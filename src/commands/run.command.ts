/**
 * Run command — execute a command with secrets injected as environment variables.
 *
 * Reads .env.example templates, resolves all secret references via the configured provider,
 * and passes the resolved key=value pairs as environment variables to the child process.
 *
 * Usage:
 *   envi run -- node index.js
 *   envi run --env-file .env.local -- node index.js
 *   envi run --no-template -- ./deploy.sh
 */

import pc from 'picocolors'

import { getConfig } from '../config'
import { getProvider } from '../config'
import { log } from '../logger'
import { isSecretReference, toNativeReference } from '../providers'
import {
  checkPrerequisites,
  parseEnvFile,
  resolveAllEnvPaths,
  substituteVariables,
  hasUnresolvedVariables,
} from '../utils'

interface RunOptions {
  /** Additional .env files to load (bare key=value, may contain secret refs) */
  envFile?: string[]
  /** Skip loading templates */
  noTemplate?: boolean
}

/**
 * Collect all environment variables from templates.
 * Returns a flat Map<key, value> with secrets resolved.
 */
async function resolveTemplateEnvVars(): Promise<Map<string, string> | null> {
  const config = getConfig()
  const env = config.environment
  const envPaths = resolveAllEnvPaths()
  const allVars = new Map<string, string>()

  for (const pathInfo of envPaths) {
    const templateFile = Bun.file(pathInfo.templatePath)
    if (!(await templateFile.exists())) continue

    const templateContent = await templateFile.text()
    const template = parseEnvFile(templateContent)

    // Separate secrets from plain values
    const secretRefs: { key: string; reference: string }[] = []

    for (const [key, envVar] of template.vars) {
      if (isSecretReference(envVar.value)) {
        const substituted = substituteVariables(envVar.value.trim(), env)

        if (hasUnresolvedVariables(substituted)) {
          log.fail(`Unresolved variable in ${key}: ${substituted}`)
          return null
        }

        secretRefs.push({ key, reference: substituted })
      } else {
        // Plain value — use directly
        allVars.set(key, envVar.value)
      }
    }

    if (secretRefs.length > 0) {
      const references = secretRefs.map((s) => s.reference)

      const provider = getProvider()

      const nativeRefs = references.map((ref) => toNativeReference(ref, provider.scheme))
      const { resolved, errors } = await provider.resolveSecrets(nativeRefs)

      if (errors.size > 0) {
        log.fail(`Failed to resolve ${errors.size} secret(s):`)
        for (let i = 0; i < secretRefs.length; i++) {
          const { key, reference } = secretRefs[i]!
          const nativeRef = nativeRefs[i]!
          const error = errors.get(nativeRef)
          if (error) {
            log.info(`    ${key}: ${reference}`)
            log.info(`    ${pc.dim(`Error: ${error}`)}`)
          }
        }
        return null
      }

      for (let i = 0; i < secretRefs.length; i++) {
        const { key } = secretRefs[i]!
        const nativeRef = nativeRefs[i]!
        const value = resolved.get(nativeRef)
        if (value !== undefined) {
          allVars.set(key, value)
        }
      }
    }
  }

  return allVars
}

/**
 * Load and resolve secrets from a raw .env file (may contain pass://, op://, envi:// refs).
 */
async function resolveEnvFile(filePath: string): Promise<Map<string, string> | null> {
  const config = getConfig()
  const env = config.environment
  const file = Bun.file(filePath)

  if (!(await file.exists())) {
    log.fail(`Env file not found: ${filePath}`)
    return null
  }

  const content = await file.text()
  const parsed = parseEnvFile(content)
  const vars = new Map<string, string>()

  const secretRefs: { key: string; reference: string }[] = []

  for (const [key, envVar] of parsed.vars) {
    if (isSecretReference(envVar.value)) {
      const substituted = substituteVariables(envVar.value.trim(), env)

      if (hasUnresolvedVariables(substituted)) {
        log.fail(`Unresolved variable in ${key}: ${substituted}`)
        return null
      }

      secretRefs.push({ key, reference: substituted })
    } else {
      vars.set(key, envVar.value)
    }
  }

  if (secretRefs.length > 0) {
    const references = secretRefs.map((s) => s.reference)
    const provider = getProvider()

    const nativeRefs = references.map((ref) => toNativeReference(ref, provider.scheme))
    const { resolved, errors } = await provider.resolveSecrets(nativeRefs)

    if (errors.size > 0) {
      log.fail(`Failed to resolve ${errors.size} secret(s) from ${filePath}:`)
      for (let i = 0; i < secretRefs.length; i++) {
        const { key, reference } = secretRefs[i]!
        const nativeRef = nativeRefs[i]!
        const error = errors.get(nativeRef)
        if (error) {
          log.info(`    ${key}: ${reference}`)
          log.info(`    ${pc.dim(`Error: ${error}`)}`)
        }
      }
      return null
    }

    for (let i = 0; i < secretRefs.length; i++) {
      const { key } = secretRefs[i]!
      const nativeRef = nativeRefs[i]!
      const value = resolved.get(nativeRef)
      if (value !== undefined) {
        vars.set(key, value)
      }
    }
  }

  return vars
}

export async function runCommand(command: string[], options: RunOptions = {}): Promise<void> {
  if (command.length === 0) {
    log.error('No command specified. Usage: envi run -- <command> [args...]')
    process.exit(1)
  }

  const config = getConfig()

  if (!config.quiet) {
    log.banner('Run')
    log.info(`  Environment: ${pc.cyan(config.environment)}`)
    log.info(`  Command: ${pc.cyan(command.join(' '))}`)
    log.info('')
  }

  // Auth check
  const prereqsOk = await checkPrerequisites({ quiet: config.quiet })
  if (!prereqsOk) {
    process.exit(1)
  }

  const envVars = new Map<string, string>()

  // 1. Load from templates (unless --no-template)
  if (!options.noTemplate) {
    if (!config.quiet) {
      log.info('  Resolving secrets from templates...')
    }
    const templateVars = await resolveTemplateEnvVars()
    if (!templateVars) {
      process.exit(1)
    }

    for (const [key, value] of templateVars) {
      envVars.set(key, value)
    }

    if (!config.quiet) {
      log.success(`Resolved ${templateVars.size} variable(s) from templates`)
    }
  }

  // 2. Load from --env-file (later files override earlier)
  if (options.envFile && options.envFile.length > 0) {
    for (const filePath of options.envFile) {
      if (!config.quiet) {
        log.info(`  Loading env file: ${pc.cyan(filePath)}`)
      }

      const fileVars = await resolveEnvFile(filePath)
      if (!fileVars) {
        process.exit(1)
      }

      for (const [key, value] of fileVars) {
        envVars.set(key, value)
      }

      if (!config.quiet) {
        log.success(`Loaded ${fileVars.size} variable(s) from ${filePath}`)
      }
    }
  }

  if (!config.quiet) {
    log.info('')
    log.info(`  Injecting ${pc.green(String(envVars.size))} variable(s) into environment`)
    log.info(`  Executing: ${pc.cyan(command.join(' '))}`)
    log.info('')
  }

  // 3. Build child process environment
  //    Start with current process env, overlay with resolved vars
  const childEnv: Record<string, string> = { ...process.env } as Record<string, string>
  for (const [key, value] of envVars) {
    childEnv[key] = value
  }

  // 4. Spawn the child process
  const [cmd, ...args] = command
  const proc = Bun.spawn([cmd!, ...args], {
    env: childEnv,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })

  // Forward signals to child
  const forwardSignal = (signal: NodeJS.Signals) => {
    proc.kill(signal === 'SIGINT' ? 2 : 15)
  }
  process.on('SIGINT', () => forwardSignal('SIGINT'))
  process.on('SIGTERM', () => forwardSignal('SIGTERM'))

  // Wait for child to exit
  const exitCode = await proc.exited
  process.exit(exitCode)
}
