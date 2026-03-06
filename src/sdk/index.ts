export { createEnviEngine } from './engine'
export { resolveRuntimeOptions } from './options'
export { stringifyEnvelope } from './json'

export { createBunRuntimeAdapter } from './runtime/bun'
export { createNodeRuntimeAdapter } from './runtime/node'
export { createRuntimeAdapter, detectRuntime, type DetectedRuntime } from './runtime/auto'

export {
  createProvider,
  SECRET_SCHEMES,
  isSecretReference,
  toNativeReference,
  parseSecretReference,
  validateSecretReferenceFormat,
} from '../providers'
export type { Provider, ProviderType, SecretReference, SecretReferenceValidationResult } from '../providers'

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
  ResolveSecretResult,
  RunResolveResult,
} from './types'
