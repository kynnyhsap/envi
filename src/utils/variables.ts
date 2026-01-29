export const VALID_ENVIRONMENTS = ['local', 'dev', 'staging', 'prod', 'sandbox', 'self-host'] as const
export type Environment = (typeof VALID_ENVIRONMENTS)[number]
export const DEFAULT_ENVIRONMENT: Environment = 'local'

export function isValidEnvironment(env: string): env is Environment {
  return VALID_ENVIRONMENTS.includes(env as Environment)
}

/**
 * Substitute ${ENV} in secret references (envi://, op://, pass://)
 * Example: envi://core-${ENV}/item/field → envi://core-local/item/field
 */
export function substituteVariables(value: string, env: Environment): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('op://') && !trimmed.startsWith('envi://') && !trimmed.startsWith('pass://')) return value
  return value.replace(/\$\{ENV\}/g, env)
}

/**
 * Check if a value contains unresolved ${VAR} variables
 */
export function hasUnresolvedVariables(value: string): boolean {
  return /\$\{[A-Z_]+\}/.test(value)
}
