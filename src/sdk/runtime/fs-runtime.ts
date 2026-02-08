import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
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
      if (entry.name === 'node_modules') continue
      if (normalized === backupRoot || normalized.startsWith(`${backupRoot}/`)) continue
      await walkForTemplateFiles(absolutePath, templateFile, backupRoot, out)
      continue
    }

    if (entry.isFile() && entry.name === templateFile) {
      out.push(absolutePath)
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
  }
}
