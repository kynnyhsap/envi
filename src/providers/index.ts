/**
 * Provider registry.
 *
 * Manages provider instances and routes secret references
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

export { OnePasswordProvider, is1PasswordAppRunning } from './1password.provider'
export type { OnePasswordConfig } from './1password.provider'

export { ProtonPassProvider } from './proton-pass.provider'
export type { ProtonPassConfig } from './proton-pass.provider'

import type { Provider } from './provider'
import { OnePasswordProvider } from './1password.provider'
import { ProtonPassProvider } from './proton-pass.provider'

const providers = new Map<string, Provider>()

/** Register a provider instance. */
export function registerProvider(provider: Provider): void {
  providers.set(provider.id, provider)
}

/** Get a provider by ID. Throws if not registered. */
export function getProvider(id: string): Provider {
  const provider = providers.get(id)
  if (!provider) {
    throw new Error(`Unknown provider: "${id}". Available: ${[...providers.keys()].join(', ')}`)
  }
  return provider
}

/** Get the default provider (first registered, or by configured ID). */
export function getDefaultProvider(): Provider {
  if (providers.size === 0) {
    throw new Error('No providers registered. Call initProviders() first.')
  }
  return providers.values().next().value!
}

/** List all registered provider IDs. */
export function getRegisteredProviderIds(): string[] {
  return [...providers.keys()]
}

export type ProviderType = '1password' | 'proton-pass'
export const VALID_PROVIDERS: ProviderType[] = ['1password', 'proton-pass']

export interface ProvidersConfig {
  default: ProviderType
  '1password'?: { accountName?: string }
  'proton-pass'?: { cliBinary?: string }
}

/**
 * Initialize providers based on config.
 * Registers the default provider first so `getDefaultProvider()` returns it.
 */
export function initProviders(config: ProvidersConfig): void {
  providers.clear()

  // Helper to create and register a provider
  const create = (id: ProviderType) => {
    switch (id) {
      case '1password':
        registerProvider(new OnePasswordProvider(config['1password']))
        break
      case 'proton-pass':
        registerProvider(new ProtonPassProvider(config['proton-pass']))
        break
    }
  }

  // Register default first
  create(config.default)

  // Register remaining providers
  for (const id of VALID_PROVIDERS) {
    if (id !== config.default) {
      create(id)
    }
  }
}
