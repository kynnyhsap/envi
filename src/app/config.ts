import { readFile } from 'node:fs/promises'

import packageJson from '../../package.json'
import type { ProviderType } from '../providers'

export const VERSION = packageJson.version

export const BACKUP_FOLDER_NAME = '.env-backup'
export const DEFAULT_BACKUP_DIR = BACKUP_FOLDER_NAME
export const DEFAULT_TEMPLATE_FILE = '.env.example'
export const DEFAULT_OUTPUT_FILE = '.env'
export const DEFAULT_PROVIDER: ProviderType = '1password'

export interface RuntimeConfig {
  backupDir: string
  templateFile: string
  outputFile: string
  paths: string[]
  quiet: boolean
  json: boolean
  vars: Record<string, string>
  provider: ProviderType
  providerOptions: Record<string, string>
}

let runtimeConfig: RuntimeConfig = {
  backupDir: DEFAULT_BACKUP_DIR,
  templateFile: DEFAULT_TEMPLATE_FILE,
  outputFile: DEFAULT_OUTPUT_FILE,
  paths: [],
  quiet: false,
  json: false,
  vars: {},
  provider: DEFAULT_PROVIDER,
  providerOptions: {},
}

export function setRuntimeConfig(config: Partial<RuntimeConfig>): void {
  runtimeConfig = { ...runtimeConfig, ...config }
}

export function getConfig(): RuntimeConfig {
  return runtimeConfig
}

export function generateBackupTimestamp(): string {
  return new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-')
}

export function parseOnlyFlag(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  return value.split(',').map((p) => p.trim())
}

export interface ConfigFile {
  provider?: ProviderType
  providerOptions?: Record<string, string>
  vars?: Record<string, string>
  paths?: string[]
  templateFile?: string
  outputFile?: string
  backupDir?: string
  quiet?: boolean
  json?: boolean
}

export async function loadConfigFile(path: string): Promise<ConfigFile> {
  let text = ''
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw new Error(`Config file not found: ${path}`)
  }

  try {
    const content = JSON.parse(text) as unknown
    return content as ConfigFile
  } catch {
    throw new Error(`Invalid JSON in config file: ${path}`)
  }
}
