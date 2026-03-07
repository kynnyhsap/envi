export const DEFAULT_ENVIRONMENT = 'local'

/**
 * Substitute ${ENV} in op:// secret references.
 * Example: op://core-${ENV}/item/field -> op://core-local/item/field
 */
export function substituteVariables(value: string, env: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('op://')) return value
  return value.replace(/\$\{ENV\}/g, env)
}

/**
 * Check if a value contains unresolved ${VAR} variables
 */
export function hasUnresolvedVariables(value: string): boolean {
  return /\$\{[A-Z_]+\}/.test(value)
}
