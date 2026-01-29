/**
 * Provider interface for secret management backends.
 *
 * Each provider maps the universal `envi://vault/item/field` format
 * to its native secret reference scheme (e.g., `op://`, `pass://`).
 */

export interface SecretReference {
  vault: string
  item: string
  field: string
  /** Original raw string from the template (e.g., "envi://core-local/api/SECRET") */
  raw: string
}

export interface ResolveSecretsResult {
  resolved: Map<string, string>
  errors: Map<string, string>
}

export interface AuthInfo {
  type: string
  identifier: string
}

export interface AvailabilityResult {
  available: boolean
  /** Status lines to display (e.g., "OP_SERVICE_ACCOUNT_TOKEN: found"). */
  statusLines?: string[]
  /** Help lines to display when not available. */
  helpLines?: string[]
}

export interface AuthFailureHints {
  /** Lines to display after auth failure. */
  lines: string[]
}

/**
 * Secret provider interface.
 *
 * Implementations must handle authentication, secret resolution,
 * and vault listing for their respective backends.
 */
export interface Provider {
  readonly id: string
  readonly name: string
  /** Including "://" (e.g., "op://", "pass://") */
  readonly scheme: string

  getAuthInfo(): AuthInfo

  /** Called before verifyAuth. If not available, auth is skipped. */
  checkAvailability(): Promise<AvailabilityResult>

  verifyAuth(): Promise<{ success: boolean; error?: string }>
  getAuthFailureHints(): AuthFailureHints

  /** Reference must be in native format (e.g., "op://vault/item/field"). */
  resolveSecret(reference: string): Promise<string>

  /** Collects per-ref errors instead of throwing. */
  resolveSecrets(references: string[]): Promise<ResolveSecretsResult>

  listVaults(): Promise<{ id: string; name: string }[]>
}

/**
 * Parse a secret reference URI into its components.
 *
 * Supports: `envi://vault/item/field`, `op://vault/item[/section]/field`, `pass://vault/item/field`
 */
export function parseSecretReference(reference: string): SecretReference {
  const trimmed = reference.trim()

  // Match any scheme ending in ://
  const schemeMatch = trimmed.match(/^[a-z]+:\/\//)
  if (!schemeMatch) {
    throw new Error(`Unknown secret reference scheme: ${trimmed}`)
  }

  const path = trimmed.slice(schemeMatch[0].length)
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
