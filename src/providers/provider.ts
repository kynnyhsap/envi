/**
 * Provider interface for secret management backends.
 *
 * The provider resolves native 1Password secret references (`op://vault/item/field`).
 */

export interface SecretReference {
  vault: string
  item: string
  field: string
  /** Original raw string from the template (e.g., "op://core-local/api/SECRET") */
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
  /** Including "://" (e.g., "op://") */
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
 * Supports: `op://vault/item[/section]/field`
 */
export function parseSecretReference(reference: string): SecretReference {
  const validation = validateSecretReferenceFormat(reference)
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Invalid secret reference')
  }

  const trimmed = normalizeSecretReferenceInput(reference)
  const path = trimmed.slice('op://'.length)
  const parts = path.split('/')

  const [vault, item, ...rest] = parts
  return {
    vault: vault!,
    item: item!,
    field: rest.join('/'),
    raw: trimmed,
  }
}

export interface SecretReferenceValidationResult {
  valid: boolean
  error?: string
}

export function normalizeSecretReferenceInput(reference: string): string {
  const trimmed = reference.trim()
  if (trimmed.length < 2) return trimmed

  const quote = trimmed[0]
  const closingQuote = trimmed[trimmed.length - 1]
  if ((quote === '"' || quote === "'") && closingQuote === quote) {
    return trimmed.slice(1, -1).trim()
  }

  return trimmed
}

export function validateSecretReferenceFormat(reference: string): SecretReferenceValidationResult {
  const trimmed = normalizeSecretReferenceInput(reference)

  if (!trimmed.startsWith('op://')) {
    return { valid: false, error: 'Must start with op://' }
  }

  const path = trimmed.slice('op://'.length)
  const parts = path.split('/')

  if (parts.length < 3) {
    return { valid: false, error: 'Must have at least 3 parts: vault/item/field' }
  }

  const [vault, item, ...rest] = parts
  const field = rest.join('/')

  if (!vault || vault.trim() === '') {
    return { valid: false, error: 'Vault name is empty' }
  }

  if (!item || item.trim() === '') {
    return { valid: false, error: 'Item name is empty' }
  }

  if (!field || field.trim() === '') {
    return { valid: false, error: 'Field name is empty' }
  }

  return { valid: true }
}
