import pc from 'picocolors'

import { getConfig } from './config'

function shouldLog(): boolean {
  const config = getConfig()
  return !config.quiet && !config.json
}

function quiet(fn: (msg: string) => void): (msg: string) => void {
  return (msg) => {
    if (shouldLog()) fn(msg)
  }
}

function tag(label: string, color: (s: string) => string): (msg: string) => void {
  const raw = `  [${label}]`
  const padded = raw.padEnd(12)
  return quiet((msg) => console.info(`${color(padded)}${msg}`))
}

export const log = {
  error: (msg: string) => console.error(`${pc.red('  [ERROR]')}   ${msg}`),
  info: quiet((msg) => console.info(msg)),
  header: quiet((msg) => console.info(`\n${pc.bold(pc.cyan(msg))}`)),
  detail: quiet((msg) => console.info(pc.dim(`            ${msg}`))),
  success: tag('OK', pc.green),
  new: tag('NEW', pc.green),
  update: tag('UPDATE', pc.yellow),
  keep: tag('KEEP', pc.blue),
  skip: tag('SKIP', pc.dim),
  fail: tag('FAIL', pc.red),
  warn: tag('WARN', pc.yellow),
  file: tag('FILE', pc.blue),
  missing: tag('MISSING', pc.red),
  synced: tag('SYNCED', pc.green),
  outdated: tag('OUTDATED', pc.yellow),
  valid: tag('VALID', pc.green),
  invalid: tag('INVALID', pc.red),

  banner: quiet((title) => {
    console.info('')
    console.info(pc.bold('========================================'))
    console.info(pc.bold(`  ${title}`))
    console.info(pc.bold('========================================'))
  }),

  diffAdd: quiet((line) => console.info(pc.green(`+ ${line}`))),
  diffRemove: quiet((line) => console.info(pc.red(`- ${line}`))),
  diffContext: quiet((line) => console.info(pc.dim(`  ${line}`))),
  diffHeader: quiet((file) => console.info(pc.bold(pc.cyan(`\n--- ${file}`)))),
}
