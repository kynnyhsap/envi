import pc from 'picocolors'

import { log } from '../../app/logger'
import type { EnvPathInfo } from '../../sdk/types'
import type { Change } from '../../shared/env/types'
import {
  createCommandContext,
  maybeWriteJsonResult,
  printCommandBanner,
  printMissingEnvPath,
  printMultilineDetails,
  printNoTemplatePath,
  printSummaryBanner,
  withCommandProgress,
} from './common'

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
  const result = await withCommandProgress({
    enabled: !config.json && !config.quiet,
    startMessage: 'Starting diff...',
    run: (progress) =>
      engine.diff(
        config.json
          ? options.path
            ? { path: options.path }
            : { progress }
          : {
              ...(options.path ? { path: options.path } : {}),
              includeSecrets: true,
              progress,
            },
      ),
  })

  if (maybeWriteJsonResult(result, config.json)) return

  printCommandBanner('Environment Diff', config.vars)

  let printedPathBlock = false

  for (const pathResult of result.data.paths) {
    if (printedPathBlock) {
      log.info('')
    }
    printedPathBlock = true

    const pathInfo = pathResult.pathInfo

    if (!pathResult.hasTemplate) {
      printNoTemplatePath(pathInfo.envPath, pathInfo.templatePath)
      continue
    }

    if (pathResult.error) {
      log.fail(`${pathInfo.envPath}: Failed to resolve secrets`)
      printMultilineDetails(pathResult.error)
      continue
    }

    if (!pathResult.hasEnv) {
      const pendingNew = pathResult.changes.filter((c) => c.type === 'new').length
      printMissingEnvPath({
        envPath: pathInfo.envPath,
        includeNotFoundSuffix: true,
        suggestion: `Run ${pc.cyan('envi sync')} to create it`,
        details: pendingNew > 0 ? [`${pendingNew} template var(s) will be created`] : [],
      })
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

  printSummaryBanner()

  const failedPaths = result.data.paths.filter((pathResult) => !!pathResult.error).length
  const missingEnvPaths = result.data.paths.filter(
    (pathResult) => pathResult.hasTemplate && !pathResult.hasEnv && !pathResult.error,
  ).length

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

    if (failedPaths > 0 || missingEnvPaths > 0) {
      log.info(`  ${pc.red(`${failedPaths} failed`)}, ${pc.yellow(`${missingEnvPaths} missing env file(s)`)}`)
    }

    log.info('')
    if (failedPaths > 0) {
      log.info(`  Fix failed paths, then run ${pc.cyan('envi sync')}`)
    } else {
      log.info(`  Run ${pc.cyan('envi sync')} to apply changes`)
    }
  }
  log.info('')

  process.exitCode = result.ok ? 0 : 1
}
