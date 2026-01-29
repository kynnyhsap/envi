/**
 * 1Password secret provider.
 *
 * Uses the 1Password JavaScript SDK to resolve secrets.
 * Supports both service account tokens and desktop app authentication.
 */

import { createClient, DesktopAuth, type Client } from '@1password/sdk'
import { VERSION } from '../config'
import type { AuthInfo, Provider, ResolveSecretsResult } from './provider'

/** Default 1Password account name. */
const DEFAULT_ACCOUNT_NAME = 'Membrane'

/** 1Password account URL for service account creation. */
export const OP_ACCOUNT_URL = 'https://getmembrane.1password.com'

let cachedClient: Client | null = null

export interface OnePasswordConfig {
  accountName?: string
}

export class OnePasswordProvider implements Provider {
  readonly id = '1password'
  readonly name = '1Password'
  readonly scheme = 'op://'

  private accountName: string

  constructor(config: OnePasswordConfig = {}) {
    this.accountName = config.accountName ?? process.env['OP_ACCOUNT_NAME'] ?? DEFAULT_ACCOUNT_NAME
  }

  /** Update the account name (e.g., from CLI --account flag). */
  setAccountName(name: string): void {
    this.accountName = name
    // Reset cached client since account changed
    cachedClient = null
  }

  getAuthInfo(): AuthInfo {
    const serviceAccountToken = process.env['OP_SERVICE_ACCOUNT_TOKEN']
    if (serviceAccountToken) {
      return { type: 'service-account', identifier: serviceAccountToken }
    }
    return { type: 'desktop-app', identifier: this.accountName }
  }

  async verifyAuth(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.listVaults()
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  }

  async resolveSecret(reference: string): Promise<string> {
    const client = await this.getClient()
    return client.secrets.resolve(reference)
  }

  async resolveSecrets(references: string[]): Promise<ResolveSecretsResult> {
    const client = await this.getClient()
    const resolved = new Map<string, string>()
    const errors = new Map<string, string>()

    for (const ref of references) {
      try {
        const value = await client.secrets.resolve(ref)
        resolved.set(ref, value)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        errors.set(ref, msg)
      }
    }

    return { resolved, errors }
  }

  async listVaults(): Promise<{ id: string; name: string }[]> {
    const client = await this.getClient()
    const vaults = await client.vaults.list(undefined)
    return vaults.map((v) => ({ id: v.id, name: v.title }))
  }

  private async getClient(): Promise<Client> {
    if (cachedClient) {
      return cachedClient
    }

    const authInfo = this.getAuthInfo()
    const auth = authInfo.type === 'service-account' ? authInfo.identifier : new DesktopAuth(this.accountName)

    cachedClient = await createClient({
      auth,
      integrationName: 'envi-cli',
      integrationVersion: VERSION,
    })

    return cachedClient
  }
}

/** Check if the 1Password desktop app process is running. */
export async function is1PasswordAppRunning(): Promise<boolean> {
  try {
    const result = await Bun.$`pgrep -x "1Password"`.quiet().nothrow()
    return result.exitCode === 0
  } catch {
    return false
  }
}
