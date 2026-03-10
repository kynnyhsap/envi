import { getConfig } from '../app/config'
import { createProvider } from '../providers'
import { createEnviEngine, createRuntimeAdapter } from '../sdk'

export function createCliEngine() {
  const config = getConfig()
  const provider = createProvider(config.providerOptions)

  return createEnviEngine({
    options: {
      backupDir: config.backupDir,
      templateFile: config.templateFile,
      outputFile: config.outputFile,
      paths: config.paths,
      quiet: config.quiet,
      json: config.json,
      vars: config.vars,
      provider: config.provider,
      providerOptions: config.providerOptions,
    },
    provider,
    runtime: createRuntimeAdapter(),
  })
}
