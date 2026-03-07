import { mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'

import type { FileStat, RuntimeAdapter } from './contracts'

function getBun(): typeof Bun {
  const bun = (globalThis as any).Bun as typeof Bun | undefined
  if (!bun) {
    throw new Error('Bun runtime not available')
  }
  return bun
}

function toFileStat(stat: any): FileStat {
  const mtimeMs =
    typeof stat?.mtimeMs === 'number' ? stat.mtimeMs : stat?.mtime instanceof Date ? stat.mtime.getTime() : Date.now()

  return {
    size: typeof stat?.size === 'number' ? stat.size : 0,
    mtimeMs,
  }
}

export function createBunRuntimeAdapter(): RuntimeAdapter {
  const bun = getBun()

  return {
    cwd() {
      return process.cwd()
    },

    async exists(filePath: string) {
      try {
        await bun.file(filePath).stat()
        return true
      } catch {
        return false
      }
    },

    async readText(filePath: string) {
      return bun.file(filePath).text()
    },

    async writeText(filePath: string, content: string) {
      await bun.write(filePath, content)
    },

    async mkdirp(dirPath: string) {
      await mkdir(dirPath, { recursive: true })
    },

    async renamePath(fromPath: string, toPath: string) {
      await rename(fromPath, toPath)
    },

    async removePath(targetPath: string) {
      await rm(targetPath, { recursive: true, force: true })
    },

    async stat(filePath: string) {
      try {
        const stat = await bun.file(filePath).stat()
        return toFileStat(stat)
      } catch {
        return null
      }
    },

    async listDirs(dirPath: string) {
      const out: string[] = []
      const glob = new bun.Glob('*')

      try {
        const stat = await bun.file(dirPath).stat()
        const isDir = typeof (stat as any)?.isDirectory === 'function' ? (stat as any).isDirectory() : false
        if (!isDir) return []
      } catch {
        return []
      }

      try {
        for await (const entry of glob.scan({ cwd: dirPath, onlyFiles: false })) {
          const fullPath = path.join(dirPath, entry)
          try {
            const stat = await bun.file(fullPath).stat()
            const isDir = typeof (stat as any)?.isDirectory === 'function' ? (stat as any).isDirectory() : false
            if (isDir) out.push(entry)
          } catch {
            // ignore
          }
        }
      } catch {
        return []
      }

      return out.sort((a, b) => a.localeCompare(b))
    },

    async findTemplateFiles(rootDir: string, templateFile: string, backupDir: string) {
      const matches: string[] = []
      const glob = new bun.Glob(`**/${templateFile}`)

      for await (const entry of glob.scan({ cwd: rootDir, dot: true, onlyFiles: true })) {
        const rel = String(entry).replace(/\\/g, '/')
        const parts = rel.split('/')

        if (parts.includes('node_modules')) continue
        if (rel === backupDir || rel.startsWith(`${backupDir}/`)) continue

        matches.push(rel)
      }

      return matches.sort((a, b) => a.localeCompare(b))
    },

    async findFilesNamed(rootDir: string, fileName: string, excludeDirs: string[] = []) {
      const matches: string[] = []
      const glob = new bun.Glob(`**/${fileName}`)

      for await (const entry of glob.scan({ cwd: rootDir, dot: true, onlyFiles: true })) {
        const rel = String(entry).replace(/\\/g, '/')
        const parts = rel.split('/')

        if (parts.includes('node_modules')) continue
        if (excludeDirs.some((dir) => rel === dir || rel.startsWith(`${dir}/`))) continue

        matches.push(rel)
      }

      return matches.sort((a, b) => a.localeCompare(b))
    },

    async findFilesWithPrefix(rootDir: string, prefix: string, excludeDirs: string[] = []) {
      const matches: string[] = []
      const glob = new bun.Glob(`**/${prefix}*`)

      for await (const entry of glob.scan({ cwd: rootDir, dot: true, onlyFiles: true })) {
        const rel = String(entry).replace(/\\/g, '/')
        const parts = rel.split('/')

        if (parts.includes('node_modules')) continue
        if (excludeDirs.some((dir) => rel === dir || rel.startsWith(`${dir}/`))) continue
        if (!path.basename(rel).startsWith(prefix)) continue

        matches.push(rel)
      }

      return matches.sort((a, b) => a.localeCompare(b))
    },
  }
}
