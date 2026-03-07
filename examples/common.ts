import {
  createClient,
  ItemCategory,
  ItemFieldType,
  type Client,
  type ItemCreateParams,
  type VaultOverview,
} from '@1password/sdk'

import { VERSION } from '../src/config'
import { loadRootEnvLocal } from '../src/test-helpers/local-env'
import { grantUserViewAccess } from '../src/test-helpers/onepassword-e2e'

export const EXAMPLE_VAULT_TITLE = 'envi-example'
export const LEGACY_EXAMPLE_VAULT_TITLES = ['envi-example-local', 'envi-example-staging', 'envi-example-prod']

export interface ExampleConfig {
  token: string
  userEmail: string
}

interface ExampleItemSeed {
  title: string
  note: string
  fields: Record<string, { type: 'text' | 'concealed'; value: string }>
}

export const EXAMPLE_ITEMS: ExampleItemSeed[] = [
  {
    title: 'api-service',
    note: 'basic/.env',
    fields: {
      API_KEY: { type: 'concealed', value: 'sk_example_basic_123' },
      DATABASE_URL: { type: 'concealed', value: 'postgres://example:example@localhost:5432/example' },
      JWT_SECRET: { type: 'concealed', value: 'jwt_example_secret_123' },
    },
  },
  {
    title: 'web-app',
    note: 'monorepo/web/.env',
    fields: {
      SESSION_SECRET: { type: 'concealed', value: 'session_example_secret_456' },
      OAUTH_CLIENT_ID: { type: 'text', value: 'example-oauth-client-id' },
      OAUTH_CLIENT_SECRET: { type: 'concealed', value: 'example-oauth-client-secret' },
    },
  },
  {
    title: 'worker',
    note: 'monorepo/worker/.env',
    fields: {
      REDIS_URL: { type: 'concealed', value: 'redis://localhost:6379' },
    },
  },
  ...['local', 'staging', 'prod'].map<ExampleItemSeed>((env) => ({
    title: `api-service-${env}`,
    note: `${env}/.env`,
    fields: {
      API_KEY: { type: 'concealed', value: `sk_${env}_example_123` },
      DATABASE_URL: { type: 'concealed', value: `postgres://example:example@db-${env}:5432/example` },
      REDIS_URL: { type: 'concealed', value: `redis://redis-${env}:6379` },
      STRIPE_SECRET: { type: 'concealed', value: `stripe_${env}_example_123` },
    },
  })),
]

export async function loadExampleConfig(): Promise<ExampleConfig> {
  await loadRootEnvLocal()

  const token =
    process.env['ENVI_1PASSWORD_EXAMPLES_TOKEN']?.trim() ??
    process.env['ENVI_1PASSWORD_E2E_SERVICE_ACCOUNT_TOKEN']?.trim() ??
    process.env['ENVI_1PASSWORD_BENCH_TOKEN']?.trim()

  if (!token) {
    throw new Error('Missing example 1Password token in .env.local')
  }

  const userEmail = (process.env['ENVI_1PASSWORD_E2E_USER_EMAIL'] ?? 'tobirawork@gmail.com').trim()
  return { token, userEmail }
}

export async function createExampleClient(token: string): Promise<Client> {
  return createClient({
    auth: token,
    integrationName: 'envi-examples',
    integrationVersion: VERSION,
  })
}

export async function findVaultByTitle(client: Client, title: string): Promise<VaultOverview | undefined> {
  const vaults = await client.vaults.list(undefined)
  return vaults.find((vault) => vault.title === title)
}

export async function ensureExampleVault(client: Client, config: ExampleConfig): Promise<VaultOverview> {
  const existing = await findVaultByTitle(client, EXAMPLE_VAULT_TITLE)
  const vault =
    existing ??
    (await client.vaults.create({
      title: EXAMPLE_VAULT_TITLE,
      description: 'Shared Envi example vault',
      allowAdminsAccess: true,
    }))

  await grantUserViewAccess({
    token: config.token,
    vaultId: vault.id,
    userEmail: config.userEmail,
  })

  await replaceManagedItems(client, vault.id)
  return vault
}

export async function replaceManagedItems(client: Client, vaultId: string): Promise<void> {
  const existing = await client.items.list(vaultId)
  const managedTitles = new Set(EXAMPLE_ITEMS.map((item) => item.title))

  for (const item of existing) {
    if (!managedTitles.has(item.title)) continue
    await client.items.delete(vaultId, item.id)
  }

  const result = await client.items.createAll(
    vaultId,
    EXAMPLE_ITEMS.map((item) => toCreateParams(vaultId, item)),
  )

  for (const response of result.individualResponses) {
    if (!response.error) continue
    const message = 'message' in response.error ? response.error.message : undefined
    throw new Error(message ?? 'Failed to seed example item')
  }
}

function toCreateParams(vaultId: string, item: ExampleItemSeed): ItemCreateParams {
  return {
    vaultId,
    title: item.title,
    category: ItemCategory.SecureNote,
    notes: item.note,
    fields: Object.entries(item.fields).map(([field, data]) => ({
      id: field,
      title: field,
      fieldType: data.type === 'concealed' ? ItemFieldType.Concealed : ItemFieldType.Text,
      value: data.value,
    })),
  }
}
