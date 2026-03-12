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
import { resolveRuntimeOptions, stringifyEnvelope } from '../sdk'
import { normalizeReferenceVars } from '../shared/env/variables'
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

interface HelpOption {
  flags: string
  description: string
}

interface CommandHelp {
  name: string
  description: string
  usage: string
  options?: HelpOption[]
  examples?: string[]
}

interface HelpJsonPayload {
  name: string
  version: string
  description: string
  usage: string
  options: HelpOption[]
  examples: string[]
  commands?: Array<Pick<CommandHelp, 'name' | 'description' | 'usage'>>
  command?: CommandHelp
}

const GLOBAL_HELP_OPTIONS: HelpOption[] = [
  { flags: '-q, --quiet', description: 'Suppress non-essential output' },
  { flags: '--json', description: 'Output machine-readable JSON' },
  {
    flags: '--var <NAME=value>',
    description: 'Dynamic reference variable (repeatable)',
  },
  { flags: '--config <path>', description: 'Load config from JSON file' },
  { flags: '--only <paths>', description: 'Only process specified paths (comma-separated)' },
  { flags: '--output <file>', description: `Output file name (default: ${DEFAULT_OUTPUT_FILE})` },
  { flags: '--template-file <file>', description: `Template file name (default: ${DEFAULT_TEMPLATE_FILE})` },
  { flags: '--backup-dir <dir>', description: `Backup directory (default: ${DEFAULT_BACKUP_DIR})` },
  { flags: '--no-color', description: 'Disable ANSI colors' },
  { flags: '-v, --version', description: 'Show version' },
  { flags: '-h, --help', description: 'Show this help' },
]

const COMMAND_HELP: Record<string, CommandHelp> = {
  status: {
    name: 'status',
    description: 'Show .env status and auth',
    usage: 'envi status [options]',
    examples: ['envi status', 'envi status --only apps/api'],
  },
  diff: {
    name: 'diff',
    description: 'Show differences between local and provider',
    usage: 'envi diff [options]',
    options: [{ flags: '-p, --path <path>', description: 'Check specific path only' }],
    examples: ['envi diff', 'envi diff --path apps/api'],
  },
  sync: {
    name: 'sync',
    description: 'Sync .env files from templates',
    usage: 'envi sync [options]',
    options: [
      { flags: '-d, --dry-run', description: 'Preview changes without writing files' },
      { flags: '--no-backup', description: 'Skip automatic backup before syncing' },
    ],
    examples: ['envi sync', 'envi sync -d', 'envi sync --no-backup', 'envi sync --only apps/api'],
  },
  resolve: {
    name: 'resolve',
    description: 'Resolve one or more secret references to their values',
    usage: 'envi resolve <reference...> [options]',
    examples: [
      'envi resolve --var PROFILE=prod op://core-${PROFILE}/engine-api/SECRET',
      'envi resolve op://vault/app/API_KEY op://vault/app/JWT_SECRET',
    ],
  },
  backup: {
    name: 'backup',
    description: 'Backup current environment files (creates timestamped snapshot)',
    usage: 'envi backup [options]',
    options: [
      { flags: '-d, --dry-run', description: 'Preview changes without writing files' },
      { flags: '-l, --list', description: 'List available backup snapshots' },
    ],
    examples: ['envi backup', 'envi backup -d', 'envi backup --list'],
  },
  restore: {
    name: 'restore',
    description: 'Restore environment files from backup',
    usage: 'envi restore [options]',
    options: [
      { flags: '-d, --dry-run', description: 'Preview changes without writing files' },
      { flags: '-l, --list', description: 'List available backup snapshots' },
      { flags: '--snapshot <id>', description: 'Restore a specific snapshot id instead of latest' },
    ],
    examples: [
      'envi restore',
      'envi restore --list',
      'envi restore --snapshot 2026-03-07T15-39-54-840Z',
      'envi restore -d',
    ],
  },
  run: {
    name: 'run',
    description: 'Run a command with secrets injected as environment variables',
    usage: 'envi run [options] -- <command> [args...]',
    options: [
      { flags: '--env-file <files...>', description: 'Load additional .env files (may contain secret refs)' },
      { flags: '--no-template', description: 'Skip loading templates' },
    ],
    examples: [
      'envi run -- node index.js',
      'envi run -- npm start',
      'envi run --env-file .env.local -- node index.js',
      'envi run --no-template --env-file .env.secrets -- ./deploy.sh',
      'envi run --var PROFILE=prod -- node server.js',
    ],
  },
  validate: {
    name: 'validate',
    description: 'Validate all secret references in templates',
    usage: 'envi validate [options]',
    options: [{ flags: '-l, --local', description: 'Validate format locally only (skip provider checks)' }],
    examples: ['envi validate', 'envi validate --local', 'envi validate --only apps/api'],
  },
}

const ROOT_HELP_EXAMPLES = [
  'envi help',
  'envi status',
  'envi diff',
  'envi sync -d                    # dry run',
  'envi sync --only apps/api     # single path',
  'envi resolve op://vault/item/field',
  'envi resolve --var PROFILE=prod op://core-${PROFILE}/engine-api/SECRET',
  'envi backup',
  'envi restore --list',
]

function getCommandNames(): string[] {
  return ['help', ...Object.keys(COMMAND_HELP)]
}

function buildRootHelpJson(): HelpJsonPayload {
  return {
    name: 'envi',
    version: VERSION,
    description: 'Manage .env files with 1Password',
    usage: 'envi <command> [options]',
    options: GLOBAL_HELP_OPTIONS,
    examples: ROOT_HELP_EXAMPLES,
    commands: getCommandNames().map((name) => {
      if (name === 'help') {
        return {
          name: 'help',
          description: 'Show root or subcommand help',
          usage: 'envi help [command] [options]',
        }
      }
      const command = COMMAND_HELP[name]!
      return {
        name: command.name,
        description: command.description,
        usage: command.usage,
      }
    }),
  }
}

function buildCommandHelpJson(commandName: string): HelpJsonPayload | null {
  const command = COMMAND_HELP[commandName]
  if (!command) return null

  return {
    name: 'envi',
    version: VERSION,
    description: command.description,
    usage: command.usage,
    options: [...(command.options ?? []), ...GLOBAL_HELP_OPTIONS],
    examples: command.examples ?? [],
    command,
  }
}

function writeHelpJson(commandName?: string): void {
  const payload = commandName ? buildCommandHelpJson(commandName) : buildRootHelpJson()
  if (!payload) {
    throw new Error(`unknown command ${commandName}`)
  }
  process.stdout.write(stringifyEnvelope(payload))
}

function printOptionTable(options: HelpOption[]): void {
  const width = Math.max(...options.map((option) => option.flags.length))
  for (const option of options) {
    console.info(`  ${pc.green(option.flags.padEnd(width))}  ${option.description}`)
  }
}

function showHelp(commandName?: string): void {
  if (commandName) {
    const command = COMMAND_HELP[commandName]
    if (!command) {
      showHelp()
      return
    }

    console.info('')
    console.info(pc.bold(pc.cyan('envi')) + ' ' + pc.yellow(command.name) + pc.dim(`  v${VERSION}`))
    console.info(pc.dim(command.description))
    console.info('')
    console.info(pc.bold('USAGE'))
    console.info(`  ${pc.cyan(command.usage)}`)
    console.info('')

    const options = [...(command.options ?? []), ...GLOBAL_HELP_OPTIONS]
    console.info(pc.bold('OPTIONS'))
    printOptionTable(options)

    if (command.examples && command.examples.length > 0) {
      console.info('')
      console.info(pc.bold('EXAMPLES'))
      for (const example of command.examples) {
        console.info(`  ${pc.dim('$')} ${example}`)
      }
    }

    console.info('')
    return
  }

  console.info('')
  console.info(pc.bold(pc.cyan('envi')) + pc.dim(` v${VERSION}`) + ' - Manage .env files with 1Password')
  console.info('')
  console.info(pc.bold('USAGE'))
  console.info(`  ${pc.cyan('envi')} ${pc.yellow('<command>')} ${pc.dim('[options]')}`)
  console.info('')
  console.info(pc.bold('COMMANDS'))
  console.info(`  ${pc.yellow('help')}                Show root or subcommand help`)
  console.info(`  ${pc.yellow('status')}              Show .env status and auth`)
  console.info(`  ${pc.yellow('diff')}                Show differences between local and provider`)
  console.info(`  ${pc.yellow('sync')}                Sync .env files from templates`)
  console.info(`  ${pc.yellow('resolve')}             Resolve one or more secret references`)
  console.info(`  ${pc.yellow('backup')}              Backup current environment files (timestamped)`)
  console.info(`  ${pc.yellow('restore')}             Restore environment files from backup`)
  console.info(`  ${pc.yellow('run')}                 Run a command with secrets as env vars`)
  console.info(`  ${pc.yellow('validate')}            Validate all secret references in templates`)
  console.info(`  ${pc.yellow('mcp')}                 Start MCP server (stdio transport)`)
  console.info('')
  console.info(pc.bold('GLOBAL OPTIONS'))
  printOptionTable(GLOBAL_HELP_OPTIONS)
  console.info('')
  console.info(pc.bold('EXAMPLES'))
  for (const example of ROOT_HELP_EXAMPLES) {
    const [command, comment] = example.split('#')
    const suffix = comment ? ` ${pc.dim(`#${comment}`)}` : ''
    console.info(`  ${pc.dim('$')} ${command?.trimEnd()}${suffix}`)
  }
  console.info('')
}

interface GlobalOptions {
  quiet?: boolean
  json?: boolean
  color?: boolean
  var?: string | string[]
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

function parseVars(opts: string | string[] | undefined): Record<string, string> {
  const values = Array.isArray(opts) ? opts : opts ? [opts] : []
  const entries = values.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  if (entries.length === 0) return {}

  const result: Record<string, string> = {}
  for (const entry of entries) {
    const eq = entry.indexOf('=')
    if (eq === -1) {
      throw new Error(`Invalid --var format: "${entry}" (expected NAME=value)`)
    }

    const key = entry.slice(0, eq).trim()
    const value = entry.slice(eq + 1).trim()
    if (!key) {
      throw new Error(`Invalid --var format: "${entry}" (expected NAME=value)`)
    }

    result[key] = value
  }

  return normalizeReferenceVars(result)
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

  const configFile: Record<string, unknown> = {}
  if (fileConfig.vars !== undefined) configFile['vars'] = fileConfig.vars
  if (fileConfig.provider !== undefined) configFile['provider'] = fileConfig.provider
  if (fileConfig.paths !== undefined) configFile['paths'] = fileConfig.paths
  if (fileConfig.outputFile !== undefined) configFile['outputFile'] = fileConfig.outputFile
  if (fileConfig.templateFile !== undefined) configFile['templateFile'] = fileConfig.templateFile
  if (fileConfig.backupDir !== undefined) configFile['backupDir'] = fileConfig.backupDir
  if (fileConfig.quiet !== undefined) configFile['quiet'] = fileConfig.quiet
  if (fileConfig.json !== undefined) configFile['json'] = fileConfig.json

  const overrides: Record<string, unknown> = {}
  if (options.var !== undefined) overrides['vars'] = parseVars(options.var)
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
    vars: resolved.vars,
    provider: resolved.provider,
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

function isHelpFlag(arg: string | undefined): boolean {
  return arg === '-h' || arg === '--help'
}

function isVersionFlag(arg: string | undefined): boolean {
  return arg === '-v' || arg === '--version'
}

function isJsonFlag(arg: string | undefined): boolean {
  return arg === '--json'
}

function findHelpCommandName(args: string[]): string | undefined {
  const helpIndex = args.indexOf('help')
  if (helpIndex === -1) return undefined

  for (let index = helpIndex + 1; index < args.length; index++) {
    const arg = args[index]
    if (!arg || arg.startsWith('-')) continue
    return arg
  }

  return undefined
}

function findCommandName(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg) continue
    if (isHelpFlag(arg) || isVersionFlag(arg)) continue
    if (arg === '--') break
    if (arg.startsWith('-')) {
      const takesValue =
        arg === '--config' ||
        arg === '--var' ||
        arg === '--only' ||
        arg === '--output' ||
        arg === '--template-file' ||
        arg === '--backup-dir' ||
        arg === '--snapshot'
      const takesShortValue = false
      if (takesValue || takesShortValue) {
        index++
      }
      continue
    }
    if (arg === 'help') {
      return args[index + 1]
    }
    return arg
  }
  return undefined
}

const rawArgs = rewriteTemplateFlag(process.argv.slice(2))
if (rawArgs.filter((arg) => !arg.startsWith('-')).length === 0 && rawArgs.some((arg) => isVersionFlag(arg))) {
  console.info(VERSION)
  process.exit(0)
}

if (rawArgs[0] === 'mcp') {
  const { mcpCommand } = await import('./commands/mcp')
  await mcpCommand()
  // Server stays alive via stdio transport — do not exit
  await new Promise(() => {})
}

if (rawArgs[0] === 'help') {
  const commandName = findHelpCommandName(rawArgs)
  if (rawArgs.some((arg) => isJsonFlag(arg))) {
    writeHelpJson(commandName)
  } else {
    showHelp(commandName)
  }
  process.exit(0)
}

if (rawArgs.length === 0 || rawArgs.some((arg) => isHelpFlag(arg))) {
  const commandName = findCommandName(rawArgs)
  if (rawArgs.some((arg) => isJsonFlag(arg))) {
    writeHelpJson(commandName)
  } else {
    showHelp(commandName)
  }
  process.exit(0)
}

const cli = cac('envi')

cli.help()

cli.option('-q, --quiet', 'Suppress non-essential output')
cli.option('--json', 'Output machine-readable JSON')
cli.option('--no-color', 'Disable ANSI colors')
cli.option('--var <NAME=value>', 'Dynamic reference variable (repeatable)')
cli.option('--config <path>', 'Load config from JSON file')
cli.option('--only <paths>', 'Only process specified paths (comma-separated)')
cli.option('--output <file>', `Output file name (default: ${DEFAULT_OUTPUT_FILE})`)
cli.option('--template-file <file>', `Template file name (default: ${DEFAULT_TEMPLATE_FILE})`)
cli.option('--backup-dir <dir>', `Backup directory (default: ${DEFAULT_BACKUP_DIR})`)

addExamples(cli.command('status', 'Show .env status and auth'), ['envi status', 'envi status --only apps/api']).action(
  async (options) => {
    await withGlobalOptions(options as GlobalOptions, () => statusCommand())
  },
)

addExamples(
  cli
    .command('diff', 'Show differences between local .env and provider')
    .option('-p, --path <path>', 'Check specific path only'),
  ['envi diff', 'envi diff --path apps/api'],
).action(async (options: { path?: string } & GlobalOptions) => {
  await withGlobalOptions(options, () => diffCommand(options.path ? { path: options.path } : {}))
})

addExamples(
  cli
    .command('sync', 'Sync .env files from templates')
    .option('-d, --dry-run', 'Preview changes without writing files')
    .option('--no-backup', 'Skip automatic backup before syncing'),
  ['envi sync', 'envi sync -d', 'envi sync --no-backup', 'envi sync --only apps/api'],
).action(async (options: { dryRun?: boolean; backup?: boolean } & GlobalOptions) => {
  await withGlobalOptions(options, () =>
    syncCommand({
      dryRun: options.dryRun ?? false,
      noBackup: options.backup === false,
    }),
  )
})

addExamples(cli.command('resolve [...references]', 'Resolve one or more secret references to their values'), [
  'envi resolve --var PROFILE=prod op://core-${PROFILE}/engine-api/SECRET',
  'envi resolve op://vault/app/API_KEY op://vault/app/JWT_SECRET',
]).action(async (references: string[] | string, options: GlobalOptions) => {
  const parsedReferences = Array.isArray(references) ? references : typeof references === 'string' ? [references] : []
  await withGlobalOptions(options, () => resolveCommand({ references: parsedReferences }))
})

addExamples(
  cli
    .command('backup', 'Backup current environment files (creates timestamped snapshot)')
    .option('-d, --dry-run', 'Preview changes without writing files')
    .option('-l, --list', 'List available backup snapshots'),
  ['envi backup', 'envi backup -d', 'envi backup --list'],
).action(async (options: { dryRun?: boolean; list?: boolean } & GlobalOptions) => {
  await withGlobalOptions(options, () =>
    backupCommand({
      dryRun: options.dryRun ?? false,
      list: options.list ?? false,
    }),
  )
})

addExamples(
  cli
    .command('restore', 'Restore environment files from backup')
    .option('-d, --dry-run', 'Preview changes without writing files')
    .option('--snapshot <id>', 'Restore a specific snapshot id instead of latest')
    .option('-l, --list', 'List available backup snapshots'),
  ['envi restore', 'envi restore --list', 'envi restore --snapshot 2026-03-07T15-39-54-840Z', 'envi restore -d'],
).action(async (options: { dryRun?: boolean; list?: boolean; snapshot?: string } & GlobalOptions) => {
  await withGlobalOptions(options, () =>
    restoreCommand({
      dryRun: options.dryRun ?? false,
      list: options.list ?? false,
      ...(options.snapshot ? { snapshot: options.snapshot } : {}),
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
    'envi run --var PROFILE=prod -- node server.js',
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
    .option('-l, --local', 'Validate format locally only (skip provider checks)'),
  ['envi validate', 'envi validate --local', 'envi validate --only apps/api'],
).action(async (options: { local?: boolean } & GlobalOptions) => {
  await withGlobalOptions(options, () => validateCommand({ local: options.local ?? false }))
})

try {
  const parsed = cli.parse([process.argv[0]!, process.argv[1]!, ...rawArgs], { run: false })
  if (!cli.matchedCommand && parsed.args[0]) {
    throw new Error(`unknown command ${parsed.args[0]}`)
  }
  await cli.runMatchedCommand()
  process.exit(process.exitCode ?? 0)
} catch (error) {
  console.error(toErrorMessage(error))
  process.exit(1)
}
