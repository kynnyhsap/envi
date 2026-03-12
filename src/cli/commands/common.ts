import { basename } from 'node:path'
import pc from 'picocolors'

import type { RuntimeConfig } from '../../app/config'
import { getConfig } from '../../app/config'
import { log } from '../../app/logger'
import {
  stringifyEnvelope,
  type EnviCommand,
  type EnviEngine,
  type Issue,
  type JsonEnvelope,
  type ProgressEvent,
  type ProgressReporter,
} from '../../sdk'
import { resolveReferenceVars } from '../../shared/env/variables'
import { createCliEngine } from '../engine'

export function createCommandContext(): { config: RuntimeConfig; engine: EnviEngine } {
  const config = getConfig()
  return { config, engine: createCliEngine() }
}

export function formatReferenceVars(vars: Record<string, string>): string | undefined {
  const entries = Object.entries(resolveReferenceVars(vars))
  if (entries.length === 0) return undefined

  return entries.map(([key, value]) => `${key}=${value}`).join(', ')
}

export function writeJsonResult(result: { ok: boolean }): never {
  process.stdout.write(stringifyEnvelope(result))
  process.exit(result.ok ? 0 : 1)
}

export function maybeWriteJsonResult<TData, TCommand extends EnviCommand>(
  result: JsonEnvelope<TData, TCommand>,
  json: boolean,
): boolean {
  if (!json) return false
  writeJsonResult(result)
}

export function printIssuesAndExit(issues: Issue[], mode: 'error' | 'fail' = 'fail'): never {
  for (const issue of issues) {
    if (mode === 'error') {
      log.error(issue.message)
    } else {
      log.fail(issue.message)
    }
  }
  process.exit(1)
}

export async function withCommandProgress<T>(args: {
  enabled: boolean
  startMessage: string
  run: (progress: ProgressReporter) => Promise<T>
}): Promise<T> {
  const noopProgress: ProgressReporter = () => {}

  if (!args.enabled || !process.stdout.isTTY) {
    return await args.run(noopProgress)
  }

  const progress = createCliProgressReporter()
  const startedAt = Date.now()
  writeProgressLine(`  ${args.startMessage}`)

  try {
    return await args.run(progress)
  } finally {
    const elapsedMs = Date.now() - startedAt
    if (elapsedMs >= 1200) {
      writeProgressLine(`  ${pc.dim(`Done in ${(elapsedMs / 1000).toFixed(1)}s`)}`)
    }
  }
}

function createCliProgressReporter(): ProgressReporter {
  let lastLine = ''

  return (event: ProgressEvent) => {
    const line = formatProgressLine(event)
    if (line === lastLine) return
    lastLine = line
    writeProgressLine(`  ${pc.dim(line)}`)
  }
}

function formatProgressLine(event: ProgressEvent): string {
  const progress =
    typeof event.completed === 'number' && typeof event.total === 'number'
      ? ` ${Math.min(event.completed, event.total)}/${event.total}`
      : ''

  const path = event.path ? ` (${compactPath(event.path)})` : ''
  return `${event.message}${progress}${path}`
}

function compactPath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
  }
  if (parts.length === 1) {
    return parts[0]!
  }
  return basename(path)
}

function writeProgressLine(line: string): void {
  console.info(line)
}
