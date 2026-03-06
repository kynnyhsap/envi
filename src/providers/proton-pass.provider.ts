/**
 * Proton Pass secret provider.
 *
 * Uses the `pass-cli` command-line tool to resolve secrets.
 * Requires `pass-cli` to be installed and authenticated.
 *
 * Secret references use the `pass://vault/item/field` format.
 */

import { exec } from '../runtime/exec'
import { mapWithConcurrency } from '../utils/concurrency'
import type { AuthInfo, AuthFailureHints, AvailabilityResult, Provider, ResolveSecretsResult } from './provider'

type ProtonPassBackend = 'cli'

const DEFAULT_RESOLVE_CONCURRENCY = 8

export class ProtonPassProvider implements Provider {
  readonly id = 'proton-pass'
  readonly name = 'Proton Pass'
  readonly scheme = 'pass://'

  private backend: ProtonPassBackend
  private binary: string
  private resolveConcurrency: number
  private readonly secretCache = new Map<string, string>()
  private readonly inFlightResolutions = new Map<string, Promise<string>>()

  constructor(options: Record<string, string> = {}) {
    const rawBackend = (options['backend'] ?? 'cli').trim()
    this.backend = rawBackend === 'cli' || rawBackend === 'auto' ? 'cli' : 'cli'
    this.binary = options['cliBinary'] ?? 'pass-cli'
    this.resolveConcurrency = parsePositiveInt(
      options['resolveConcurrency'] ?? process.env['ENVI_PASS_RESOLVE_CONCURRENCY'],
      DEFAULT_RESOLVE_CONCURRENCY,
    )
  }

  getAuthInfo(): AuthInfo {
    return { type: this.backend, identifier: this.binary }
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
    const cached = this.secretCache.get(reference)
    if (cached !== undefined) return cached

    const inFlight = this.inFlightResolutions.get(reference)
    if (inFlight) return inFlight

    const promise = this.resolveSecretUncached(reference)
    this.inFlightResolutions.set(reference, promise)

    try {
      const value = await promise
      this.secretCache.set(reference, value)
      return value
    } finally {
      this.inFlightResolutions.delete(reference)
    }
  }

  async resolveSecrets(references: string[]): Promise<ResolveSecretsResult> {
    const uniqueReferences = Array.from(new Set(references))
    const resolved = new Map<string, string>()
    const errors = new Map<string, string>()

    await mapWithConcurrency(uniqueReferences, this.resolveConcurrency, async (ref) => {
      try {
        const value = await this.resolveSecret(ref)
        resolved.set(ref, value)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        errors.set(ref, msg)
      }
    })

    return { resolved, errors }
  }

  private async resolveSecretUncached(reference: string): Promise<string> {
    // Use `pass-cli item view "pass://vault/item/field"` to get a single field value
    const result = await exec(this.binary, ['item', 'view', reference, '--output', 'text'])

    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim()
      throw new Error(`Failed to resolve ${reference}: ${stderr}`)
    }

    return result.stdout.toString().trim()
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

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}
