import pc from 'picocolors'

import { log } from '../../app/logger'
import { formatBackupTimestamp } from '../../shared/env/format'
import { createCommandContext, printIssuesAndExit, writeJsonResult } from './common'

function summarizeSnapshot(snapshot: { files?: Array<{ size: number }> }): { fileCount: number; sizeKb: string } {
  const files = snapshot.files ?? []
  const totalSize = files.reduce((sum, file) => sum + file.size, 0)
  return {
    fileCount: files.length,
    sizeKb: (totalSize / 1024).toFixed(1),
  }
}

export async function backupCommand(options: { dryRun: boolean; list: boolean }): Promise<void> {
  const { config, engine } = createCommandContext()
  const result = await engine.backup({ dryRun: options.dryRun, list: options.list })

  if (config.json) {
    writeJsonResult(result)
  }

  if (result.command === 'backup.list') {
    log.banner('Available Backups')

    const snapshots = result.data.snapshots ?? []
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
      const label = snapshot.isLatest
        ? `${snapshot.id} ${pc.dim(`(${formatBackupTimestamp(snapshot.timestamp)})`)}`
        : snapshot.id
      log.info(`  ${pc.cyan(label)}  ${pc.dim(`(${fileCount} files, ${sizeKb}KB)`)}`)
      for (const file of snapshot.files ?? []) {
        log.detail(`  ${file.originalPath}`)
      }
      log.info('')
    }
    return
  }

  if (!result.ok) {
    printIssuesAndExit(result.issues)
  }

  log.banner('Backup .env Files')

  if (result.data.dryRun) {
    log.info(pc.yellow('  Running in dry-run mode'))
  }

  const files = result.data.files ?? []
  if (files.length === 0) {
    log.warn('No .env files found to backup')
    return
  }

  log.info('')
  log.info(`  Found ${pc.green(String(files.length))} .env file(s):`)
  log.info('')
  for (const file of files) {
    log.file(file)
  }

  if (result.data.backupRoot) {
    log.info('')
    log.info(`  Backup location: ${pc.cyan(result.data.backupRoot)}`)
  }

  if (result.data.dryRun) {
    log.info('')
    log.warn('Dry run - no backups created')
    return
  }

  log.header('Creating backups...')
  log.info('')

  const errors = result.data.errors ?? []
  for (const file of files) {
    const error = errors.find((entry) => entry.path === file)
    if (error) {
      log.fail(`Failed to backup ${file}`)
      log.detail(error.error)
      continue
    }
    log.success(`Backed up ${file}`)
  }

  log.banner('Summary')
  log.info('')
  log.info(`  Backed up: ${pc.green(String(result.data.backedUp ?? 0))} file(s) to ${result.data.backupRoot}`)
  log.info('')

  process.exitCode = result.ok ? 0 : 1
}
