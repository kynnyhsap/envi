import { DEFAULT_BACKUP_DIR, DEFAULT_OUTPUT_FILE, DEFAULT_PROVIDER, DEFAULT_TEMPLATE_FILE } from '../config'
import { VALID_PROVIDERS, type ProviderType } from '../providers'
import { DEFAULT_ENVIRONMENT } from '../utils/variables'
import type { RuntimeOptions, RuntimeOptionsInput } from './types'

export function resolveRuntimeOptions(input: RuntimeOptionsInput = {}): RuntimeOptions {
  const defaults: RuntimeOptions = {
    backupDir: DEFAULT_BACKUP_DIR,
    templateFile: DEFAULT_TEMPLATE_FILE,
    outputFile: DEFAULT_OUTPUT_FILE,
    paths: [],
    quiet: false,
    json: false,
    environment: DEFAULT_ENVIRONMENT,
    provider: DEFAULT_PROVIDER,
    providerOptions: {},
  }

  const merged: RuntimeOptions = {
    ...defaults,
    ...(input.defaults ?? {}),
    ...(input.configFile ?? {}),
    ...(input.overrides ?? {}),
    providerOptions: {
      ...(defaults.providerOptions ?? {}),
      ...((input.defaults ?? {}).providerOptions ?? {}),
      ...((input.configFile ?? {}).providerOptions ?? {}),
      ...((input.overrides ?? {}).providerOptions ?? {}),
    },
    paths: input.overrides?.paths ?? input.configFile?.paths ?? input.defaults?.paths ?? defaults.paths ?? [],
  }

  const provider = merged.provider as ProviderType
  if (!VALID_PROVIDERS.includes(provider)) {
    throw new Error(`Invalid provider: ${provider}`)
  }
  merged.provider = provider

  return merged
}
