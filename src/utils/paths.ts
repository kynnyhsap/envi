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

/**
 * Resolve all env paths to process.
 * If explicit paths are configured, use those.
 * Otherwise, auto-discover by scanning for template files.
 */
export function resolveAllEnvPaths(): EnvPathInfo[] {
  const config = getConfig()

  if (config.paths.length > 0) {
    return config.paths.map(resolveEnvPath)
  }

  return discoverEnvPaths()
}

/**
 * Auto-discover directories containing template files.
 * Scans from cwd for any file matching the configured template name,
 * excluding node_modules and backup directories.
 */
function discoverEnvPaths(): EnvPathInfo[] {
  const config = getConfig()
  const rootDir = getRootDir()
  const glob = new Bun.Glob(`**/${config.templateFile}`)
  const paths: EnvPathInfo[] = []

  for (const match of glob.scanSync({ cwd: rootDir, dot: true })) {
    // Skip node_modules and backup directories
    if (match.includes('node_modules/') || match.includes(config.backupDir + '/')) {
      continue
    }

    const dir = path.dirname(match)
    // Use '.' for templates in the root directory
    const envDir = dir === '.' ? '.' : dir

    paths.push({
      name: envDir,
      dir: path.resolve(rootDir, envDir),
      templatePath: path.join(rootDir, match),
      envPath: path.join(rootDir, envDir, config.outputFile),
      backupDir: path.join(rootDir, config.backupDir, envDir),
    })
  }

  // Sort for deterministic output
  paths.sort((a, b) => a.name.localeCompare(b.name))

  return paths
}

export function getBackupRootDir(): string {
  const config = getConfig()
  return path.join(getRootDir(), config.backupDir)
}
