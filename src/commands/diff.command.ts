import pc from 'picocolors'

import { log } from '../logger'
import { type Change, type EnvPathInfo } from '../utils'
import { createCommandContext, maybeWriteJsonResult } from './common'

function maskValue(value: string, maxLen = 40): string {
  if (value.length <= 8) return value
  if (value.length <= maxLen) {
    return value.substring(0, 4) + '...' + value.substring(value.length - 4)
  }
  return value.substring(0, 4) + '...' + value.substring(value.length - 4)
}

function displayGitStyleDiff(changes: Change[], pathInfo: EnvPathInfo): void {
  const newChanges = changes.filter((c) => c.type === 'new')
  const updatedChanges = changes.filter((c) => c.type === 'updated')
  const localModifiedChanges = changes.filter((c) => c.type === 'local_modified')
  const localOnlyChanges = changes.filter((c) => c.type === 'custom')

  if (newChanges.length === 0 && updatedChanges.length === 0 && localModifiedChanges.length === 0) {
    return
  }

  log.diffHeader(pathInfo.envPath)

  for (const change of newChanges) {
    log.diffAdd(`${change.key}=${maskValue(change.newValue || '')}`)
  }

  for (const change of updatedChanges) {
    log.diffRemove(`${change.key}=${maskValue(change.localValue || '')}`)
    log.diffAdd(`${change.key}=${maskValue(change.newValue || '')}`)
  }

  for (const change of localModifiedChanges) {
    log.info(
      pc.blue(`~ ${change.key}=${maskValue(change.localValue || '')} ${pc.dim('(local modification, preserved)')}`),
    )
  }

  if (localOnlyChanges.length > 0) {
    log.info('')
    log.info(pc.dim(`  # ${localOnlyChanges.length} local-only var(s) will be preserved`))
  }
}

export async function diffCommand(options: { path?: string }): Promise<void> {
  const { config, engine } = createCommandContext()
  const result = await engine.diff(
    config.json
      ? options.path
        ? { path: options.path }
        : undefined
      : {
          ...(options.path ? { path: options.path } : {}),
          includeSecrets: true,
        },
  )

  if (maybeWriteJsonResult(result, config.json)) return

  log.banner('Environment Diff')
  log.info(`  Environment: ${pc.cyan(config.environment)}`)

  for (const pathResult of result.data.paths) {
    const pathInfo = pathResult.pathInfo

    if (!pathResult.hasTemplate) {
      log.skip(`${pathInfo.envPath} (no template)`)
      log.detail(`Template not found: ${pathInfo.templatePath}`)
      continue
    }

    if (pathResult.error) {
      log.fail(`${pathInfo.envPath}: Failed to resolve secrets`)
      log.detail(pathResult.error)
      continue
    }

    if (!pathResult.hasEnv) {
      log.missing(`${pathInfo.envPath} not found`)
      log.detail(`Run ${pc.cyan('envi sync')} to create it`)
      continue
    }

    const newChanges = pathResult.changes.filter((c) => c.type === 'new')
    const updatedChanges = pathResult.changes.filter((c) => c.type === 'updated')
    const localModifiedChanges = pathResult.changes.filter((c) => c.type === 'local_modified')
    const localOnlyChanges = pathResult.changes.filter((c) => c.type === 'custom')

    if (newChanges.length === 0 && updatedChanges.length === 0 && localModifiedChanges.length === 0) {
      log.synced(`${pathInfo.envPath}`)
      if (localOnlyChanges.length > 0) {
        log.detail(`${localOnlyChanges.length} local-only var(s)`)
      }
      continue
    }

    displayGitStyleDiff(pathResult.changes, pathInfo)
  }

  log.banner('Summary')
  log.info('')

  if (!result.data.summary.hasAnyChanges) {
    log.info(`  ${pc.green('All environments are in sync!')}`)
    if (result.data.summary.localModified > 0) {
      log.info(`  ${pc.blue(`${result.data.summary.localModified} local modification(s)`)} preserved`)
    }
  } else {
    log.info(
      `  ${pc.green(`${result.data.summary.new} new`)}, ` +
        `${pc.yellow(`${result.data.summary.updated} updated`)}, ` +
        `${pc.blue(`${result.data.summary.localModified} local mods`)}, ` +
        `${pc.dim(`${result.data.summary.unchanged} unchanged`)}`,
    )
    log.info('')
    log.info(`  Run ${pc.cyan('envi sync')} to apply changes`)
  }
  log.info('')

  process.exitCode = result.ok ? 0 : 1
}
