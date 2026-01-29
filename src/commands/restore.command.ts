import { select } from '@inquirer/prompts'
import pc from 'picocolors'

import { getConfig } from '../config'
import { log } from '../logger'
import { promptConfirm, formatBackupTimestamp } from '../utils'

interface BackupSnapshot {
  timestamp: string
  path: string
  files: BackupFile[]
}

interface BackupFile {
  backupPath: string
  originalPath: string
  size: number
  modifiedAt: Date
}

async function findBackupSnapshots(): Promise<BackupSnapshot[]> {
  const config = getConfig()
  const snapshots: BackupSnapshot[] = []

  const backupDirFile = Bun.file(config.backupDir)
  try {
    await backupDirFile.stat()
  } catch {
    return []
  }

  const glob = new Bun.Glob('*')
  for await (const entry of glob.scan({ cwd: config.backupDir, onlyFiles: false })) {
    if (!/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(entry)) continue

    const snapshotPath = `${config.backupDir}/${entry}`
    const files: BackupFile[] = []

    const envGlob = new Bun.Glob('**/.env*')
    for await (const envFile of envGlob.scan({ cwd: snapshotPath, dot: true })) {
      const backupPath = `${snapshotPath}/${envFile}`
      const file = Bun.file(backupPath)

      try {
        const stat = await file.stat()
        files.push({
          backupPath,
          originalPath: envFile,
          size: stat?.size ?? 0,
          modifiedAt: stat?.mtime ? new Date(stat.mtime) : new Date(),
        })
      } catch {
        // Skip files we can't stat
      }
    }

    if (files.length > 0) {
      snapshots.push({
        timestamp: entry,
        path: snapshotPath,
        files,
      })
    }
  }

  return snapshots.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

async function restoreFile(backup: BackupFile, options: { force: boolean; dryRun: boolean }): Promise<boolean> {
  const targetFile = Bun.file(backup.originalPath)
  const targetExists = await targetFile.exists()

  if (targetExists && !options.force && !options.dryRun) {
    const currentContent = await targetFile.text()
    const backupContent = await Bun.file(backup.backupPath).text()

    if (currentContent === backupContent) {
      log.skip(`${backup.originalPath} (identical to backup)`)
      return true
    }
  }

  if (options.dryRun) {
    if (targetExists) {
      log.detail(`Would overwrite: ${backup.originalPath}`)
    } else {
      log.detail(`Would restore: ${backup.originalPath}`)
    }
    return true
  }

  try {
    const content = await Bun.file(backup.backupPath).text()
    await Bun.write(backup.originalPath, content)
    log.success(`Restored ${backup.originalPath}`)
    return true
  } catch (error) {
    log.fail(`Failed to restore ${backup.originalPath}`)
    if (error instanceof Error) {
      log.detail(error.message)
    }
    return false
  }
}

export async function restoreCommand(options: { force: boolean; dryRun: boolean; list: boolean }): Promise<void> {
  log.banner('Restore .env Files from Backup')

  if (options.dryRun) {
    log.info(pc.yellow('  Running in dry-run mode'))
  }

  const config = getConfig()
  const snapshots = await findBackupSnapshots()

  if (snapshots.length === 0) {
    log.fail(`No backups found in ${config.backupDir}/`)
    log.info('')
    log.info('  Create a backup first with:')
    log.info(`  ${pc.cyan('env-cli backup')}`)
    process.exit(1)
  }

  if (options.list) {
    log.header('Available Backups')
    log.info('')

    for (const snapshot of snapshots) {
      const totalSize = snapshot.files.reduce((sum, f) => sum + f.size, 0)
      const sizeKb = (totalSize / 1024).toFixed(1)
      log.info(`  ${pc.cyan(snapshot.timestamp)}  ${pc.dim(`(${snapshot.files.length} files, ${sizeKb}KB)`)}`)
      for (const file of snapshot.files) {
        log.detail(`  ${file.originalPath}`)
      }
    }
    log.info('')
    return
  }

  let selectedSnapshot: BackupSnapshot

  const firstSnapshot = snapshots[0]
  if (!firstSnapshot) {
    log.fail('No backups found')
    process.exit(1)
  }

  if (snapshots.length === 1) {
    selectedSnapshot = firstSnapshot
    log.info('')
    log.info(`  Found 1 backup: ${pc.cyan(formatBackupTimestamp(selectedSnapshot.timestamp))}`)
  } else if (options.force) {
    // In force mode, use the most recent backup
    selectedSnapshot = firstSnapshot
    log.info('')
    log.info(`  Using most recent backup: ${pc.cyan(formatBackupTimestamp(selectedSnapshot.timestamp))}`)
  } else {
    // Interactive selection
    log.info('')
    try {
      const answer = await select({
        message: 'Select backup to restore:',
        choices: snapshots.map((s) => ({
          name: `${formatBackupTimestamp(s.timestamp)} (${s.files.length} files)`,
          value: s.timestamp,
        })),
      })
      const found = snapshots.find((s) => s.timestamp === answer)
      if (!found) {
        log.fail('Selected backup not found')
        process.exit(1)
      }
      selectedSnapshot = found
    } catch {
      log.skip('Restore cancelled')
      return
    }
  }

  log.header(`Backup: ${formatBackupTimestamp(selectedSnapshot.timestamp)}`)
  log.info('')
  log.info(`  ${pc.green(String(selectedSnapshot.files.length))} file(s) to restore:`)
  log.info('')

  for (const file of selectedSnapshot.files) {
    const sizeKb = (file.size / 1024).toFixed(1)
    log.file(`${file.originalPath} ${pc.dim(`(${sizeKb}KB)`)}`)
  }

  if (options.dryRun) {
    log.header('Would restore...')
    log.info('')
    for (const backup of selectedSnapshot.files) {
      const targetExists = await Bun.file(backup.originalPath).exists()
      if (targetExists) {
        log.detail(`Would overwrite: ${backup.originalPath}`)
      } else {
        log.detail(`Would restore: ${backup.originalPath}`)
      }
    }
    log.info('')
    log.warn('Dry run - no files restored')
    return
  }

  if (!options.force) {
    const confirmed = await promptConfirm(
      `Restore ${selectedSnapshot.files.length} file(s)? This will overwrite existing .env files.`,
    )
    if (!confirmed) {
      log.info('')
      log.skip('Restore cancelled by user')
      return
    }
  }

  log.header('Restoring files...')
  log.info('')

  let successCount = 0
  let failCount = 0

  for (const backup of selectedSnapshot.files) {
    const success = await restoreFile(backup, options)
    if (success) {
      successCount++
    } else {
      failCount++
    }
  }

  log.banner('Summary')
  log.info('')
  log.info(`  Restored: ${pc.green(String(successCount))}, Failed: ${pc.red(String(failCount))}`)
  log.info('')

  if (failCount > 0) {
    process.exit(1)
  }
}
