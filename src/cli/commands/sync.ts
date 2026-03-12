import { Table } from 'console-table-printer'
import pc from 'picocolors'

import { log } from '../../app/logger'
import { isSecretReference } from '../../sdk'
import { redactSecret, truncateValue } from '../../shared/env/format'
import type { Change } from '../../shared/env/types'
import {
  createCommandContext,
  maybeWriteJsonResult,
  printCommandBanner,
  printMultilineDetails,
  printSummaryBanner,
  printSummaryMetrics,
  withCommandProgress,
} from './common'

function formatValue(value: string, isSecret: boolean): string {
  if (isSecret) {
    return redactSecret(value)
  }
  return truncateValue(value)
}

function isSecretValue(templateValue: string | undefined): boolean {
  if (!templateValue) return false
  return isSecretReference(templateValue)
}

function displayChanges(changes: Change[]): {
  newCount: number
  updateCount: number
  customCount: number
  unchangedCount: number
} {
  let newCount = 0
  let updateCount = 0
  let customCount = 0
  let unchangedCount = 0

  const templateChanges: { change: Change; status: 'NEW' | 'UPDATED' | 'UNCHANGED' }[] = []
  const customChanges: Change[] = []

  for (const change of changes) {
    switch (change.type) {
      case 'new':
        templateChanges.push({ change, status: 'NEW' })
        newCount++
        break
      case 'updated':
        templateChanges.push({ change, status: 'UPDATED' })
        updateCount++
        break
      case 'unchanged':
        templateChanges.push({ change, status: 'UNCHANGED' })
        unchangedCount++
        break
      case 'local_modified':
      case 'custom':
        customChanges.push(change)
        customCount++
        break
    }
  }

  if (templateChanges.length === 0 && customChanges.length === 0) {
    return { newCount, updateCount, customCount, unchangedCount }
  }

  const hasUpdates = updateCount > 0

  const columns = [
    { name: 'source', title: 'Source', alignment: 'left' as const },
    { name: 'status', title: 'Status', alignment: 'left' as const },
    { name: 'key', title: 'Variable', alignment: 'left' as const },
    { name: 'value', title: 'Value', alignment: 'left' as const },
  ]
  if (hasUpdates) {
    columns.push({ name: 'oldValue', title: 'Old Value', alignment: 'left' as const })
  }

  const table = new Table({ columns })

  const statusOrder = { NEW: 0, UPDATED: 1, UNCHANGED: 2 }
  templateChanges.sort((a, b) => statusOrder[a.status] - statusOrder[b.status])

  for (const { change, status } of templateChanges) {
    const isSecret = isSecretValue(change.templateValue)
    const displayValue = status === 'UNCHANGED' ? change.localValue : change.newValue
    const row: Record<string, string> = {
      source: 'TEMPLATE',
      status,
      key: change.key,
      value: formatValue(displayValue || '', isSecret),
    }
    if (hasUpdates) {
      row['oldValue'] = status === 'UPDATED' ? formatValue(change.localValue || '', isSecret) : ''
    }

    let color: 'green' | 'yellow' | 'white' = 'white'
    if (status === 'NEW') color = 'green'
    else if (status === 'UPDATED') color = 'yellow'

    table.addRow(row, { color })
  }

  for (const change of customChanges) {
    const row: Record<string, string> = {
      source: 'CUSTOM',
      status: 'KEPT',
      key: change.key,
      value: formatValue(change.localValue || '', false),
    }
    if (hasUpdates) row['oldValue'] = ''
    table.addRow(row, { color: 'cyan' })
  }

  table.printTable()

  return { newCount, updateCount, customCount, unchangedCount }
}

export async function syncCommand(options: { dryRun: boolean; noBackup: boolean }): Promise<void> {
  const { config, engine } = createCommandContext()
  const result = await withCommandProgress({
    enabled: !config.json && !config.quiet,
    startMessage: 'Starting sync...',
    run: (progress) =>
      engine.sync({
        dryRun: options.dryRun,
        noBackup: options.noBackup,
        includeSecrets: !config.json,
        progress,
      }),
  })

  if (maybeWriteJsonResult(result, config.json)) return

  printCommandBanner('Environment Sync', config.vars)

  if (options.dryRun) {
    log.info(pc.yellow('  Running in dry-run mode'))
  }

  for (const pathResult of result.data.paths) {
    log.header(`Processing ${pathResult.pathInfo.envPath}`)

    if (pathResult.skipped) {
      log.skip(pathResult.message ?? 'Skipped')
      continue
    }

    if (!pathResult.success) {
      const lines = (pathResult.message ?? 'Failed').split('\n').filter((line) => line.trim().length > 0)
      const [firstLine = 'Failed', ...rest] = lines
      log.fail(firstLine)
      printMultilineDetails(rest.join('\n'))
      continue
    }

    if (pathResult.envSwitched) {
      log.warn('Reference vars changed - secrets updated')
    }

    log.info('')
    const { newCount, updateCount, customCount, unchangedCount } = displayChanges(pathResult.changes)

    log.info('')
    log.info('  Summary:')
    printSummaryMetrics([
      { value: newCount, label: 'new', color: pc.green },
      { value: updateCount, label: 'updated', color: pc.yellow },
      { value: customCount, label: 'custom', color: pc.cyan },
      { value: unchangedCount, label: 'unchanged', color: pc.dim },
    ])

    if (options.dryRun) {
      log.warn('Dry run - no changes written')
    } else if (newCount === 0 && updateCount === 0) {
      log.success('File reformatted (no value changes)')
    } else {
      log.success(`Written to ${pathResult.pathInfo.envPath}`)
    }
  }

  printSummaryBanner()
  printSummaryMetrics([
    { value: result.data.summary.success, label: 'files succeeded', color: pc.green },
    { value: result.data.summary.failed, label: 'files failed', color: pc.red },
    { value: result.data.summary.skipped, label: 'files skipped', color: pc.dim },
  ])
  log.info('')
  printSummaryMetrics([
    { value: result.data.summary.new, label: 'new variables', color: pc.green },
    { value: result.data.summary.updated, label: 'updated variables', color: pc.yellow },
    { value: result.data.summary.custom, label: 'custom variables', color: pc.cyan },
  ])
  log.info('')

  process.exitCode = result.ok ? 0 : 1
}
