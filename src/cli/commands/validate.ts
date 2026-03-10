import pc from 'picocolors'

import { log } from '../../app/logger'
import { hasUnresolvedVariables } from '../../shared/env/variables'
import { createCommandContext, formatReferenceVars, maybeWriteJsonResult } from './common'

function formatReference(reference: string): string {
  const trimmed = reference.trim()

  if (trimmed.startsWith('op://')) {
    const path = trimmed.slice('op://'.length)
    const parts = path.split('/')
    const [vault, item, ...rest] = parts
    const field = rest.join('/')

    return pc.dim('op://') + pc.blue(vault ?? '') + pc.dim('/') + pc.cyan(item ?? '') + pc.dim('/') + pc.yellow(field)
  }

  return trimmed
}

interface ValidateOptions {
  remote?: boolean
}

export async function validateCommand(options: ValidateOptions = {}): Promise<void> {
  const isRemote = options.remote ?? false
  const { config, engine } = createCommandContext()
  const result = await engine.validate({ remote: isRemote })

  if (maybeWriteJsonResult(result, config.json)) return

  log.banner('Validate Secret References')

  log.info('')
  log.info(`  Vars: ${pc.cyan(formatReferenceVars(config.vars))}`)
  log.info(`  Provider: ${pc.cyan(result.meta.provider)}`)
  if (isRemote) {
    log.info('  Validating references against provider...')
  } else {
    log.info('  Validating reference format in templates...')
  }
  log.info('')

  for (const pathResult of result.data.paths) {
    const pathInfo = pathResult.pathInfo
    if (!pathResult.hasTemplate) {
      log.skip(`${pathInfo.templatePath} (not found)`)
      continue
    }

    if (pathResult.references.length === 0) {
      log.info(`  ${pc.cyan(pathInfo.templatePath)}`)
      log.detail('No secret references found')
      continue
    }

    log.header(pathInfo.templatePath)

    for (const ref of pathResult.references) {
      const formattedRef = formatReference(ref.resolvedReference)
      const line = `${ref.key}=${formattedRef}`

      if (hasUnresolvedVariables(ref.resolvedReference)) {
        log.invalid(line)
        log.detail(pc.red('Error: Unresolved variables in reference'))
        continue
      }

      if (ref.valid) {
        log.valid(line)
      } else {
        log.invalid(line)
        log.detail(pc.red(`Error: ${ref.error ?? 'Invalid reference'}`))
      }
    }
  }

  const providerIssue = result.issues.find(
    (issue) => issue.code === 'AUTH_FAILED' || issue.code === 'PROVIDER_UNAVAILABLE',
  )

  // Summary
  log.banner('Summary')
  log.info('')

  if (providerIssue) {
    log.fail(providerIssue.message)
  } else if (result.data.summary.templates === 0) {
    log.warn('No templates found')
  } else if (result.data.summary.invalid === 0) {
    log.info(`  ${pc.green('All references are valid!')}`)
    log.info(
      `  ${pc.green(String(result.data.summary.valid))} reference(s) validated across ${result.data.summary.templates} template(s)`,
    )
    if (!isRemote) {
      log.info('')
      log.info(`  ${pc.dim(`Use ${pc.cyan('--remote')} to check against provider`)}`)
    }
  } else {
    log.info(
      `  ${pc.green(`${result.data.summary.valid} valid`)}, ${pc.red(`${result.data.summary.invalid} invalid`)} ` +
        `across ${result.data.summary.templates} template(s)`,
    )
    log.info('')
    log.info(`  ${pc.red('Fix invalid references before running sync')}`)
  }

  log.info('')

  if (providerIssue) {
    process.exit(1)
  }

  process.exitCode = result.ok ? 0 : 1
}
