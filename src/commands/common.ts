import type { RuntimeConfig } from '../config'
import { getConfig } from '../config'
import { log } from '../logger'
import { stringifyEnvelope, type EnviCommand, type EnviEngine, type Issue, type JsonEnvelope } from '../sdk'
import { createCliEngine } from './engine'

export function createCommandContext(): { config: RuntimeConfig; engine: EnviEngine } {
  const config = getConfig()
  return { config, engine: createCliEngine() }
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
