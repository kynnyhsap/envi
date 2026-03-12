import { createOnePasswordE2EClient, loadOnePasswordE2EConfig } from './onepassword-e2e'

const LEGACY_PREFIX = 'envi-e2e-'
const SHARED_PREFIX = 'envi-e2e-live-'
const MAX_RETRIES = 6
const BASE_BACKOFF_MS = 750
const MAX_BACKOFF_MS = 10_000

const includeShared = Bun.argv.includes('--include-shared') || !Bun.argv.includes('--legacy-only')
const dryRun = Bun.argv.includes('--dry-run')
const strict = process.env['ENVI_E2E_CLEANUP_STRICT'] === 'true'

function countLabel(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`
}

const config = await loadOnePasswordE2EConfig()
if (!config) {
  console.info('[cleanup] skipped (missing ENVI_1PASSWORD_E2E_SERVICE_ACCOUNT_TOKEN)')
  process.exit(0)
}

const client = await createOnePasswordE2EClient(config.token)
const vaults = await withRetry('list vaults', () => client.vaults.list(undefined))
const candidates = vaults
  .filter((vault) => shouldDeleteVault(vault.title, includeShared))
  .map((vault) => ({ id: vault.id, title: vault.title }))

if (candidates.length === 0) {
  console.info('[cleanup] no matching test vaults found')
  process.exit(0)
}

console.info(`[cleanup] matched ${countLabel(candidates.length, 'vault')}`)

const failures: Array<{ title: string; error: string }> = []
for (const candidate of candidates) {
  if (dryRun) {
    console.info(`[cleanup] dry-run: would delete ${candidate.title}`)
    continue
  }

  try {
    await withRetry(`delete ${candidate.title}`, () => client.vaults.delete(candidate.id))
    console.info(`[cleanup] deleted ${candidate.title}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push({ title: candidate.title, error: message })
    console.error(`[cleanup] failed to delete ${candidate.title}: ${message}`)
  }
}

if (failures.length > 0) {
  console.error(`[cleanup] ${countLabel(failures.length, 'vault')} failed to delete`)
  if (strict) {
    process.exit(1)
  }
  process.exit(0)
}

console.info('[cleanup] complete')

function shouldDeleteVault(title: string, includeSharedVaults: boolean): boolean {
  if (!title.startsWith(LEGACY_PREFIX)) return false
  if (title.startsWith(SHARED_PREFIX)) return includeSharedVaults
  return true
}

async function withRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  let attempt = 0

  while (true) {
    try {
      return await operation()
    } catch (error) {
      if (!isRetryable(error) || attempt >= MAX_RETRIES) {
        throw error
      }

      attempt += 1
      const delayMs = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1))
      console.info(`[cleanup] retry ${attempt}/${MAX_RETRIES} for ${label} in ${delayMs}ms`)
      await Bun.sleep(delayMs)
    }
  }
}

function isRetryable(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    message.includes('rate limit exceeded') ||
    message.includes('gateway timeout') ||
    message.includes('timed out') ||
    message.includes('econnreset') ||
    message.includes('service unavailable')
  )
}
