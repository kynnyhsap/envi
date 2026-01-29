/**
 * Provider registry.
 *
 * Factory for creating provider instances and routing secret references
 * to the appropriate provider based on URI scheme.
 */

export type { Provider, SecretReference, ResolveSecretsResult, AuthInfo } from './provider'
export {
  isSecretReference,
  detectProvider,
  toNativeReference,
  parseSecretReference,
  SECRET_SCHEMES,
} from './provider'

export { OnePasswordProvider } from './1password.provider'
export { ProtonPassProvider } from './proton-pass.provider'

import type { Provider } from './provider'
import { OnePasswordProvider } from './1password.provider'
import { ProtonPassProvider } from './proton-pass.provider'

export type ProviderType = '1password' | 'proton-pass'
export const VALID_PROVIDERS: ProviderType[] = ['1password', 'proton-pass']

/**
 * Create a provider instance.
 * Each provider accepts a generic Record<string, string> of options.
 */
export function createProvider(id: ProviderType, options: Record<string, string> = {}): Provider {
  switch (id) {
    case '1password':
      return new OnePasswordProvider(options)
    case 'proton-pass':
      return new ProtonPassProvider(options)
  }
}
