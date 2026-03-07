import type { Client } from '@1password/sdk'
import { beforeAll, afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

import {
  createOnePasswordE2EClient,
  createTemporaryVault,
  getSeedFieldValue,
  grantUserViewAccess,
  loadOnePasswordE2EConfig,
  populateVaultWithEnvItems,
} from '../testing/onepassword-e2e'

const CLI_PATH = path.join(import.meta.dir, '..', 'cli.ts')
const WORKSPACE_PREFIX = path.join(import.meta.dir, '.test-workspace-1password-live-')

const e2eConfig = await loadOnePasswordE2EConfig()

if (!e2eConfig) {
  throw new Error('Missing ENVI_1PASSWORD_E2E_SERVICE_ACCOUNT_TOKEN in .env.test, .env.local, or process.env')
}

let client: Client
let vault: { id: string; title: string } | null = null

describe('live 1Password CLI e2e', () => {
  beforeAll(async () => {
    client = await createOnePasswordE2EClient(e2eConfig.token)
    vault = await createTemporaryVault(client)

    await grantUserViewAccess({
      token: e2eConfig.token,
      vaultId: vault.id,
      userEmail: e2eConfig.userEmail,
    })
    await populateVaultWithEnvItems(client, vault.id)
  })

  afterAll(async () => {
    if (vault) {
      await client.vaults.delete(vault.id)
      vault = null
    }
  })

  test('status reports provider auth and missing env files before sync', async () => {
    await withWorkspace(async (workspaceDir) => {
      const plain = await runCli(workspaceDir, ['status'])
      expect(plain.stdout).toContain('Environment Status')
      expect(plain.stdout).toContain('1Password')
      expect(plain.stdout).toContain('Authenticated')
      expect(plain.stdout).toContain('Configured Paths')

      const status = await runCliJson(workspaceDir, ['--json', 'status'])
      expect(status.command).toBe('status')
      expect(status.ok).toBe(true)
      expect(status.data.provider.name).toBe('1Password')
      expect(status.data.provider.auth.success).toBe(true)
      expect(status.data.summary.missing).toBe(3)
      expect(status.data.backups.count).toBe(0)
    })
  })

  test('validate covers local format checks and remote provider checks', async () => {
    await withWorkspace(async (workspaceDir) => {
      const localValidate = await runCliJson(workspaceDir, ['--json', 'validate'])
      expect(localValidate.command).toBe('validate')
      expect(localValidate.ok).toBe(true)
      expect(localValidate.data.summary.invalid).toBe(0)
      expect(localValidate.data.summary.templates).toBe(3)

      const remoteValidate = await runCliJson(workspaceDir, ['--json', 'validate', '--remote'])
      expect(remoteValidate.command).toBe('validate')
      expect(remoteValidate.ok).toBe(true)
      expect(remoteValidate.data.remote).toBe(true)
      expect(remoteValidate.data.summary.invalid).toBe(0)
    })
  })

  test('resolve returns secret values in plain and json modes', async () => {
    await withWorkspace(async (workspaceDir) => {
      const reference = `op://${getVaultName()}/api-envs/DATABASE_URL`

      const plain = await runCli(workspaceDir, ['--quiet', 'resolve', reference])
      expect(plain.stdout.trim()).toBe(getSeedFieldValue('api-envs', 'DATABASE_URL'))

      const resolved = await runCliJson(workspaceDir, ['--json', 'resolve', reference])
      expect(resolved.command).toBe('resolve')
      expect(resolved.ok).toBe(true)
      expect(resolved.data.secret).toBe(getSeedFieldValue('api-envs', 'DATABASE_URL'))
      expect(resolved.data.resolvedReference).toBe(reference)
    })
  })

  test('sync and diff cover dry-run, write, local drift, and --only', async () => {
    await withWorkspace(async (workspaceDir) => {
      const preview = await runCliJson(workspaceDir, ['--json', 'sync', '-d', '-f'])
      expect(preview.command).toBe('sync')
      expect(preview.ok).toBe(true)
      expect(preview.data.options.dryRun).toBe(true)
      expect(preview.data.summary.success).toBe(3)

      expect(await Bun.file(path.join(workspaceDir, 'apps', 'api', '.env')).exists()).toBe(false)

      const synced = await runCliJson(workspaceDir, ['--json', 'sync', '-f', '--no-backup'])
      expect(synced.command).toBe('sync')
      expect(synced.ok).toBe(true)
      expect(synced.data.summary.success).toBe(3)
      expect(synced.data.summary.failed).toBe(0)

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

  test('run injects template secrets and env-file secrets', async () => {
    await withWorkspace(async (workspaceDir) => {
      await runCliJson(workspaceDir, ['--json', 'sync', '-f', '--no-backup'])

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

  test('backup and restore recover synced env files end to end', async () => {
    await withWorkspace(async (workspaceDir) => {
      await runCliJson(workspaceDir, ['--json', 'sync', '-f', '--no-backup'])

      const apiEnvPath = path.join(workspaceDir, 'apps', 'api', '.env')
      const original = await Bun.file(apiEnvPath).text()

      const backup = await runCliJson(workspaceDir, ['--json', 'backup', '-f'])
      expect(backup.command).toBe('backup')
      expect(backup.ok).toBe(true)
      expect(backup.data.backedUp).toBe(3)

      await Bun.write(apiEnvPath, 'BROKEN=1\n')

      const restore = await runCliJson(workspaceDir, ['--json', 'restore', '-f'])
      expect(restore.command).toBe('restore')
      expect(restore.ok).toBe(true)
      expect(restore.data.restored).toBe(3)

      const restored = await Bun.file(apiEnvPath).text()
      expect(restored).toBe(original)
    })
  })
})

function getVaultName(): string {
  if (!vault) {
    throw new Error('Vault not initialized')
  }
  return vault.title
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

async function prepareWorkspace(workspaceDir: string, vaultName: string): Promise<void> {
  await mkdir(path.join(workspaceDir, 'apps', 'api'), { recursive: true })
  await mkdir(path.join(workspaceDir, 'apps', 'web'), { recursive: true })
  await mkdir(path.join(workspaceDir, 'apps', 'worker'), { recursive: true })

  await Bun.write(
    path.join(workspaceDir, 'envi.json'),
    JSON.stringify(
      {
        provider: '1password',
        providerOptions: {
          backend: 'sdk',
        },
        environment: 'local',
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

async function runCli(workspaceDir: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', CLI_PATH, ...args], {
    cwd: workspaceDir,
    env: {
      ...process.env,
      NO_COLOR: '1',
      OP_SERVICE_ACCOUNT_TOKEN: e2eConfig!.token,
    } as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()

  if (exitCode !== 0) {
    throw new Error(
      [stderr.trim(), stdout.trim(), `CLI exited with code ${exitCode}`].filter((part) => part.length > 0).join('\n\n'),
    )
  }

  return { stdout, stderr }
}
