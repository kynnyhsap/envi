import path from 'node:path'

import type { RuntimeAdapter } from './runtime/contracts'
import type { RuntimeOptions, EnvPathInfo } from './types'

export function getRootDir(options: RuntimeOptions, runtime: RuntimeAdapter): string {
  return options.rootDir ? path.resolve(options.rootDir) : runtime.cwd()
}

export function resolveEnvPath(envDir: string, options: RuntimeOptions, runtime: RuntimeAdapter): EnvPathInfo {
  const rootDir = getRootDir(options, runtime)
  const absoluteDir = path.resolve(rootDir, envDir)

  return {
    name: envDir,
    dir: absoluteDir,
    templatePath: path.join(absoluteDir, options.templateFile),
    envPath: path.join(absoluteDir, options.outputFile),
    backupDir: path.join(rootDir, options.backupDir, envDir),
  }
}

export async function resolveAllEnvPaths(options: RuntimeOptions, runtime: RuntimeAdapter): Promise<EnvPathInfo[]> {
  if (options.paths.length > 0) {
    return options.paths.map((p) => resolveEnvPath(p, options, runtime))
  }

  const rootDir = getRootDir(options, runtime)
  const matches = await runtime.findTemplateFiles(rootDir, options.templateFile, options.backupDir)

  const paths: EnvPathInfo[] = []
  for (const match of matches) {
    const dir = path.dirname(match)
    const envDir = dir === '.' ? '.' : dir
    paths.push({
      name: envDir,
      dir: path.resolve(rootDir, envDir),
      templatePath: path.join(rootDir, match),
      envPath: path.join(rootDir, envDir, options.outputFile),
      backupDir: path.join(rootDir, options.backupDir, envDir),
    })
  }

  paths.sort((a, b) => a.name.localeCompare(b.name))
  return paths
}
