import packageJson from '../package.json'
import { DEFAULT_ENVIRONMENT, type Environment } from './utils/variables'
import { initProviders, type ProviderType, type ProvidersConfig } from './providers'

export const VERSION = packageJson.version

// Default values
export const BACKUP_FOLDER_NAME = '.env-backup'
export const DEFAULT_BACKUP_DIR = BACKUP_FOLDER_NAME
export const DEFAULT_TEMPLATE_FILE = '.env.tpl'
export const DEFAULT_OUTPUT_FILE = '.env'
export const DEFAULT_PROVIDER: ProviderType = '1password'

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
  environment: Environment
  provider: ProviderType
  accountName?: string
}

let runtimeConfig: RuntimeConfig = {
  backupDir: DEFAULT_BACKUP_DIR,
  templateFile: DEFAULT_TEMPLATE_FILE,
  outputFile: DEFAULT_OUTPUT_FILE,
  paths: ENV_PATHS,
  quiet: false,
  environment: DEFAULT_ENVIRONMENT,
  provider: DEFAULT_PROVIDER,
}

export function setRuntimeConfig(config: Partial<RuntimeConfig>): void {
  runtimeConfig = { ...runtimeConfig, ...config }

  // Initialize providers based on config
  const providersConfig: ProvidersConfig = {
    default: runtimeConfig.provider,
    '1password': runtimeConfig.accountName ? { accountName: runtimeConfig.accountName } : {},
  }

  initProviders(providersConfig)
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
