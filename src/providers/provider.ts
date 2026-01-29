/**
 * Provider interface for secret management backends.
 *
 * Each provider maps the universal `envi://vault/item/field` format
 * to its native secret reference scheme (e.g., `op://`, `pass://`).
 */

/** Parsed secret reference with vault/item/field components. */
export interface SecretReference {
  vault: string
  item: string
  field: string
  /** Original raw string from the template (e.g., "envi://core-local/api/SECRET") */
  raw: string
}

/** Result of resolving multiple secrets. */
export interface ResolveSecretsResult {
  resolved: Map<string, string>
  errors: Map<string, string>
}

/** Authentication status info returned by providers. */
export interface AuthInfo {
  type: string
  identifier: string
}

/**
 * Secret provider interface.
 *
 * Implementations must handle authentication, secret resolution,
 * and vault listing for their respective backends.
 */
export interface Provider {
  /** Unique provider identifier (e.g., "1password", "proton-pass") */
  readonly id: string
  /** Human-readable provider name */
  readonly name: string
  /** Native URI scheme including "://" (e.g., "op://", "pass://") */
  readonly scheme: string

  /** Get the current authentication method info. */
  getAuthInfo(): AuthInfo

  /** Verify that authentication is working. */
  verifyAuth(): Promise<{ success: boolean; error?: string }>

  /** Resolve a single secret reference string (native format, e.g., "op://vault/item/field"). */
  resolveSecret(reference: string): Promise<string>

  /** Resolve multiple secret reference strings, collecting per-ref errors. */
  resolveSecrets(references: string[]): Promise<ResolveSecretsResult>

  /** List accessible vaults. */
  listVaults(): Promise<{ id: string; name: string }[]>
}

/** Known URI schemes and their provider IDs. */
const SCHEME_TO_PROVIDER: Record<string, string> = {
  'op://': '1password',
  'pass://': 'proton-pass',
}

/** All recognized secret reference schemes. */
export const SECRET_SCHEMES = ['envi://', 'op://', 'pass://'] as const

/**
 * Check if a value is a secret reference (starts with a known scheme).
 */
export function isSecretReference(value: string): boolean {
  const trimmed = value.trim()
  return SECRET_SCHEMES.some((scheme) => trimmed.startsWith(scheme))
}

/**
 * Detect which provider a secret reference should route to.
 *
 * - `op://` -> "1password"
 * - `pass://` -> "proton-pass"
 * - `envi://` -> undefined (use configured default)
 *
 * Returns undefined for `envi://` so the caller uses the default provider.
 */
export function detectProvider(reference: string): string | undefined {
  const trimmed = reference.trim()
  for (const [scheme, providerId] of Object.entries(SCHEME_TO_PROVIDER)) {
    if (trimmed.startsWith(scheme)) {
      return providerId
    }
  }
  return undefined
}

/**
 * Convert a secret reference to the provider's native format.
 *
 * - `envi://vault/item/field` -> `<scheme>vault/item/field`
 * - `op://vault/item/field` -> `op://vault/item/field` (passthrough)
 * - `pass://vault/item/field` -> `pass://vault/item/field` (passthrough)
 */
export function toNativeReference(reference: string, providerScheme: string): string {
  const trimmed = reference.trim()

  // Already in a native format — pass through
  for (const scheme of Object.keys(SCHEME_TO_PROVIDER)) {
    if (trimmed.startsWith(scheme)) {
      return trimmed
    }
  }

  // Convert envi:// to native
  if (trimmed.startsWith('envi://')) {
    const path = trimmed.slice('envi://'.length)
    return `${providerScheme}${path}`
  }

  return trimmed
}

/**
 * Parse a secret reference URI into its components.
 *
 * Supports: `envi://vault/item/field`, `op://vault/item[/section]/field`, `pass://vault/item/field`
 */
export function parseSecretReference(reference: string): SecretReference {
  const trimmed = reference.trim()
  let path: string

  for (const scheme of SECRET_SCHEMES) {
    if (trimmed.startsWith(scheme)) {
      path = trimmed.slice(scheme.length)
      const parts = path.split('/')

      if (parts.length < 3) {
        throw new Error(`Invalid secret reference (need vault/item/field): ${trimmed}`)
      }

      const [vault, item, ...rest] = parts
      return {
        vault: vault!,
        item: item!,
        field: rest.join('/'),
        raw: trimmed,
      }
    }
  }

  throw new Error(`Unknown secret reference scheme: ${trimmed}`)
}
