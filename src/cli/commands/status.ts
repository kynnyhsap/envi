import pc from 'picocolors'

import { log } from '../../app/logger'
import { formatBackupTimestamp } from '../../shared/env/format'
import {
  createCommandContext,
  formatCountNoun,
  maybeWriteJsonResult,
  printCommandBanner,
  printMissingEnvPath,
  printNoTemplatePath,
  printSummaryBanner,
  printSummaryMetrics,
  withCommandProgress,
} from './common'

export async function statusCommand(): Promise<void> {
  const { config, engine } = createCommandContext()
  const result = await withCommandProgress({
    enabled: !config.json && !config.quiet,
    startMessage: 'Starting status check...',
    run: (progress) => engine.status({ progress }),
  })

  if (maybeWriteJsonResult(result, config.json)) return

  printCommandBanner('Environment Status', config.vars)

  log.header('Authentication')
  log.info(`  ${pc.cyan(result.data.provider.name)}`)
  log.info('')

  for (const line of result.data.provider.availability.statusLines) {
    log.detail(line)
  }

  log.info('')

  const providerAuthOk = result.data.provider.availability.available && result.data.provider.auth.success

  if (!result.data.provider.availability.available) {
    log.fail('No authentication method available')
    log.info('')
    for (const line of result.data.provider.availability.helpLines) {
      log.info(`  ${line}`)
    }
  } else {
    log.info(`  Authenticating via ${result.data.provider.name} (${result.data.provider.auth.type})...`)

    if (result.data.provider.auth.success) {
      log.success(`Authenticated via ${result.data.provider.auth.type}`)
    } else {
      log.fail('Authentication failed')
      if (result.data.provider.auth.error) {
        log.detail(result.data.provider.auth.error)
      }
      for (const line of result.data.provider.auth.hints) {
        log.detail(line)
      }
    }
  }

  if (!providerAuthOk) {
    log.warn('Provider auth failed - path status below is local template/file checks only')
  }

  log.header('Configured Paths')
  log.info('')

  const statuses = result.data.paths
  for (const status of statuses) {
    const pathInfo = status.pathInfo
    const backupIndicator = status.hasBackup ? ` ${pc.dim('(backup exists)')}` : ''

    switch (status.status) {
      case 'missing':
        printMissingEnvPath({
          envPath: `${pathInfo.envPath}${backupIndicator}`,
          details: [
            `Template: ${pathInfo.templatePath}`,
            `Template has ${status.templateVarCount} vars, file not found`,
          ],
        })
        break
      case 'synced':
        if (providerAuthOk) {
          log.synced(`${pathInfo.envPath}${backupIndicator}`)
          log.detail(`${status.envVarCount} vars (template: ${status.templateVarCount})`)
          log.detail(pc.dim('Note: only checks key presence, run diff to verify values'))
        } else {
          log.file(`${pathInfo.envPath}${backupIndicator}`)
          log.detail(`${status.envVarCount} vars (template: ${status.templateVarCount})`)
          log.detail(pc.dim('Local keys align with template (provider check unavailable)'))
        }
        break
      case 'outdated':
        if (providerAuthOk) {
          log.outdated(`${pathInfo.envPath}${backupIndicator}`)
          log.detail(`${status.envVarCount} vars, template expects ${status.templateVarCount}`)
          log.detail(pc.dim('Run sync to add missing variables'))
        } else {
          log.warn(`${pathInfo.envPath}${backupIndicator}`)
          log.detail(`${status.envVarCount} vars, template expects ${status.templateVarCount}`)
          log.detail(pc.dim('Local file is missing template keys (provider check unavailable)'))
        }
        break
      case 'no-template':
        printNoTemplatePath(pathInfo.envPath, pathInfo.templatePath)
        break
    }
  }

  log.header('Backups')
  log.info('')

  const backupInfo = result.data.backups
  if (backupInfo.count === 0) {
    log.info(`  ${pc.dim('No backups found')}`)
  } else {
    const latestFormatted = backupInfo.latestTimestamp ? formatBackupTimestamp(backupInfo.latestTimestamp) : 'unknown'
    log.info(`  ${pc.green(formatCountNoun(backupInfo.count, 'backup'))}, latest: ${latestFormatted}`)
  }

  const { missing, synced, outdated, noTemplate } = result.data.summary

  printSummaryBanner()
  if (providerAuthOk) {
    printSummaryMetrics([
      { value: synced, label: 'synced', color: pc.green },
      { value: outdated, label: 'outdated', color: pc.yellow },
      { value: missing, label: 'missing', color: pc.red },
      { value: noTemplate, label: 'no template', color: pc.dim },
    ])
  } else {
    printSummaryMetrics([
      { value: synced, label: 'key-aligned (local)', color: pc.blue },
      { value: outdated, label: 'missing template keys (local)', color: pc.yellow },
      { value: missing, label: 'missing env files (local)', color: pc.red },
      { value: noTemplate, label: 'no template', color: pc.dim },
    ])
  }

  if (missing > 0 || outdated > 0) {
    log.info('')
    if (providerAuthOk) {
      log.info(`  Run ${pc.cyan('envi sync')} to sync secrets`)
    } else {
      log.info(`  Fix provider auth, then run ${pc.cyan('envi sync')}`)
    }
  }

  log.info('')
}
