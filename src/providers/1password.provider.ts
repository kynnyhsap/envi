/**
 * 1Password secret provider.
 *
 * Prefers the JavaScript SDK (`@1password/sdk`) when available and authenticated.
 * Users can opt into the 1Password CLI (`op`) via `--provider-opt backend=cli`.
 */

import { createClient, DesktopAuth, type Client } from '@1password/sdk'

import { VERSION } from '../config'
import { exec, type ExecResult } from '../runtime/exec'
import { mapWithConcurrency } from '../utils/concurrency'
import type { AuthInfo, AuthFailureHints, AvailabilityResult, Provider, ResolveSecretsResult } from './provider'

type BackendMode = 'auto' | 'cli' | 'sdk'
type SelectedBackend = 'cli' | 'sdk'
type ResolveMode = 'auto' | 'batch' | 'sequential'

const DEFAULT_RESOLVE_CHUNK_SIZE = 100
const DEFAULT_RESOLVE_CONCURRENCY = 8

interface OnePasswordDeps {
  exec?: (command: string, args?: string[]) => Promise<ExecResult>
  createClient?: typeof createClient
  DesktopAuth?: typeof DesktopAuth
}

interface OpAccount {
  url?: string
  email?: string
  user_uuid?: string
  account_uuid?: string
}

interface AuthAttemptState {
  tried: SelectedBackend[]
  cliError?: string
  sdkError?: string
}

export class OnePasswordProvider implements Provider {
  readonly id = '1password'
  readonly name = '1Password'
  readonly scheme = 'op://'

  private readonly backend: BackendMode
  private readonly resolveMode: ResolveMode
  private readonly resolveChunkSize: number
  private readonly resolveConcurrency: number
  private readonly cliBinary: string
  private readonly accountName: string | undefined
  private detectedAccountName: string | undefined

  private readonly _exec: (command: string, args?: string[]) => Promise<ExecResult>
  private readonly _createClient: typeof createClient
  private readonly _DesktopAuth: typeof DesktopAuth

  private sdkClient: Client | null = null
  private selectedBackend: SelectedBackend | null = null
  private authVerified = false
  private lastAuthAttempt: AuthAttemptState | null = null
  private readonly secretCache = new Map<string, string>()
  private readonly inFlightResolutions = new Map<string, Promise<string>>()

  constructor(options: Record<string, string> = {}, deps: OnePasswordDeps = {}) {
    const rawBackend = (options['backend'] ?? 'sdk').trim()
    this.backend = isBackendMode(rawBackend) ? rawBackend : 'auto'

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

    this.cliBinary = options['cliBinary'] ?? 'op'
    this.accountName = options['accountName'] ?? process.env['OP_ACCOUNT_NAME']

    this._exec = deps.exec ?? exec
    this._createClient = deps.createClient ?? createClient
    this._DesktopAuth = deps.DesktopAuth ?? DesktopAuth
  }

  getAuthInfo(): AuthInfo {
    const active = this.selectedBackend
    if (active === 'cli') {
      return { type: 'cli', identifier: this.cliBinary }
    }
    if (active === 'sdk') {
      return this.getSdkAuthInfo()
    }

    if (this.backend === 'cli') {
      return { type: 'cli', identifier: this.cliBinary }
    }
    if (this.backend === 'sdk') {
      return this.getSdkAuthInfo()
    }

    return { type: 'auto', identifier: 'sdk->cli' }
  }

  async checkAvailability(): Promise<AvailabilityResult> {
    const [cli, sdk] = await Promise.all([this.checkCliAvailability(), this.checkSdkAvailability()])

    const statusLines: string[] = []
    statusLines.push(cli.available ? `${this.cliBinary}: installed` : `${this.cliBinary}: not found`)
    for (const line of sdk.statusLines) statusLines.push(line)

    const available =
      this.backend === 'cli' ? cli.available : this.backend === 'sdk' ? sdk.available : sdk.available || cli.available

    if (!available) {
      return {
        available: false,
        statusLines,
        helpLines: [
          `Install and sign in to 1Password CLI (${this.cliBinary}), or configure the SDK:`,
          `- Set OP_SERVICE_ACCOUNT_TOKEN (CI/CD)`,
          `- Or set OP_ACCOUNT_NAME and open the 1Password desktop app (local dev)`,
        ],
      }
    }

    return { available: true, statusLines }
  }

  async verifyAuth(): Promise<{ success: boolean; error?: string }> {
    this.lastAuthAttempt = { tried: [] }

    if (this.backend === 'cli') {
      const result = await this.verifyCliAuth()
      return result
    }

    if (this.backend === 'sdk') {
      const result = await this.verifySdkAuth()
      return result
    }

    const sdkAvailable = (await this.checkSdkAvailability()).available
    const cliAvailable = (await this.checkCliAvailability()).available

    if (sdkAvailable) {
      const sdk = await this.verifySdkAuth()
      if (sdk.success) return sdk
    }

    if (cliAvailable) {
      const cli = await this.verifyCliAuth()
      if (cli.success) return cli
    }

    const sdkError = this.lastAuthAttempt?.sdkError
    const cliError = this.lastAuthAttempt?.cliError

    if (sdkError && cliError) {
      return { success: false, error: `SDK: ${sdkError}; CLI: ${cliError}` }
    }
    return { success: false, error: sdkError ?? cliError ?? 'No authentication method available' }
  }

  getAuthFailureHints(): AuthFailureHints {
    const tried = this.lastAuthAttempt?.tried ?? []

    const lines: string[] = []

    if (tried.includes('sdk')) {
      const sdkInfo = this.getSdkAuthInfo()
      if (sdkInfo.type === 'desktop-app') {
        lines.push('Make sure "Integrate with other apps" is enabled in Settings > Developer')
        const sdkError = this.lastAuthAttempt?.sdkError
        if (sdkError && sdkError.toLowerCase().includes('account not found')) {
          lines.push('Check OP_ACCOUNT_NAME / --provider-opt accountName: it must match an account in the desktop app')
          lines.push('Common values look like a sign-in address (e.g. my.1password.com, my.1password.eu)')
        } else {
          lines.push('Set OP_ACCOUNT_NAME or pass --provider-opt accountName=<name>')
        }
      } else {
        lines.push('Check your OP_SERVICE_ACCOUNT_TOKEN value')
      }
    }

    if (tried.includes('cli')) {
      lines.push(`If you want to use the CLI, make sure you're signed in: ${this.cliBinary} whoami`)
      lines.push(`Then run: ${this.cliBinary} signin`)
    }

    return { lines: lines.length > 0 ? lines : ['No authentication method available'] }
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

    if (this.selectedBackend === 'cli') {
      await this.resolveSecretsViaCli(toFetch, resolved, errors)
      return { resolved, errors }
    }

    const client = await this.getSdkClient()
    await this.resolveSecretsViaSdk(client, toFetch, resolved, errors)

    return { resolved, errors }
  }

  async listVaults(): Promise<{ id: string; name: string }[]> {
    await this.ensureAuthenticated()

    if (this.selectedBackend === 'cli') {
      return this.cliListVaults()
    }

    const client = await this.getSdkClient()
    const vaults = await client.vaults.list(undefined)
    return vaults.map((v) => ({ id: v.id, name: v.title }))
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
    if (this.selectedBackend === 'cli') {
      return this.cliRead(reference)
    }

    const client = await this.getSdkClient()
    return client.secrets.resolve(reference)
  }

  private async resolveSecretsViaCli(
    references: string[],
    resolved: Map<string, string>,
    errors: Map<string, string>,
  ): Promise<void> {
    if (this.resolveMode === 'sequential') {
      for (const reference of references) {
        try {
          resolved.set(reference, await this.resolveReference(reference))
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          errors.set(reference, msg)
        }
      }
      return
    }

    await mapWithConcurrency(references, this.resolveConcurrency, async (reference) => {
      try {
        resolved.set(reference, await this.resolveReferenceCached(reference))
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        errors.set(reference, msg)
      }
    })
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
          const msg = error instanceof Error ? error.message : String(error)
          errors.set(reference, msg)
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

      if (!batchFailed) {
        return
      }
    }

    await mapWithConcurrency(references, this.resolveConcurrency, async (reference) => {
      try {
        resolved.set(reference, await this.resolveReferenceCached(reference))
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        errors.set(reference, msg)
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

  private getSdkAuthInfo(): AuthInfo {
    const token = process.env['OP_SERVICE_ACCOUNT_TOKEN']
    if (token) {
      return { type: 'service-account', identifier: 'set' }
    }
    return { type: 'desktop-app', identifier: this.getEffectiveAccountName() ?? 'unknown' }
  }

  private getEffectiveAccountName(): string | undefined {
    return this.accountName ?? this.detectedAccountName
  }

  private async detectAccountNameFromOp(): Promise<string | undefined> {
    if (this.detectedAccountName) return this.detectedAccountName

    const available = (await this.checkCliAvailability()).available
    if (!available) return undefined

    const result = await this._exec(this.cliBinary, ['account', 'list', '--format', 'json'])
    if (result.exitCode !== 0) return undefined

    const out = result.stdout.trim()
    if (!out) return undefined

    let accounts: OpAccount[]
    try {
      accounts = JSON.parse(out) as OpAccount[]
    } catch {
      return undefined
    }

    const urls = accounts.map((a) => (a.url ?? '').trim()).filter((u) => u.length > 0)

    if (urls.length === 0) return undefined

    const personal = urls.find((u) => u.startsWith('my.'))
    this.detectedAccountName = personal ?? urls[0]
    return this.detectedAccountName
  }

  private async checkCliAvailability(): Promise<{ available: boolean }> {
    const result = await this._exec(this.cliBinary, ['--version'])
    if (result.exitCode === 0) return { available: true }

    const err = `${result.stderr}\n${result.stdout}`
    if (looksLikeCommandNotFound(err)) {
      return { available: false }
    }
    // If the binary exists but exited non-zero, treat as available.
    return { available: true }
  }

  private async checkSdkAvailability(): Promise<{ available: boolean; statusLines: string[] }> {
    const statusLines: string[] = []

    const token = process.env['OP_SERVICE_ACCOUNT_TOKEN']
    if (token) {
      statusLines.push('OP_SERVICE_ACCOUNT_TOKEN: found')
      return { available: true, statusLines }
    }
    statusLines.push('OP_SERVICE_ACCOUNT_TOKEN: not set')

    const appRunning = await is1PasswordAppRunning(this._exec)
    statusLines.push(appRunning ? '1Password desktop app: running' : '1Password desktop app: not running')

    let hasAccountName = !!this.accountName
    if (!hasAccountName && appRunning) {
      const detected = await this.detectAccountNameFromOp()
      if (detected) {
        statusLines.push(`OP_ACCOUNT_NAME: auto (${detected})`)
        hasAccountName = true
      }
    }

    if (!hasAccountName) {
      statusLines.push('OP_ACCOUNT_NAME: not set')
    }

    // We consider desktop auth "available" when the app is running; the auth attempt may still
    // fail with a more specific error.
    const available = appRunning
    return { available, statusLines }
  }

  private async verifyCliAuth(): Promise<{ success: boolean; error?: string }> {
    this.lastAuthAttempt?.tried.push('cli')

    const available = (await this.checkCliAvailability()).available
    if (!available) {
      const error = `${this.cliBinary} not found`
      if (this.lastAuthAttempt) this.lastAuthAttempt.cliError = error
      return { success: false, error }
    }

    const result = await this._exec(this.cliBinary, ['whoami', '--format', 'json'])
    if (result.exitCode === 0) {
      this.selectedBackend = 'cli'
      this.authVerified = true
      return { success: true }
    }

    const error = normalizeCliError(result, `${this.cliBinary} whoami`)
    if (this.lastAuthAttempt) this.lastAuthAttempt.cliError = error
    return { success: false, error }
  }

  private async verifySdkAuth(): Promise<{ success: boolean; error?: string }> {
    this.lastAuthAttempt?.tried.push('sdk')

    try {
      const client = await this.getSdkClient()
      await client.vaults.list(undefined)
      this.selectedBackend = 'sdk'
      this.authVerified = true
      return { success: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (this.lastAuthAttempt) this.lastAuthAttempt.sdkError = msg
      return { success: false, error: msg }
    }
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.authVerified && this.selectedBackend) return

    const result = await this.verifyAuth()
    if (!result.success) {
      throw new Error(result.error ?? 'Authentication failed')
    }
  }

  private async getSdkClient(): Promise<Client> {
    if (this.sdkClient) return this.sdkClient

    const token = process.env['OP_SERVICE_ACCOUNT_TOKEN']
    const auth = token ? token : await this.getDesktopAuth()

    this.sdkClient = await this._createClient({
      auth,
      integrationName: 'envi-cli',
      integrationVersion: VERSION,
    })

    return this.sdkClient
  }

  private async getDesktopAuth() {
    const accountName = this.accountName ?? (await this.detectAccountNameFromOp())
    if (!accountName) {
      throw new Error(
        '1Password account name is required for desktop app auth. ' +
          'Set OP_ACCOUNT_NAME env var or pass --provider-opt accountName=<name>.',
      )
    }
    return new this._DesktopAuth(accountName)
  }

  private async cliRead(reference: string): Promise<string> {
    const result = await this._exec(this.cliBinary, ['read', reference])
    if (result.exitCode !== 0) {
      throw new Error(`Failed to resolve ${reference}: ${normalizeCliError(result, `${this.cliBinary} read`)}`)
    }
    return stripFinalNewline(result.stdout)
  }

  private async cliListVaults(): Promise<{ id: string; name: string }[]> {
    const result = await this._exec(this.cliBinary, ['vault', 'list', '--format', 'json'])
    if (result.exitCode !== 0) {
      throw new Error(`Failed to list vaults: ${normalizeCliError(result, `${this.cliBinary} vault list`)}`)
    }

    const out = result.stdout.trim()
    try {
      const parsed = JSON.parse(out) as Array<{ id?: string; name?: string; title?: string }>
      return parsed.map((v) => ({ id: v.id ?? '', name: v.name ?? v.title ?? '' }))
    } catch {
      throw new Error(`Failed to parse vault list output: ${out}`)
    }
  }
}

function isBackendMode(value: string): value is BackendMode {
  return value === 'auto' || value === 'cli' || value === 'sdk'
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
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
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

function stripFinalNewline(value: string): string {
  if (value.endsWith('\r\n')) return value.slice(0, -2)
  if (value.endsWith('\n')) return value.slice(0, -1)
  return value
}

function looksLikeCommandNotFound(text: string): boolean {
  const t = text.toLowerCase()
  return t.includes('enoent') || t.includes('not found') || t.includes('spawn')
}

function normalizeCliError(result: ExecResult, commandLabel: string): string {
  const stderr = result.stderr.trim()
  const stdout = result.stdout.trim()
  if (stderr) return stderr
  if (stdout) return stdout
  return `${commandLabel} exited with code ${result.exitCode}`
}

/** Check if the 1Password desktop app process is running. */
async function is1PasswordAppRunning(run: (command: string, args?: string[]) => Promise<ExecResult>): Promise<boolean> {
  if (process.platform === 'win32') return false
  const result = await run('pgrep', ['-x', '1Password'])
  return result.exitCode === 0
}
