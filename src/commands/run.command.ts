/**
 * Run command — execute a command with secrets injected as environment variables.
 *
 * Reads .env.example templates, resolves all secret references via the configured provider,
 * and passes the resolved key=value pairs as environment variables to the child process.
 *
 * Usage:
 *   envi run -- node index.js
 *   envi run --env-file .env.local -- node index.js
 *   envi run --no-template -- ./deploy.sh
 */

import pc from 'picocolors'

import { getConfig } from '../config'
import { log } from '../logger'
import { stringifyEnvelope } from '../sdk'
import { createCliEngine } from './engine'

interface RunOptions {
  /** Additional .env files to load (bare key=value, may contain secret refs) */
  envFile?: string[]
  /** Skip loading templates */
  noTemplate?: boolean
}

export async function runCommand(command: string[], options: RunOptions = {}): Promise<void> {
  if (command.length === 0) {
    log.error('No command specified. Usage: envi run -- <command> [args...]')
    process.exit(1)
  }

  const config = getConfig()
  const engine = createCliEngine()
  const resolved = await engine.resolveRunEnvironment({
    ...(options.envFile ? { envFile: options.envFile } : {}),
    ...(options.noTemplate ? { noTemplate: true } : {}),
    includeSecrets: !config.json,
  })

  if (config.json) {
    process.stdout.write(stringifyEnvelope(resolved))
    process.exitCode = resolved.ok ? 0 : 1
    return
  }

  if (!config.quiet) {
    log.banner('Run')
    log.info(`  Environment: ${pc.cyan(config.environment)}`)
    log.info(`  Command: ${pc.cyan(command.join(' '))}`)
    log.info('')
  }

  if (!resolved.ok) {
    for (const issue of resolved.issues) {
      log.fail(issue.message)
    }
    process.exit(1)
  }

  if (!config.quiet) {
    log.info(`  Injecting ${pc.green(String(resolved.data.summary.total))} variable(s) into environment`)
    log.info(`  Executing: ${pc.cyan(command.join(' '))}`)
    log.info('')
  }

  const childEnv: Record<string, string> = { ...process.env } as Record<string, string>
  for (const [key, value] of Object.entries(resolved.data.env)) {
    childEnv[key] = value
  }

  const [cmd, ...args] = command
  const proc = Bun.spawn([cmd!, ...args], {
    env: childEnv,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const forwardSignal = (signal: NodeJS.Signals) => {
    proc.kill(signal === 'SIGINT' ? 2 : 15)
  }
  process.on('SIGINT', () => forwardSignal('SIGINT'))
  process.on('SIGTERM', () => forwardSignal('SIGTERM'))

  const exitCode = await proc.exited
  process.exit(exitCode)
}
