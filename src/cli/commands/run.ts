import pc from 'picocolors'

import { log } from '../../app/logger'
import { createCommandContext, maybeWriteJsonResult, printIssuesAndExit } from './common'

interface RunOptions {
  envFile?: string[]
  noTemplate?: boolean
}

export async function runCommand(command: string[], options: RunOptions = {}): Promise<void> {
  if (command.length === 0) {
    log.error('No command specified. Usage: envi run -- <command> [args...]')
    process.exit(1)
  }

  const { config, engine } = createCommandContext()
  const resolved = await engine.resolveRunEnvironment({
    ...(options.envFile ? { envFile: options.envFile } : {}),
    ...(options.noTemplate ? { noTemplate: true } : {}),
    includeSecrets: !config.json,
  })

  if (maybeWriteJsonResult(resolved, config.json)) return

  if (!config.quiet) {
    log.banner('Run')
    log.info(`  Environment: ${pc.cyan(config.environment)}`)
    log.info(`  Command: ${pc.cyan(command.join(' '))}`)
    log.info('')
  }

  if (!resolved.ok) {
    printIssuesAndExit(resolved.issues)
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
