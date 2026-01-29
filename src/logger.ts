import pc from 'picocolors'
import { getConfig } from './config'

function shouldLog(): boolean {
  return !getConfig().quiet
}

export const log = {
  // Always log (errors, critical info)
  error: (msg: string) => console.error(`${pc.red('  [ERROR]')}   ${msg}`),

  // Conditional logging (respects --quiet)
  info: (msg: string) => shouldLog() && console.info(msg),
  header: (msg: string) => shouldLog() && console.info(`\n${pc.bold(pc.cyan(msg))}`),
  success: (msg: string) => shouldLog() && console.info(`${pc.green('  [OK]')}      ${msg}`),
  new: (msg: string) => shouldLog() && console.info(`${pc.green('  [NEW]')}     ${msg}`),
  update: (msg: string) => shouldLog() && console.info(`${pc.yellow('  [UPDATE]')}  ${msg}`),
  keep: (msg: string) => shouldLog() && console.info(`${pc.blue('  [KEEP]')}    ${msg}`),
  skip: (msg: string) => shouldLog() && console.info(`${pc.dim('  [SKIP]')}    ${msg}`),
  fail: (msg: string) => shouldLog() && console.info(`${pc.red('  [FAIL]')}    ${msg}`),
  detail: (msg: string) => shouldLog() && console.info(pc.dim(`            ${msg}`)),
  warn: (msg: string) => shouldLog() && console.info(`${pc.yellow('  [WARN]')}    ${msg}`),
  file: (msg: string) => shouldLog() && console.info(`${pc.blue('  [FILE]')}    ${msg}`),
  missing: (msg: string) => shouldLog() && console.info(`${pc.red('  [MISSING]')} ${msg}`),
  synced: (msg: string) => shouldLog() && console.info(`${pc.green('  [SYNCED]')}  ${msg}`),
  outdated: (msg: string) => shouldLog() && console.info(`${pc.yellow('  [OUTDATED]')} ${msg}`),
  valid: (msg: string) => shouldLog() && console.info(`${pc.green('  [VALID]')}   ${msg}`),
  invalid: (msg: string) => shouldLog() && console.info(`${pc.red('  [INVALID]')} ${msg}`),
  banner: (title: string) => {
    if (!shouldLog()) return
    console.info('')
    console.info(pc.bold('========================================'))
    console.info(pc.bold(`  ${title}`))
    console.info(pc.bold('========================================'))
  },

  // Git-style diff output
  diffAdd: (line: string) => shouldLog() && console.info(pc.green(`+ ${line}`)),
  diffRemove: (line: string) => shouldLog() && console.info(pc.red(`- ${line}`)),
  diffContext: (line: string) => shouldLog() && console.info(pc.dim(`  ${line}`)),
  diffHeader: (file: string) => shouldLog() && console.info(pc.bold(pc.cyan(`\n--- ${file}`))),
}
