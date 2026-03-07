import { mkdir } from 'node:fs/promises'

export interface BackupFileRecord {
  backupPath: string
  originalPath: string
  size: number
  modifiedAt: Date
}

export interface BackupSnapshot {
  timestamp: string
  path: string
  files: BackupFileRecord[]
}

const SNAPSHOT_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/

export function getBackupRoot(backupDir: string, timestamp: string): string {
  return `${backupDir}/${timestamp}`
}

export async function findBackupSnapshots(backupDir: string): Promise<BackupSnapshot[]> {
  const snapshots: BackupSnapshot[] = []

  try {
    await Bun.file(backupDir).stat()
  } catch {
    return []
  }

  const glob = new Bun.Glob('*')
  for await (const entry of glob.scan({ cwd: backupDir, onlyFiles: false })) {
    if (!SNAPSHOT_RE.test(entry)) continue

    const snapshotPath = `${backupDir}/${entry}`
    const files: BackupFileRecord[] = []

    const envGlob = new Bun.Glob('**/.env*')
    for await (const envFile of envGlob.scan({ cwd: snapshotPath, dot: true })) {
      const backupPath = `${snapshotPath}/${envFile}`

      try {
        const stat = await Bun.file(backupPath).stat()
        files.push({
          backupPath,
          originalPath: envFile,
          size: stat?.size ?? 0,
          modifiedAt: stat?.mtime ? new Date(stat.mtime) : new Date(),
        })
      } catch {
        continue
      }
    }

    if (files.length === 0) continue
    snapshots.push({ timestamp: entry, path: snapshotPath, files })
  }

  return snapshots.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

export async function findEnvFilesForBackup(backupDir: string): Promise<string[]> {
  const envFiles: string[] = []
  const glob = new Bun.Glob('**/.env')

  for await (const entry of glob.scan({ cwd: '.', dot: true })) {
    if (entry.includes('node_modules') || entry.startsWith(backupDir)) continue
    envFiles.push(entry)
  }

  return envFiles
}

export async function backupFilesToRoot(
  filePaths: string[],
  backupRoot: string,
): Promise<{ backedUp: number; errors: Array<{ path: string; error: string }> }> {
  let backedUp = 0
  const errors: Array<{ path: string; error: string }> = []

  for (const filePath of filePaths) {
    const backupPath = `${backupRoot}/${filePath}`
    const backupDirPath = backupPath.slice(0, Math.max(0, backupPath.lastIndexOf('/')))

    try {
      if (backupDirPath) {
        await mkdir(backupDirPath, { recursive: true })
      }
      await Bun.write(backupPath, await Bun.file(filePath).text())
      backedUp++
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push({ path: filePath, error: message })
    }
  }

  return { backedUp, errors }
}

export function summarizeSnapshot(snapshot: BackupSnapshot): { fileCount: number; sizeKb: string } {
  const totalSize = snapshot.files.reduce((sum, file) => sum + file.size, 0)
  return {
    fileCount: snapshot.files.length,
    sizeKb: (totalSize / 1024).toFixed(1),
  }
}
