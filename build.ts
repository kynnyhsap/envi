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
    },
  },
]

for (const target of targets) {
  await runBuild(target.name, target.config)
}

async function runBuild(name: BuildTarget, config: Bun.BuildConfig): Promise<void> {
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

  const outputPaths = result.outputs.map((output) => relative(process.cwd(), output.path))

  console.log(`[build:${name}] ${outputPaths.join(', ')}`)
}
