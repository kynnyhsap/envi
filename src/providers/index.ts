/**
 * Provider registry.
 *
 * Single source of truth for provider definitions, scheme mappings,
 * and reference utilities. All scheme knowledge derives from PROVIDER_DEFS.
 */

export type { Provider, SecretReference, ResolveSecretsResult, AuthInfo } from './provider'
export { parseSecretReference } from './provider'

export { OnePasswordProvider } from './1password.provider'
export { ProtonPassProvider } from './proton-pass.provider'

import { OnePasswordProvider } from './1password.provider'
import { ProtonPassProvider } from './proton-pass.provider'
import type { Provider } from './provider'

// ---------------------------------------------------------------------------
// Provider definitions — the single source of truth
// ---------------------------------------------------------------------------

export type ProviderType = '1password' | 'proton-pass'

interface ProviderDef {
  id: ProviderType
  scheme: string
  create: (options: Record<string, string>) => Provider
}

const PROVIDER_DEFS: ProviderDef[] = [
  { id: '1password', scheme: 'op://', create: (opts) => new OnePasswordProvider(opts) },
  { id: 'proton-pass', scheme: 'pass://', create: (opts) => new ProtonPassProvider(opts) },
]

// ---------------------------------------------------------------------------
// Derived constants
// ---------------------------------------------------------------------------

export const VALID_PROVIDERS: ProviderType[] = PROVIDER_DEFS.map((d) => d.id)

const SCHEME_TO_PROVIDER = new Map(PROVIDER_DEFS.map((d) => [d.scheme, d.id]))

export const SECRET_SCHEMES = ['envi://', ...SCHEME_TO_PROVIDER.keys()] as const

// ---------------------------------------------------------------------------
// Reference utilities
// ---------------------------------------------------------------------------

export function isSecretReference(value: string): boolean {
  const trimmed = value.trim()
  return SECRET_SCHEMES.some((scheme) => trimmed.startsWith(scheme))
}

/** Returns undefined for `envi://` (use configured default). */
export function detectProvider(reference: string): ProviderType | undefined {
  const trimmed = reference.trim()
  for (const [scheme, providerId] of SCHEME_TO_PROVIDER) {
    if (trimmed.startsWith(scheme)) {
      return providerId
    }
  }
  return undefined
}

/** Converts `envi://` to the provider's native scheme. Native refs pass through unchanged. */
export function toNativeReference(reference: string, providerScheme: string): string {
  const trimmed = reference.trim()

  // Already in a native format — pass through
  if (SCHEME_TO_PROVIDER.has(trimmed.slice(0, trimmed.indexOf('://') + 3))) {
    return trimmed
  }

  // Convert envi:// to native
  if (trimmed.startsWith('envi://')) {
    return `${providerScheme}${trimmed.slice('envi://'.length)}`
  }

  return trimmed
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createProvider(id: ProviderType, options: Record<string, string> = {}): Provider {
  const def = PROVIDER_DEFS.find((d) => d.id === id)
  if (!def) throw new Error(`Unknown provider: ${id}`)
  return def.create(options)
}
