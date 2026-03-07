import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { FileStat, RuntimeAdapter } from './contracts'

async function listDirectories(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

async function walkForTemplateFiles(
  dirPath: string,
  templateFile: string,
  backupRoot: string,
  out: string[],
): Promise<void> {
  await walkForMatchingFiles(dirPath, {
    matchFile: (entryName) => entryName === templateFile,
    skipDir: (entryName, normalizedPath) =>
      entryName === 'node_modules' || normalizedPath === backupRoot || normalizedPath.startsWith(`${backupRoot}/`),
    out,
  })
}

async function walkForMatchingFiles(
  dirPath: string,
  args: {
    matchFile: (entryName: string) => boolean
    skipDir?: (entryName: string, normalizedPath: string) => boolean
    out: string[]
  },
): Promise<void> {
  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name)
    const normalized = absolutePath.replace(/\\/g, '/')

    if (entry.isDirectory()) {
      if (args.skipDir?.(entry.name, normalized)) continue
      await walkForMatchingFiles(absolutePath, args)
      continue
    }

    if (entry.isFile() && args.matchFile(entry.name)) {
      args.out.push(absolutePath)
    }
  }
}

async function getStat(filePath: string): Promise<FileStat | null> {
  try {
    const result = await stat(filePath)
    return {
      size: result.size,
      mtimeMs: result.mtimeMs,
    }
  } catch {
    return null
  }
}

export function createFsRuntimeAdapter(): RuntimeAdapter {
  return {
    cwd() {
      return process.cwd()
    },

    async exists(filePath: string) {
      const result = await getStat(filePath)
      return result !== null
    },

    async readText(filePath: string) {
      return readFile(filePath, 'utf8')
    },

    async writeText(filePath: string, content: string) {
      await writeFile(filePath, content, 'utf8')
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
      return getStat(filePath)
    },

    async listDirs(dirPath: string) {
      return listDirectories(dirPath)
    },

    async findTemplateFiles(rootDir: string, templateFile: string, backupDir: string) {
      const absoluteRoot = path.resolve(rootDir)
      const absoluteBackupRoot = path.resolve(absoluteRoot, backupDir).replace(/\\/g, '/')
      const matches: string[] = []

      await walkForTemplateFiles(absoluteRoot, templateFile, absoluteBackupRoot, matches)

      const relative = matches.map((match) => path.relative(absoluteRoot, match).replace(/\\/g, '/'))
      return relative.sort((a, b) => a.localeCompare(b))
    },

    async findFilesNamed(rootDir: string, fileName: string, excludeDirs: string[] = []) {
      const absoluteRoot = path.resolve(rootDir)
      const excluded = excludeDirs.map((dir) => path.resolve(absoluteRoot, dir).replace(/\\/g, '/'))
      const matches: string[] = []

      await walkForMatchingFiles(absoluteRoot, {
        matchFile: (entryName) => entryName === fileName,
        skipDir: (entryName, normalizedPath) => {
          if (entryName === 'node_modules') return true
          return excluded.some((dir) => normalizedPath === dir || normalizedPath.startsWith(`${dir}/`))
        },
        out: matches,
      })

      return matches
        .map((match) => path.relative(absoluteRoot, match).replace(/\\/g, '/'))
        .sort((a, b) => a.localeCompare(b))
    },

    async findFilesWithPrefix(rootDir: string, prefix: string, excludeDirs: string[] = []) {
      const absoluteRoot = path.resolve(rootDir)
      const excluded = excludeDirs.map((dir) => path.resolve(absoluteRoot, dir).replace(/\\/g, '/'))
      const matches: string[] = []

      await walkForMatchingFiles(absoluteRoot, {
        matchFile: (entryName) => entryName.startsWith(prefix),
        skipDir: (_entryName, normalizedPath) => {
          return excluded.some((dir) => normalizedPath === dir || normalizedPath.startsWith(`${dir}/`))
        },
        out: matches,
      })

      return matches
        .map((match) => path.relative(absoluteRoot, match).replace(/\\/g, '/'))
        .sort((a, b) => a.localeCompare(b))
    },
  }
}
