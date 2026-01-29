#!/usr/bin/env bun

/**
 * envi - Manage .env files with secret providers.
 *
 * Usage:
 *   envi <command> [options]
 *
 * Commands:
 *   status              Show .env status and auth
 *   diff                Show differences between local and provider
 *   sync                Sync .env files from templates
 *   backup              Backup current .env files
 *   restore             Restore .env files from backup
 *   validate            Validate all secret references in templates
 *
 * Run 'envi <command> --help' for command-specific options.
 */

import { Command } from 'commander'
import pc from 'picocolors'
import {
  VERSION,
  ENV_PATHS,
  DEFAULT_BACKUP_DIR,
  DEFAULT_OUTPUT_FILE,
  DEFAULT_TEMPLATE_FILE,
  DEFAULT_PROVIDER,
  setRuntimeConfig,
  parseOnlyFlag,
  loadConfigFile,
  type ConfigFile,
} from './config'
import { isValidEnvironment, VALID_ENVIRONMENTS, DEFAULT_ENVIRONMENT } from './utils/variables'
import { VALID_PROVIDERS, type ProviderType } from './providers'
import {
  statusCommand,
  diffCommand,
  syncCommand,
  runCommand,
  backupCommand,
  restoreCommand,
  validateCommand,
} from './commands'

function showHelp(): void {
  console.info('')
  console.info(pc.bold(pc.cyan('envi')) + pc.dim(` v${VERSION}`) + ' - Manage .env files with secret providers')
  console.info('')
  console.info(pc.bold('USAGE'))
  console.info(`  ${pc.cyan('envi')} ${pc.yellow('<command>')} ${pc.dim('[options]')}`)
  console.info('')
  console.info(pc.bold('COMMANDS'))
  console.info(`  ${pc.yellow('status')}              Show .env status and auth`)
  console.info(`  ${pc.yellow('diff')}                Show differences between local and provider`)
  console.info(`  ${pc.yellow('sync')}                Sync .env files from templates`)
  console.info(`  ${pc.yellow('backup')}              Backup current .env files (timestamped)`)
  console.info(`  ${pc.yellow('restore')}             Restore .env files from backup`)
  console.info(`  ${pc.yellow('run')}                 Run a command with secrets as env vars`)
  console.info(`  ${pc.yellow('validate')}            Validate all secret references in templates`)
  console.info('')
  console.info(pc.bold('GLOBAL OPTIONS'))
  console.info(`  ${pc.green('-q, --quiet')}         Suppress non-essential output`)
  console.info(
    `  ${pc.green('-e, --env')} ${pc.dim('<name>')}    Environment ${pc.dim(`(${VALID_ENVIRONMENTS.join(', ')})`)}`,
  )
  console.info(
    `  ${pc.green('--provider')} ${pc.dim('<name>')}   Secret provider ${pc.dim(`(${VALID_PROVIDERS.join(', ')})`)}`,
  )
  console.info(
    `  ${pc.green('--provider-opt')} ${pc.dim('<k=v>')} Provider-specific option (repeatable)`,
  )
  console.info(`  ${pc.green('--config')} ${pc.dim('<path>')}    Load config from JSON file`)
  console.info(`  ${pc.green('--only')} ${pc.dim('<paths>')}      Only process specified paths (comma-separated)`)
  console.info(
    `  ${pc.green('--output')} ${pc.dim('<file>')}    Output file name ${pc.dim(`(default: ${DEFAULT_OUTPUT_FILE})`)}`,
  )
  console.info(
    `  ${pc.green('--template')} ${pc.dim('<file>')}  Template file name ${pc.dim(`(default: ${DEFAULT_TEMPLATE_FILE})`)}`,
  )
  console.info(
    `  ${pc.green('--backup-dir')} ${pc.dim('<dir>')} Backup directory ${pc.dim(`(default: ${DEFAULT_BACKUP_DIR})`)}`,
  )
  console.info(`  ${pc.green('-v, --version')}       Show version`)
  console.info(`  ${pc.green('-h, --help')}          Show this help`)
  console.info('')
  console.info(pc.bold('EXAMPLES'))
  console.info(`  ${pc.dim('$')} envi status`)
  console.info(`  ${pc.dim('$')} envi diff`)
  console.info(`  ${pc.dim('$')} envi sync -d                    ${pc.dim('# dry run')}`)
  console.info(`  ${pc.dim('$')} envi sync --only engine/api     ${pc.dim('# single path')}`)
  console.info(`  ${pc.dim('$')} envi backup`)
  console.info(`  ${pc.dim('$')} envi restore --list`)
  console.info('')
}

interface CommandOption {
  flags: string
  description: string
}

interface CommandHelp {
  name: string
  description: string
  options?: CommandOption[]
  examples?: string[]
}

function showCommandHelp(cmd: CommandHelp): void {
  console.info('')
  console.info(pc.bold(pc.cyan(`envi ${cmd.name}`)) + ` - ${cmd.description}`)
  console.info('')
  console.info(pc.bold('USAGE'))
  console.info(`  ${pc.cyan('envi')} ${pc.yellow(cmd.name)} ${pc.dim('[options]')}`)

  if (cmd.options && cmd.options.length > 0) {
    console.info('')
    console.info(pc.bold('OPTIONS'))
    for (const opt of cmd.options) {
      console.info(`  ${pc.green(opt.flags.padEnd(20))} ${opt.description}`)
    }
  }

  if (cmd.examples && cmd.examples.length > 0) {
    console.info('')
    console.info(pc.bold('EXAMPLES'))
    for (const example of cmd.examples) {
      console.info(`  ${pc.dim('$')} ${example}`)
    }
  }

  console.info('')
}

function configureCommandHelp(cmd: Command, help: CommandHelp): Command {
  return cmd.configureHelp({
    formatHelp: () => {
      showCommandHelp(help)
      return ''
    },
  })
}

interface GlobalOptions {
  quiet?: boolean
  env?: string
  provider?: string
  providerOpt?: string[]
  config?: string
  only?: string
  output?: string
  template?: string
  backupDir?: string
}

/** Parse `--provider-opt key=value` entries into a record. */
function parseProviderOpts(opts: string[] | undefined): Record<string, string> {
  if (!opts) return {}
  const result: Record<string, string> = {}
  for (const entry of opts) {
    const eq = entry.indexOf('=')
    if (eq === -1) {
      console.error(pc.red(`Invalid --provider-opt format: "${entry}" (expected key=value)`))
      process.exit(1)
    }
    result[entry.slice(0, eq)] = entry.slice(eq + 1)
  }
  return result
}

async function applyGlobalOptions(options: GlobalOptions): Promise<void> {
  // Load config file if provided (base layer)
  let fileConfig: ConfigFile = {}
  if (options.config) {
    try {
      fileConfig = await loadConfigFile(options.config)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(pc.red(msg))
      process.exit(1)
    }
  }

  // Merge: config file ← CLI flags (CLI wins)
  const env = options.env ?? fileConfig.environment ?? DEFAULT_ENVIRONMENT
  if (!isValidEnvironment(env)) {
    console.error(pc.red(`Invalid environment: ${env}`))
    console.error(pc.dim(`Valid environments: ${VALID_ENVIRONMENTS.join(', ')}`))
    process.exit(1)
  }

  const providerName = (options.provider ?? fileConfig.provider ?? DEFAULT_PROVIDER) as ProviderType
  if (!VALID_PROVIDERS.includes(providerName)) {
    console.error(pc.red(`Invalid provider: ${providerName}`))
    console.error(pc.dim(`Valid providers: ${VALID_PROVIDERS.join(', ')}`))
    process.exit(1)
  }

  // Provider options: config file ← CLI --provider-opt (CLI wins)
  const cliProviderOpts = parseProviderOpts(options.providerOpt)
  const providerOptions: Record<string, string> = {
    ...fileConfig.providerOptions,
    ...cliProviderOpts,
  }

  const paths = parseOnlyFlag(options.only) ?? fileConfig.paths ?? ENV_PATHS

  setRuntimeConfig({
    paths,
    outputFile: options.output ?? fileConfig.outputFile ?? DEFAULT_OUTPUT_FILE,
    templateFile: options.template ?? fileConfig.templateFile ?? DEFAULT_TEMPLATE_FILE,
    backupDir: options.backupDir ?? fileConfig.backupDir ?? DEFAULT_BACKUP_DIR,
    quiet: options.quiet ?? fileConfig.quiet ?? false,
    environment: env,
    provider: providerName,
    providerOptions,
  })
}

const program = new Command()

program
  .name('envi')
  .description('Manage .env files with secret providers')
  .version(VERSION, '-v, --version', 'Show version number')
  .option('-q, --quiet', 'Suppress non-essential output')
  .option('-e, --env <name>', `Environment (${VALID_ENVIRONMENTS.join(', ')})`, DEFAULT_ENVIRONMENT)
  .option('--provider <name>', `Secret provider (${VALID_PROVIDERS.join(', ')})`, DEFAULT_PROVIDER)
  .option('--provider-opt <key=value>', 'Provider-specific option (repeatable)', (val: string, acc: string[]) => { acc.push(val); return acc }, [] as string[])
  .option('--config <path>', 'Load config from JSON file')
  .option('--only <paths>', 'Only process specified paths (comma-separated)')
  .option('--output <file>', `Output file name (default: ${DEFAULT_OUTPUT_FILE})`)
  .option('--template <file>', `Template file name (default: ${DEFAULT_TEMPLATE_FILE})`)
  .option('--backup-dir <dir>', `Backup directory (default: ${DEFAULT_BACKUP_DIR})`)

configureCommandHelp(program.command('status').description('Show .env status and auth'), {
  name: 'status',
  description: 'Show .env status and auth',
  examples: ['envi status', 'envi status --only engine/api'],
}).action(async () => {
  await applyGlobalOptions(program.opts())
  await statusCommand()
})

configureCommandHelp(
  program
    .command('diff')
    .description('Show differences between local .env and provider')
    .option('-p, --path <path>', 'Check specific path only'),
  {
    name: 'diff',
    description: 'Show differences between local .env and provider',
    options: [{ flags: '-p, --path <path>', description: 'Check specific path only' }],
    examples: ['envi diff', 'envi diff --path engine/api'],
  },
).action(async (options) => {
  await applyGlobalOptions(program.opts())
  await diffCommand({
    path: options.path,
  })
})

configureCommandHelp(
  program
    .command('sync')
    .description('Sync .env files from templates')
    .option('-f, --force', 'Skip confirmation prompts')
    .option('-d, --dry-run', 'Preview changes without writing files')
    .option('--no-backup', 'Skip automatic backup before syncing'),
  {
    name: 'sync',
    description: 'Sync .env files from templates',
    options: [
      { flags: '-f, --force', description: 'Skip confirmation prompts' },
      { flags: '-d, --dry-run', description: 'Preview changes without writing files' },
      { flags: '--no-backup', description: 'Skip automatic backup before syncing' },
    ],
    examples: ['envi sync', 'envi sync -d', 'envi sync -f', 'envi sync --no-backup', 'envi sync --only engine/api'],
  },
).action(async (options) => {
  await applyGlobalOptions(program.opts())
  await syncCommand({
    force: options.force ?? false,
    dryRun: options.dryRun ?? false,
    noBackup: options.backup === false,
  })
})

configureCommandHelp(
  program
    .command('backup')
    .description('Backup current .env files (creates timestamped snapshot)')
    .option('-f, --force', 'Skip confirmation prompts')
    .option('-d, --dry-run', 'Preview changes without writing files')
    .option('-l, --list', 'List available backup snapshots'),
  {
    name: 'backup',
    description: 'Backup current .env files (creates timestamped snapshot)',
    options: [
      { flags: '-f, --force', description: 'Skip confirmation prompts' },
      { flags: '-d, --dry-run', description: 'Preview changes without writing files' },
      { flags: '-l, --list', description: 'List available backup snapshots' },
    ],
    examples: ['envi backup', 'envi backup -d', 'envi backup -f', 'envi backup --list'],
  },
).action(async (options) => {
  await applyGlobalOptions(program.opts())
  await backupCommand({
    force: options.force ?? false,
    dryRun: options.dryRun ?? false,
    list: options.list ?? false,
  })
})

configureCommandHelp(
  program
    .command('restore')
    .description('Restore .env files from backup')
    .option('-f, --force', 'Skip confirmation prompts (uses most recent backup)')
    .option('-d, --dry-run', 'Preview changes without writing files')
    .option('-l, --list', 'List available backup snapshots'),
  {
    name: 'restore',
    description: 'Restore .env files from backup',
    options: [
      { flags: '-f, --force', description: 'Skip confirmation prompts (uses most recent backup)' },
      { flags: '-d, --dry-run', description: 'Preview changes without writing files' },
      { flags: '-l, --list', description: 'List available backup snapshots' },
    ],
    examples: ['envi restore', 'envi restore --list', 'envi restore -f', 'envi restore -d'],
  },
).action(async (options) => {
  await applyGlobalOptions(program.opts())
  await restoreCommand({
    force: options.force ?? false,
    dryRun: options.dryRun ?? false,
    list: options.list ?? false,
  })
})

// The run command uses allowUnknownOption + passThroughOptions so everything after `--` is captured
const runCmd = program
  .command('run')
  .description('Run a command with secrets injected as environment variables')
  .option('--env-file <files...>', 'Load additional .env files (may contain secret refs)')
  .option('--no-template', 'Skip loading templates')
  .allowUnknownOption(true)
  .allowExcessArguments(true)

configureCommandHelp(runCmd, {
  name: 'run',
  description: 'Run a command with secrets injected as environment variables',
  options: [
    { flags: '--env-file <files...>', description: 'Load additional .env files (may contain secret refs)' },
    { flags: '--no-template', description: 'Skip loading templates, use --env-file only' },
  ],
  examples: [
    'envi run -- node index.js',
    'envi run -- npm start',
    'envi run --env-file .env.local -- node index.js',
    'envi run --no-template --env-file .env.secrets -- ./deploy.sh',
    'envi run -e prod -- node server.js',
  ],
}).action(async (options, cmd) => {
  await applyGlobalOptions(program.opts())
  // Everything after `--` ends up in cmd.args
  const childCommand = cmd.args
  await runCommand(childCommand, {
    envFile: options.envFile,
    noTemplate: options.template === false,
  })
})

configureCommandHelp(
  program
    .command('validate')
    .description('Validate all secret references in templates')
    .option('-r, --remote', 'Check references against provider (slower, requires auth)'),
  {
    name: 'validate',
    description: 'Validate all secret references in templates',
    options: [{ flags: '-r, --remote', description: 'Check references against provider (slower, requires auth)' }],
    examples: ['envi validate', 'envi validate --remote', 'envi validate --only engine/api'],
  },
).action(async (options) => {
  await applyGlobalOptions(program.opts())
  await validateCommand({ remote: options.remote ?? false })
})

// Show custom help when no command is provided or when -h/--help is passed to main program
const arg = process.argv[2]
if (process.argv.length === 2 || (process.argv.length === 3 && arg !== undefined && ['-h', '--help'].includes(arg))) {
  showHelp()
  process.exit(0)
}

program.parse()
