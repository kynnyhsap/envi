import path from 'node:path'
import { getConfig } from '../config'

export interface EnvPathInfo {
  name: string
  dir: string
  templatePath: string
  envPath: string
  backupDir: string
}

export function getRootDir(): string {
  return process.cwd()
}

export function resolveEnvPath(envDir: string): EnvPathInfo {
  const config = getConfig()
  const rootDir = getRootDir()
  const absoluteDir = path.resolve(rootDir, envDir)

  return {
    name: envDir,
    dir: absoluteDir,
    templatePath: path.join(absoluteDir, config.templateFile),
    envPath: path.join(absoluteDir, config.outputFile),
    backupDir: path.join(rootDir, config.backupDir, envDir),
  }
}

export function resolveAllEnvPaths(): EnvPathInfo[] {
  const config = getConfig()
  return config.paths.map(resolveEnvPath)
}

export function getBackupRootDir(): string {
  const config = getConfig()
  return path.join(getRootDir(), config.backupDir)
}
