import { select } from '@inquirer/prompts'
import pc from 'picocolors'

import { getConfig } from '../../app/config'
import { log } from '../../app/logger'
import { stringifyEnvelope } from '../../sdk'
import {
  findBackupSnapshots,
  summarizeSnapshot,
  type BackupFileRecord,
  type BackupSnapshot,
} from '../../shared/backup/snapshots'
import { formatBackupTimestamp } from '../../shared/env/format'
import { promptConfirm } from '../../shared/helpers'

async function restoreFile(backup: BackupFileRecord, options: { force: boolean; dryRun: boolean }): Promise<boolean> {
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
  const config = getConfig()

  if (config.json) {
    const snapshots = await findBackupSnapshots(config.backupDir)

    if (snapshots.length === 0) {
      const envelope = {
        schemaVersion: 1,
        command: 'restore',
        ok: false,
        data: { backupDir: config.backupDir, snapshots: [] },
        issues: [{ code: 'NO_BACKUPS', message: `No backups found in ${config.backupDir}/` }],
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

    if (options.list) {
      const envelope = {
        schemaVersion: 1,
        command: 'restore.list',
        ok: true,
        data: {
          backupDir: config.backupDir,
          snapshots: snapshots.map((s) => ({
            timestamp: s.timestamp,
            path: s.path,
            files: s.files.map((f) => ({
              originalPath: f.originalPath,
              size: f.size,
              modifiedAt: f.modifiedAt.toISOString(),
            })),
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

    const selectedSnapshot = snapshots[0]!
    if (!options.force) {
      const envelope = {
        schemaVersion: 1,
        command: 'restore',
        ok: false,
        data: {
          backupDir: config.backupDir,
          selectedSnapshot: selectedSnapshot.timestamp,
          files: selectedSnapshot.files.map((f) => f.originalPath),
        },
        issues: [
          {
            code: 'PROMPT_REQUIRED',
            message:
              'Restore requires interactive selection/confirmation. Re-run with --force or --list when using --json.',
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
      const wouldOverwrite: string[] = []
      const wouldRestore: string[] = []
      for (const file of selectedSnapshot.files) {
        const exists = await Bun.file(file.originalPath).exists()
        if (exists) wouldOverwrite.push(file.originalPath)
        else wouldRestore.push(file.originalPath)
      }

      const envelope = {
        schemaVersion: 1,
        command: 'restore',
        ok: true,
        data: {
          dryRun: true,
          force: true,
          backupDir: config.backupDir,
          selectedSnapshot: selectedSnapshot.timestamp,
          wouldOverwrite,
          wouldRestore,
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

    let successCount = 0
    let failCount = 0
    const errors: Array<{ path: string; error: string }> = []

    for (const backup of selectedSnapshot.files) {
      try {
        const content = await Bun.file(backup.backupPath).text()
        await Bun.write(backup.originalPath, content)
        successCount++
      } catch (error) {
        failCount++
        const msg = error instanceof Error ? error.message : String(error)
        errors.push({ path: backup.originalPath, error: msg })
      }
    }

    const envelope = {
      schemaVersion: 1,
      command: 'restore',
      ok: failCount === 0,
      data: {
        dryRun: false,
        force: true,
        backupDir: config.backupDir,
        selectedSnapshot: selectedSnapshot.timestamp,
        restored: successCount,
        failed: failCount,
        errors,
      },
      issues: errors.map((e) => ({ code: 'RESTORE_FAILED', message: e.error, path: e.path })),
      meta: {
        environment: config.environment,
        provider: config.provider,
        timestamp: new Date().toISOString(),
      },
    }

    process.stdout.write(stringifyEnvelope(envelope))
    process.exitCode = failCount === 0 ? 0 : 1
    return
  }

  log.banner('Restore .env Files from Backup')

  if (options.dryRun) {
    log.info(pc.yellow('  Running in dry-run mode'))
  }

  const snapshots = await findBackupSnapshots(config.backupDir)

  if (snapshots.length === 0) {
    log.fail(`No backups found in ${config.backupDir}/`)
    log.info('')
    log.info('  Create a backup first with:')
    log.info(`  ${pc.cyan('envi backup')}`)
    process.exitCode = 1
    return
  }

  if (options.list) {
    log.header('Available Backups')
    log.info('')

    for (const snapshot of snapshots) {
      const { fileCount, sizeKb } = summarizeSnapshot(snapshot)
      log.info(`  ${pc.cyan(snapshot.timestamp)}  ${pc.dim(`(${fileCount} files, ${sizeKb}KB)`)}`)
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
    process.exitCode = 1
    return
  }

  if (snapshots.length === 1) {
    selectedSnapshot = firstSnapshot
    log.info('')
    log.info(`  Found 1 backup: ${pc.cyan(formatBackupTimestamp(selectedSnapshot.timestamp))}`)
  } else if (options.force) {
    selectedSnapshot = firstSnapshot
    log.info('')
    log.info(`  Using most recent backup: ${pc.cyan(formatBackupTimestamp(selectedSnapshot.timestamp))}`)
  } else {
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
        process.exitCode = 1
        return
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
    process.exitCode = 1
    return
  }
}
