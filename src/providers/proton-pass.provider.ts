/**
 * Proton Pass secret provider.
 *
 * Uses the `pass-cli` command-line tool to resolve secrets.
 * Requires `pass-cli` to be installed and authenticated.
 *
 * Secret references use the `pass://vault/item/field` format.
 */

import type { AuthInfo, Provider, ResolveSecretsResult } from './provider'

export interface ProtonPassConfig {
  /** Path to the pass-cli binary (default: "pass-cli") */
  cliBinary?: string
}

export class ProtonPassProvider implements Provider {
  readonly id = 'proton-pass'
  readonly name = 'Proton Pass'
  readonly scheme = 'pass://'

  private binary: string

  constructor(config: ProtonPassConfig = {}) {
    this.binary = config.cliBinary ?? 'pass-cli'
  }

  getAuthInfo(): AuthInfo {
    return { type: 'cli', identifier: this.binary }
  }

  async verifyAuth(): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await Bun.$`${this.binary} test`.quiet().nothrow()
      if (result.exitCode === 0) {
        return { success: true }
      }
      const stderr = result.stderr.toString().trim()
      return { success: false, error: stderr || `pass-cli test exited with code ${result.exitCode}` }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('not found') || msg.includes('ENOENT')) {
        return { success: false, error: `${this.binary} not found. Install it from https://proton.me/pass/download` }
      }
      return { success: false, error: msg }
    }
  }

  async resolveSecret(reference: string): Promise<string> {
    // Use `pass-cli item view "pass://vault/item/field"` to get a single field value
    const result = await Bun.$`${this.binary} item view ${reference} --output text`.quiet().nothrow()

    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim()
      throw new Error(`Failed to resolve ${reference}: ${stderr}`)
    }

    return result.stdout.toString().trim()
  }

  async resolveSecrets(references: string[]): Promise<ResolveSecretsResult> {
    const resolved = new Map<string, string>()
    const errors = new Map<string, string>()

    for (const ref of references) {
      try {
        const value = await this.resolveSecret(ref)
        resolved.set(ref, value)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        errors.set(ref, msg)
      }
    }

    return { resolved, errors }
  }

  async listVaults(): Promise<{ id: string; name: string }[]> {
    const result = await Bun.$`${this.binary} vault list --output json`.quiet().nothrow()

    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim()
      throw new Error(`Failed to list vaults: ${stderr}`)
    }

    const output = result.stdout.toString().trim()
    try {
      const vaults = JSON.parse(output) as Array<{ share_id?: string; name?: string }>
      return vaults.map((v) => ({
        id: v.share_id ?? '',
        name: v.name ?? '',
      }))
    } catch {
      throw new Error(`Failed to parse vault list output: ${output}`)
    }
  }
}
