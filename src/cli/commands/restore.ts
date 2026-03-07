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

export async function restoreCommand(options: { dryRun: boolean; list: boolean; snapshot?: string }): Promise<void> {
  const { config, engine } = createCommandContext()
  const result = await engine.restore(options)

  if (config.json) {
    writeJsonResult(result)
  }

  if (result.command === 'restore.list') {
    log.header('Available Backups')
    log.info('')

    for (const snapshot of result.data.snapshots ?? []) {
      const { fileCount, sizeKb } = summarizeSnapshot(snapshot)
      const label = snapshot.isLatest
        ? `${snapshot.id} ${pc.dim(`(${formatBackupTimestamp(snapshot.timestamp)})`)}`
        : snapshot.id
      log.info(`  ${pc.cyan(label)}  ${pc.dim(`(${fileCount} files, ${sizeKb}KB)`)}`)
      for (const file of snapshot.files ?? []) {
        log.detail(`  ${file.originalPath}`)
      }
    }
    log.info('')
    return
  }

  const noBackups = result.issues.some((issue) => issue.code === 'NO_BACKUPS')
  if (!result.ok && !noBackups) {
    printIssuesAndExit(result.issues)
  }

  log.banner('Restore .env Files from Backup')

  if (result.data.dryRun) {
    log.info(pc.yellow('  Running in dry-run mode'))
  }

  if (noBackups) {
    log.fail(`No backups found in ${config.backupDir}/`)
    log.info('')
    log.info('  Create a backup first with:')
    log.info(`  ${pc.cyan('envi backup')}`)
    process.exitCode = 1
    return
  }

  const files = result.data.files ?? []
  const selectedSnapshot = result.data.selectedSnapshot
  if (selectedSnapshot) {
    log.header(`Backup: ${selectedSnapshot === 'latest' ? 'latest' : formatBackupTimestamp(selectedSnapshot)}`)
    if (result.data.selectedSnapshotPath) {
      log.detail(`Path: ${result.data.selectedSnapshotPath}`)
    }
    log.info('')
    log.info(`  ${pc.green(String(files.length))} file(s) to restore:`)
    log.info('')
    for (const file of files) {
      log.file(file)
    }
  }

  if (result.data.dryRun) {
    log.header('Would restore...')
    log.info('')
    for (const file of result.data.wouldOverwrite ?? []) {
      log.detail(`Would overwrite: ${file}`)
    }
    for (const file of result.data.wouldRestore ?? []) {
      log.detail(`Would restore: ${file}`)
    }
    log.info('')
    log.warn('Dry run - no files restored')
    return
  }

  log.header('Restoring files...')
  log.info('')
  for (const file of files) {
    const error = (result.data.errors ?? []).find((entry) => entry.path === file)
    if (error) {
      log.fail(`Failed to restore ${file}`)
      log.detail(error.error)
      continue
    }
    log.success(`Restored ${file}`)
  }

  log.banner('Summary')
  log.info('')
  log.info(
    `  Restored: ${pc.green(String(result.data.restored ?? 0))}, Failed: ${pc.red(String(result.data.failed ?? 0))}`,
  )
  log.info('')

  process.exitCode = result.ok ? 0 : 1
}
