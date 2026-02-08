import { isSecretReference } from '../../providers'
import { parseEnvFile } from '../../utils/parse'
import { makeEnvelope } from '../json'
import { resolveAllEnvPaths } from '../paths'
import type {
  ExecutionContext,
  Issue,
  ResolveRunEnvironmentOperationOptions,
  RunResolveData,
  RunResolveResult,
} from '../types'
import { checkProviderReady } from './provider-check'
import { injectResolvedSecrets, resolveEnvFileToKeyValue } from './resolve-secrets'

export async function resolveRunEnvironmentOperation(
  ctx: ExecutionContext,
  options: ResolveRunEnvironmentOperationOptions = {},
): Promise<RunResolveResult> {
  const envFile = options.envFile
  const noTemplate = options.noTemplate ?? false
  const includeSecrets = options.includeSecrets ?? false
  const issues: Issue[] = []

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
    const envPaths = await resolveAllEnvPaths(ctx.options, ctx.runtime)
    for (const pathInfo of envPaths) {
      const hasTemplate = await ctx.runtime.exists(pathInfo.templatePath)
      if (!hasTemplate) continue

      const template = parseEnvFile(await ctx.runtime.readText(pathInfo.templatePath))

      for (const [key, envVar] of template.vars) {
        if (isSecretReference(envVar.value)) secretKeys.add(key)
      }

      const injected = await injectResolvedSecrets({
        template,
        environment: ctx.options.environment,
        provider: ctx.provider,
      })

      if (!injected.injected) {
        issues.push(...injected.issues)
        continue
      }

      for (const [key, envVar] of injected.injected.vars) {
        envVars.set(key, envVar.value)
      }
    }
    templateVarsCount = envVars.size
  }

  if (envFile && envFile.length > 0) {
    for (const filePath of envFile) {
      const exists = await ctx.runtime.exists(filePath)
      if (!exists) {
        issues.push({ code: 'ENV_FILE_NOT_FOUND', message: `Env file not found: ${filePath}`, path: filePath })
        continue
      }

      const content = await ctx.runtime.readText(filePath)
      const resolved = await resolveEnvFileToKeyValue({
        content,
        environment: ctx.options.environment,
        provider: ctx.provider,
      })

      if (!resolved.vars) {
        issues.push(...resolved.issues.map((i) => ({ ...i, path: filePath })))
        continue
      }

      for (const key of resolved.secretKeys) {
        secretKeys.add(key)
      }

      for (const [key, value] of resolved.vars) {
        envVars.set(key, value)
      }
      envFileVarsCount += resolved.vars.size
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
