/**
 * Proton Pass secret provider.
 *
 * Uses the `pass-cli` command-line tool to resolve secrets.
 * Requires `pass-cli` to be installed and authenticated.
 *
 * Secret references use the `pass://vault/item/field` format.
 */

import { exec } from '../runtime/exec'
import type { AuthInfo, AuthFailureHints, AvailabilityResult, Provider, ResolveSecretsResult } from './provider'

export class ProtonPassProvider implements Provider {
  readonly id = 'proton-pass'
  readonly name = 'Proton Pass'
  readonly scheme = 'pass://'

  private binary: string

  constructor(options: Record<string, string> = {}) {
    this.binary = options['cliBinary'] ?? 'pass-cli'
  }

  getAuthInfo(): AuthInfo {
    return { type: 'cli', identifier: this.binary }
  }

  async checkAvailability(): Promise<AvailabilityResult> {
    try {
      const result = await exec('which', [this.binary])
      if (result.exitCode === 0) {
        return { available: true, statusLines: [`${this.binary}: installed`] }
      }
    } catch {
      // fall through
    }
    return {
      available: false,
      statusLines: [`${this.binary}: not found`],
      helpLines: [`Install pass-cli from https://proton.me/pass/download`, `Then run: pass-cli login`],
    }
  }

  getAuthFailureHints(): AuthFailureHints {
    return {
      lines: [`Make sure ${this.binary} is installed and you are logged in`, `Run: ${this.binary} login`],
    }
  }

  async verifyAuth(): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await exec(this.binary, ['test'])
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
    const result = await exec(this.binary, ['item', 'view', reference, '--output', 'text'])

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
    const result = await exec(this.binary, ['vault', 'list', '--output', 'json'])

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
