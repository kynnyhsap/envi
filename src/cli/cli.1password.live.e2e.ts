import { expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
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
const WORKSPACE_DIR = path.join(import.meta.dir, '.test-workspace-1password-live')

const e2eConfig = await loadOnePasswordE2EConfig()

if (!e2eConfig) {
  throw new Error('Missing ENVI_1PASSWORD_E2E_SERVICE_ACCOUNT_TOKEN in .env.local or process.env')
}

test('live 1Password E2E: provision vault, sync secrets, and clean up', async () => {
  const client = await createOnePasswordE2EClient(e2eConfig.token)
  let vaultId: string | null = null

  try {
    const vault = await createTemporaryVault(client)
    vaultId = vault.id

    await grantUserViewAccess({
      token: e2eConfig.token,
      vaultId: vault.id,
      userEmail: e2eConfig.userEmail,
    })
    await populateVaultWithEnvItems(client, vault.id)
    await prepareWorkspace(vault.title)

    const validate = await runCliJson(['--config', 'envi.json', '--json', 'validate', '--remote'])
    expect(validate.ok).toBe(true)
    expect(validate.data.summary.invalid).toBe(0)

    const resolvedSecret = await runCli([
      '--quiet',
      '--config',
      'envi.json',
      'resolve',
      `op://${vault.title}/api-envs/DATABASE_URL`,
    ])
    expect(resolvedSecret.stdout.trim()).toBe(getSeedFieldValue('api-envs', 'DATABASE_URL'))

    const sync = await runCliJson(['--config', 'envi.json', '--json', 'sync', '-f', '--no-backup'])
    expect(sync.ok).toBe(true)
    expect(sync.data.summary.success).toBe(3)
    expect(sync.data.summary.failed).toBe(0)

    const apiEnv = await Bun.file(path.join(WORKSPACE_DIR, 'apps', 'api', '.env')).text()
    expect(apiEnv).toContain(`DATABASE_URL=${getSeedFieldValue('api-envs', 'DATABASE_URL')}`)
    expect(apiEnv).toContain(`JWT_SECRET=${getSeedFieldValue('api-envs', 'JWT_SECRET')}`)
    expect(apiEnv).toContain(`INTERNAL_API_KEY=${getSeedFieldValue('app-envs', 'INTERNAL_API_KEY')}`)

    const webEnv = await Bun.file(path.join(WORKSPACE_DIR, 'apps', 'web', '.env')).text()
    expect(webEnv).toContain(`NEXT_PUBLIC_API_URL=${getSeedFieldValue('web-envs', 'NEXT_PUBLIC_API_URL')}`)
    expect(webEnv).toContain(`FEATURE_FLAGS=${getSeedFieldValue('app-envs', 'FEATURE_FLAGS')}`)

    const diff = await runCliJson(['--config', 'envi.json', '--json', 'diff'])
    expect(diff.ok).toBe(true)
    expect(diff.data.summary.hasAnyChanges).toBe(false)

    const runResult = await runCli([
      '--quiet',
      '--config',
      'envi.json',
      '--only',
      'apps/api',
      'run',
      '--',
      'bun',
      '-e',
      'process.stdout.write(process.env.DATABASE_URL ?? "")',
    ])
    expect(runResult.stdout.trim()).toBe(getSeedFieldValue('api-envs', 'DATABASE_URL'))
  } finally {
    await rm(WORKSPACE_DIR, { recursive: true, force: true })

    if (vaultId) {
      await client.vaults.delete(vaultId)
    }
  }
})

async function prepareWorkspace(vaultName: string): Promise<void> {
  await rm(WORKSPACE_DIR, { recursive: true, force: true })
  await mkdir(path.join(WORKSPACE_DIR, 'apps', 'api'), { recursive: true })
  await mkdir(path.join(WORKSPACE_DIR, 'apps', 'web'), { recursive: true })
  await mkdir(path.join(WORKSPACE_DIR, 'apps', 'worker'), { recursive: true })

  await Bun.write(
    path.join(WORKSPACE_DIR, 'envi.json'),
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
    path.join(WORKSPACE_DIR, 'apps', 'api', '.env.example'),
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
    path.join(WORKSPACE_DIR, 'apps', 'web', '.env.example'),
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
    path.join(WORKSPACE_DIR, 'apps', 'worker', '.env.example'),
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

async function runCliJson(args: string[]): Promise<any> {
  const result = await runCli(args)
  return JSON.parse(result.stdout)
}

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', CLI_PATH, ...args], {
    cwd: WORKSPACE_DIR,
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
    throw new Error(stderr.trim() || stdout.trim() || `CLI exited with code ${exitCode}`)
  }

  return { stdout, stderr }
}
