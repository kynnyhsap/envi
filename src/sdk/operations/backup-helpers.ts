import path from 'node:path'

import { getRootDir } from '../paths'
import type { BackupSnapshotData, ExecutionContext } from '../types'

const SNAPSHOT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/
const SNAPSHOT_METADATA_FILE = '.envi-backup.json'
const LATEST_SNAPSHOT_ID = 'latest'

interface BackupSnapshotMetadata {
  id: string
  createdAt: string
}

export interface BackupSnapshotInternalFile {
  backupPath: string
  originalPath: string
  size: number
  modifiedAt: Date
}

export interface BackupSnapshotInternal {
  id: string
  timestamp: string
  isLatest: boolean
  path: string
  absolutePath: string
  files: BackupSnapshotInternalFile[]
}

function getMetadataPath(snapshotAbsolutePath: string): string {
  return path.join(snapshotAbsolutePath, SNAPSHOT_METADATA_FILE)
}

async function readSnapshotMetadata(
  ctx: ExecutionContext,
  snapshotAbsolutePath: string,
): Promise<BackupSnapshotMetadata | null> {
  try {
    const raw = await ctx.runtime.readText(getMetadataPath(snapshotAbsolutePath))
    const parsed = JSON.parse(raw) as Partial<BackupSnapshotMetadata>
    if (typeof parsed.id !== 'string' || typeof parsed.createdAt !== 'string') return null
    return {
      id: parsed.id,
      createdAt: parsed.createdAt,
    }
  } catch {
    return null
  }
}

async function writeSnapshotMetadata(
  ctx: ExecutionContext,
  snapshotAbsolutePath: string,
  metadata: BackupSnapshotMetadata,
): Promise<void> {
  await ctx.runtime.writeText(getMetadataPath(snapshotAbsolutePath), JSON.stringify(metadata, null, 2) + '\n')
}

export function getSnapshotIdFromTimestamp(timestamp: string): string {
  return timestamp
}

export function getBackupRootInfo(
  ctx: ExecutionContext,
  snapshotId: string,
): {
  rootDir: string
  backupRootRelative: string
  backupRootAbsolute: string
} {
  const rootDir = getRootDir(ctx.options, ctx.runtime)
  const backupRootRelative = path.join(ctx.options.backupDir, snapshotId).replace(/\\/g, '/')
  const backupRootAbsolute = path.join(rootDir, backupRootRelative)
  return { rootDir, backupRootRelative, backupRootAbsolute }
}

export async function findEnvFilesForBackup(ctx: ExecutionContext): Promise<string[]> {
  const rootDir = getRootDir(ctx.options, ctx.runtime)
  return ctx.runtime.findFilesNamed(rootDir, ctx.options.outputFile, [ctx.options.backupDir])
}

async function collectSnapshotFiles(
  ctx: ExecutionContext,
  snapshotAbsolute: string,
): Promise<BackupSnapshotInternalFile[]> {
  const filesRelative = await ctx.runtime.findFilesWithPrefix(snapshotAbsolute, '.env')
  const files: BackupSnapshotInternalFile[] = []

  for (const fileRelative of filesRelative) {
    if (fileRelative === SNAPSHOT_METADATA_FILE) continue

    const backupPath = path.join(snapshotAbsolute, fileRelative)
    const stat = await ctx.runtime.stat(backupPath)
    files.push({
      backupPath,
      originalPath: fileRelative,
      size: stat?.size ?? 0,
      modifiedAt: new Date(stat?.mtimeMs ?? Date.now()),
    })
  }

  return files
}

export async function listBackupSnapshots(ctx: ExecutionContext): Promise<BackupSnapshotInternal[]> {
  const rootDir = getRootDir(ctx.options, ctx.runtime)
  const backupRootAbsolute = path.join(rootDir, ctx.options.backupDir)

  if (!(await ctx.runtime.exists(backupRootAbsolute))) {
    return []
  }

  const entries = await ctx.runtime.listDirs(backupRootAbsolute)
  const snapshots: BackupSnapshotInternal[] = []

  for (const entry of entries) {
    const isLatest = entry === LATEST_SNAPSHOT_ID
    if (!isLatest && !SNAPSHOT_RE.test(entry)) continue

    const snapshotAbsolute = path.join(backupRootAbsolute, entry)
    const metadata = await readSnapshotMetadata(ctx, snapshotAbsolute)
    const files = await collectSnapshotFiles(ctx, snapshotAbsolute)
    if (files.length === 0) continue

    const timestamp =
      metadata?.createdAt ?? new Date(Math.max(...files.map((file) => file.modifiedAt.getTime()))).toISOString()
    const id = isLatest ? LATEST_SNAPSHOT_ID : (metadata?.id ?? entry)

    snapshots.push({
      id,
      timestamp,
      isLatest,
      path: path.join(ctx.options.backupDir, entry).replace(/\\/g, '/'),
      absolutePath: snapshotAbsolute,
      files,
    })
  }

  return snapshots.sort((a, b) => {
    if (a.isLatest && !b.isLatest) return -1
    if (!a.isLatest && b.isLatest) return 1
    return b.id.localeCompare(a.id)
  })
}

export async function rotateLatestSnapshot(ctx: ExecutionContext): Promise<void> {
  const { backupRootAbsolute } = getBackupRootInfo(ctx, '')
  const latestAbsolutePath = path.join(backupRootAbsolute, LATEST_SNAPSHOT_ID)
  if (!(await ctx.runtime.exists(latestAbsolutePath))) return

  const metadata = await readSnapshotMetadata(ctx, latestAbsolutePath)
  const archiveId =
    metadata?.id && metadata.id !== LATEST_SNAPSHOT_ID
      ? metadata.id
      : getSnapshotIdFromTimestamp(new Date().toISOString())
  const archiveAbsolutePath = path.join(backupRootAbsolute, archiveId)

  if (await ctx.runtime.exists(archiveAbsolutePath)) {
    await ctx.runtime.removePath(archiveAbsolutePath)
  }

  await ctx.runtime.renamePath(latestAbsolutePath, archiveAbsolutePath)
}

export async function createLatestSnapshot(
  ctx: ExecutionContext,
  args: { id: string; createdAt: string; filePaths: string[] },
): Promise<{
  backupRootRelative: string
  backupRootAbsolute: string
  backedUp: number
  errors: Array<{ path: string; error: string }>
}> {
  await rotateLatestSnapshot(ctx)

  const { backupRootRelative, backupRootAbsolute } = getBackupRootInfo(ctx, LATEST_SNAPSHOT_ID)
  const backupResult = await backupFilesToRoot(ctx, args.filePaths, backupRootAbsolute)

  if (backupResult.backedUp > 0) {
    await writeSnapshotMetadata(ctx, backupRootAbsolute, {
      id: args.id,
      createdAt: args.createdAt,
    })
  }

  return {
    backupRootRelative,
    backupRootAbsolute,
    backedUp: backupResult.backedUp,
    errors: backupResult.errors,
  }
}

export async function backupFilesToRoot(
  ctx: ExecutionContext,
  filePaths: string[],
  backupRootAbsolute: string,
): Promise<{ backedUp: number; errors: Array<{ path: string; error: string }> }> {
  const rootDir = getRootDir(ctx.options, ctx.runtime)
  let backedUp = 0
  const errors: Array<{ path: string; error: string }> = []

  await ctx.runtime.removePath(backupRootAbsolute)

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

export function findSnapshotBySelector(
  snapshots: BackupSnapshotInternal[],
  selector: string | undefined,
): BackupSnapshotInternal | undefined {
  if (!selector || selector === LATEST_SNAPSHOT_ID) {
    return snapshots.find((snapshot) => snapshot.isLatest) ?? snapshots[0]
  }

  return snapshots.find((snapshot) => snapshot.id === selector || path.basename(snapshot.path) === selector)
}

export function toBackupSnapshotData(snapshot: BackupSnapshotInternal): BackupSnapshotData {
  return {
    id: snapshot.id,
    timestamp: snapshot.timestamp,
    isLatest: snapshot.isLatest,
    path: snapshot.path,
    files: snapshot.files.map((file) => ({
      originalPath: file.originalPath,
      size: file.size,
      modifiedAt: file.modifiedAt.toISOString(),
    })),
  }
}
