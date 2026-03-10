export const DEFAULT_REFERENCE_VARS = {
  PROFILE: 'default',
} as const

export function normalizeReferenceVars(vars: Record<string, string>): Record<string, string> {
  const normalized = Object.entries(vars)
    .map(([key, value]) => [key.trim(), value.trim()] as [string, string])
    .filter(([key]) => key.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))

  return Object.fromEntries(normalized)
}

export function resolveReferenceVars(vars: Record<string, string>): Record<string, string> {
  return normalizeReferenceVars({ ...DEFAULT_REFERENCE_VARS, ...vars })
}

export function shouldPersistReferenceVars(vars: Record<string, string> | undefined): boolean {
  if (!vars) return false

  const explicit = normalizeReferenceVars(vars)
  if (Object.keys(explicit).length === 0) return false

  const resolved = resolveReferenceVars(explicit)
  const defaults = normalizeReferenceVars({ ...DEFAULT_REFERENCE_VARS })

  const resolvedKeys = Object.keys(resolved)
  const defaultKeys = Object.keys(defaults)
  if (resolvedKeys.length !== defaultKeys.length) return true

  return resolvedKeys.some((key) => resolved[key] !== defaults[key])
}

function unwrapSecretReference(value: string): { body: string; quote: string | null } {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const quote = trimmed[0]
    if ((quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
      return { body: trimmed.slice(1, -1), quote }
    }
  }
  return { body: trimmed, quote: null }
}

/**
 * Substitute ${NAME} placeholders in op:// secret references.
 */
export function substituteVariables(value: string, vars: Record<string, string>): string {
  const normalizedVars = resolveReferenceVars(vars)
  const leadingWhitespace = value.match(/^\s*/)?.[0] ?? ''
  const trailingWhitespace = value.match(/\s*$/)?.[0] ?? ''
  const { body, quote } = unwrapSecretReference(value)
  if (!body.startsWith('op://')) return value

  const substituted = body.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (match, name: string) => normalizedVars[name] ?? match)
  const resolved = quote ? `${quote}${substituted}${quote}` : substituted
  return `${leadingWhitespace}${resolved}${trailingWhitespace}`
}

/**
 * Check if a value contains unresolved ${VAR} variables
 */
export function hasUnresolvedVariables(value: string): boolean {
  return /\$\{[A-Z_]+\}/.test(value)
}
