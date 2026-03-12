import pc from 'picocolors'

import { log } from '../../app/logger'
import { formatBackupTimestamp } from '../../shared/env/format'
import { createCommandContext, formatReferenceVars, maybeWriteJsonResult } from './common'

export async function statusCommand(): Promise<void> {
  const { config, engine } = createCommandContext()
  const result = await engine.status()

  if (maybeWriteJsonResult(result, config.json)) return

  log.banner('Environment Status')
  const varsLabel = formatReferenceVars(config.vars)
  if (varsLabel) {
    log.info(`  Vars: ${pc.cyan(varsLabel)}`)
  }
  log.info(`  Provider: ${pc.cyan(result.data.provider.name)}`)

  log.header(result.data.provider.name)
  log.info('')

  for (const line of result.data.provider.availability.statusLines) {
    log.detail(line)
  }

  log.info('')

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

  log.header('Configured Paths')
  log.info('')

  const statuses = result.data.paths
  for (const status of statuses) {
    const pathInfo = status.pathInfo
    const backupIndicator = status.hasBackup ? ` ${pc.dim('(backup exists)')}` : ''

    switch (status.status) {
      case 'missing':
        log.missing(`${pathInfo.envPath}${backupIndicator}`)
        log.detail(`Template: ${pathInfo.templatePath}`)
        log.detail(`Template has ${status.templateVarCount} vars, file not found`)
        break
      case 'synced':
        log.synced(`${pathInfo.envPath}${backupIndicator}`)
        log.detail(`${status.envVarCount} vars (template: ${status.templateVarCount})`)
        log.detail(pc.dim('Note: only checks key presence, run diff to verify values'))
        break
      case 'outdated':
        log.outdated(`${pathInfo.envPath}${backupIndicator}`)
        log.detail(`${status.envVarCount} vars, template expects ${status.templateVarCount}`)
        log.detail(pc.dim('Run sync to add missing variables'))
        break
      case 'no-template':
        log.skip(`${pathInfo.envPath} (no template)`)
        log.detail(`Template not found: ${pathInfo.templatePath}`)
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
    log.info(`  ${pc.green(String(backupInfo.count))} backup(s), latest: ${latestFormatted}`)
  }

  const { missing, synced, outdated, noTemplate } = result.data.summary

  log.header('Summary')
  log.info('')
  log.info(
    `  ${pc.green(`${synced} synced`)}, ` +
      `${pc.yellow(`${outdated} outdated`)}, ` +
      `${pc.red(`${missing} missing`)}, ` +
      `${pc.dim(`${noTemplate} no template`)}`,
  )

  if (missing > 0 || outdated > 0) {
    log.info('')
    log.info(`  Run ${pc.cyan('envi sync')} to sync secrets`)
  }

  log.info('')
}
