import { createClient, DesktopAuth, type Client } from '@1password/sdk'
import { OP_ACCOUNT_NAME, VERSION, getConfig } from './config'

let cachedClient: Client | null = null

export interface OnePasswordAuth {
  type: 'service-account' | 'desktop-app'
  identifier: string
}

export function getAuthMethod(): OnePasswordAuth {
  const serviceAccountToken = process.env['OP_SERVICE_ACCOUNT_TOKEN']
  if (serviceAccountToken) {
    return { type: 'service-account', identifier: serviceAccountToken }
  }

  // Priority: CLI --account flag > OP_ACCOUNT_NAME env var > default
  const config = getConfig()
  const accountName = config.accountName || process.env['OP_ACCOUNT_NAME'] || OP_ACCOUNT_NAME
  return { type: 'desktop-app', identifier: accountName }
}

export async function getClient(): Promise<Client> {
  if (cachedClient) {
    return cachedClient
  }

  const authMethod = getAuthMethod()
  const auth = authMethod.type === 'service-account' ? authMethod.identifier : new DesktopAuth(authMethod.identifier)

  cachedClient = await createClient({
    auth,
    integrationName: 'membrane-env-cli',
    integrationVersion: VERSION,
  })

  return cachedClient
}

export async function resolveSecret(reference: string): Promise<string> {
  const client = await getClient()
  return client.secrets.resolve(reference)
}

export interface ResolveSecretsResult {
  resolved: Map<string, string>
  errors: Map<string, string>
}

export async function resolveSecrets(references: string[]): Promise<ResolveSecretsResult> {
  const client = await getClient()

  const resolved = new Map<string, string>()
  const errors = new Map<string, string>()

  // Resolve each secret individually to capture per-reference errors
  for (const ref of references) {
    try {
      const value = await client.secrets.resolve(ref)
      resolved.set(ref, value)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      errors.set(ref, msg)
    }
  }

  return { resolved, errors }
}

export async function listVaults(): Promise<{ id: string; title: string }[]> {
  const client = await getClient()
  const vaults = await client.vaults.list(undefined)
  return vaults.map((v) => ({ id: v.id, title: v.title }))
}

export async function verifyAuth(): Promise<{ success: boolean; error?: string }> {
  try {
    await listVaults()
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: message }
  }
}

export function clearClient(): void {
  cachedClient = null
}
