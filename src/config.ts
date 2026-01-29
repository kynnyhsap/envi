import packageJson from '../package.json'
import { createProvider, type Provider, type ProviderType } from './providers'
import { DEFAULT_ENVIRONMENT } from './utils/variables'

export const VERSION = packageJson.version

// Default values
export const BACKUP_FOLDER_NAME = '.env-backup'
export const DEFAULT_BACKUP_DIR = BACKUP_FOLDER_NAME
export const DEFAULT_TEMPLATE_FILE = '.env.example'
export const DEFAULT_OUTPUT_FILE = '.env'
export const DEFAULT_PROVIDER: ProviderType = '1password'

// Runtime configuration (set by CLI)
export interface RuntimeConfig {
  backupDir: string
  templateFile: string
  outputFile: string
  /** Explicit paths to process. If empty, auto-discover from template files. */
  paths: string[]
  quiet: boolean
  environment: string
  provider: ProviderType
  providerOptions: Record<string, string>
}

let runtimeConfig: RuntimeConfig = {
  backupDir: DEFAULT_BACKUP_DIR,
  templateFile: DEFAULT_TEMPLATE_FILE,
  outputFile: DEFAULT_OUTPUT_FILE,
  paths: [],
  quiet: false,
  environment: DEFAULT_ENVIRONMENT,
  provider: DEFAULT_PROVIDER,
  providerOptions: {},
}

let providerInstance: Provider | null = null

export function setRuntimeConfig(config: Partial<RuntimeConfig>): void {
  runtimeConfig = { ...runtimeConfig, ...config }
  providerInstance = createProvider(runtimeConfig.provider, runtimeConfig.providerOptions)
}

/** Get the initialized provider instance. Throws if not initialized. */
export function getProvider(): Provider {
  if (!providerInstance) {
    throw new Error('Provider not initialized. Call setRuntimeConfig() first.')
  }
  return providerInstance
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

/** Config file shape (envi.json). All fields optional. */
export interface ConfigFile {
  provider?: ProviderType
  providerOptions?: Record<string, string>
  environment?: string
  paths?: string[]
  templateFile?: string
  outputFile?: string
  backupDir?: string
  quiet?: boolean
}

/** Load and parse a config file. Returns partial RuntimeConfig. */
export async function loadConfigFile(path: string): Promise<ConfigFile> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    throw new Error(`Config file not found: ${path}`)
  }
  const content = await file.json()
  return content as ConfigFile
}
