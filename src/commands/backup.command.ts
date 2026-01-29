import { $ } from 'bun'
import pc from 'picocolors'

import { getConfig, generateBackupTimestamp } from '../config'
import { log } from '../logger'
import { promptConfirm, formatBackupTimestamp } from '../utils'

/**
 * Silently backup specific .env files before overwriting.
 * Used by setup command to create automatic backups.
 * Returns the backup path if successful, null if no files to backup.
 */
export async function createAutoBackup(filePaths: string[]): Promise<string | null> {
  if (filePaths.length === 0) return null

  const config = getConfig()
  const timestamp = generateBackupTimestamp()
  const backupRoot = `${config.backupDir}/${timestamp}`

  let successCount = 0

  for (const file of filePaths) {
    const fileExists = await Bun.file(file).exists()
    if (!fileExists) continue

    const backupPath = `${backupRoot}/${file}`
    const backupDirPath = backupPath.substring(0, backupPath.lastIndexOf('/'))

    try {
      await $`mkdir -p ${backupDirPath}`.quiet()
      const content = await Bun.file(file).text()
      await Bun.write(backupPath, content)
      successCount++
    } catch {
      // Silently skip failed backups
    }
  }

  return successCount > 0 ? backupRoot : null
}

interface BackupSnapshot {
  timestamp: string
  path: string
  files: { path: string; size: number }[]
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
    const files: { path: string; size: number }[] = []

    const envGlob = new Bun.Glob('**/.env*')
    for await (const envFile of envGlob.scan({ cwd: snapshotPath, dot: true })) {
      const backupPath = `${snapshotPath}/${envFile}`
      const file = Bun.file(backupPath)

      try {
        const stat = await file.stat()
        files.push({
          path: envFile,
          size: stat?.size ?? 0,
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

export async function listBackupsCommand(): Promise<void> {
  log.banner('Available Backups')

  const config = getConfig()
  const snapshots = await findBackupSnapshots()

  if (snapshots.length === 0) {
    log.info('')
    log.warn(`No backups found in ${config.backupDir}/`)
    log.info('')
    log.info('  Create a backup with:')
    log.info(`  ${pc.cyan('env-cli backup')}`)
    log.info('')
    return
  }

  log.info('')
  log.info(`  Found ${pc.green(String(snapshots.length))} backup(s):`)
  log.info('')

  for (const snapshot of snapshots) {
    const totalSize = snapshot.files.reduce((sum, f) => sum + f.size, 0)
    const sizeKb = (totalSize / 1024).toFixed(1)
    log.info(
      `  ${pc.cyan(formatBackupTimestamp(snapshot.timestamp))}  ${pc.dim(`(${snapshot.files.length} files, ${sizeKb}KB)`)}`,
    )
    for (const file of snapshot.files) {
      log.detail(`  ${file.path}`)
    }
    log.info('')
  }
}

export async function backupCommand(options: { force: boolean; dryRun: boolean; list: boolean }): Promise<void> {
  if (options.list) {
    await listBackupsCommand()
    return
  }

  log.banner('Backup .env Files')

  if (options.dryRun) {
    log.info(pc.yellow('  Running in dry-run mode'))
  }

  const config = getConfig()
  const envFiles: string[] = []

  const glob = new Bun.Glob('**/.env')
  for await (const entry of glob.scan({ cwd: '.', dot: true })) {
    if (!entry.includes('node_modules') && !entry.startsWith(config.backupDir)) {
      envFiles.push(entry)
    }
  }

  if (envFiles.length === 0) {
    log.warn('No .env files found to backup')
    return
  }

  const timestamp = generateBackupTimestamp()
  const backupRoot = `${config.backupDir}/${timestamp}`

  log.info('')
  log.info(`  Found ${pc.green(String(envFiles.length))} .env file(s):`)
  log.info('')

  for (const file of envFiles) {
    log.file(file)
  }

  log.info('')
  log.info(`  Backup location: ${pc.cyan(backupRoot)}`)

  if (options.dryRun) {
    log.info('')
    log.warn('Dry run - no backups created')
    return
  }

  if (!options.force) {
    const confirmed = await promptConfirm(`Backup ${envFiles.length} file(s) to ${backupRoot}/?`)
    if (!confirmed) {
      log.skip('Backup cancelled by user')
      return
    }
  }

  log.header('Creating backups...')
  log.info('')

  let successCount = 0

  for (const file of envFiles) {
    const backupPath = `${backupRoot}/${file}`
    const backupDirPath = backupPath.substring(0, backupPath.lastIndexOf('/'))

    try {
      await $`mkdir -p ${backupDirPath}`.quiet()
      const content = await Bun.file(file).text()
      await Bun.write(backupPath, content)
      log.success(`Backed up ${file}`)
      successCount++
    } catch (error) {
      log.fail(`Failed to backup ${file}`)
      if (error instanceof Error) {
        log.detail(error.message)
      }
    }
  }

  log.banner('Summary')
  log.info('')
  log.info(`  Backed up: ${pc.green(String(successCount))} file(s) to ${backupRoot}/`)
  log.info('')
}
