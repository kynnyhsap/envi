import type { Provider, ProviderType } from '../providers'
import type { Change } from '../shared/env/types'
import type { RuntimeAdapter } from './runtime/contracts'

export const SDK_SCHEMA_VERSION = 1 as const

export type EnviCommand =
  | 'status'
  | 'diff'
  | 'sync'
  | 'validate'
  | 'resolve'
  | 'run.resolve'
  | 'backup'
  | 'backup.list'
  | 'restore'
  | 'restore.list'

export interface ProgressEvent {
  command: EnviCommand
  stage: string
  message: string
  completed?: number
  total?: number
  path?: string
}

export type ProgressReporter = (event: ProgressEvent) => void | Promise<void>

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
    vars: Record<string, string>
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
  vars: Record<string, string>
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
  select?: (args: { message: string; choices: Array<{ name: string; value: string }> }) => Promise<string>
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

export interface StatusOperationOptions {
  progress?: ProgressReporter
}

export interface DiffPathData {
  pathInfo: EnvPathInfo
  hasTemplate: boolean
  hasEnv: boolean
  changes: Change[]
  error?: string
  issues?: Issue[]
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
  progress?: ProgressReporter
}

export type DiffResult = JsonEnvelope<DiffData, 'diff'>

export interface SyncOperationOptions {
  dryRun?: boolean
  noBackup?: boolean
  /** Include secret values in output (unsafe). Default: false */
  includeSecrets?: boolean
  progress?: ProgressReporter
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
  progress?: ProgressReporter
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
  references?: string[]
  progress?: ProgressReporter
}

export interface ResolveSecretEntryData {
  input: string
  resolvedReference: string
  nativeReference: string
  secret: string
}

export type ResolveSecretSingleData = ResolveSecretEntryData

export interface ResolveSecretMultipleData {
  inputs: string[]
  results: ResolveSecretEntryData[]
}

export type ResolveSecretData = ResolveSecretSingleData | ResolveSecretMultipleData

export type ResolveSecretResult = JsonEnvelope<ResolveSecretData, 'resolve'>

export interface ResolveRunEnvironmentOperationOptions {
  envFile?: string[]
  noTemplate?: boolean
  /** Include secret values in output (unsafe). Default: false */
  includeSecrets?: boolean
  progress?: ProgressReporter
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

export interface BackupSnapshotFileData {
  originalPath: string
  size: number
  modifiedAt: string
}

export interface BackupSnapshotData {
  id: string
  timestamp: string
  isLatest: boolean
  path: string
  files: BackupSnapshotFileData[]
}

export interface BackupData {
  backupDir: string
  snapshots?: BackupSnapshotData[]
  dryRun?: boolean
  found?: number
  backupRoot?: string | null
  files?: string[]
  backedUp?: number
  errors?: Array<{ path: string; error: string }>
}

export interface BackupOperationOptions {
  dryRun?: boolean
  list?: boolean
  progress?: ProgressReporter
}

export type BackupResult = JsonEnvelope<BackupData, 'backup'> | JsonEnvelope<BackupData, 'backup.list'>

export interface RestoreData {
  backupDir: string
  snapshots?: BackupSnapshotData[]
  selectedSnapshot?: string
  selectedSnapshotPath?: string
  files?: string[]
  dryRun?: boolean
  wouldOverwrite?: string[]
  wouldRestore?: string[]
  restored?: number
  failed?: number
  errors?: Array<{ path: string; error: string }>
}

export interface RestoreOperationOptions {
  dryRun?: boolean
  list?: boolean
  snapshot?: string
  progress?: ProgressReporter
}

export type RestoreResult = JsonEnvelope<RestoreData, 'restore'> | JsonEnvelope<RestoreData, 'restore.list'>

export interface EnviEngine {
  readonly options: RuntimeOptions
  status(options?: StatusOperationOptions): Promise<StatusResult>
  diff(options?: DiffOperationOptions): Promise<DiffResult>
  sync(options?: SyncOperationOptions): Promise<SyncResult>
  validate(options?: ValidateOperationOptions): Promise<ValidateResult>
  resolveSecret(options: ResolveSecretOperationOptions): Promise<ResolveSecretResult>
  resolveRunEnvironment(options?: ResolveRunEnvironmentOperationOptions): Promise<RunResolveResult>
  backup(options?: BackupOperationOptions): Promise<BackupResult>
  restore(options?: RestoreOperationOptions): Promise<RestoreResult>
}
