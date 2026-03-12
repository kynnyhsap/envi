import { loadOnePasswordE2EConfig } from './onepassword-e2e'

interface RateLimitRow {
  action: 'read' | 'write' | 'unknown'
  period: 'hourly' | 'daily' | 'unknown'
  limit?: number
  remaining?: number
}

const MIN_HOURLY_READ = numberEnv('ENVI_1PASSWORD_MIN_HOURLY_READ', 50)
const MIN_HOURLY_WRITE = numberEnv('ENVI_1PASSWORD_MIN_HOURLY_WRITE', 20)
const MIN_DAILY_REMAINING = numberEnv('ENVI_1PASSWORD_MIN_DAILY_REMAINING', 100)

const config = await loadOnePasswordE2EConfig()
if (!config) {
  console.error('[preflight] Missing ENVI_1PASSWORD_E2E_SERVICE_ACCOUNT_TOKEN')
  process.exit(1)
}

const ratelimit = await runOp(['service-account', 'ratelimit', '--format', 'json'], config.token)
const rows = extractRateLimitRows(ratelimit.stdout)

if (rows.length === 0) {
  console.warn('[preflight] Could not parse structured rate limit rows; continuing without hard threshold checks')
  console.warn(ratelimit.stdout.trim())
  process.exit(0)
}

const hourlyRead = rows.find((row) => row.period === 'hourly' && row.action === 'read')
const hourlyWrite = rows.find((row) => row.period === 'hourly' && row.action === 'write')
const daily = rows.find((row) => row.period === 'daily')

const checks = [
  {
    label: 'hourly read remaining',
    row: hourlyRead,
    min: MIN_HOURLY_READ,
  },
  {
    label: 'hourly write remaining',
    row: hourlyWrite,
    min: MIN_HOURLY_WRITE,
  },
  {
    label: 'daily remaining',
    row: daily,
    min: MIN_DAILY_REMAINING,
  },
]

let hasFailure = false
for (const check of checks) {
  if (!check.row || typeof check.row.remaining !== 'number') {
    console.warn(`[preflight] Missing ${check.label} in parsed output; skipping this check`)
    continue
  }

  const status = check.row.remaining >= check.min ? 'ok' : 'low'
  console.info(
    `[preflight] ${check.label}: ${check.row.remaining}/${check.row.limit ?? '?'} (min ${check.min}) -> ${status}`,
  )

  if (status === 'low') {
    hasFailure = true
  }
}

if (hasFailure) {
  console.error('[preflight] Not enough 1Password rate-limit budget for stable live E2E run')
  console.error('[preflight] Check `op service-account ratelimit <id-or-name>` and retry later')
  process.exit(1)
}

console.info('[preflight] 1Password rate-limit budget looks healthy for live E2E')

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

async function runOp(args: string[], token: string): Promise<{ stdout: string; stderr: string }> {
  const proc = Bun.spawn(['op', ...args], {
    env: {
      ...process.env,
      OP_SERVICE_ACCOUNT_TOKEN: token,
      NO_COLOR: '1',
    } as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()

  if (exitCode !== 0) {
    console.error(`[preflight] op ${args.join(' ')} failed with code ${exitCode}`)
    console.error(stderr.trim() || stdout.trim())
    process.exit(1)
  }

  return { stdout, stderr }
}

function extractRateLimitRows(rawJson: string): RateLimitRow[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    return []
  }

  const objects = collectObjects(parsed)
  const rows: RateLimitRow[] = []

  for (const object of objects) {
    const row = toRateLimitRow(object)
    if (!row) continue
    rows.push(row)
  }

  return dedupeRows(rows)
}

function collectObjects(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectObjects(entry))
  }

  const object = asRecord(value)
  if (!object) return []

  const nested = Object.values(object).flatMap((entry) => collectObjects(entry))
  return [object, ...nested]
}

function toRateLimitRow(object: Record<string, unknown>): RateLimitRow | undefined {
  const loweredEntries = Object.entries(object).map(([key, value]) => [key.toLowerCase(), value] as const)

  const directAction = stringFromKeys(loweredEntries, ['action'])
  const directType = stringFromKeys(loweredEntries, ['type'])
  const textBlob = loweredEntries.map(([, value]) => (typeof value === 'string' ? value.toLowerCase() : '')).join(' ')

  const actionText = (directAction ?? textBlob).toLowerCase()
  const typeText = (directType ?? textBlob).toLowerCase()

  const action: RateLimitRow['action'] = actionText.includes('read')
    ? 'read'
    : actionText.includes('write')
      ? 'write'
      : 'unknown'

  const period: RateLimitRow['period'] = typeText.includes('token')
    ? 'hourly'
    : typeText.includes('account')
      ? 'daily'
      : textBlob.includes('hour')
        ? 'hourly'
        : textBlob.includes('day')
          ? 'daily'
          : 'unknown'

  const limit = numberFromKeys(loweredEntries, ['limit'])
  const remaining =
    numberFromKeys(loweredEntries, ['remaining']) ??
    computeRemaining(limit, numberFromKeys(loweredEntries, ['used', 'usage', 'consumed']))

  if (period === 'unknown' && action === 'unknown') return undefined
  if (limit === undefined && remaining === undefined) return undefined

  const row: RateLimitRow = { action, period }
  if (typeof limit === 'number') row.limit = limit
  if (typeof remaining === 'number') row.remaining = remaining
  return row
}

function numberFromKeys(entries: Array<readonly [string, unknown]>, keyFragments: string[]): number | undefined {
  for (const [key, value] of entries) {
    if (!keyFragments.some((fragment) => key.includes(fragment))) continue

    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/,/g, ''))
      if (Number.isFinite(parsed)) return parsed
    }
  }

  return undefined
}

function stringFromKeys(entries: Array<readonly [string, unknown]>, keyFragments: string[]): string | undefined {
  for (const [key, value] of entries) {
    if (!keyFragments.some((fragment) => key.includes(fragment))) continue
    if (typeof value === 'string' && value.length > 0) return value
  }

  return undefined
}

function computeRemaining(limit: number | undefined, used: number | undefined): number | undefined {
  if (limit === undefined || used === undefined) return undefined
  return Math.max(0, limit - used)
}

function dedupeRows(rows: RateLimitRow[]): RateLimitRow[] {
  const byKey = new Map<string, RateLimitRow>()

  for (const row of rows) {
    const key = `${row.period}:${row.action}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, row)
      continue
    }

    const existingScore = rowScore(existing)
    const candidateScore = rowScore(row)
    if (candidateScore > existingScore) {
      byKey.set(key, row)
    }
  }

  return [...byKey.values()]
}

function rowScore(row: RateLimitRow): number {
  let score = 0
  if (typeof row.limit === 'number') score += 1
  if (typeof row.remaining === 'number') score += 1
  if (row.action !== 'unknown') score += 1
  if (row.period !== 'unknown') score += 1
  return score
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
