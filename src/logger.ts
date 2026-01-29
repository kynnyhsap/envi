import pc from 'picocolors'
import { getConfig } from './config'

function shouldLog(): boolean {
  return !getConfig().quiet
}

/** Create a log method that only prints when not in quiet mode. */
function quiet(fn: (msg: string) => void): (msg: string) => void {
  return (msg) => { if (shouldLog()) fn(msg) }
}

/** Create a tagged log method: `  [TAG]   message` */
function tag(label: string, color: (s: string) => string): (msg: string) => void {
  // Pad the raw text first, then colorize, so ANSI codes don't break alignment
  const raw = `  [${label}]`
  const padded = raw.padEnd(12)
  return quiet((msg) => console.info(`${color(padded)}${msg}`))
}

export const log = {
  // Always log (errors, critical info)
  error: (msg: string) => console.error(`${pc.red('  [ERROR]')}   ${msg}`),

  // Conditional logging (respects --quiet)
  info:     quiet((msg) => console.info(msg)),
  header:   quiet((msg) => console.info(`\n${pc.bold(pc.cyan(msg))}`)),
  detail:   quiet((msg) => console.info(pc.dim(`            ${msg}`))),

  // Tagged status lines
  success:  tag('OK',       pc.green),
  new:      tag('NEW',      pc.green),
  update:   tag('UPDATE',   pc.yellow),
  keep:     tag('KEEP',     pc.blue),
  skip:     tag('SKIP',     pc.dim),
  fail:     tag('FAIL',     pc.red),
  warn:     tag('WARN',     pc.yellow),
  file:     tag('FILE',     pc.blue),
  missing:  tag('MISSING',  pc.red),
  synced:   tag('SYNCED',   pc.green),
  outdated: tag('OUTDATED', pc.yellow),
  valid:    tag('VALID',    pc.green),
  invalid:  tag('INVALID',  pc.red),

  banner: quiet((title) => {
    console.info('')
    console.info(pc.bold('========================================'))
    console.info(pc.bold(`  ${title}`))
    console.info(pc.bold('========================================'))
  }),

  // Git-style diff output
  diffAdd:     quiet((line) => console.info(pc.green(`+ ${line}`))),
  diffRemove:  quiet((line) => console.info(pc.red(`- ${line}`))),
  diffContext:  quiet((line) => console.info(pc.dim(`  ${line}`))),
  diffHeader:  quiet((file) => console.info(pc.bold(pc.cyan(`\n--- ${file}`)))),
}
