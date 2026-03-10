import { stat } from 'node:fs/promises'
import { relative } from 'node:path'

type BuildTarget = 'cli' | 'sdk'

const targets: Array<{ name: BuildTarget; config: Bun.BuildConfig }> = [
  {
    name: 'cli',
    config: {
      entrypoints: ['src/cli.ts'],
      outdir: 'dist',
      target: 'bun',
      format: 'esm',
      sourcemap: 'none',
      packages: 'external',
      splitting: true,
      minify: true,
      naming: {
        entry: 'cli.js',
        chunk: '[name]-[hash].js',
        asset: '[name]-[hash].[ext]',
      },
    },
  },
  {
    name: 'sdk',
    config: {
      entrypoints: ['src/sdk/index.ts'],
      outdir: 'dist/sdk',
      target: 'node',
      format: 'esm',
      sourcemap: 'none',
      packages: 'external',
    },
  },
]

const overallStart = Bun.nanoseconds()
console.log(`[build] Starting ${targets.length} targets`)

for (const target of targets) {
  await runBuild(target.name, target.config)
}

const overallMs = nanosecondsToMs(Bun.nanoseconds() - overallStart)
console.log(`[build] Completed in ${formatDuration(overallMs)}`)

async function runBuild(name: BuildTarget, config: Bun.BuildConfig): Promise<void> {
  const startedAt = Bun.nanoseconds()
  console.log(`[build:${name}] Building...`)

  const result = await Bun.build(config)

  if (!result.success) {
    for (const log of result.logs) {
      const file = log.position?.file
      const line = log.position?.line
      const column = log.position?.column
      const location =
        file && line != null && column != null ? `${relative(process.cwd(), file)}:${line}:${column}` : ''

      console.error(`[build:${name}]${location ? ` ${location}` : ''} ${log.message}`)
    }

    throw new Error(`Build failed: ${name}`)
  }

  const outputDetails = await Promise.all(
    result.outputs.map(async (output) => {
      const outputPath = relative(process.cwd(), output.path)
      const outputSize = await readFileSize(output.path)
      return `${outputPath} (${formatBytes(outputSize)})`
    }),
  )

  const elapsedMs = nanosecondsToMs(Bun.nanoseconds() - startedAt)
  console.log(`[build:${name}] Completed in ${formatDuration(elapsedMs)}: ${outputDetails.join(', ')}`)
}

function nanosecondsToMs(nanoseconds: number): number {
  return nanoseconds / 1_000_000
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

async function readFileSize(path: string): Promise<number> {
  const fileStats = await stat(path)
  return fileStats.size
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
