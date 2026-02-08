import { createBunRuntimeAdapter } from './bun'
import type { RuntimeAdapter } from './contracts'
import { createNodeRuntimeAdapter } from './node'

export type DetectedRuntime = 'bun' | 'node'

export function detectRuntime(): DetectedRuntime {
  const versions = process.versions as any
  return versions && typeof versions.bun === 'string' ? 'bun' : 'node'
}

export function createRuntimeAdapter(): RuntimeAdapter {
  return detectRuntime() === 'bun' ? createBunRuntimeAdapter() : createNodeRuntimeAdapter()
}
