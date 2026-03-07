import { createCommandContext, maybeWriteJsonResult, printIssuesAndExit } from './common'

interface ResolveCommandOptions {
  references: string[]
}

export async function resolveCommand(options: ResolveCommandOptions): Promise<void> {
  const { config, engine } = createCommandContext()
  const [firstReference = ''] = options.references
  const result = await engine.resolveSecret({ reference: firstReference, references: options.references })

  if (maybeWriteJsonResult(result, config.json)) return

  if (!result.ok) {
    printIssuesAndExit(result.issues, 'error')
  }

  const suffix = process.stdout.isTTY ? '\n' : ''
  const output =
    'results' in result.data ? result.data.results.map((entry) => entry.secret).join('\n') : result.data.secret
  process.stdout.write(`${output}${suffix}`)
}
