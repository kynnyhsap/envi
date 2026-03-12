import { isSecretReference } from '../../providers'
import { mapWithConcurrency } from '../../shared/concurrency'
import { parseEnvFile } from '../../shared/env/parse'
import { makeEnvelope } from '../json'
import { resolveAllEnvPaths } from '../paths'
import type {
  ExecutionContext,
  Issue,
  ResolveRunEnvironmentOperationOptions,
  RunResolveData,
  RunResolveResult,
} from '../types'
import { emitProgress } from './progress'
import { checkProviderReady } from './provider-check'
import { injectResolvedSecrets, resolveEnvFileToKeyValue } from './resolve-secrets'

const DEFAULT_RUN_RESOLVE_CONCURRENCY = 8

function getRunResolveConcurrency(): number {
  const raw = Number(process.env['ENVI_RUN_RESOLVE_CONCURRENCY'])
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_RUN_RESOLVE_CONCURRENCY
  return Math.floor(raw)
}

export async function resolveRunEnvironmentOperation(
  ctx: ExecutionContext,
  options: ResolveRunEnvironmentOperationOptions = {},
): Promise<RunResolveResult> {
  const envFile = options.envFile
  const noTemplate = options.noTemplate ?? false
  const includeSecrets = options.includeSecrets ?? false
  const issues: Issue[] = []

  await emitProgress(options.progress, {
    command: 'run.resolve',
    stage: 'auth',
    message: 'Checking provider availability and authentication',
  })

  const prereq = await checkProviderReady(ctx)
  if (!prereq.ok) {
    return makeEnvelope({
      command: 'run.resolve',
      ok: false,
      data: { env: {}, summary: { total: 0, templateVars: 0, envFileVars: 0 } },
      issues: prereq.issues,
      options: ctx.options,
      providerId: ctx.provider.id,
    })
  }

  const envVars = new Map<string, string>()
  const secretKeys = new Set<string>()
  let templateVarsCount = 0
  let envFileVarsCount = 0

  if (!noTemplate) {
    await emitProgress(options.progress, {
      command: 'run.resolve',
      stage: 'discover',
      message: 'Discovering configured template paths',
    })

    const envPaths = await resolveAllEnvPaths(ctx.options, ctx.runtime)
    let completedTemplatePaths = 0
    const templateResults = await mapWithConcurrency(envPaths, getRunResolveConcurrency(), async (pathInfo) => {
      const hasTemplate = await ctx.runtime.exists(pathInfo.templatePath)
      if (!hasTemplate) {
        completedTemplatePaths += 1
        await emitProgress(options.progress, {
          command: 'run.resolve',
          stage: 'templates',
          message: 'Processed template path',
          completed: completedTemplatePaths,
          total: envPaths.length,
          path: pathInfo.templatePath,
        })
        return {
          vars: null as Map<string, string> | null,
          secretKeys: new Set<string>(),
          issues: [] as Issue[],
        }
      }

      let template
      try {
        template = parseEnvFile(await ctx.runtime.readText(pathInfo.templatePath))
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        completedTemplatePaths += 1
        await emitProgress(options.progress, {
          command: 'run.resolve',
          stage: 'templates',
          message: 'Processed template path with issues',
          completed: completedTemplatePaths,
          total: envPaths.length,
          path: pathInfo.templatePath,
        })

        return {
          vars: null as Map<string, string> | null,
          secretKeys: new Set<string>(),
          issues: [{ code: 'TEMPLATE_READ_FAILED', message: msg, path: pathInfo.templatePath }] as Issue[],
        }
      }

      const pathSecretKeys = new Set<string>()
      for (const [key, envVar] of template.vars) {
        if (isSecretReference(envVar.value)) pathSecretKeys.add(key)
      }

      const injected = await injectResolvedSecrets({
        template,
        vars: ctx.options.vars,
        provider: ctx.provider,
      })

      if (!injected.injected) {
        completedTemplatePaths += 1
        await emitProgress(options.progress, {
          command: 'run.resolve',
          stage: 'templates',
          message: 'Processed template path with issues',
          completed: completedTemplatePaths,
          total: envPaths.length,
          path: pathInfo.templatePath,
        })

        return {
          vars: null as Map<string, string> | null,
          secretKeys: pathSecretKeys,
          issues: injected.issues,
        }
      }

      const vars = new Map<string, string>()
      for (const [key, envVar] of injected.injected.vars) {
        vars.set(key, envVar.value)
      }

      completedTemplatePaths += 1
      await emitProgress(options.progress, {
        command: 'run.resolve',
        stage: 'templates',
        message: 'Processed template path',
        completed: completedTemplatePaths,
        total: envPaths.length,
        path: pathInfo.templatePath,
      })

      return {
        vars,
        secretKeys: pathSecretKeys,
        issues: [] as Issue[],
      }
    })

    for (const result of templateResults) {
      issues.push(...result.issues)

      for (const key of result.secretKeys) {
        secretKeys.add(key)
      }

      if (!result.vars) continue
      for (const [key, value] of result.vars) {
        envVars.set(key, value)
      }
    }
    templateVarsCount = envVars.size
  }

  if (envFile && envFile.length > 0) {
    await emitProgress(options.progress, {
      command: 'run.resolve',
      stage: 'env-files',
      message: 'Resolving custom env-file inputs',
    })

    let completedEnvFiles = 0
    const envFileResults = await mapWithConcurrency(envFile, getRunResolveConcurrency(), async (filePath) => {
      const exists = await ctx.runtime.exists(filePath)
      if (!exists) {
        completedEnvFiles += 1
        await emitProgress(options.progress, {
          command: 'run.resolve',
          stage: 'env-files',
          message: 'Processed env file with issues',
          completed: completedEnvFiles,
          total: envFile.length,
          path: filePath,
        })

        return {
          vars: null as Map<string, string> | null,
          secretKeys: new Set<string>(),
          issues: [
            { code: 'ENV_FILE_NOT_FOUND', message: `Env file not found: ${filePath}`, path: filePath },
          ] as Issue[],
          varCount: 0,
        }
      }

      const content = await ctx.runtime.readText(filePath)
      const resolved = await resolveEnvFileToKeyValue({
        content,
        vars: ctx.options.vars,
        provider: ctx.provider,
      })

      if (!resolved.vars) {
        completedEnvFiles += 1
        await emitProgress(options.progress, {
          command: 'run.resolve',
          stage: 'env-files',
          message: 'Processed env file with issues',
          completed: completedEnvFiles,
          total: envFile.length,
          path: filePath,
        })

        return {
          vars: null as Map<string, string> | null,
          secretKeys: resolved.secretKeys,
          issues: resolved.issues.map((i) => ({ ...i, path: filePath })),
          varCount: 0,
        }
      }

      completedEnvFiles += 1
      await emitProgress(options.progress, {
        command: 'run.resolve',
        stage: 'env-files',
        message: 'Processed env file',
        completed: completedEnvFiles,
        total: envFile.length,
        path: filePath,
      })

      return {
        vars: resolved.vars,
        secretKeys: resolved.secretKeys,
        issues: [] as Issue[],
        varCount: resolved.vars.size,
      }
    })

    for (const result of envFileResults) {
      issues.push(...result.issues)

      for (const key of result.secretKeys) {
        secretKeys.add(key)
      }

      if (!result.vars) continue
      for (const [key, value] of result.vars) {
        envVars.set(key, value)
      }
      envFileVarsCount += result.varCount
    }
  }

  if (!includeSecrets) {
    for (const key of secretKeys) {
      if (envVars.has(key)) {
        envVars.set(key, '<redacted>')
      }
    }
  }

  const env = Object.fromEntries(Array.from(envVars.entries()).sort(([a], [b]) => a.localeCompare(b)))

  const data: RunResolveData = {
    env,
    summary: {
      total: Object.keys(env).length,
      templateVars: templateVarsCount,
      envFileVars: envFileVarsCount,
    },
  }

  return makeEnvelope({
    command: 'run.resolve',
    ok: issues.length === 0,
    data,
    issues,
    options: ctx.options,
    providerId: ctx.provider.id,
  })
}
