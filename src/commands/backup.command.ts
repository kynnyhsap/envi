import pc from 'picocolors'

import { getConfig, generateBackupTimestamp } from '../config'
import { log } from '../logger'
import { stringifyEnvelope } from '../sdk'
import { formatBackupTimestamp, promptConfirm } from '../utils'
import {
  backupFilesToRoot,
  findBackupSnapshots,
  findEnvFilesForBackup,
  getBackupRoot,
  summarizeSnapshot,
} from '../utils/backups'

export async function createAutoBackup(filePaths: string[]): Promise<string | null> {
  if (filePaths.length === 0) return null

  const config = getConfig()
  const existingFiles: string[] = []

  for (const filePath of filePaths) {
    if (await Bun.file(filePath).exists()) {
      existingFiles.push(filePath)
    }
  }

  if (existingFiles.length === 0) return null

  const backupRoot = getBackupRoot(config.backupDir, generateBackupTimestamp())
  const result = await backupFilesToRoot(existingFiles, backupRoot)
  return result.backedUp > 0 ? backupRoot : null
}

export async function listBackupsCommand(): Promise<void> {
  const config = getConfig()
  if (config.json) {
    const snapshots = await findBackupSnapshots(config.backupDir)
    const envelope = {
      schemaVersion: 1,
      command: 'backup.list',
      ok: true,
      data: {
        backupDir: config.backupDir,
        snapshots: snapshots.map((s) => ({
          timestamp: s.timestamp,
          path: s.path,
          files: s.files,
        })),
      },
      issues: [],
      meta: {
        environment: config.environment,
        provider: config.provider,
        timestamp: new Date().toISOString(),
      },
    }
    process.stdout.write(stringifyEnvelope(envelope))
    return
  }

  log.banner('Available Backups')

  const snapshots = await findBackupSnapshots(config.backupDir)

  if (snapshots.length === 0) {
    log.info('')
    log.warn(`No backups found in ${config.backupDir}/`)
    log.info('')
    log.info('  Create a backup with:')
    log.info(`  ${pc.cyan('envi backup')}`)
    log.info('')
    return
  }

  log.info('')
  log.info(`  Found ${pc.green(String(snapshots.length))} backup(s):`)
  log.info('')

  for (const snapshot of snapshots) {
    const { fileCount, sizeKb } = summarizeSnapshot(snapshot)
    log.info(`  ${pc.cyan(formatBackupTimestamp(snapshot.timestamp))}  ${pc.dim(`(${fileCount} files, ${sizeKb}KB)`)}`)
    for (const file of snapshot.files) {
      log.detail(`  ${file.originalPath}`)
    }
    log.info('')
  }
}

export async function backupCommand(options: { force: boolean; dryRun: boolean; list: boolean }): Promise<void> {
  const config = getConfig()

  if (options.list) {
    await listBackupsCommand()
    return
  }

  if (config.json) {
    const envFiles = await findEnvFilesForBackup(config.backupDir)

    if (envFiles.length === 0) {
      const envelope = {
        schemaVersion: 1,
        command: 'backup',
        ok: true,
        data: {
          dryRun: options.dryRun,
          force: options.force,
          found: 0,
          backupRoot: null as string | null,
          files: [],
          backedUp: 0,
        },
        issues: [{ code: 'NO_FILES', message: 'No .env files found to backup' }],
        meta: {
          environment: config.environment,
          provider: config.provider,
          timestamp: new Date().toISOString(),
        },
      }
      process.stdout.write(stringifyEnvelope(envelope))
      return
    }

    const backupRoot = getBackupRoot(config.backupDir, generateBackupTimestamp())

    if (!options.dryRun && !options.force) {
      const envelope = {
        schemaVersion: 1,
        command: 'backup',
        ok: false,
        data: {
          dryRun: options.dryRun,
          force: options.force,
          found: envFiles.length,
          backupRoot,
          files: envFiles,
          backedUp: 0,
        },
        issues: [
          {
            code: 'PROMPT_REQUIRED',
            message: 'Backup requires confirmation. Re-run with --force or --dry-run when using --json.',
          },
        ],
        meta: {
          environment: config.environment,
          provider: config.provider,
          timestamp: new Date().toISOString(),
        },
      }
      process.stdout.write(stringifyEnvelope(envelope))
      process.exitCode = 1
      return
    }

    if (options.dryRun) {
      const envelope = {
        schemaVersion: 1,
        command: 'backup',
        ok: true,
        data: {
          dryRun: true,
          force: options.force,
          found: envFiles.length,
          backupRoot,
          files: envFiles,
          backedUp: 0,
        },
        issues: [],
        meta: {
          environment: config.environment,
          provider: config.provider,
          timestamp: new Date().toISOString(),
        },
      }
      process.stdout.write(stringifyEnvelope(envelope))
      return
    }

    const backupResult = await backupFilesToRoot(envFiles, backupRoot)

    const envelope = {
      schemaVersion: 1,
      command: 'backup',
      ok: backupResult.errors.length === 0,
      data: {
        dryRun: false,
        force: true,
        found: envFiles.length,
        backupRoot,
        files: envFiles,
        backedUp: backupResult.backedUp,
        errors: backupResult.errors,
      },
      issues: backupResult.errors.map((e) => ({ code: 'BACKUP_FAILED', message: e.error, path: e.path })),
      meta: {
        environment: config.environment,
        provider: config.provider,
        timestamp: new Date().toISOString(),
      },
    }

    process.stdout.write(stringifyEnvelope(envelope))
    process.exitCode = backupResult.errors.length === 0 ? 0 : 1
    return
  }

  log.banner('Backup .env Files')

  if (options.dryRun) {
    log.info(pc.yellow('  Running in dry-run mode'))
  }

  const envFiles = await findEnvFilesForBackup(config.backupDir)

  if (envFiles.length === 0) {
    log.warn('No .env files found to backup')
    return
  }

  const backupRoot = getBackupRoot(config.backupDir, generateBackupTimestamp())

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

  const backupResult = await backupFilesToRoot(envFiles, backupRoot)

  for (const file of envFiles) {
    const error = backupResult.errors.find((entry) => entry.path === file)
    if (error) {
      log.fail(`Failed to backup ${file}`)
      log.detail(error.error)
      continue
    }
    log.success(`Backed up ${file}`)
  }

  log.banner('Summary')
  log.info('')
  log.info(`  Backed up: ${pc.green(String(backupResult.backedUp))} file(s) to ${backupRoot}/`)
  log.info('')
}
