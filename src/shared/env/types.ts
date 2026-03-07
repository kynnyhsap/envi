export interface EnvVar {
  key: string
  value: string
  comment?: string | undefined
  isCustom?: boolean | undefined
}

export interface EnvFile {
  vars: Map<string, EnvVar>
  order: string[]
  trailingContent: string
  /** Environment used to generate this file (from # envi:env=xxx comment) */
  sourceEnv?: string | undefined
}

export const ENV_MARKER_PREFIX = '# envi:env='
export const LEGACY_ENV_MARKER_PREFIX = '# env-cli:env='

export type ChangeType = 'new' | 'updated' | 'local_modified' | 'custom' | 'unchanged'

export interface Change {
  type: ChangeType
  key: string
  templateValue?: string | undefined
  localValue?: string | undefined
  newValue?: string | undefined
}

export const LOCAL_ENVS_SEPARATOR = '# ----------- PUT YOUR CUSTOM ENVS BELOW THIS LINE -----------'
