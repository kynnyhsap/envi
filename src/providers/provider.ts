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

/** Pre-flight availability check result. */
export interface AvailabilityResult {
  available: boolean
  /** Status lines to display (e.g., "OP_SERVICE_ACCOUNT_TOKEN: found"). */
  statusLines?: string[]
  /** Help lines to display when not available. */
  helpLines?: string[]
}

/** Hints for the user when auth fails. */
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
  /** Unique provider identifier (e.g., "1password", "proton-pass") */
  readonly id: string
  /** Human-readable provider name */
  readonly name: string
  /** Native URI scheme including "://" (e.g., "op://", "pass://") */
  readonly scheme: string

  /** Get the current authentication method info. */
  getAuthInfo(): AuthInfo

  /**
   * Check if the provider is available (e.g., app running, CLI installed).
   * Called before verifyAuth. If not available, auth is skipped.
   */
  checkAvailability(): Promise<AvailabilityResult>

  /** Verify that authentication is working. */
  verifyAuth(): Promise<{ success: boolean; error?: string }>

  /** Get hint messages to display when auth fails. */
  getAuthFailureHints(): AuthFailureHints

  /** Resolve a single secret reference string (native format, e.g., "op://vault/item/field"). */
  resolveSecret(reference: string): Promise<string>

  /** Resolve multiple secret reference strings, collecting per-ref errors. */
  resolveSecrets(references: string[]): Promise<ResolveSecretsResult>

  /** List accessible vaults. */
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
