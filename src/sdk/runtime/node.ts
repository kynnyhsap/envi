import { createFsRuntimeAdapter } from './fs-runtime'

export function createNodeRuntimeAdapter() {
  return createFsRuntimeAdapter()
}
