import type { Client } from '@1password/sdk'
import { beforeAll, afterAll, describe, expect, test } from 'bun:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { cp, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { replaceManagedItems } from '../../examples/common'
import {
  E2E_VAULT_ITEMS,
  createOnePasswordE2EClient,
  getSeedFieldValue,
  grantUserViewAccess,
  loadOnePasswordE2EConfig,
  populateVaultWithEnvItems,
} from '../testing/onepassword-e2e'

const CLI_PATH = path.join(import.meta.dir, '..', 'cli.ts')
const WORKSPACE_PREFIX = path.join(import.meta.dir, '.test-workspace-1password-live-')
const PRIMARY_LIVE_VAULT_TITLE = 'envi-e2e-live-shared'
const EXAMPLE_LIVE_VAULT_TITLE = 'envi-e2e-live-example-shared'
const SLOW_COMMAND_THRESHOLD_MS = 2500
const RATE_LIMIT_RETRIES = 10
const RATE_LIMIT_BACKOFF_MS = 1000
const RATE_LIMIT_MAX_BACKOFF_MS = 15000

interface CommandBenchmark {
  testName: string
  command: string
  args: string[]
  elapsedMs: number
  exitCode: number
}

interface TestBenchmark {
  testName: string
  elapsedMs: number
}

const e2eConfig = await loadOnePasswordE2EConfig()

if (!e2eConfig) {
  throw new Error('Missing ENVI_1PASSWORD_E2E_SERVICE_ACCOUNT_TOKEN in .env.test, .env.local, or process.env')
}

let client: Client
let vault: { id: string; title: string } | null = null
let exampleVault: { id: string; title: string } | null = null
const suiteStartedAt = Date.now()
const commandBenchmarks: CommandBenchmark[] = []
const testBenchmarks: TestBenchmark[] = []
const testContext = new AsyncLocalStorage<string>()

describe('live 1Password CLI e2e', () => {
  beforeAll(async () => {
    client = await createOnePasswordE2EClient(e2eConfig.token)
    const createdVault = await ensureManagedVault({
      title: PRIMARY_LIVE_VAULT_TITLE,
      description: 'Shared Envi live E2E test vault',
    })
    const createdExampleVault = await ensureManagedVault({
      title: EXAMPLE_LIVE_VAULT_TITLE,
      description: 'Shared Envi live E2E example test vault',
    })
    vault = createdVault
    exampleVault = createdExampleVault

    await withRateLimitRetry('grant user access to primary vault', () =>
      grantUserViewAccess({
        token: e2eConfig.token,
        vaultId: createdVault.id,
        userEmail: e2eConfig.userEmail,
      }),
    )
    await withRateLimitRetry('grant user access to example vault', () =>
      grantUserViewAccess({
        token: e2eConfig.token,
        vaultId: createdExampleVault.id,
        userEmail: e2eConfig.userEmail,
      }),
    )
    await replacePrimaryManagedItems(createdVault.id)
    await withRateLimitRetry('populate example vault items', () => replaceManagedItems(client, createdExampleVault.id))
  })

  afterAll(async () => {
    printBenchmarkSummary()
  })

  liveTest('status reports provider auth and missing env files before sync', async () => {
    await withWorkspace(async (workspaceDir) => {
      const plain = await runCli(workspaceDir, ['status'])
      expect(plain.stdout).toContain('Environment Status')
      expect(plain.stdout).toContain('1Password')
      expect(plain.stdout).toContain('Authenticated')
      expect(plain.stdout).toContain('Configured Paths')
      expect(plain.stdout).toContain('Summary')
      expect(plain.stdout).toContain('3 missing')

      const status = await runCliJson(workspaceDir, ['--json', 'status'])
      expect(status.command).toBe('status')
      expect(status.ok).toBe(true)
      expect(status.data.provider.name).toBe('1Password')
      expect(status.data.provider.auth.success).toBe(true)
      expect(status.data.summary.missing).toBe(3)
      expect(status.data.backups.count).toBe(0)
    })
  })

  liveTest('validate defaults to provider checks and supports local mode', async () => {
    await withWorkspace(async (workspaceDir) => {
      const remoteValidate = await runCliJson(workspaceDir, ['--json', 'validate'])
      expect(remoteValidate.command).toBe('validate')
      expect(remoteValidate.ok).toBe(true)
      expect(remoteValidate.data.remote).toBe(true)
      expect(remoteValidate.data.summary.invalid).toBe(0)

      const localValidate = await runCliJson(workspaceDir, ['--json', 'validate', '--local'])
      expect(localValidate.command).toBe('validate')
      expect(localValidate.ok).toBe(true)
      expect(localValidate.data.remote).toBe(false)
      expect(localValidate.data.summary.invalid).toBe(0)
      expect(localValidate.data.summary.templates).toBe(3)
    })
  })

  liveTest('auth failure returns structured errors for critical commands', async () => {
    await withWorkspace(async (workspaceDir) => {
      const badToken = 'op://invalid-token'

      for (const args of [
        ['--json', 'diff'],
        ['--json', 'sync', '--no-backup'],
        ['--json', 'validate'],
        ['--json', 'run', '--', 'printenv', 'JWT_SECRET'],
      ]) {
        const result = await runCliRaw(workspaceDir, args, {
          OP_SERVICE_ACCOUNT_TOKEN: badToken,
        })

        expect(result.exitCode).toBe(1)
        const json = JSON.parse(result.stdout)
        expect(json.ok).toBe(false)
        expect(json.issues.some((issue: { code: string }) => issue.code === 'AUTH_FAILED')).toBe(true)
      }
    })
  })

  liveTest('resolve returns single and multiple secret values in plain and json modes', async () => {
    await withWorkspace(async (workspaceDir) => {
      const reference = `op://${getVaultName()}/api-envs/DATABASE_URL`
      const secondReference = `op://${getVaultName()}/api-envs/JWT_SECRET`

      const plain = await runCli(workspaceDir, ['--quiet', 'resolve', reference])
      expect(plain.stdout.trim()).toBe(getSeedFieldValue('api-envs', 'DATABASE_URL'))

      const multiPlain = await runCli(workspaceDir, ['--quiet', 'resolve', reference, secondReference])
      expect(multiPlain.stdout.trim()).toBe(
        [getSeedFieldValue('api-envs', 'DATABASE_URL'), getSeedFieldValue('api-envs', 'JWT_SECRET')].join('\n'),
      )

      const resolved = await runCliJson(workspaceDir, ['--json', 'resolve', reference])
      expect(resolved.command).toBe('resolve')
      expect(resolved.ok).toBe(true)
      expect(resolved.data.secret).toBe(getSeedFieldValue('api-envs', 'DATABASE_URL'))
      expect(resolved.data.resolvedReference).toBe(reference)

      const multiResolved = await runCliJson(workspaceDir, ['--json', 'resolve', reference, secondReference])
      expect(multiResolved.command).toBe('resolve')
      expect(multiResolved.ok).toBe(true)
      expect(multiResolved.data.inputs).toEqual([reference, secondReference])
      expect(multiResolved.data.results.map((entry: { secret: string }) => entry.secret)).toEqual([
        getSeedFieldValue('api-envs', 'DATABASE_URL'),
        getSeedFieldValue('api-envs', 'JWT_SECRET'),
      ])
    })
  })

  liveTest('sync and diff cover dry-run, write, local drift, and --only', async () => {
    await withWorkspace(async (workspaceDir) => {
      // dry-run shows banner and mode message, does not write files or create backups
      const dryRunPlain = await runCli(workspaceDir, ['sync', '-d'])
      expect(dryRunPlain.stdout).toContain('Environment Sync')
      expect(dryRunPlain.stdout).toContain('dry-run mode')

      const preview = await runCliJson(workspaceDir, ['--json', 'sync', '-d'])
      expect(preview.command).toBe('sync')
      expect(preview.ok).toBe(true)
      expect(preview.data.options.dryRun).toBe(true)
      expect(preview.data.summary.success).toBe(3)

      // dry-run must not write env files or create backups
      expect(await Bun.file(path.join(workspaceDir, 'apps', 'api', '.env')).exists()).toBe(false)
      expect(await Bun.file(path.join(workspaceDir, '.env-backup')).exists()).toBe(false)

      // --no-backup sync: writes files but creates no backup
      const synced = await runCliJson(workspaceDir, ['--json', 'sync', '--no-backup'])
      expect(synced.command).toBe('sync')
      expect(synced.ok).toBe(true)
      expect(synced.data.summary.success).toBe(3)
      expect(synced.data.summary.failed).toBe(0)
      expect(await Bun.file(path.join(workspaceDir, '.env-backup')).exists()).toBe(false)

      const apiEnvPath = path.join(workspaceDir, 'apps', 'api', '.env')
      const apiEnv = await Bun.file(apiEnvPath).text()
      expect(apiEnv).toContain(`DATABASE_URL=${getSeedFieldValue('api-envs', 'DATABASE_URL')}`)
      expect(apiEnv).toContain(`JWT_SECRET=${getSeedFieldValue('api-envs', 'JWT_SECRET')}`)
      expect(apiEnv).toContain(`INTERNAL_API_KEY=${getSeedFieldValue('app-envs', 'INTERNAL_API_KEY')}`)

      const cleanDiff = await runCliJson(workspaceDir, ['--json', 'diff'])
      expect(cleanDiff.command).toBe('diff')
      expect(cleanDiff.ok).toBe(true)
      expect(cleanDiff.data.summary.hasAnyChanges).toBe(false)

      await Bun.write(
        apiEnvPath,
        apiEnv.replace(
          `DATABASE_URL=${getSeedFieldValue('api-envs', 'DATABASE_URL')}`,
          'DATABASE_URL=postgres://override.local/test',
        ) + 'CUSTOM_ONLY=preserve-me\n',
      )

      const driftDiff = await runCliJson(workspaceDir, ['--json', '--only', 'apps/api', 'diff'])
      expect(driftDiff.command).toBe('diff')
      expect(driftDiff.ok).toBe(true)
      expect(driftDiff.data.paths).toHaveLength(1)
      expect(driftDiff.data.summary.hasAnyChanges).toBe(true)
      expect(driftDiff.data.summary.updated).toBeGreaterThan(0)
      expect(driftDiff.data.paths[0].changes.some((change: { type: string }) => change.type === 'custom')).toBe(true)
    })
  })

  liveTest('run injects template secrets and env-file secrets', async () => {
    await withWorkspace(async (workspaceDir) => {
      await runCliJson(workspaceDir, ['--json', 'sync', '--no-backup'])

      const templateRun = await runCli(workspaceDir, [
        '--quiet',
        '--only',
        'apps/api',
        'run',
        '--',
        'bun',
        '-e',
        'process.stdout.write([process.env.DATABASE_URL, process.env.JWT_SECRET].join("\\n"))',
      ])
      expect(templateRun.stdout).toContain(getSeedFieldValue('api-envs', 'DATABASE_URL'))
      expect(templateRun.stdout).toContain(getSeedFieldValue('api-envs', 'JWT_SECRET'))

      const envFileRun = await runCli(workspaceDir, [
        '--quiet',
        'run',
        '--no-template',
        '--env-file',
        '.env.runtime',
        '--',
        'bun',
        '-e',
        'process.stdout.write([process.env.RUNTIME_SECRET, process.env.RUNTIME_TEXT].join("\\n"))',
      ])
      expect(envFileRun.stdout).toContain(getSeedFieldValue('worker-envs', 'WORKER_TOKEN'))
      expect(envFileRun.stdout).toContain(getSeedFieldValue('web-envs', 'NEXT_PUBLIC_APP_URL'))
    })
  })

  liveTest('backup and restore recover synced env files end to end', async () => {
    await withWorkspace(async (workspaceDir) => {
      await runCliJson(workspaceDir, ['--json', 'sync', '--no-backup'])

      const apiEnvPath = path.join(workspaceDir, 'apps', 'api', '.env')
      const original = await Bun.file(apiEnvPath).text()

      const backup = await runCliJson(workspaceDir, ['--json', 'backup'])
      expect(backup.command).toBe('backup')
      expect(backup.ok).toBe(true)
      expect(backup.data.backedUp).toBe(3)

      await Bun.write(apiEnvPath, 'BROKEN=1\n')

      const restore = await runCliJson(workspaceDir, ['--json', 'restore'])
      expect(restore.command).toBe('restore')
      expect(restore.ok).toBe(true)
      expect(restore.data.restored).toBe(3)

      const restored = await Bun.file(apiEnvPath).text()
      expect(restored).toBe(original)

      const status = await runCliJson(workspaceDir, ['--json', 'status'])
      expect(status.data.backups.count).toBe(1)
    })
  })

  liveTest('sync creates a backup by default when env files already exist', async () => {
    await withWorkspace(async (workspaceDir) => {
      await runCliJson(workspaceDir, ['--json', 'sync', '--no-backup'])

      const apiEnvPath = path.join(workspaceDir, 'apps', 'api', '.env')
      const original = await Bun.file(apiEnvPath).text()
      await Bun.write(apiEnvPath, original.replace('JWT_SECRET=', 'JWT_SECRET=locally-modified-'))

      const synced = await runCliJson(workspaceDir, ['--json', 'sync'])
      expect(synced.command).toBe('sync')
      expect(synced.ok).toBe(true)
      expect(await Bun.file(path.join(workspaceDir, '.env-backup', 'latest', 'apps', 'api', '.env')).exists()).toBe(
        true,
      )
    })
  })

  liveTest('1password-basic example works end to end', async () => {
    await withExampleWorkspace('1password-basic', async (workspaceDir) => {
      const status = await runCliJson(workspaceDir, ['--json', 'status'])
      expect(status.command).toBe('status')
      expect(status.ok).toBe(true)
      expect(status.data.summary.missing).toBe(1)

      const validate = await runCliJson(workspaceDir, ['--json', 'validate'])
      expect(validate.ok).toBe(true)
      expect(validate.data.summary.invalid).toBe(0)

      const preview = await runCliJson(workspaceDir, ['--json', 'sync', '-d'])
      expect(preview.ok).toBe(true)
      expect(preview.data.summary.success).toBe(1)

      const sync = await runCliJson(workspaceDir, ['--json', 'sync'])
      expect(sync.ok).toBe(true)
      expect(await Bun.file(path.join(workspaceDir, '.env')).exists()).toBe(true)

      const resolved = await runCli(workspaceDir, [
        '--quiet',
        'resolve',
        `op://${getExampleVaultName()}/api-service/JWT_SECRET`,
      ])
      expect(resolved.stdout.trim()).toBe('jwt_example_secret_123')

      const run = await runCli(workspaceDir, ['--quiet', 'run', '--', 'printenv', 'JWT_SECRET'])
      expect(run.stdout.trim()).toBe('jwt_example_secret_123')

      const diff = await runCliJson(workspaceDir, ['--json', 'diff'])
      expect(diff.ok).toBe(true)
      expect(diff.data.summary.hasAnyChanges).toBe(false)

      const backup = await runCliJson(workspaceDir, ['--json', 'backup'])
      expect(backup.ok).toBe(true)

      await Bun.write(path.join(workspaceDir, '.env'), 'BROKEN=1\n')
      const restore = await runCliJson(workspaceDir, ['--json', 'restore'])
      expect(restore.ok).toBe(true)
      expect(await Bun.file(path.join(workspaceDir, '.env')).text()).toContain('JWT_SECRET=jwt_example_secret_123')
    })
  })

  liveTest('1password-monorepo example works end to end', async () => {
    await withExampleWorkspace('1password-monorepo', async (workspaceDir) => {
      const sync = await runCliJson(workspaceDir, ['--json', 'sync'])
      expect(sync.ok).toBe(true)
      expect(sync.data.summary.success).toBe(3)

      const diff = await runCliJson(workspaceDir, ['--json', '--only', 'web', 'diff'])
      expect(diff.ok).toBe(true)
      expect(diff.data.paths).toHaveLength(1)
      expect(diff.data.summary.hasAnyChanges).toBe(false)

      const run = await runCli(workspaceDir, ['--quiet', '--only', 'web', 'run', '--', 'printenv', 'SESSION_SECRET'])
      expect(run.stdout.trim()).toBe('session_example_secret_456')

      const backup = await runCliJson(workspaceDir, ['--json', 'backup'])
      expect(backup.ok).toBe(true)
      expect(backup.data.backedUp).toBe(3)

      const listed = await runCliJson(workspaceDir, ['--json', 'restore', '--list'])
      expect(listed.ok).toBe(true)
      expect(listed.data.snapshots[0].files).toHaveLength(3)
    })
  })

  liveTest('1password-environments example switches by profile var', async () => {
    await withExampleWorkspace('1password-environments', async (workspaceDir) => {
      const defaultSync = await runCliJson(workspaceDir, ['--json', '--var', 'PROFILE=default', 'sync', '--no-backup'])
      expect(defaultSync.ok).toBe(true)
      expect(await Bun.file(path.join(workspaceDir, '.env')).text()).toContain('API_KEY=sk_default_example_123')

      const localSync = await runCliJson(workspaceDir, ['--json', '--var', 'PROFILE=local', 'sync', '--no-backup'])
      expect(localSync.ok).toBe(true)
      expect(await Bun.file(path.join(workspaceDir, '.env')).text()).toContain('API_KEY=sk_local_example_123')

      const stagingSync = await runCliJson(workspaceDir, ['--json', '--var', 'PROFILE=staging', 'sync', '--no-backup'])
      expect(stagingSync.ok).toBe(true)
      expect(await Bun.file(path.join(workspaceDir, '.env')).text()).toContain('API_KEY=sk_staging_example_123')

      const resolved = await runCli(workspaceDir, [
        '--quiet',
        '--var',
        'PROFILE=prod',
        'resolve',
        `op://${getExampleVaultName()}/api-service-\${PROFILE}/API_KEY`,
      ])
      expect(resolved.stdout.trim()).toBe('sk_prod_example_123')

      const run = await runCli(workspaceDir, [
        '--quiet',
        '--var',
        'PROFILE=prod',
        'run',
        '--',
        'printenv',
        'STRIPE_SECRET',
      ])
      expect(run.stdout.trim()).toBe('stripe_prod_example_123')
    })
  })

  liveTest('custom-files example works with config-backed output files', async () => {
    await withExampleWorkspace('custom-files', async (workspaceDir) => {
      const sync = await runCliJson(workspaceDir, ['--json', '--config', 'envi.json', 'sync'])
      expect(sync.ok).toBe(true)
      expect(await Bun.file(path.join(workspaceDir, '.env.local')).exists()).toBe(true)

      const diff = await runCliJson(workspaceDir, ['--json', '--config', 'envi.json', 'diff'])
      expect(diff.ok).toBe(true)
      expect(diff.data.summary.hasAnyChanges).toBe(false)

      const run = await runCli(workspaceDir, ['--quiet', '--config', 'envi.json', 'run', '--', 'printenv', 'API_KEY'])
      expect(run.stdout.trim()).toBe('sk_example_basic_123')

      const backup = await runCliJson(workspaceDir, ['--json', '--config', 'envi.json', 'backup'])
      expect(backup.ok).toBe(true)
      expect(backup.data.files).toContain('.env.local')

      await Bun.write(path.join(workspaceDir, '.env.local'), 'BROKEN=1\n')
      const restore = await runCliJson(workspaceDir, ['--json', '--config', 'envi.json', 'restore'])
      expect(restore.ok).toBe(true)
      expect(await Bun.file(path.join(workspaceDir, '.env.local')).text()).toContain('API_KEY=sk_example_basic_123')
    })
  })
})

function getVaultName(): string {
  if (!vault) {
    throw new Error('Vault not initialized')
  }
  return vault.title
}

function getExampleVaultName(): string {
  if (!exampleVault) {
    throw new Error('Example vault not initialized')
  }
  return exampleVault.title
}

async function ensureManagedVault(args: {
  title: string
  description: string
}): Promise<{ id: string; title: string }> {
  const listed = await withRateLimitRetry(`list vaults for ${args.title}`, () => client.vaults.list(undefined))
  const existing = listed.find((entry) => entry.title === args.title)
  if (existing) {
    return { id: existing.id, title: existing.title }
  }

  const created = await withRateLimitRetry(`create vault ${args.title}`, () =>
    client.vaults.create({
      title: args.title,
      description: args.description,
      allowAdminsAccess: true,
    }),
  )

  return { id: created.id, title: created.title }
}

async function replacePrimaryManagedItems(vaultId: string): Promise<void> {
  const managedTitles = new Set(E2E_VAULT_ITEMS.map((item) => item.title))
  const existing = await withRateLimitRetry('list primary vault items', () => client.items.list(vaultId))

  for (const item of existing) {
    if (!managedTitles.has(item.title)) continue
    await withRateLimitRetry(`delete primary managed item ${item.title}`, () => client.items.delete(vaultId, item.id))
  }

  await withRateLimitRetry('populate primary vault items', () => populateVaultWithEnvItems(client, vaultId))
}

async function withWorkspace(run: (workspaceDir: string) => Promise<void>): Promise<void> {
  const workspaceDir = await mkdtemp(WORKSPACE_PREFIX)

  try {
    await prepareWorkspace(workspaceDir, getVaultName())
    await run(workspaceDir)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}

async function withExampleWorkspace(exampleName: string, run: (workspaceDir: string) => Promise<void>): Promise<void> {
  const workspaceDir = await mkdtemp(WORKSPACE_PREFIX)
  const exampleDir = path.join(workspaceDir, 'workspace')

  try {
    await cp(path.join(import.meta.dir, '..', '..', 'examples', exampleName), exampleDir, { recursive: true })
    await rewriteWorkspaceVaultRefs(exampleDir, 'envi-example', getExampleVaultName())
    await run(exampleDir)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}

async function rewriteWorkspaceVaultRefs(workspaceDir: string, fromVault: string, toVault: string): Promise<void> {
  const entries = await readdir(workspaceDir, { withFileTypes: true })

  for (const entry of entries) {
    const entryPath = path.join(workspaceDir, entry.name)
    if (entry.isDirectory()) {
      await rewriteWorkspaceVaultRefs(entryPath, fromVault, toVault)
      continue
    }

    if (!(entry.name.startsWith('.env') || entry.name === 'envi.json')) continue

    const content = await readFile(entryPath, 'utf8')
    await writeFile(entryPath, content.replaceAll(fromVault, toVault), 'utf8')
  }
}

async function prepareWorkspace(workspaceDir: string, vaultName: string): Promise<void> {
  await mkdir(path.join(workspaceDir, 'apps', 'api'), { recursive: true })
  await mkdir(path.join(workspaceDir, 'apps', 'web'), { recursive: true })
  await mkdir(path.join(workspaceDir, 'apps', 'worker'), { recursive: true })

  await Bun.write(
    path.join(workspaceDir, 'envi.json'),
    JSON.stringify(
      {
        provider: '1password',
        vars: { PROFILE: 'local' },
        templateFile: '.env.example',
        outputFile: '.env',
        backupDir: '.env-backup',
      },
      null,
      2,
    ) + '\n',
  )

  await Bun.write(
    path.join(workspaceDir, '.env.runtime'),
    [
      `RUNTIME_SECRET=op://${vaultName}/worker-envs/WORKER_TOKEN`,
      `RUNTIME_TEXT=op://${vaultName}/web-envs/NEXT_PUBLIC_APP_URL`,
      '',
    ].join('\n'),
  )

  await Bun.write(
    path.join(workspaceDir, 'apps', 'api', '.env.example'),
    [
      'NODE_ENV=development',
      `DATABASE_URL=op://${vaultName}/api-envs/DATABASE_URL`,
      `JWT_SECRET=op://${vaultName}/api-envs/JWT_SECRET`,
      `BETTER_AUTH_URL=op://${vaultName}/api-envs/BETTER_AUTH_URL`,
      `INTERNAL_API_KEY=op://${vaultName}/app-envs/INTERNAL_API_KEY`,
      '',
    ].join('\n'),
  )

  await Bun.write(
    path.join(workspaceDir, 'apps', 'web', '.env.example'),
    [
      `NEXT_PUBLIC_API_URL=op://${vaultName}/web-envs/NEXT_PUBLIC_API_URL`,
      `NEXT_PUBLIC_APP_URL=op://${vaultName}/web-envs/NEXT_PUBLIC_APP_URL`,
      `SENTRY_AUTH_TOKEN=op://${vaultName}/web-envs/SENTRY_AUTH_TOKEN`,
      `GOOGLE_CLIENT_ID=op://${vaultName}/web-envs/GOOGLE_CLIENT_ID`,
      `FEATURE_FLAGS=op://${vaultName}/app-envs/FEATURE_FLAGS`,
      '',
    ].join('\n'),
  )

  await Bun.write(
    path.join(workspaceDir, 'apps', 'worker', '.env.example'),
    [
      `QUEUE_URL=op://${vaultName}/worker-envs/QUEUE_URL`,
      `WORKER_TOKEN=op://${vaultName}/worker-envs/WORKER_TOKEN`,
      `CRON_SECRET=op://${vaultName}/worker-envs/CRON_SECRET`,
      `DATABASE_URL=op://${vaultName}/api-envs/DATABASE_URL`,
      `SLACK_WEBHOOK_URL=op://${vaultName}/ops-envs/SLACK_WEBHOOK_URL`,
      '',
    ].join('\n'),
  )
}

async function runCliJson(workspaceDir: string, args: string[]): Promise<any> {
  const result = await runCli(workspaceDir, args)
  return JSON.parse(result.stdout)
}

async function runCliRaw(
  workspaceDir: string,
  args: string[],
  envOverrides: Record<string, string | undefined> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries({
    ...process.env,
    NO_COLOR: '1',
    OP_SERVICE_ACCOUNT_TOKEN: e2eConfig!.token,
    ...envOverrides,
  })) {
    if (typeof value === 'string') env[key] = value
  }

  const startedAt = Date.now()

  const proc = Bun.spawn(['bun', CLI_PATH, ...args], {
    cwd: workspaceDir,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()

  const elapsedMs = Date.now() - startedAt
  const testName = testContext.getStore() ?? 'suite.setup'
  const command = findCommandName(args)
  commandBenchmarks.push({
    testName,
    command,
    args,
    elapsedMs,
    exitCode,
  })

  if (elapsedMs >= SLOW_COMMAND_THRESHOLD_MS) {
    console.info(`[bench][command] ${elapsedMs}ms | test="${testName}" | cmd="${args.join(' ')}"`)
  }

  return { stdout, stderr, exitCode }
}

async function runCli(workspaceDir: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr, exitCode } = await runCliRaw(workspaceDir, args)

  if (exitCode !== 0) {
    throw new Error(
      [stderr.trim(), stdout.trim(), `CLI exited with code ${exitCode}`].filter((part) => part.length > 0).join('\n\n'),
    )
  }

  return { stdout, stderr }
}

function liveTest(name: string, run: () => Promise<void>): void {
  test(name, async () => {
    const startedAt = Date.now()

    try {
      await testContext.run(name, async () => {
        await run()
      })
    } finally {
      const elapsedMs = Date.now() - startedAt
      testBenchmarks.push({ testName: name, elapsedMs })
      console.info(`[bench][test] ${elapsedMs}ms | ${name}`)
    }
  })
}

function findCommandName(args: string[]): string {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg) continue
    if (arg === '--') break

    if (arg.startsWith('-')) {
      if (takesOptionValue(arg)) index++
      continue
    }

    return arg
  }

  return '(none)'
}

function takesOptionValue(arg: string): boolean {
  return (
    arg === '--var' ||
    arg === '--config' ||
    arg === '--only' ||
    arg === '--output' ||
    arg === '--template-file' ||
    arg === '--backup-dir' ||
    arg === '--snapshot' ||
    arg === '--env-file'
  )
}

function printBenchmarkSummary(): void {
  const suiteElapsedMs = Date.now() - suiteStartedAt
  console.info(`\n[bench][summary] live e2e suite completed in ${suiteElapsedMs}ms`)

  if (testBenchmarks.length === 0 || commandBenchmarks.length === 0) {
    console.info('[bench][summary] no benchmark data collected')
    return
  }

  const slowTests = [...testBenchmarks].sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 8)
  console.info('[bench][summary] slowest tests:')
  for (const item of slowTests) {
    console.info(`  ${item.elapsedMs}ms | ${item.testName}`)
  }

  const grouped = new Map<string, { count: number; total: number; max: number }>()
  for (const item of commandBenchmarks) {
    const current = grouped.get(item.command) ?? { count: 0, total: 0, max: 0 }
    current.count += 1
    current.total += item.elapsedMs
    current.max = Math.max(current.max, item.elapsedMs)
    grouped.set(item.command, current)
  }

  const byTotal = [...grouped.entries()]
    .map(([command, stats]) => ({
      command,
      count: stats.count,
      total: stats.total,
      avg: Math.round(stats.total / stats.count),
      max: stats.max,
    }))
    .sort((a, b) => b.total - a.total)

  console.info('[bench][summary] command totals:')
  for (const row of byTotal) {
    console.info(`  ${row.command}: total=${row.total}ms avg=${row.avg}ms max=${row.max}ms count=${row.count}`)
  }

  const slowCommands = [...commandBenchmarks].sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 12)
  console.info('[bench][summary] slowest command invocations:')
  for (const item of slowCommands) {
    console.info(`  ${item.elapsedMs}ms | ${item.testName} | ${item.args.join(' ')}`)
  }
}

async function withRateLimitRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  let attempt = 0

  while (true) {
    try {
      return await operation()
    } catch (error) {
      if (!isRetryableOnePasswordSetupError(error) || attempt >= RATE_LIMIT_RETRIES) {
        throw error
      }

      attempt += 1
      const delayMs = Math.min(RATE_LIMIT_MAX_BACKOFF_MS, RATE_LIMIT_BACKOFF_MS * 2 ** (attempt - 1))
      console.info(
        `[bench][retry] ${label} hit transient 1Password error, retry ${attempt}/${RATE_LIMIT_RETRIES} in ${delayMs}ms`,
      )
      await Bun.sleep(delayMs)
    }
  }
}

function isRetryableOnePasswordSetupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  return (
    lower.includes('rate limit exceeded') ||
    lower.includes('504 gateway timeout') ||
    lower.includes('gateway timeout') ||
    lower.includes('timed out') ||
    lower.includes('econnreset') ||
    lower.includes('service unavailable')
  )
}
