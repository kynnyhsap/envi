import { computeChanges } from '../../utils/diff'
import { parseEnvFile } from '../../utils/parse'
import type { Change, EnvFile } from '../../utils/types'
import { makeEnvelope } from '../json'
import { resolveAllEnvPaths, resolveEnvPath } from '../paths'
import type { DiffData, DiffOperationOptions, DiffPathData, DiffResult, ExecutionContext, Issue } from '../types'
import { checkProviderReady } from './provider-check'
import { redactChanges } from './redact'
import { injectResolvedSecrets } from './resolve-secrets'

async function diffOne(
  ctx: ExecutionContext,
  pathInfo: DiffPathData['pathInfo'],
  options: { includeSecrets: boolean },
): Promise<DiffPathData> {
  const hasTemplate = await ctx.runtime.exists(pathInfo.templatePath)
  const hasEnv = await ctx.runtime.exists(pathInfo.envPath)

  if (!hasTemplate) {
    return { pathInfo, hasTemplate: false, hasEnv, changes: [] }
  }

  const template: EnvFile = parseEnvFile(await ctx.runtime.readText(pathInfo.templatePath))
  const { injected, issues } = await injectResolvedSecrets({
    template,
    environment: ctx.options.environment,
    provider: ctx.provider,
  })

  if (!injected) {
    const msg = issues.map((i) => i.message).join('; ')
    return { pathInfo, hasTemplate: true, hasEnv, changes: [], error: msg || 'Failed to resolve secrets' }
  }

  const local = hasEnv ? parseEnvFile(await ctx.runtime.readText(pathInfo.envPath)) : null
  const changes: Change[] = computeChanges(template, injected, local)

  return { pathInfo, hasTemplate: true, hasEnv, changes: options.includeSecrets ? changes : redactChanges(changes) }
}

export async function diffOperation(ctx: ExecutionContext, options: DiffOperationOptions = {}): Promise<DiffResult> {
  const includeSecrets = options.includeSecrets ?? false
  const prereq = await checkProviderReady(ctx)
  if (!prereq.ok) {
    return makeEnvelope({
      command: 'diff',
      ok: false,
      data: {
        paths: [],
        summary: { new: 0, updated: 0, localModified: 0, unchanged: 0, hasAnyChanges: false },
      },
      issues: prereq.issues,
      options: ctx.options,
      providerId: ctx.provider.id,
    })
  }

  const envPaths = options.path
    ? [resolveEnvPath(options.path, ctx.options, ctx.runtime)]
    : await resolveAllEnvPaths(ctx.options, ctx.runtime)

  const paths: DiffPathData[] = []
  let totalNew = 0
  let totalUpdated = 0
  let totalLocalModified = 0
  let totalUnchanged = 0
  let hasAnyChanges = false
  const issues: Issue[] = []

  for (const pathInfo of envPaths) {
    const result = await diffOne(ctx, pathInfo, { includeSecrets })
    paths.push(result)

    if (result.error) {
      issues.push({ code: 'DIFF_FAILED', message: result.error, path: pathInfo.envPath })
      hasAnyChanges = true
      continue
    }

    const newChanges = result.changes.filter((c) => c.type === 'new').length
    const updatedChanges = result.changes.filter((c) => c.type === 'updated').length
    const localModifiedChanges = result.changes.filter((c) => c.type === 'local_modified').length
    const unchangedChanges = result.changes.filter((c) => c.type === 'unchanged').length

    totalNew += newChanges
    totalUpdated += updatedChanges
    totalLocalModified += localModifiedChanges
    totalUnchanged += unchangedChanges

    if (newChanges > 0 || updatedChanges > 0 || localModifiedChanges > 0 || (!result.hasEnv && result.hasTemplate)) {
      hasAnyChanges = true
    }
  }

  const data: DiffData = {
    paths,
    summary: {
      new: totalNew,
      updated: totalUpdated,
      localModified: totalLocalModified,
      unchanged: totalUnchanged,
      hasAnyChanges,
    },
  }

  return makeEnvelope({
    command: 'diff',
    ok: issues.length === 0,
    data,
    issues,
    options: ctx.options,
    providerId: ctx.provider.id,
  })
}
