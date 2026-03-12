/**
 * 1Password secret provider (SDK-only).
 */

import { createClient, DesktopAuth, type Client } from '@1password/sdk'

import { VERSION } from '../../app/config'
import { mapWithConcurrency } from '../../shared/concurrency'
import { exec, type ExecResult } from '../../shared/process/exec'
import type { AuthFailureHints, AuthInfo, AvailabilityResult, Provider, ResolveSecretsResult } from '../provider'

type ResolveMode = 'auto' | 'batch' | 'sequential'

const DEFAULT_RESOLVE_CHUNK_SIZE = 100
const DEFAULT_RESOLVE_CONCURRENCY = 8
const SDK_TIMEOUT_MS = 10_000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

interface OnePasswordDeps {
  exec?: (command: string, args?: string[], timeoutMs?: number) => Promise<ExecResult>
  createClient?: typeof createClient
  DesktopAuth?: typeof DesktopAuth
}

export class OnePasswordProvider implements Provider {
  readonly id = '1password'
  readonly name = '1Password'
  readonly scheme = 'op://'

  private readonly resolveMode: ResolveMode
  private readonly resolveChunkSize: number
  private readonly resolveConcurrency: number
  private readonly accountName: string | undefined

  private readonly _exec: (command: string, args?: string[], timeoutMs?: number) => Promise<ExecResult>
  private readonly _createClient: typeof createClient
  private readonly _DesktopAuth: typeof DesktopAuth

  private sdkClient: Client | null = null
  private authVerified = false
  private lastAuthError: string | null = null
  private readonly secretCache = new Map<string, string>()
  private readonly inFlightResolutions = new Map<string, Promise<string>>()

  constructor(options: Record<string, string> = {}, deps: OnePasswordDeps = {}) {
    const rawResolveMode = (options['resolveMode'] ?? process.env['ENVI_OP_RESOLVE_MODE'] ?? 'auto').trim()
    this.resolveMode = isResolveMode(rawResolveMode) ? rawResolveMode : 'auto'

    this.resolveChunkSize = parsePositiveInt(
      options['resolveChunkSize'] ?? process.env['ENVI_OP_RESOLVE_CHUNK_SIZE'],
      DEFAULT_RESOLVE_CHUNK_SIZE,
    )
    this.resolveConcurrency = parsePositiveInt(
      options['resolveConcurrency'] ?? process.env['ENVI_OP_RESOLVE_CONCURRENCY'],
      DEFAULT_RESOLVE_CONCURRENCY,
    )

    this.accountName = options['accountName'] ?? process.env['OP_ACCOUNT_NAME']

    this._exec = deps.exec ?? exec
    this._createClient = deps.createClient ?? createClient
    this._DesktopAuth = deps.DesktopAuth ?? DesktopAuth
  }

  getAuthInfo(): AuthInfo {
    return this.getSdkAuthInfo()
  }

  async checkAvailability(): Promise<AvailabilityResult> {
    const statusLines: string[] = []

    const token = process.env['OP_SERVICE_ACCOUNT_TOKEN']
    if (token) {
      statusLines.push('OP_SERVICE_ACCOUNT_TOKEN: found')
      return { available: true, statusLines }
    }

    statusLines.push('OP_SERVICE_ACCOUNT_TOKEN: not set')

    const appRunning = await is1PasswordAppRunning(this._exec)
    statusLines.push(appRunning ? '1Password desktop app: running' : '1Password desktop app: not running')

    if (this.accountName) {
      statusLines.push(`OP_ACCOUNT_NAME: set (${this.accountName})`)
    } else {
      statusLines.push('OP_ACCOUNT_NAME: not set')
    }

    const available = appRunning && !!this.accountName
    if (!available) {
      return {
        available: false,
        statusLines,
        helpLines: [
          'Configure 1Password SDK authentication:',
          '- Set OP_SERVICE_ACCOUNT_TOKEN (CI/CD)',
          '- Or set OP_ACCOUNT_NAME and open the 1Password desktop app (local dev)',
        ],
      }
    }

    return { available: true, statusLines }
  }

  async verifyAuth(): Promise<{ success: boolean; error?: string }> {
    return this.verifySdkAuth()
  }

  getAuthFailureHints(): AuthFailureHints {
    const sdkInfo = this.getSdkAuthInfo()
    if (sdkInfo.type === 'service-account') {
      return { lines: ['Check your OP_SERVICE_ACCOUNT_TOKEN value'] }
    }

    const lines: string[] = ['Make sure "Integrate with other apps" is enabled in Settings > Developer']
    if (!this.accountName) {
      lines.push('Set OP_ACCOUNT_NAME env var (for example: my.1password.com)')
      return { lines }
    }

    const sdkError = this.lastAuthError
    if (sdkError && sdkError.toLowerCase().includes('account not found')) {
      lines.push('Check OP_ACCOUNT_NAME: it must match an account in the 1Password desktop app')
      lines.push('Common values look like a sign-in address (e.g. my.1password.com, my.1password.eu)')
    }

    return { lines }
  }

  async resolveSecret(reference: string): Promise<string> {
    await this.ensureAuthenticated()
    if (this.resolveMode === 'sequential') {
      return this.resolveReference(reference)
    }
    return this.resolveReferenceCached(reference)
  }

  async resolveSecrets(references: string[]): Promise<ResolveSecretsResult> {
    await this.ensureAuthenticated()

    const uniqueReferences = uniqueStrings(references)
    const resolved = new Map<string, string>()
    const errors = new Map<string, string>()
    const useCache = this.resolveMode !== 'sequential'

    if (uniqueReferences.length === 0) {
      return { resolved, errors }
    }

    const toFetch: string[] = []
    for (const reference of uniqueReferences) {
      if (useCache) {
        const cached = this.secretCache.get(reference)
        if (cached !== undefined) {
          resolved.set(reference, cached)
          continue
        }
      }

      toFetch.push(reference)
    }

    if (toFetch.length === 0) {
      return { resolved, errors }
    }

    const client = await this.getSdkClient()
    await this.resolveSecretsViaSdk(client, toFetch, resolved, errors)

    return { resolved, errors }
  }

  async listVaults(): Promise<{ id: string; name: string }[]> {
    await this.ensureAuthenticated()

    const client = await this.getSdkClient()
    const vaults = await client.vaults.list(undefined)
    return vaults.map((vault) => ({ id: vault.id, name: vault.title }))
  }

  private getSdkAuthInfo(): AuthInfo {
    const token = process.env['OP_SERVICE_ACCOUNT_TOKEN']
    if (token) {
      return { type: 'service-account', identifier: 'set' }
    }

    return { type: 'desktop-app', identifier: this.accountName ?? 'unknown' }
  }

  private async verifySdkAuth(): Promise<{ success: boolean; error?: string }> {
    try {
      const client = await this.getSdkClient()
      await withTimeout(
        client.vaults.list(undefined),
        SDK_TIMEOUT_MS,
        'Timed out listing vaults (is desktop app integration enabled?)',
      )
      this.authVerified = true
      this.lastAuthError = null
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.lastAuthError = message
      return { success: false, error: message }
    }
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.authVerified) return

    const result = await this.verifyAuth()
    if (!result.success) {
      throw new Error(result.error ?? 'Authentication failed')
    }
  }

  private async getSdkClient(): Promise<Client> {
    if (this.sdkClient) return this.sdkClient

    const token = process.env['OP_SERVICE_ACCOUNT_TOKEN']
    const auth = token ? token : this.getDesktopAuth()

    this.sdkClient = await withTimeout(
      this._createClient({
        auth,
        integrationName: 'envi-cli',
        integrationVersion: VERSION,
      }),
      SDK_TIMEOUT_MS,
      'Timed out connecting to 1Password (is desktop app integration enabled?)',
    )

    return this.sdkClient
  }

  private getDesktopAuth() {
    if (!this.accountName) {
      throw new Error('1Password account name is required for desktop app auth. Set OP_ACCOUNT_NAME env var.')
    }

    return new this._DesktopAuth(this.accountName)
  }

  private async resolveReferenceCached(reference: string): Promise<string> {
    const cached = this.secretCache.get(reference)
    if (cached !== undefined) return cached

    const inFlight = this.inFlightResolutions.get(reference)
    if (inFlight) return inFlight

    const promise = this.resolveReference(reference)
    this.inFlightResolutions.set(reference, promise)

    try {
      const value = await promise
      this.secretCache.set(reference, value)
      return value
    } finally {
      this.inFlightResolutions.delete(reference)
    }
  }

  private async resolveReference(reference: string): Promise<string> {
    const client = await this.getSdkClient()
    return client.secrets.resolve(reference)
  }

  private async resolveSecretsViaSdk(
    client: Client,
    references: string[],
    resolved: Map<string, string>,
    errors: Map<string, string>,
  ): Promise<void> {
    const useSequential = this.resolveMode === 'sequential'
    const useBatch = this.resolveMode === 'batch' || this.resolveMode === 'auto'

    if (useSequential) {
      for (const reference of references) {
        try {
          resolved.set(reference, await this.resolveReference(reference))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          errors.set(reference, message)
        }
      }
      return
    }

    if (useBatch) {
      const chunks = chunkArray(references, this.resolveChunkSize)
      let batchFailed = false

      for (const chunk of chunks) {
        const ok = await this.tryResolveSdkBatchChunk(client, chunk, resolved, errors)
        if (!ok) {
          batchFailed = true
          break
        }
      }

      if (!batchFailed) return
    }

    await mapWithConcurrency(references, this.resolveConcurrency, async (reference) => {
      try {
        resolved.set(reference, await this.resolveReferenceCached(reference))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.set(reference, message)
      }
    })
  }

  private async tryResolveSdkBatchChunk(
    client: Client,
    references: string[],
    resolved: Map<string, string>,
    errors: Map<string, string>,
  ): Promise<boolean> {
    try {
      const response = await client.secrets.resolveAll(references)
      const individualResponses = response.individualResponses

      for (const reference of references) {
        const item = individualResponses[reference]
        if (!item) {
          errors.set(reference, 'No response returned for reference')
          continue
        }

        if (item.error) {
          errors.set(reference, formatResolveReferenceError(item.error))
          continue
        }

        const value = item.content?.secret
        if (typeof value === 'string') {
          this.secretCache.set(reference, value)
          resolved.set(reference, value)
          continue
        }

        errors.set(reference, 'Resolved response did not include a secret value')
      }

      return true
    } catch {
      return false
    }
  }
}

function isResolveMode(value: string): value is ResolveMode {
  return value === 'auto' || value === 'batch' || value === 'sequential'
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (items.length === 0) return []

  const size = Math.max(1, Math.floor(chunkSize))
  if (items.length <= size) return [items]

  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function formatResolveReferenceError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return String(error)
  }

  const maybeMessage = Reflect.get(error, 'message')
  if (typeof maybeMessage === 'string' && maybeMessage.trim().length > 0) {
    return maybeMessage
  }

  const maybeType = Reflect.get(error, 'type')
  if (typeof maybeType === 'string' && maybeType.trim().length > 0) {
    return maybeType
  }

  return 'Failed to resolve reference'
}

async function is1PasswordAppRunning(
  run: (command: string, args?: string[], timeoutMs?: number) => Promise<ExecResult>,
): Promise<boolean> {
  if (process.platform === 'win32') return false
  const result = await run('pgrep', ['-x', '1Password'])
  return result.exitCode === 0
}
