import { generateBackupTimestamp } from '../../app/config'
import { makeEnvelope } from '../json'
import type { BackupOperationOptions, BackupResult, ExecutionContext, Issue } from '../types'
import {
  createLatestSnapshot,
  findEnvFilesForBackup,
  listBackupSnapshots,
  toBackupSnapshotData,
} from './backup-helpers'
import { emitProgress } from './progress'

export async function backupOperation(
  ctx: ExecutionContext,
  options: BackupOperationOptions = {},
): Promise<BackupResult> {
  const dryRun = options.dryRun ?? false
  const list = options.list ?? false

  if (list) {
    await emitProgress(options.progress, {
      command: 'backup.list',
      stage: 'list',
      message: 'Loading backup snapshots',
    })

    const snapshots = await listBackupSnapshots(ctx)
    return makeEnvelope({
      command: 'backup.list',
      ok: true,
      data: {
        backupDir: ctx.options.backupDir,
        snapshots: snapshots.map(toBackupSnapshotData),
      },
      issues: [],
      options: ctx.options,
      providerId: ctx.provider.id,
    })
  }

  await emitProgress(options.progress, {
    command: 'backup',
    stage: 'discover',
    message: 'Scanning environment files to backup',
  })

  const envFiles = await findEnvFilesForBackup(ctx)
  if (envFiles.length === 0) {
    return makeEnvelope({
      command: 'backup',
      ok: true,
      data: {
        backupDir: ctx.options.backupDir,
        dryRun,
        found: 0,
        backupRoot: null,
        files: [],
        backedUp: 0,
      },
      issues: [{ code: 'NO_FILES', message: 'No environment files found to backup' }],
      options: ctx.options,
      providerId: ctx.provider.id,
    })
  }

  const createdAt = new Date().toISOString()
  const snapshotId = generateBackupTimestamp()
  const backupRootRelative = `${ctx.options.backupDir}/latest`

  if (dryRun) {
    return makeEnvelope({
      command: 'backup',
      ok: true,
      data: {
        backupDir: ctx.options.backupDir,
        dryRun: true,
        found: envFiles.length,
        backupRoot: backupRootRelative,
        files: envFiles,
        backedUp: 0,
      },
      issues: [],
      options: ctx.options,
      providerId: ctx.provider.id,
    })
  }

  await emitProgress(options.progress, {
    command: 'backup',
    stage: 'write',
    message: 'Creating backup snapshot',
    completed: 0,
    total: envFiles.length,
  })

  const backupResult = await createLatestSnapshot(ctx, {
    id: snapshotId,
    createdAt,
    filePaths: envFiles,
  })
  const issues: Issue[] = backupResult.errors.map((entry) => ({
    code: 'BACKUP_FAILED',
    message: entry.error,
    path: entry.path,
  }))

  return makeEnvelope({
    command: 'backup',
    ok: backupResult.errors.length === 0,
    data: {
      backupDir: ctx.options.backupDir,
      dryRun: false,
      found: envFiles.length,
      backupRoot: backupRootRelative,
      files: envFiles,
      backedUp: backupResult.backedUp,
      errors: backupResult.errors,
    },
    issues,
    options: ctx.options,
    providerId: ctx.provider.id,
  })
}
