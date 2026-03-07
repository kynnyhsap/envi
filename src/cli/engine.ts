import { getConfig, getProvider } from '../app/config'
import { createBunRuntimeAdapter, createEnviEngine } from '../sdk'
import { promptConfirm } from '../shared/helpers'

export function createCliEngine() {
  const config = getConfig()
  const provider = getProvider()

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
    prompts: {
      confirm: promptConfirm,
    },
  })
}
