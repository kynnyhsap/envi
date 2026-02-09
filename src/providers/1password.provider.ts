/**
 * 1Password secret provider.
 *
 * Prefers the JavaScript SDK (`@1password/sdk`) when available and authenticated.
 * Users can opt into the 1Password CLI (`op`) via `--provider-opt backend=cli`.
 */

import { createClient, DesktopAuth, type Client } from '@1password/sdk'

import { VERSION } from '../config'
import { exec, type ExecResult } from '../runtime/exec'
import type { AuthInfo, AuthFailureHints, AvailabilityResult, Provider, ResolveSecretsResult } from './provider'

type BackendMode = 'auto' | 'cli' | 'sdk'
type SelectedBackend = 'cli' | 'sdk'

interface OnePasswordDeps {
  exec?: (command: string, args?: string[]) => Promise<ExecResult>
  createClient?: typeof createClient
  DesktopAuth?: typeof DesktopAuth
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
  private readonly cliBinary: string
  private readonly accountName: string | undefined

  private readonly _exec: (command: string, args?: string[]) => Promise<ExecResult>
  private readonly _createClient: typeof createClient
  private readonly _DesktopAuth: typeof DesktopAuth

  private sdkClient: Client | null = null
  private selectedBackend: SelectedBackend | null = null
  private authVerified = false
  private lastAuthAttempt: AuthAttemptState | null = null

  constructor(options: Record<string, string> = {}, deps: OnePasswordDeps = {}) {
    const rawBackend = (options['backend'] ?? 'sdk').trim()
    this.backend = isBackendMode(rawBackend) ? rawBackend : 'auto'
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
        lines.push('Set OP_ACCOUNT_NAME or pass --provider-opt accountName=<name>')
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

    if (this.selectedBackend === 'cli') {
      return this.cliRead(reference)
    }

    const client = await this.getSdkClient()
    return client.secrets.resolve(reference)
  }

  async resolveSecrets(references: string[]): Promise<ResolveSecretsResult> {
    await this.ensureAuthenticated()

    const resolved = new Map<string, string>()
    const errors = new Map<string, string>()

    if (this.selectedBackend === 'cli') {
      for (const ref of references) {
        try {
          resolved.set(ref, await this.cliRead(ref))
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          errors.set(ref, msg)
        }
      }
      return { resolved, errors }
    }

    const client = await this.getSdkClient()
    for (const ref of references) {
      try {
        resolved.set(ref, await client.secrets.resolve(ref))
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        errors.set(ref, msg)
      }
    }

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

  private getSdkAuthInfo(): AuthInfo {
    const token = process.env['OP_SERVICE_ACCOUNT_TOKEN']
    if (token) {
      return { type: 'service-account', identifier: 'set' }
    }
    return { type: 'desktop-app', identifier: this.accountName ?? 'unknown' }
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

    const hasAccountName = !!this.accountName
    statusLines.push(hasAccountName ? 'OP_ACCOUNT_NAME: set' : 'OP_ACCOUNT_NAME: not set')

    // We consider desktop auth "available" when the app is running; the auth attempt may still
    // fail with a more specific error (e.g. missing OP_ACCOUNT_NAME).
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
    const auth = token ? token : this.getDesktopAuth()

    this.sdkClient = await this._createClient({
      auth,
      integrationName: 'envi-cli',
      integrationVersion: VERSION,
    })

    return this.sdkClient
  }

  private getDesktopAuth() {
    if (!this.accountName) {
      throw new Error(
        '1Password account name is required for desktop app auth. ' +
          'Set OP_ACCOUNT_NAME env var or configure providers.1password.accountName.',
      )
    }
    return new this._DesktopAuth(this.accountName)
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
