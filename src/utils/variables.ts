export const VALID_ENVIRONMENTS = ['local', 'dev', 'staging', 'prod', 'sandbox', 'self-host'] as const
export type Environment = (typeof VALID_ENVIRONMENTS)[number]
export const DEFAULT_ENVIRONMENT: Environment = 'local'

export function isValidEnvironment(env: string): env is Environment {
  return VALID_ENVIRONMENTS.includes(env as Environment)
}

/**
 * Substitute ${ENV} in op:// references
 * Example: op://core-${ENV}/item/field → op://core-local/item/field
 */
export function substituteVariables(value: string, env: Environment): string {
  if (!value.trim().startsWith('op://')) return value
  return value.replace(/\$\{ENV\}/g, env)
}

/**
 * Check if a value contains unresolved ${VAR} variables
 */
export function hasUnresolvedVariables(value: string): boolean {
  return /\$\{[A-Z_]+\}/.test(value)
}
