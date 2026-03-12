import pc from 'picocolors'

import { log } from '../../app/logger'
import {
  createCommandContext,
  formatProviderReference,
  maybeWriteJsonResult,
  pluralize,
  printCommandBanner,
  printSummaryBanner,
  printSummaryMetrics,
  withCommandProgress,
} from './common'

interface ValidateOptions {
  local?: boolean
}

function collectMissingDynamicVars(issues: Array<{ code: string; reference?: string }>): string[] {
  const missing = new Set<string>()

  for (const issue of issues) {
    if (issue.code !== 'UNRESOLVED_VARIABLE' || !issue.reference) continue

    for (const match of issue.reference.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)) {
      const name = match[1]
      if (name) missing.add(name)
    }
  }

  return [...missing].sort()
}

export async function validateCommand(options: ValidateOptions = {}): Promise<void> {
  const isLocal = options.local ?? false
  const remote = !isLocal
  const { config, engine } = createCommandContext()
  const result = await withCommandProgress({
    enabled: !config.json && !config.quiet,
    startMessage: isLocal ? 'Starting local validate...' : 'Starting validate...',
    run: (progress) => engine.validate({ remote, progress }),
  })

  if (maybeWriteJsonResult(result, config.json)) return

  printCommandBanner('Validate Secret References', config.vars)
  log.info('')
  if (isLocal) {
    log.info(`  ${pc.yellow('Mode: local-only (provider not checked)')}`)
    log.info('  Validating reference format in templates...')
  } else {
    log.info(`  Provider: ${pc.cyan(result.meta.provider)}`)
    log.info('  Validating references against provider...')
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
      const formattedRef = formatProviderReference(ref.resolvedReference)
      const line = `${ref.key}=${formattedRef}`

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
  printSummaryBanner()

  if (providerIssue) {
    log.fail(providerIssue.message)
  } else if (result.data.summary.templates === 0) {
    log.warn('No templates found')
  } else if (result.data.summary.invalid === 0) {
    log.info(`  ${pc.green('All references are valid!')}`)
    printSummaryMetrics([
      {
        value: result.data.summary.valid,
        label: `${pluralize(result.data.summary.valid, 'valid reference')}`,
        color: pc.green,
      },
      {
        value: result.data.summary.templates,
        label: `${pluralize(result.data.summary.templates, 'template')} scanned`,
        color: pc.dim,
      },
    ])
    if (isLocal) {
      log.info('')
      log.info(`  ${pc.dim(`Run ${pc.cyan('envi validate')} to check against provider`)}`)
    }
  } else {
    printSummaryMetrics([
      { value: result.data.summary.valid, label: 'valid', color: pc.green },
      { value: result.data.summary.invalid, label: 'invalid', color: pc.red },
      {
        value: result.data.summary.templates,
        label: `${pluralize(result.data.summary.templates, 'template')} scanned`,
        color: pc.dim,
      },
    ])
    log.info('')
    log.info(`  ${pc.red('Fix invalid references before running sync')}`)

    const missingVars = collectMissingDynamicVars(result.issues)
    if (!isLocal && missingVars.length > 0) {
      log.info('')
      log.info(`  ${pc.yellow(`Missing dynamic vars: ${missingVars.join(', ')}`)}`)
      log.detail(`Pass required vars: ${missingVars.map((name) => `--var ${name}=<value>`).join(' ')}`)
      log.detail('Or set "vars" in envi.json')
    }
  }

  log.info('')

  if (providerIssue) {
    process.exit(1)
  }

  process.exitCode = result.ok ? 0 : 1
}
