import { Table } from 'console-table-printer'
import pc from 'picocolors'

import { log } from '../../app/logger'
import { isSecretReference } from '../../sdk'
import { redactSecret, truncateValue } from '../../shared/env/format'
import type { Change } from '../../shared/env/types'
import { createCommandContext, maybeWriteJsonResult } from './common'

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

export async function syncCommand(options: { force: boolean; dryRun: boolean; noBackup: boolean }): Promise<void> {
  const { config, engine } = createCommandContext()
  const result = await engine.sync({
    force: options.force,
    dryRun: options.dryRun,
    noBackup: options.noBackup,
    includeSecrets: !config.json,
  })

  if (maybeWriteJsonResult(result, config.json)) return

  log.banner('Environment Sync')
  log.info(`  Environment: ${pc.cyan(config.environment)}`)

  if (options.dryRun) {
    log.info(pc.yellow('  Running in dry-run mode'))
  }
  if (options.force) {
    log.info(pc.yellow('  Running in force mode (no prompts)'))
  }

  for (const pathResult of result.data.paths) {
    log.header(`Processing ${pathResult.pathInfo.envPath}`)

    if (pathResult.skipped) {
      log.skip(pathResult.message ?? 'Skipped')
      continue
    }

    if (!pathResult.success) {
      log.fail(pathResult.message ?? 'Failed')
      continue
    }

    if (pathResult.envSwitched) {
      log.warn('Environment change detected - secrets updated')
    }

    log.info('')
    const { newCount, updateCount, customCount, unchangedCount } = displayChanges(pathResult.changes)

    log.info('')
    log.info(
      `  Summary: ${pc.green(`${newCount} new`)}, ` +
        `${pc.yellow(`${updateCount} updated`)}, ` +
        `${pc.cyan(`${customCount} custom`)}, ` +
        `${pc.dim(`${unchangedCount} unchanged`)}`,
    )

    if (options.dryRun) {
      log.warn('Dry run - no changes written')
    } else if (newCount === 0 && updateCount === 0) {
      log.success('File reformatted (no value changes)')
    } else {
      log.success(`Written to ${pathResult.pathInfo.envPath}`)
    }
  }

  log.banner('Summary')
  log.info('')
  log.info(
    `  Files processed: ${pc.green(`${result.data.summary.success} success`)}, ` +
      `${pc.red(`${result.data.summary.failed} failed`)}, ` +
      `${pc.dim(`${result.data.summary.skipped} skipped`)}`,
  )
  log.info(
    `  Variables: ${pc.green(`${result.data.summary.new} new`)}, ` +
      `${pc.yellow(`${result.data.summary.updated} updated`)}, ` +
      `${pc.cyan(`${result.data.summary.custom} custom`)}`,
  )
  log.info('')

  process.exitCode = result.ok ? 0 : 1
}
