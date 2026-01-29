import packageJson from '../package.json'
import { DEFAULT_ENVIRONMENT, type Environment } from './utils/variables'

export const VERSION = packageJson.version

// Default 1Password account name (shown at top of sidebar in 1Password app)
// Can be overridden with OP_ACCOUNT_NAME env var
export const OP_ACCOUNT_NAME = 'Membrane'

// 1Password account URL for service account creation
export const OP_ACCOUNT_URL = 'https://getmembrane.1password.com'

// Default values
export const BACKUP_FOLDER_NAME = '.env-backup'
export const DEFAULT_BACKUP_DIR = BACKUP_FOLDER_NAME
export const DEFAULT_TEMPLATE_FILE = '.env.tpl'
export const DEFAULT_OUTPUT_FILE = '.env'

export const ENV_PATHS = [
  'dashboard-agent',

  // 'engine/api',
  // 'console',
  // 'ui',

  // TODO: add all other paths here
]

// Runtime configuration (set by CLI)
export interface RuntimeConfig {
  backupDir: string
  templateFile: string
  outputFile: string
  paths: string[]
  quiet: boolean
  accountName?: string
  environment: Environment
}

let runtimeConfig: RuntimeConfig = {
  backupDir: DEFAULT_BACKUP_DIR,
  templateFile: DEFAULT_TEMPLATE_FILE,
  outputFile: DEFAULT_OUTPUT_FILE,
  paths: ENV_PATHS,
  quiet: false,
  environment: DEFAULT_ENVIRONMENT,
}

export function setRuntimeConfig(config: Partial<RuntimeConfig>): void {
  runtimeConfig = { ...runtimeConfig, ...config }
}

export function getConfig(): RuntimeConfig {
  return runtimeConfig
}

// Generate timestamp for backup directories (YYYY-MM-DD_HH-MM-SS)
export function generateBackupTimestamp(): string {
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
}

// Parse --only flag value into array of paths
export function parseOnlyFlag(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  return value.split(',').map((p) => p.trim())
}
