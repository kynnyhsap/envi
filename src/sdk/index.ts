export { createEnviEngine } from './engine'
export { resolveRuntimeOptions } from './options'
export { stringifyEnvelope } from './json'

export { createBunRuntimeAdapter } from './runtime/bun'
export { createNodeRuntimeAdapter } from './runtime/node'
export { createRuntimeAdapter, detectRuntime, type DetectedRuntime } from './runtime/auto'

export {
  createProvider,
  VALID_PROVIDERS,
  SECRET_SCHEMES,
  isSecretReference,
  detectProvider,
  toNativeReference,
} from '../providers'
export type { Provider, ProviderType, SecretReference } from '../providers'

export type {
  EnviEngine,
  RuntimeOptions,
  RuntimeOptionsInput,
  Issue,
  JsonEnvelope,
  StatusResult,
  DiffResult,
  SyncResult,
  ValidateResult,
  RunResolveResult,
} from './types'
