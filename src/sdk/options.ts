import { DEFAULT_BACKUP_DIR, DEFAULT_OUTPUT_FILE, DEFAULT_PROVIDER, DEFAULT_TEMPLATE_FILE } from '../app/config'
import type { ProviderType } from '../providers'
import { normalizeReferenceVars } from '../shared/env/variables'
import type { RuntimeOptions, RuntimeOptionsInput } from './types'

export function resolveRuntimeOptions(input: RuntimeOptionsInput = {}): RuntimeOptions {
  const defaults: RuntimeOptions = {
    backupDir: DEFAULT_BACKUP_DIR,
    templateFile: DEFAULT_TEMPLATE_FILE,
    outputFile: DEFAULT_OUTPUT_FILE,
    paths: [],
    quiet: false,
    json: false,
    vars: {},
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
    vars: normalizeReferenceVars({
      ...(defaults.vars ?? {}),
      ...((input.defaults ?? {}).vars ?? {}),
      ...((input.configFile ?? {}).vars ?? {}),
      ...((input.overrides ?? {}).vars ?? {}),
    }),
    paths: input.overrides?.paths ?? input.configFile?.paths ?? input.defaults?.paths ?? defaults.paths ?? [],
  }

  const provider = merged.provider as ProviderType
  if (provider !== '1password') {
    throw new Error(`Invalid provider: ${provider}. Envi only supports 1password.`)
  }
  merged.provider = provider

  return merged
}
