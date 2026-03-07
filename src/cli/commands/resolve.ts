import { createCommandContext, maybeWriteJsonResult, printIssuesAndExit } from './common'

interface ResolveCommandOptions {
  reference: string
}

export async function resolveCommand(options: ResolveCommandOptions): Promise<void> {
  const { config, engine } = createCommandContext()
  const result = await engine.resolveSecret({ reference: options.reference })

  if (maybeWriteJsonResult(result, config.json)) return

  if (!result.ok) {
    printIssuesAndExit(result.issues, 'error')
  }

  const suffix = process.stdout.isTTY ? '\n' : ''
  process.stdout.write(`${result.data.secret}${suffix}`)
}
