import path from 'node:path'

import { makeEnvelope } from '../json'
import { getRootDir } from '../paths'
import { resolveAllEnvPaths } from '../paths'
import type { ExecutionContext, Issue, RestoreOperationOptions, RestoreResult } from '../types'
import { findSnapshotBySelector, listBackupSnapshots, toBackupSnapshotData } from './backup-helpers'

async function restoreFile(
  ctx: ExecutionContext,
  backup: { backupPath: string; originalPath: string },
  options: { dryRun: boolean },
): Promise<{ restored: boolean; skippedIdentical: boolean; error?: string; action: 'restore' | 'overwrite' }> {
  const rootDir = getRootDir(ctx.options, ctx.runtime)
  const targetPath = path.join(rootDir, backup.originalPath)
  const targetExists = await ctx.runtime.exists(targetPath)

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
  const dryRun = options.dryRun ?? false
  const list = options.list ?? false
  const snapshotSelector = options.snapshot

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

  const selectedSnapshot = findSnapshotBySelector(snapshots, snapshotSelector)
  if (!selectedSnapshot) {
    return makeEnvelope({
      command: 'restore',
      ok: false,
      data: {
        backupDir: ctx.options.backupDir,
        snapshots: snapshots.map(toBackupSnapshotData),
      },
      issues: [
        {
          code: 'SNAPSHOT_NOT_FOUND',
          message: `Snapshot not found: ${snapshotSelector}`,
        },
      ],
      options: ctx.options,
      providerId: ctx.provider.id,
    })
  }

  let selectedFiles = selectedSnapshot.files
  if (ctx.options.paths.length > 0) {
    const rootDir = getRootDir(ctx.options, ctx.runtime)
    const envPaths = await resolveAllEnvPaths(ctx.options, ctx.runtime)
    const allowed = new Set(envPaths.map((pathInfo) => path.relative(rootDir, pathInfo.envPath).replace(/\\/g, '/')))
    selectedFiles = selectedFiles.filter((file) => allowed.has(file.originalPath))
  }

  if (dryRun) {
    const wouldOverwrite: string[] = []
    const wouldRestore: string[] = []
    const rootDir = getRootDir(ctx.options, ctx.runtime)
    for (const file of selectedFiles) {
      const exists = await ctx.runtime.exists(path.join(rootDir, file.originalPath))
      if (exists) wouldOverwrite.push(file.originalPath)
      else wouldRestore.push(file.originalPath)
    }

    return makeEnvelope({
      command: 'restore',
      ok: true,
      data: {
        backupDir: ctx.options.backupDir,
        selectedSnapshot: selectedSnapshot.id,
        selectedSnapshotPath: selectedSnapshot.path,
        files: selectedFiles.map((file) => file.originalPath),
        dryRun: true,
        wouldOverwrite,
        wouldRestore,
      },
      issues: [],
      options: ctx.options,
      providerId: ctx.provider.id,
    })
  }

  let restored = 0
  let failed = 0
  const issues: Issue[] = []
  const errors: Array<{ path: string; error: string }> = []

  for (const file of selectedFiles) {
    const result = await restoreFile(ctx, file, { dryRun: false })
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
      selectedSnapshot: selectedSnapshot.id,
      selectedSnapshotPath: selectedSnapshot.path,
      files: selectedFiles.map((file) => file.originalPath),
      dryRun: false,
      restored,
      failed,
      errors,
    },
    issues,
    options: ctx.options,
    providerId: ctx.provider.id,
  })
}
