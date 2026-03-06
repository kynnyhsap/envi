import { getConfig } from '../config'
import { stringifyEnvelope } from '../sdk'
import { createCliEngine } from './engine'

interface ResolveCommandOptions {
  reference: string
}

export async function resolveCommand(options: ResolveCommandOptions): Promise<void> {
  const config = getConfig()
  const engine = createCliEngine()
  const result = await engine.resolveSecret({ reference: options.reference })

  if (config.json) {
    process.stdout.write(stringifyEnvelope(result))
    process.exitCode = result.ok ? 0 : 1
    return
  }

  if (!result.ok) {
    for (const issue of result.issues) {
      console.error(issue.message)
    }
    process.exit(1)
  }

  const suffix = process.stdout.isTTY ? '\n' : ''
  process.stdout.write(`${result.data.secret}${suffix}`)
}
