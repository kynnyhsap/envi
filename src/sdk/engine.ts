import { createProvider } from '../providers'
import { diffOperation } from './operations/diff'
import { resolveRunEnvironmentOperation } from './operations/run-resolve'
import { statusOperation } from './operations/status'
import { syncOperation } from './operations/sync'
import { validateOperation } from './operations/validate'
import { resolveRuntimeOptions } from './options'
import { createRuntimeAdapter } from './runtime/auto'
import type { CreateEngineOptions, EnviEngine, ExecutionContext, RuntimeOptions } from './types'

function makeContext(args: {
  options: RuntimeOptions
  provider?: ExecutionContext['provider']
  runtime?: ExecutionContext['runtime']
  prompts?: ExecutionContext['prompts']
}): ExecutionContext {
  const provider = args.provider ?? createProvider(args.options.provider, args.options.providerOptions)
  const runtime = args.runtime ?? createRuntimeAdapter()
  const ctx: ExecutionContext = {
    options: args.options,
    provider,
    runtime,
  }
  if (args.prompts) {
    ctx.prompts = args.prompts
  }
  return ctx
}

export function createEnviEngine(opts: CreateEngineOptions = {}): EnviEngine {
  const input: Parameters<typeof resolveRuntimeOptions>[0] = {}
  if (opts.configFile) input.configFile = opts.configFile
  if (opts.options) input.overrides = opts.options
  const options = resolveRuntimeOptions(input)

  const ctxArgs: Parameters<typeof makeContext>[0] = { options }
  if (opts.provider) ctxArgs.provider = opts.provider
  if (opts.runtime) ctxArgs.runtime = opts.runtime
  if (opts.prompts) ctxArgs.prompts = opts.prompts
  const ctx = makeContext(ctxArgs)

  return {
    options: ctx.options,

    async status() {
      return statusOperation(ctx)
    },

    async diff(operationOptions) {
      return diffOperation(ctx, operationOptions)
    },

    async sync(operationOptions) {
      return syncOperation(ctx, operationOptions)
    },

    async validate(operationOptions) {
      return validateOperation(ctx, operationOptions)
    },

    async resolveRunEnvironment(operationOptions) {
      return resolveRunEnvironmentOperation(ctx, operationOptions)
    },
  }
}
