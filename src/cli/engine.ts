import { select } from '@inquirer/prompts'

import { getConfig } from '../app/config'
import { createProvider } from '../providers'
import { createBunRuntimeAdapter, createEnviEngine } from '../sdk'
import { promptConfirm } from '../shared/helpers'

export function createCliEngine() {
  const config = getConfig()
  const provider = createProvider(config.providerOptions)
  const prompts = config.json
    ? undefined
    : {
        confirm: promptConfirm,
        select: (args: { message: string; choices: Array<{ name: string; value: string }> }) => select(args),
      }

  return createEnviEngine({
    options: {
      backupDir: config.backupDir,
      templateFile: config.templateFile,
      outputFile: config.outputFile,
      paths: config.paths,
      quiet: config.quiet,
      json: config.json,
      environment: config.environment,
      provider: config.provider,
      providerOptions: config.providerOptions,
    },
    provider,
    runtime: createBunRuntimeAdapter(),
    ...(prompts ? { prompts } : {}),
  })
}
