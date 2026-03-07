import type { Provider, ProviderType } from '../providers'
import type { Change } from '../shared/env/types'
import type { RuntimeAdapter } from './runtime/contracts'

export const SDK_SCHEMA_VERSION = 1 as const

export type EnviCommand = 'status' | 'diff' | 'sync' | 'validate' | 'resolve' | 'run.resolve'

export interface Issue {
  code: string
  message: string
  path?: string
  key?: string
  reference?: string
}

export interface JsonEnvelope<TData, TCommand extends EnviCommand> {
  schemaVersion: typeof SDK_SCHEMA_VERSION
  command: TCommand
  ok: boolean
  data: TData
  issues: Issue[]
  meta: {
    environment: string
    provider: string
    timestamp: string
  }
}

export interface RuntimeOptions {
  backupDir: string
  templateFile: string
  outputFile: string
  paths: string[]
  quiet: boolean
  json: boolean
  environment: string
  provider: ProviderType
  providerOptions: Record<string, string>
  rootDir?: string
}

export interface RuntimeOptionsInput {
  defaults?: Partial<RuntimeOptions>
  configFile?: Partial<RuntimeOptions>
  overrides?: Partial<RuntimeOptions>
}

export interface EnvPathInfo {
  name: string
  dir: string
  templatePath: string
  envPath: string
  backupDir: string
}

export interface PromptAdapter {
  confirm?: (message: string, defaultValue?: boolean) => Promise<boolean>
}

export interface ExecutionContext {
  options: RuntimeOptions
  provider: Provider
  runtime: RuntimeAdapter
  prompts?: PromptAdapter
}

export interface CreateEngineOptions {
  options?: Partial<RuntimeOptions>
  configFile?: Partial<RuntimeOptions>
  runtime?: RuntimeAdapter
  provider?: Provider
  prompts?: PromptAdapter
}

export interface StatusPathData {
  pathInfo: EnvPathInfo
  hasTemplate: boolean
  hasEnv: boolean
  hasBackup: boolean
  templateVarCount: number
  envVarCount: number
  status: 'missing' | 'synced' | 'outdated' | 'no-template'
}

export interface StatusData {
  provider: {
    id: string
    name: string
    availability: {
      available: boolean
      statusLines: string[]
      helpLines: string[]
    }
    auth: {
      success: boolean
      type: string
      identifier: string
      error?: string
      hints: string[]
    }
  }
  paths: StatusPathData[]
  backups: {
    count: number
    latestTimestamp?: string
  }
  summary: {
    synced: number
    outdated: number
    missing: number
    noTemplate: number
  }
}

export type StatusResult = JsonEnvelope<StatusData, 'status'>

export interface DiffPathData {
  pathInfo: EnvPathInfo
  hasTemplate: boolean
  hasEnv: boolean
  changes: Change[]
  error?: string
}

export interface DiffData {
  paths: DiffPathData[]
  summary: {
    new: number
    updated: number
    localModified: number
    unchanged: number
    hasAnyChanges: boolean
  }
}

export interface DiffOperationOptions {
  path?: string
  /** Include secret values in output (unsafe). Default: false */
  includeSecrets?: boolean
}

export type DiffResult = JsonEnvelope<DiffData, 'diff'>

export interface SyncOperationOptions {
  force?: boolean
  dryRun?: boolean
  noBackup?: boolean
  /** Include secret values in output (unsafe). Default: false */
  includeSecrets?: boolean
}

export interface SyncPathData {
  pathInfo: EnvPathInfo
  success: boolean
  skipped: boolean
  changes: Change[]
  envSwitched: boolean
  message?: string
}

export interface SyncData {
  options: {
    force: boolean
    dryRun: boolean
    noBackup: boolean
  }
  paths: SyncPathData[]
  summary: {
    success: number
    failed: number
    skipped: number
    new: number
    updated: number
    custom: number
  }
}

export type SyncResult = JsonEnvelope<SyncData, 'sync'>

export interface ValidateOperationOptions {
  remote?: boolean
}

export interface ValidateReferenceData {
  key: string
  reference: string
  resolvedReference: string
  valid: boolean
  error?: string
}

export interface ValidatePathData {
  pathInfo: EnvPathInfo
  hasTemplate: boolean
  references: ValidateReferenceData[]
}

export interface ValidateData {
  remote: boolean
  paths: ValidatePathData[]
  summary: {
    templates: number
    valid: number
    invalid: number
  }
}

export type ValidateResult = JsonEnvelope<ValidateData, 'validate'>

export interface ResolveSecretOperationOptions {
  reference: string
}

export interface ResolveSecretData {
  input: string
  resolvedReference: string
  nativeReference: string
  secret: string
}

export type ResolveSecretResult = JsonEnvelope<ResolveSecretData, 'resolve'>

export interface ResolveRunEnvironmentOperationOptions {
  envFile?: string[]
  noTemplate?: boolean
  /** Include secret values in output (unsafe). Default: false */
  includeSecrets?: boolean
}

export interface RunResolveData {
  env: Record<string, string>
  summary: {
    total: number
    templateVars: number
    envFileVars: number
  }
}

export type RunResolveResult = JsonEnvelope<RunResolveData, 'run.resolve'>

export interface EnviEngine {
  readonly options: RuntimeOptions
  status(): Promise<StatusResult>
  diff(options?: DiffOperationOptions): Promise<DiffResult>
  sync(options?: SyncOperationOptions): Promise<SyncResult>
  validate(options?: ValidateOperationOptions): Promise<ValidateResult>
  resolveSecret(options: ResolveSecretOperationOptions): Promise<ResolveSecretResult>
  resolveRunEnvironment(options?: ResolveRunEnvironmentOperationOptions): Promise<RunResolveResult>
}
