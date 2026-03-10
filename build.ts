import { stat } from 'node:fs/promises'
import { relative } from 'node:path'
import pc from 'picocolors'

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
console.log('')
console.log(`${buildTag()} ${pc.cyan(`Starting ${targets.length} targets`)}`)

for (const target of targets) {
  await runBuild(target.name, target.config)
}

const overallMs = nanosecondsToMs(Bun.nanoseconds() - overallStart)
console.log('')
console.log(`${buildTag()} ${pc.green(`Completed in ${formatDuration(overallMs)}`)}`)
console.log('')

async function runBuild(name: BuildTarget, config: Bun.BuildConfig): Promise<void> {
  const startedAt = Bun.nanoseconds()
  console.log('')
  console.log(`${targetTag(name)} ${pc.yellow('Building...')}`)

  const result = await Bun.build(config)

  if (!result.success) {
    for (const log of result.logs) {
      const file = log.position?.file
      const line = log.position?.line
      const column = log.position?.column
      const location =
        file && line != null && column != null ? `${relative(process.cwd(), file)}:${line}:${column}` : ''

      const where = location ? ` ${pc.dim(location)}` : ''
      console.error(`${targetTag(name)}${where} ${pc.red(log.message)}`)
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
  const formattedOutputs = outputDetails.map((detail) => `  ${pc.dim('-')} ${detail}`).join('\n')

  console.log(`${targetTag(name)} ${pc.green(`Completed in ${formatDuration(elapsedMs)}`)}`)
  console.log(formattedOutputs)
}

function buildTag(): string {
  return pc.bold(pc.blue('[build]'))
}

function targetTag(name: BuildTarget): string {
  return pc.bold(pc.blue(`[build:${name}]`))
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
