import { createClient, ItemCategory, ItemFieldType, type Client, type ItemCreateParams } from '@1password/sdk'
import { randomUUID } from 'node:crypto'

import { VERSION } from '../config'
import { loadRootEnvLocal } from './local-env'

export const E2E_SERVICE_ACCOUNT_TOKEN_ENV = 'ENVI_1PASSWORD_E2E_SERVICE_ACCOUNT_TOKEN'
export const E2E_USER_EMAIL_ENV = 'ENVI_1PASSWORD_E2E_USER_EMAIL'
const DEFAULT_E2E_USER_EMAIL = 'tobirawork@gmail.com'

type FieldKind = 'text' | 'concealed'

interface SeedField {
  kind: FieldKind
  value: string
}

interface SeedItem {
  title: string
  note: string
  fields: Record<string, SeedField>
}

export interface OnePasswordE2EConfig {
  token: string
  userEmail: string
}

export const E2E_VAULT_ITEMS: SeedItem[] = [
  {
    title: 'api-envs',
    note: 'api/.env',
    fields: {
      DATABASE_URL: { kind: 'concealed', value: 'postgres://envi_user:envi_pass@localhost:5432/api_dev' },
      BETTER_AUTH_SECRET: { kind: 'concealed', value: 'ba_test_8f3c9a12d4e6' },
      BETTER_AUTH_URL: { kind: 'text', value: 'http://localhost:3000' },
      REDIS_URL: { kind: 'concealed', value: 'redis://default:redis_pass@localhost:6379' },
      JWT_SECRET: { kind: 'concealed', value: 'jwt_test_s3cr3t_9a8b7c' },
    },
  },
  {
    title: 'web-envs',
    note: 'web/.env',
    fields: {
      NEXT_PUBLIC_API_URL: { kind: 'text', value: 'http://localhost:3001' },
      NEXT_PUBLIC_APP_URL: { kind: 'text', value: 'http://localhost:3000' },
      SENTRY_AUTH_TOKEN: { kind: 'concealed', value: 'sntr_auth_test_3ab45cde67' },
      STRIPE_PUBLIC_KEY: { kind: 'text', value: 'pk_test_51Nexample12345' },
      GOOGLE_CLIENT_ID: { kind: 'text', value: '1234567890-webtest.apps.googleusercontent.com' },
    },
  },
  {
    title: 'app-envs',
    note: 'app/.env.local',
    fields: {
      APP_SECRET: { kind: 'concealed', value: 'app_secret_test_k2m4n6p8' },
      INTERNAL_API_KEY: { kind: 'concealed', value: 'int_api_test_91b2c3d4' },
      UPSTASH_REDIS_REST_URL: { kind: 'text', value: 'https://quiet-otter-12345.upstash.io' },
      UPSTASH_REDIS_REST_TOKEN: { kind: 'concealed', value: 'upstash_token_test_6543abcd' },
      FEATURE_FLAGS: { kind: 'text', value: 'new-dashboard,invite-beta' },
    },
  },
  {
    title: 'dash-envs',
    note: 'dash/.env',
    fields: {
      DASH_API_URL: { kind: 'text', value: 'http://localhost:3010' },
      DASH_SESSION_SECRET: { kind: 'concealed', value: 'dash_sess_test_79a1bc2d' },
      ADMIN_EMAIL: { kind: 'text', value: 'admin@example.com' },
      ANALYTICS_WRITE_KEY: { kind: 'concealed', value: 'write_key_test_44ffeedd' },
    },
  },
  {
    title: 'worker-envs',
    note: 'worker/.env',
    fields: {
      QUEUE_URL: { kind: 'text', value: 'redis://localhost:6379/1' },
      WORKER_TOKEN: { kind: 'concealed', value: 'worker_token_test_5f6e7d8c' },
      CRON_SECRET: { kind: 'concealed', value: 'cron_secret_test_10293847' },
      LOG_LEVEL: { kind: 'text', value: 'debug' },
      BATCH_SIZE: { kind: 'text', value: '50' },
    },
  },
  {
    title: 'ops-envs',
    note: 'ops/.env',
    fields: {
      AWS_ACCESS_KEY_ID: { kind: 'concealed', value: 'AKIAT3STEXAMPLE42' },
      AWS_SECRET_ACCESS_KEY: { kind: 'concealed', value: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
      SLACK_WEBHOOK_URL: { kind: 'concealed', value: 'https://hooks.slack.com/services/T000/B000/TEST123' },
      GITHUB_APP_ID: { kind: 'text', value: '123456' },
      GITHUB_PRIVATE_KEY: { kind: 'concealed', value: '-----BEGIN_PRIVATE_KEY-----test-----END_PRIVATE_KEY-----' },
    },
  },
]

export async function loadOnePasswordE2EConfig(): Promise<OnePasswordE2EConfig | null> {
  await loadRootEnvLocal()

  const token = process.env[E2E_SERVICE_ACCOUNT_TOKEN_ENV]?.trim()
  if (!token) return null

  const userEmail = (process.env[E2E_USER_EMAIL_ENV] ?? DEFAULT_E2E_USER_EMAIL).trim()
  return { token, userEmail }
}

export async function createOnePasswordE2EClient(token: string): Promise<Client> {
  return createClient({
    auth: token,
    integrationName: 'envi-e2e-tests',
    integrationVersion: VERSION,
  })
}

export async function createTemporaryVault(client: Client): Promise<{ id: string; title: string }> {
  const suffix = randomUUID().slice(0, 8)
  const vault = await client.vaults.create({
    title: `envi-e2e-${Date.now()}-${suffix}`,
    description: 'Temporary Envi live E2E test vault',
    allowAdminsAccess: true,
  })

  return { id: vault.id, title: vault.title }
}

export async function populateVaultWithEnvItems(client: Client, vaultId: string): Promise<void> {
  const items = E2E_VAULT_ITEMS.map((item) => toItemCreateParams(vaultId, item))
  const response = await client.items.createAll(vaultId, items)

  for (const individual of response.individualResponses) {
    if (!individual.error) continue

    const message = 'message' in individual.error ? individual.error.message : undefined
    const type = 'type' in individual.error ? individual.error.type : undefined
    throw new Error(message ?? type ?? 'Failed to create 1Password test item')
  }
}

export async function grantUserViewAccess(args: { token: string; vaultId: string; userEmail: string }): Promise<void> {
  const proc = Bun.spawn(
    [
      'op',
      'vault',
      'user',
      'grant',
      '--vault',
      args.vaultId,
      '--user',
      args.userEmail,
      '--permissions',
      'allow_viewing',
    ],
    {
      env: {
        ...process.env,
        OP_SERVICE_ACCOUNT_TOKEN: args.token,
      } as Record<string, string>,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  const exitCode = await proc.exited
  if (exitCode === 0) return

  const stderr = await new Response(proc.stderr).text()
  const stdout = await new Response(proc.stdout).text()
  throw new Error(stderr.trim() || stdout.trim() || `Failed to grant ${args.userEmail} access to vault ${args.vaultId}`)
}

export function getSeedFieldValue(itemTitle: string, fieldKey: string): string {
  const item = E2E_VAULT_ITEMS.find((entry) => entry.title === itemTitle)
  if (!item) {
    throw new Error(`Unknown seed item: ${itemTitle}`)
  }

  const field = item.fields[fieldKey]
  if (!field) {
    throw new Error(`Unknown seed field: ${itemTitle}/${fieldKey}`)
  }

  return field.value
}

function toItemCreateParams(vaultId: string, item: SeedItem): ItemCreateParams {
  return {
    vaultId,
    title: item.title,
    category: ItemCategory.SecureNote,
    notes: item.note,
    fields: Object.entries(item.fields).map(([key, field]) => ({
      id: key,
      title: key,
      fieldType: field.kind === 'concealed' ? ItemFieldType.Concealed : ItemFieldType.Text,
      value: field.value,
    })),
  }
}
