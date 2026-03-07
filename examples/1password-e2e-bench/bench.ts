import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

type ResolveMode = 'sequential' | 'batch'

interface Scenario {
  name: string
  args: string[]
}

interface Stats {
  min: number
  p50: number
  p95: number
  avg: number
  max: number
}

const APP_COUNT = parseIntEnv('ENVI_BENCH_APP_COUNT', 40)
const ITERATIONS = parseIntEnv('ENVI_BENCH_ITERATIONS', 5)
const WARMUP = parseIntEnv('ENVI_BENCH_WARMUP', 1)

const exampleDir = import.meta.dir
const repoRoot = path.resolve(exampleDir, '..', '..')
const cliPath = path.join(repoRoot, 'src', 'cli.ts')
const configPath = path.join(exampleDir, 'envi.json')
const baseTemplatePath = path.join(exampleDir, 'template', '.env.example')

const scenarios: Scenario[] = [
  { name: 'sync (dry-run)', args: ['sync', '-f', '-d', '--no-backup'] },
  { name: 'diff', args: ['diff'] },
  { name: 'run (resolve only)', args: ['run', '--', '/usr/bin/true'] },
]

async function main() {
  if (!process.env['OP_SERVICE_ACCOUNT_TOKEN']) {
    console.error('Missing OP_SERVICE_ACCOUNT_TOKEN')
    console.error('Export your service account token and rerun the benchmark.')
    process.exit(1)
  }

  const workspaceDir = await prepareWorkspace()

  try {
    console.info('Envi E2E vault benchmark')
    console.info(`Workspace: ${workspaceDir}`)
    console.info(`App count: ${APP_COUNT}`)
    console.info(`Iterations: ${ITERATIONS} (+${WARMUP} warmup)`)

    for (const scenario of scenarios) {
      const sequential = await runMode(workspaceDir, scenario, 'sequential')
      const batch = await runMode(workspaceDir, scenario, 'batch')

      const sequentialStats = summarize(sequential)
      const batchStats = summarize(batch)
      const speedup = sequentialStats.avg / batchStats.avg

      console.info('')
      console.info(`Scenario: ${scenario.name}`)
      console.info(
        `  sequential  avg ${formatMs(sequentialStats.avg)}  p50 ${formatMs(sequentialStats.p50)}  p95 ${formatMs(sequentialStats.p95)}`,
      )
      console.info(
        `  batch       avg ${formatMs(batchStats.avg)}  p50 ${formatMs(batchStats.p50)}  p95 ${formatMs(batchStats.p95)}`,
      )
      console.info(`  speedup     ${speedup.toFixed(2)}x`)
    }
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}

async function prepareWorkspace(): Promise<string> {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), 'envi-bench-'))
  await mkdir(workspaceDir, { recursive: true })

  const configText = await Bun.file(configPath).text()
  await Bun.write(path.join(workspaceDir, 'envi.json'), configText)

  const baseTemplate = await Bun.file(baseTemplatePath).text()
  for (let i = 1; i <= APP_COUNT; i++) {
    const appName = `app-${String(i).padStart(3, '0')}`
    const appDir = path.join(workspaceDir, 'apps', appName)
    await mkdir(appDir, { recursive: true })

    const template = [
      `# generated benchmark template`,
      `APP_NAME=${appName}`,
      `APP_PORT=${4100 + i}`,
      '',
      baseTemplate,
    ].join('\n')

    await Bun.write(path.join(appDir, '.env.example'), template)
  }

  return workspaceDir
}

async function runMode(workspaceDir: string, scenario: Scenario, mode: ResolveMode): Promise<number[]> {
  for (let i = 0; i < WARMUP; i++) {
    await runCli(workspaceDir, scenario, mode)
  }

  const durations: number[] = []
  for (let i = 0; i < ITERATIONS; i++) {
    durations.push(await runCli(workspaceDir, scenario, mode))
  }
  return durations
}

async function runCli(workspaceDir: string, scenario: Scenario, mode: ResolveMode): Promise<number> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>
  env['NO_COLOR'] = '1'

  const command = [
    'bun',
    'run',
    cliPath,
    '--config',
    'envi.json',
    '--json',
    '--provider-opt',
    `resolveMode=${mode}`,
    ...scenario.args,
  ]

  const startedAt = performance.now()
  const proc = Bun.spawn(command, {
    cwd: workspaceDir,
    env,
    stdout: 'ignore',
    stderr: 'pipe',
  })

  const exitCode = await proc.exited
  const durationMs = performance.now() - startedAt

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`Benchmark command failed (${mode}, ${scenario.name}): ${stderr}`)
  }

  return durationMs
}

function summarize(values: number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b)
  const sum = values.reduce((acc, value) => acc + value, 0)

  return {
    min: sorted[0]!,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    avg: sum / values.length,
    max: sorted[sorted.length - 1]!,
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p))
  return sorted[index]!
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${ms.toFixed(1)}ms`
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error)
  console.error(msg)
  process.exit(1)
})
