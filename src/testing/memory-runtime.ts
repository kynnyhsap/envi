import type { RuntimeAdapter } from '../sdk/runtime/contracts'

export function createMemoryRuntime(args: {
  cwd: string
  files: Record<string, string>
  templateMatches: string[]
}): RuntimeAdapter {
  const store = new Map(Object.entries(args.files))

  return {
    cwd() {
      return args.cwd
    },
    async exists(filePath: string) {
      return store.has(filePath)
    },
    async readText(filePath: string) {
      const value = store.get(filePath)
      if (value === undefined) throw new Error(`File not found: ${filePath}`)
      return value
    },
    async writeText(filePath: string, content: string) {
      store.set(filePath, content)
    },
    async mkdirp() {
      // no-op for memory
    },
    async renamePath() {
      // no-op for memory
    },
    async removePath() {
      // no-op for memory
    },
    async stat() {
      return null
    },
    async listDirs() {
      return []
    },
    async findTemplateFiles() {
      return args.templateMatches
    },
    async findFilesNamed() {
      return []
    },
    async findFilesWithPrefix() {
      return []
    },
  }
}
