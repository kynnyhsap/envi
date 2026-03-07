// Types
export type { EnvVar, EnvFile, ChangeType, Change } from './types'
export { LOCAL_ENVS_SEPARATOR, ENV_MARKER_PREFIX, LEGACY_ENV_MARKER_PREFIX } from './types'

// Parsing
export { parseEnvFile, serializeEnvFile } from './parse'

// Variables
export { substituteVariables, hasUnresolvedVariables } from './variables'

// Diff
export { computeChanges } from './diff'

// Merge
export { mergeEnvFiles } from './merge'

// Formatting
export { truncateValue, redactSecret, formatBackupTimestamp } from './format'

// Helpers
export { promptConfirm, withTimeout } from './helpers'

// Backups
export type { BackupFileRecord, BackupSnapshot } from './backups'
export {
  backupFilesToRoot,
  findBackupSnapshots,
  findEnvFilesForBackup,
  getBackupRoot,
  summarizeSnapshot,
} from './backups'

// Paths
export type { EnvPathInfo } from './paths'
export { getRootDir, resolveEnvPath, resolveAllEnvPaths, getBackupRootDir } from './paths'
