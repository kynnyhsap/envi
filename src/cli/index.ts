#!/usr/bin/env bun

import { cac } from 'cac'
import pc from 'picocolors'

import {
  VERSION,
  DEFAULT_BACKUP_DIR,
  DEFAULT_OUTPUT_FILE,
  DEFAULT_TEMPLATE_FILE,
  setRuntimeConfig,
  parseOnlyFlag,
  loadConfigFile,
  type ConfigFile,
} from '../app/config'
import { resolveRuntimeOptions } from '../sdk'
import { DEFAULT_ENVIRONMENT } from '../shared/env/variables'
import {
  statusCommand,
  diffCommand,
  syncCommand,
  runCommand,
  resolveCommand,
  backupCommand,
  restoreCommand,
  validateCommand,
} from './commands'

function showHelp(): void {
  console.info('')
  console.info(pc.bold(pc.cyan('envi')) + pc.dim(` v${VERSION}`) + ' - Manage .env files with 1Password')
  console.info('')
  console.info(pc.bold('USAGE'))
  console.info(`  ${pc.cyan('envi')} ${pc.yellow('<command>')} ${pc.dim('[options]')}`)
  console.info('')
  console.info(pc.bold('COMMANDS'))
  console.info(`  ${pc.yellow('status')}              Show .env status and auth`)
  console.info(`  ${pc.yellow('diff')}                Show differences between local and provider`)
  console.info(`  ${pc.yellow('sync')}                Sync .env files from templates`)
  console.info(`  ${pc.yellow('resolve')}             Resolve one secret reference`)
  console.info(`  ${pc.yellow('backup')}              Backup current .env files (timestamped)`)
  console.info(`  ${pc.yellow('restore')}             Restore .env files from backup`)
  console.info(`  ${pc.yellow('run')}                 Run a command with secrets as env vars`)
  console.info(`  ${pc.yellow('validate')}            Validate all secret references in templates`)
  console.info('')
  console.info(pc.bold('GLOBAL OPTIONS'))
  console.info(`  ${pc.green('-q, --quiet')}         Suppress non-essential output`)
  console.info(`  ${pc.green('--json')}              Output machine-readable JSON`)
  console.info(
    `  ${pc.green('-e, --env')} ${pc.dim('<name>')}    Environment name for ${'${ENV}'} substitution ${pc.dim(`(default: ${DEFAULT_ENVIRONMENT})`)}`,
  )
  console.info(`  ${pc.green('--provider-opt')} ${pc.dim('<k=v>')} Provider-specific option (repeatable)`)
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
  console.info(`  ${pc.dim('$')} envi resolve op://vault/item/field`)
  console.info(`  ${pc.dim('$')} envi backup`)
  console.info(`  ${pc.dim('$')} envi restore --list`)
  console.info('')
}

interface GlobalOptions {
  quiet?: boolean
  json?: boolean
  env?: string
  providerOpt?: string | string[]
  config?: string
  only?: string
  output?: string
  templateFile?: string
  backupDir?: string
}

interface RunActionOptions extends GlobalOptions {
  envFile?: string | string[]
  template?: boolean
  '--'?: string[]
}

function rewriteTemplateFlag(args: string[]): string[] {
  return args.map((arg) => {
    if (arg === '--template') return '--template-file'
    if (arg.startsWith('--template=')) return `--template-file=${arg.slice('--template='.length)}`
    return arg
  })
}

function parseProviderOpts(opts: string | string[] | undefined): Record<string, string> {
  const values = Array.isArray(opts) ? opts : opts ? [opts] : []
  const entries = values.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  if (entries.length === 0) return {}

  const result: Record<string, string> = {}
  for (const entry of entries) {
    const eq = entry.indexOf('=')
    if (eq === -1) {
      throw new Error(`Invalid --provider-opt format: "${entry}" (expected key=value)`)
    }
    result[entry.slice(0, eq)] = entry.slice(eq + 1)
  }
  return result
}

async function applyGlobalOptions(options: GlobalOptions): Promise<void> {
  let fileConfig: ConfigFile = {}
  const configPath = options.config ?? 'envi.json'

  try {
    fileConfig = await loadConfigFile(configPath)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const isDefaultMissing = options.config === undefined && msg.startsWith('Config file not found:')
    if (!isDefaultMissing) {
      throw error
    }
  }

  const cliProviderOpts = parseProviderOpts(options.providerOpt)

  const configFile: Record<string, unknown> = {}
  if (fileConfig.environment !== undefined) configFile['environment'] = fileConfig.environment
  if (fileConfig.provider !== undefined) configFile['provider'] = fileConfig.provider
  if (fileConfig.providerOptions !== undefined) configFile['providerOptions'] = fileConfig.providerOptions
  if (fileConfig.paths !== undefined) configFile['paths'] = fileConfig.paths
  if (fileConfig.outputFile !== undefined) configFile['outputFile'] = fileConfig.outputFile
  if (fileConfig.templateFile !== undefined) configFile['templateFile'] = fileConfig.templateFile
  if (fileConfig.backupDir !== undefined) configFile['backupDir'] = fileConfig.backupDir
  if (fileConfig.quiet !== undefined) configFile['quiet'] = fileConfig.quiet
  if (fileConfig.json !== undefined) configFile['json'] = fileConfig.json

  const overrides: Record<string, unknown> = {}
  if (options.env !== undefined) overrides['environment'] = options.env
  if (options.providerOpt !== undefined && options.providerOpt.length > 0) {
    overrides['providerOptions'] = cliProviderOpts
  }
  const onlyPaths = parseOnlyFlag(options.only)
  if (onlyPaths !== undefined) overrides['paths'] = onlyPaths
  if (options.output !== undefined) overrides['outputFile'] = options.output
  if (options.templateFile !== undefined) overrides['templateFile'] = options.templateFile
  if (options.backupDir !== undefined) overrides['backupDir'] = options.backupDir
  if (options.quiet !== undefined) overrides['quiet'] = options.quiet
  if (options.json !== undefined) overrides['json'] = options.json

  const resolved = resolveRuntimeOptions({
    configFile: configFile as any,
    overrides: overrides as any,
  })

  const quiet = resolved.quiet || resolved.json

  setRuntimeConfig({
    paths: resolved.paths,
    outputFile: resolved.outputFile,
    templateFile: resolved.templateFile,
    backupDir: resolved.backupDir,
    quiet,
    json: resolved.json,
    environment: resolved.environment,
    provider: resolved.provider,
    providerOptions: resolved.providerOptions,
  })
}

function addExamples(command: ReturnType<typeof cli.command>, examples: string[]): ReturnType<typeof cli.command> {
  for (const example of examples) {
    command.example(example)
  }
  return command
}

async function withGlobalOptions(options: GlobalOptions, run: () => Promise<void>): Promise<void> {
  await applyGlobalOptions(options)
  await run()
}

function toErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('Unknown command')) {
    return message.replace('Unknown command', 'unknown command')
  }
  return message
}

const rawArgs = process.argv.slice(2)
if (rawArgs.length === 1 && ['-v', '--version'].includes(rawArgs[0]!)) {
  console.info(VERSION)
  process.exit(0)
}

if (rawArgs.length === 0 || (rawArgs.length === 1 && ['-h', '--help'].includes(rawArgs[0]!))) {
  showHelp()
  process.exit(0)
}

const cli = cac('envi')

cli.help()

cli.option('-q, --quiet', 'Suppress non-essential output')
cli.option('--json', 'Output machine-readable JSON')
cli.option('-e, --env <name>', 'Environment name for ${ENV} substitution')
cli.option('--provider-opt <key=value>', 'Provider-specific option (repeatable)')
cli.option('--config <path>', 'Load config from JSON file')
cli.option('--only <paths>', 'Only process specified paths (comma-separated)')
cli.option('--output <file>', `Output file name (default: ${DEFAULT_OUTPUT_FILE})`)
cli.option('--template-file <file>', `Template file name (default: ${DEFAULT_TEMPLATE_FILE})`)
cli.option('--backup-dir <dir>', `Backup directory (default: ${DEFAULT_BACKUP_DIR})`)

addExamples(cli.command('status', 'Show .env status and auth'), [
  'envi status',
  'envi status --only engine/api',
]).action(async (options) => {
  await withGlobalOptions(options as GlobalOptions, () => statusCommand())
})

addExamples(
  cli
    .command('diff', 'Show differences between local .env and provider')
    .option('-p, --path <path>', 'Check specific path only'),
  ['envi diff', 'envi diff --path engine/api'],
).action(async (options: { path?: string } & GlobalOptions) => {
  await withGlobalOptions(options, () => diffCommand(options.path ? { path: options.path } : {}))
})

addExamples(
  cli
    .command('sync', 'Sync .env files from templates')
    .option('-f, --force', 'Skip confirmation prompts')
    .option('-d, --dry-run', 'Preview changes without writing files')
    .option('--no-backup', 'Skip automatic backup before syncing'),
  ['envi sync', 'envi sync -d', 'envi sync -f', 'envi sync --no-backup', 'envi sync --only engine/api'],
).action(async (options: { force?: boolean; dryRun?: boolean; backup?: boolean } & GlobalOptions) => {
  await withGlobalOptions(options, () =>
    syncCommand({
      force: options.force ?? false,
      dryRun: options.dryRun ?? false,
      noBackup: options.backup === false,
    }),
  )
})

addExamples(cli.command('resolve <reference>', 'Resolve one secret reference to its value'), [
  'envi resolve op://core-${ENV}/engine-api/SECRET',
]).action(async (reference: string, options: GlobalOptions) => {
  await withGlobalOptions(options, () => resolveCommand({ reference }))
})

addExamples(
  cli
    .command('backup', 'Backup current .env files (creates timestamped snapshot)')
    .option('-f, --force', 'Skip confirmation prompts')
    .option('-d, --dry-run', 'Preview changes without writing files')
    .option('-l, --list', 'List available backup snapshots'),
  ['envi backup', 'envi backup -d', 'envi backup -f', 'envi backup --list'],
).action(async (options: { force?: boolean; dryRun?: boolean; list?: boolean } & GlobalOptions) => {
  await withGlobalOptions(options, () =>
    backupCommand({
      force: options.force ?? false,
      dryRun: options.dryRun ?? false,
      list: options.list ?? false,
    }),
  )
})

addExamples(
  cli
    .command('restore', 'Restore .env files from backup')
    .option('-f, --force', 'Skip confirmation prompts (uses most recent backup)')
    .option('-d, --dry-run', 'Preview changes without writing files')
    .option('-l, --list', 'List available backup snapshots'),
  ['envi restore', 'envi restore --list', 'envi restore -f', 'envi restore -d'],
).action(async (options: { force?: boolean; dryRun?: boolean; list?: boolean } & GlobalOptions) => {
  await withGlobalOptions(options, () =>
    restoreCommand({
      force: options.force ?? false,
      dryRun: options.dryRun ?? false,
      list: options.list ?? false,
    }),
  )
})

addExamples(
  cli
    .command('run [...command]', 'Run a command with secrets injected as environment variables')
    .option('--env-file <files...>', 'Load additional .env files (may contain secret refs)')
    .option('--no-template', 'Skip loading templates')
    .allowUnknownOptions(),
  [
    'envi run -- node index.js',
    'envi run -- npm start',
    'envi run --env-file .env.local -- node index.js',
    'envi run --no-template --env-file .env.secrets -- ./deploy.sh',
    'envi run -e prod -- node server.js',
  ],
).action(async (command: string[] | string, options: RunActionOptions) => {
  const parsedOptions: RunActionOptions =
    options ?? ((typeof command === 'object' && !Array.isArray(command) ? command : {}) as RunActionOptions)
  const envFiles = Array.isArray(parsedOptions.envFile)
    ? parsedOptions.envFile
    : parsedOptions.envFile
      ? [parsedOptions.envFile]
      : undefined
  const childCommand =
    Array.isArray(command) && command.length > 0
      ? command
      : typeof command === 'string'
        ? [command]
        : Array.isArray(parsedOptions['--'])
          ? parsedOptions['--']
          : []
  await withGlobalOptions(parsedOptions, () =>
    runCommand(childCommand, {
      ...(envFiles ? { envFile: envFiles } : {}),
      noTemplate: parsedOptions.template === false,
    }),
  )
})

addExamples(
  cli
    .command('validate', 'Validate all secret references in templates')
    .option('-r, --remote', 'Check references against provider (slower, requires auth)'),
  ['envi validate', 'envi validate --remote', 'envi validate --only engine/api'],
).action(async (options: { remote?: boolean } & GlobalOptions) => {
  await withGlobalOptions(options, () => validateCommand({ remote: options.remote ?? false }))
})

try {
  const parsed = cli.parse([process.argv[0]!, process.argv[1]!, ...rewriteTemplateFlag(rawArgs)], { run: false })
  if (!cli.matchedCommand && parsed.args[0]) {
    throw new Error(`unknown command ${parsed.args[0]}`)
  }
  await cli.runMatchedCommand()
} catch (error) {
  console.error(toErrorMessage(error))
  process.exit(1)
}
