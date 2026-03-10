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
  sourceVars?: Record<string, string> | undefined
}

export const VARS_MARKER_PREFIX = '# envi:vars='

export type ChangeType = 'new' | 'updated' | 'local_modified' | 'custom' | 'unchanged'

export interface Change {
  type: ChangeType
  key: string
  templateValue?: string | undefined
  localValue?: string | undefined
  newValue?: string | undefined
}

export const LOCAL_ENVS_SEPARATOR = '# ----------- PUT YOUR CUSTOM ENVS BELOW THIS LINE -----------'
