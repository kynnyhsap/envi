import { generateBackupTimestamp } from '../../app/config'
import { makeEnvelope } from '../json'
import type { BackupOperationOptions, BackupResult, ExecutionContext, Issue } from '../types'
import {
  backupFilesToRoot,
  findEnvFilesForBackup,
  getBackupRootInfo,
  listBackupSnapshots,
  toBackupSnapshotData,
} from './backup-helpers'

export async function backupOperation(
  ctx: ExecutionContext,
  options: BackupOperationOptions = {},
): Promise<BackupResult> {
  const force = options.force ?? false
  const dryRun = options.dryRun ?? false
  const list = options.list ?? false

  if (list) {
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

  const envFiles = await findEnvFilesForBackup(ctx)
  if (envFiles.length === 0) {
    return makeEnvelope({
      command: 'backup',
      ok: true,
      data: {
        backupDir: ctx.options.backupDir,
        dryRun,
        force,
        found: 0,
        backupRoot: null,
        files: [],
        backedUp: 0,
      },
      issues: [{ code: 'NO_FILES', message: 'No .env files found to backup' }],
      options: ctx.options,
      providerId: ctx.provider.id,
    })
  }

  const { backupRootRelative, backupRootAbsolute } = getBackupRootInfo(ctx, generateBackupTimestamp())

  if (dryRun) {
    return makeEnvelope({
      command: 'backup',
      ok: true,
      data: {
        backupDir: ctx.options.backupDir,
        dryRun: true,
        force,
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

  if (!force) {
    if (!ctx.prompts?.confirm) {
      return makeEnvelope({
        command: 'backup',
        ok: false,
        data: {
          backupDir: ctx.options.backupDir,
          dryRun: false,
          force: false,
          found: envFiles.length,
          backupRoot: backupRootRelative,
          files: envFiles,
          backedUp: 0,
        },
        issues: [
          {
            code: 'PROMPT_REQUIRED',
            message: 'Backup requires confirmation. Re-run with --force or --dry-run when using --json.',
          },
        ],
        options: ctx.options,
        providerId: ctx.provider.id,
      })
    }

    const confirmed = await ctx.prompts.confirm(`Backup ${envFiles.length} file(s) to ${backupRootRelative}/?`, true)
    if (!confirmed) {
      return makeEnvelope({
        command: 'backup',
        ok: true,
        data: {
          backupDir: ctx.options.backupDir,
          dryRun: false,
          force: false,
          found: envFiles.length,
          backupRoot: backupRootRelative,
          files: envFiles,
          backedUp: 0,
        },
        issues: [{ code: 'CANCELLED', message: 'Backup cancelled by user' }],
        options: ctx.options,
        providerId: ctx.provider.id,
      })
    }
  }

  const backupResult = await backupFilesToRoot(ctx, envFiles, backupRootAbsolute)
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
      force: true,
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
