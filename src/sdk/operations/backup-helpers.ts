import path from 'node:path'

import { getRootDir } from '../paths'
import type { BackupSnapshotData, ExecutionContext } from '../types'

const SNAPSHOT_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/

export interface BackupSnapshotInternalFile {
  backupPath: string
  originalPath: string
  size: number
  modifiedAt: Date
}

export interface BackupSnapshotInternal {
  timestamp: string
  path: string
  absolutePath: string
  files: BackupSnapshotInternalFile[]
}

export function getBackupRootInfo(
  ctx: ExecutionContext,
  timestamp: string,
): {
  rootDir: string
  backupRootRelative: string
  backupRootAbsolute: string
} {
  const rootDir = getRootDir(ctx.options, ctx.runtime)
  const backupRootRelative = path.join(ctx.options.backupDir, timestamp).replace(/\\/g, '/')
  const backupRootAbsolute = path.join(rootDir, backupRootRelative)
  return { rootDir, backupRootRelative, backupRootAbsolute }
}

export async function findEnvFilesForBackup(ctx: ExecutionContext): Promise<string[]> {
  const rootDir = getRootDir(ctx.options, ctx.runtime)
  return ctx.runtime.findFilesNamed(rootDir, '.env', [ctx.options.backupDir])
}

export async function listBackupSnapshots(ctx: ExecutionContext): Promise<BackupSnapshotInternal[]> {
  const rootDir = getRootDir(ctx.options, ctx.runtime)
  const backupRootAbsolute = path.join(rootDir, ctx.options.backupDir)

  if (!(await ctx.runtime.exists(backupRootAbsolute))) {
    return []
  }

  const timestamps = (await ctx.runtime.listDirs(backupRootAbsolute))
    .filter((entry) => SNAPSHOT_RE.test(entry))
    .sort((a, b) => b.localeCompare(a))

  const snapshots: BackupSnapshotInternal[] = []
  for (const timestamp of timestamps) {
    const snapshotAbsolute = path.join(backupRootAbsolute, timestamp)
    const filesRelative = await ctx.runtime.findFilesWithPrefix(snapshotAbsolute, '.env')
    if (filesRelative.length === 0) continue

    const files: BackupSnapshotInternalFile[] = []
    for (const fileRelative of filesRelative) {
      const backupPath = path.join(snapshotAbsolute, fileRelative)
      const stat = await ctx.runtime.stat(backupPath)
      files.push({
        backupPath,
        originalPath: fileRelative,
        size: stat?.size ?? 0,
        modifiedAt: new Date(stat?.mtimeMs ?? Date.now()),
      })
    }

    snapshots.push({
      timestamp,
      path: path.join(ctx.options.backupDir, timestamp).replace(/\\/g, '/'),
      absolutePath: snapshotAbsolute,
      files,
    })
  }

  return snapshots
}

export async function backupFilesToRoot(
  ctx: ExecutionContext,
  filePaths: string[],
  backupRootAbsolute: string,
): Promise<{ backedUp: number; errors: Array<{ path: string; error: string }> }> {
  const rootDir = getRootDir(ctx.options, ctx.runtime)
  let backedUp = 0
  const errors: Array<{ path: string; error: string }> = []

  for (const filePath of filePaths) {
    const sourcePath = path.join(rootDir, filePath)
    const backupPath = path.join(backupRootAbsolute, filePath)
    const backupDirPath = path.dirname(backupPath)

    try {
      await ctx.runtime.mkdirp(backupDirPath)
      const content = await ctx.runtime.readText(sourcePath)
      await ctx.runtime.writeText(backupPath, content)
      backedUp++
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push({ path: filePath, error: message })
    }
  }

  return { backedUp, errors }
}

export function toBackupSnapshotData(snapshot: BackupSnapshotInternal): BackupSnapshotData {
  return {
    timestamp: snapshot.timestamp,
    path: snapshot.path,
    files: snapshot.files.map((file) => ({
      originalPath: file.originalPath,
      size: file.size,
      modifiedAt: file.modifiedAt.toISOString(),
    })),
  }
}
