import path from 'node:path'

import { makeEnvelope } from '../json'
import { getRootDir } from '../paths'
import type { ExecutionContext, Issue, RestoreOperationOptions, RestoreResult } from '../types'
import { listBackupSnapshots, toBackupSnapshotData } from './backup-helpers'

async function restoreFile(
  ctx: ExecutionContext,
  backup: { backupPath: string; originalPath: string },
  options: { force: boolean; dryRun: boolean },
): Promise<{ restored: boolean; skippedIdentical: boolean; error?: string; action: 'restore' | 'overwrite' }> {
  const rootDir = getRootDir(ctx.options, ctx.runtime)
  const targetPath = path.join(rootDir, backup.originalPath)
  const targetExists = await ctx.runtime.exists(targetPath)

  if (targetExists && !options.force && !options.dryRun) {
    const currentContent = await ctx.runtime.readText(targetPath)
    const backupContent = await ctx.runtime.readText(backup.backupPath)

    if (currentContent === backupContent) {
      return { restored: true, skippedIdentical: true, action: 'overwrite' }
    }
  }

  if (options.dryRun) {
    return {
      restored: true,
      skippedIdentical: false,
      action: targetExists ? 'overwrite' : 'restore',
    }
  }

  try {
    const content = await ctx.runtime.readText(backup.backupPath)
    await ctx.runtime.mkdirp(path.dirname(targetPath))
    await ctx.runtime.writeText(targetPath, content)
    return { restored: true, skippedIdentical: false, action: targetExists ? 'overwrite' : 'restore' }
  } catch (error) {
    return {
      restored: false,
      skippedIdentical: false,
      action: targetExists ? 'overwrite' : 'restore',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function restoreOperation(
  ctx: ExecutionContext,
  options: RestoreOperationOptions = {},
): Promise<RestoreResult> {
  const force = options.force ?? false
  const dryRun = options.dryRun ?? false
  const list = options.list ?? false

  const snapshots = await listBackupSnapshots(ctx)
  if (snapshots.length === 0) {
    return makeEnvelope({
      command: 'restore',
      ok: false,
      data: {
        backupDir: ctx.options.backupDir,
        snapshots: [],
      },
      issues: [{ code: 'NO_BACKUPS', message: `No backups found in ${ctx.options.backupDir}/` }],
      options: ctx.options,
      providerId: ctx.provider.id,
    })
  }

  if (list) {
    return makeEnvelope({
      command: 'restore.list',
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

  const firstSnapshot = snapshots[0]!
  let selectedSnapshot = firstSnapshot

  if (snapshots.length > 1 && !force) {
    if (!ctx.prompts?.select) {
      return makeEnvelope({
        command: 'restore',
        ok: false,
        data: {
          backupDir: ctx.options.backupDir,
          selectedSnapshot: firstSnapshot.timestamp,
          files: firstSnapshot.files.map((file) => file.originalPath),
        },
        issues: [
          {
            code: 'PROMPT_REQUIRED',
            message:
              'Restore requires interactive selection/confirmation. Re-run with --force or --list when using --json.',
          },
        ],
        options: ctx.options,
        providerId: ctx.provider.id,
      })
    }

    try {
      const selectedTimestamp = await ctx.prompts.select({
        message: 'Select backup to restore:',
        choices: snapshots.map((snapshot) => ({
          name: `${snapshot.timestamp} (${snapshot.files.length} files)`,
          value: snapshot.timestamp,
        })),
      })
      const found = snapshots.find((snapshot) => snapshot.timestamp === selectedTimestamp)
      if (found) {
        selectedSnapshot = found
      }
    } catch {
      return makeEnvelope({
        command: 'restore',
        ok: true,
        data: {
          backupDir: ctx.options.backupDir,
          selectedSnapshot: selectedSnapshot.timestamp,
          files: selectedSnapshot.files.map((file) => file.originalPath),
        },
        issues: [{ code: 'CANCELLED', message: 'Restore cancelled' }],
        options: ctx.options,
        providerId: ctx.provider.id,
      })
    }
  }

  if (dryRun) {
    const wouldOverwrite: string[] = []
    const wouldRestore: string[] = []
    const rootDir = getRootDir(ctx.options, ctx.runtime)
    for (const file of selectedSnapshot.files) {
      const exists = await ctx.runtime.exists(path.join(rootDir, file.originalPath))
      if (exists) wouldOverwrite.push(file.originalPath)
      else wouldRestore.push(file.originalPath)
    }

    return makeEnvelope({
      command: 'restore',
      ok: true,
      data: {
        backupDir: ctx.options.backupDir,
        selectedSnapshot: selectedSnapshot.timestamp,
        files: selectedSnapshot.files.map((file) => file.originalPath),
        dryRun: true,
        force,
        wouldOverwrite,
        wouldRestore,
      },
      issues: [],
      options: ctx.options,
      providerId: ctx.provider.id,
    })
  }

  if (!force) {
    if (!ctx.prompts?.confirm) {
      return makeEnvelope({
        command: 'restore',
        ok: false,
        data: {
          backupDir: ctx.options.backupDir,
          selectedSnapshot: selectedSnapshot.timestamp,
          files: selectedSnapshot.files.map((file) => file.originalPath),
        },
        issues: [
          {
            code: 'PROMPT_REQUIRED',
            message:
              'Restore requires interactive selection/confirmation. Re-run with --force or --list when using --json.',
          },
        ],
        options: ctx.options,
        providerId: ctx.provider.id,
      })
    }

    const confirmed = await ctx.prompts.confirm(
      `Restore ${selectedSnapshot.files.length} file(s)? This will overwrite existing .env files.`,
      true,
    )
    if (!confirmed) {
      return makeEnvelope({
        command: 'restore',
        ok: true,
        data: {
          backupDir: ctx.options.backupDir,
          selectedSnapshot: selectedSnapshot.timestamp,
          files: selectedSnapshot.files.map((file) => file.originalPath),
        },
        issues: [{ code: 'CANCELLED', message: 'Restore cancelled by user' }],
        options: ctx.options,
        providerId: ctx.provider.id,
      })
    }
  }

  let restored = 0
  let failed = 0
  const issues: Issue[] = []
  const errors: Array<{ path: string; error: string }> = []

  for (const file of selectedSnapshot.files) {
    const result = await restoreFile(ctx, file, { force, dryRun: false })
    if (result.restored) {
      restored++
      continue
    }

    failed++
    const message = result.error ?? 'Failed to restore file'
    errors.push({ path: file.originalPath, error: message })
    issues.push({ code: 'RESTORE_FAILED', message, path: file.originalPath })
  }

  return makeEnvelope({
    command: 'restore',
    ok: failed === 0,
    data: {
      backupDir: ctx.options.backupDir,
      selectedSnapshot: selectedSnapshot.timestamp,
      files: selectedSnapshot.files.map((file) => file.originalPath),
      dryRun: false,
      force,
      restored,
      failed,
      errors,
    },
    issues,
    options: ctx.options,
    providerId: ctx.provider.id,
  })
}
