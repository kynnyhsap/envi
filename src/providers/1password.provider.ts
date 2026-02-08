/**
 * 1Password secret provider.
 *
 * Uses the 1Password JavaScript SDK to resolve secrets.
 * Supports both service account tokens and desktop app authentication.
 */

import { createClient, DesktopAuth, type Client } from '@1password/sdk'

import { VERSION } from '../config'
import { exec } from '../runtime/exec'
import type { AuthInfo, AuthFailureHints, AvailabilityResult, Provider, ResolveSecretsResult } from './provider'

let cachedClient: Client | null = null

export class OnePasswordProvider implements Provider {
  readonly id = '1password'
  readonly name = '1Password'
  readonly scheme = 'op://'

  private accountName: string | undefined

  constructor(options: Record<string, string> = {}) {
    this.accountName = options['accountName'] ?? process.env['OP_ACCOUNT_NAME']
  }

  getAuthInfo(): AuthInfo {
    const serviceAccountToken = process.env['OP_SERVICE_ACCOUNT_TOKEN']
    if (serviceAccountToken) {
      return { type: 'service-account', identifier: 'OP_SERVICE_ACCOUNT_TOKEN' }
    }
    return { type: 'desktop-app', identifier: this.accountName ?? 'unknown' }
  }

  async checkAvailability(): Promise<AvailabilityResult> {
    const hasServiceToken = !!process.env['OP_SERVICE_ACCOUNT_TOKEN']
    const appRunning = await is1PasswordAppRunning()
    const statusLines: string[] = []

    if (hasServiceToken) {
      statusLines.push('OP_SERVICE_ACCOUNT_TOKEN: found')
    } else {
      statusLines.push('OP_SERVICE_ACCOUNT_TOKEN: not set')
    }

    if (appRunning) {
      statusLines.push('1Password desktop app: running')
    } else {
      statusLines.push('1Password desktop app: not running')
    }

    if (!hasServiceToken && !appRunning) {
      return {
        available: false,
        statusLines,
        helpLines: [
          'To authenticate, either:',
          '1. Open the 1Password desktop app',
          '2. Set OP_SERVICE_ACCOUNT_TOKEN env var',
        ],
      }
    }

    return { available: true, statusLines }
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

  getAuthFailureHints(): AuthFailureHints {
    const authInfo = this.getAuthInfo()
    if (authInfo.type === 'desktop-app') {
      return { lines: ['Make sure "Integrate with other apps" is enabled in Settings > Developer'] }
    }
    return { lines: ['Check your OP_SERVICE_ACCOUNT_TOKEN value'] }
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
    if (authInfo.type === 'desktop-app' && !this.accountName) {
      throw new Error(
        '1Password account name is required for desktop app auth. ' +
          'Set OP_ACCOUNT_NAME env var or configure providers.1password.accountName.',
      )
    }

    const auth = authInfo.type === 'service-account' ? authInfo.identifier : new DesktopAuth(this.accountName!)

    cachedClient = await createClient({
      auth,
      integrationName: 'envi-cli',
      integrationVersion: VERSION,
    })

    return cachedClient
  }
}

/** Check if the 1Password desktop app process is running. */
async function is1PasswordAppRunning(): Promise<boolean> {
  const result = await exec('pgrep', ['-x', '1Password'])
  return result.exitCode === 0
}
