import { createCommandContext, maybeWriteJsonResult, printIssuesAndExit, withCommandProgress } from './common'

interface ResolveCommandOptions {
  references: string[]
}

export async function resolveCommand(options: ResolveCommandOptions): Promise<void> {
  const { config, engine } = createCommandContext()
  const [firstReference = ''] = options.references
  const result = await withCommandProgress({
    enabled: !config.json && !config.quiet,
    startMessage: 'Starting secret resolution...',
    run: (progress) =>
      engine.resolveSecret({
        reference: firstReference,
        references: options.references,
        progress,
      }),
  })

  if (maybeWriteJsonResult(result, config.json)) return

  if (!result.ok) {
    printIssuesAndExit(result.issues, 'error')
  }

  const suffix = process.stdout.isTTY ? '\n' : ''
  const output =
    'results' in result.data ? result.data.results.map((entry) => entry.secret).join('\n') : result.data.secret
  process.stdout.write(`${output}${suffix}`)
}
