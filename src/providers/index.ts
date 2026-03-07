/**
 * Provider registry.
 *
 * Single source of truth for provider definitions, scheme mappings,
 * and reference utilities. All scheme knowledge derives from PROVIDER_DEFS.
 */

export type { Provider, SecretReference, ResolveSecretsResult, AuthInfo } from './provider'
export { parseSecretReference, validateSecretReferenceFormat } from './provider'
export type { SecretReferenceValidationResult } from './provider'

export { OnePasswordProvider } from './onepassword/provider'

import { OnePasswordProvider } from './onepassword/provider'
import type { Provider } from './provider'

export type ProviderType = '1password'

export const SECRET_SCHEMES = ['op://'] as const

export function isSecretReference(value: string): boolean {
  const trimmed = value.trim()
  return SECRET_SCHEMES.some((scheme) => trimmed.startsWith(scheme))
}

/** Normalizes a native 1Password reference. */
export function toNativeReference(reference: string): string {
  return reference.trim()
}

export function createProvider(options: Record<string, string> = {}): Provider {
  return new OnePasswordProvider(options)
}
