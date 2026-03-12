import { computeChanges } from '../../shared/env/diff'
import { parseEnvFile } from '../../shared/env/parse'
import type { Change, EnvFile } from '../../shared/env/types'
import { makeEnvelope } from '../json'
import { resolveAllEnvPaths, resolveEnvPath } from '../paths'
import type { DiffData, DiffOperationOptions, DiffPathData, DiffResult, ExecutionContext, Issue } from '../types'
import { mapWithProgress, runStage } from './progress'
import { checkProviderReady } from './provider-check'
import { redactChanges } from './redact'
import { injectResolvedSecrets } from './resolve-secrets'
import { formatUnresolvedVariableGuidance, summarizeUnresolvedVariableIssues } from './unresolved-vars'

const DEFAULT_DIFF_PATH_CONCURRENCY = 8

function getDiffPathConcurrency(): number {
  const raw = Number(process.env['ENVI_DIFF_PATH_CONCURRENCY'])
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_DIFF_PATH_CONCURRENCY
  return Math.floor(raw)
}

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
    vars: ctx.options.vars,
    provider: ctx.provider,
  })

  if (!injected) {
    return {
      pathInfo,
      hasTemplate: true,
      hasEnv,
      changes: [],
      error: formatDiffResolutionError(issues),
      issues,
    }
  }

  const local = hasEnv ? parseEnvFile(await ctx.runtime.readText(pathInfo.envPath)) : null
  const changes: Change[] = computeChanges(template, injected, local)

  return { pathInfo, hasTemplate: true, hasEnv, changes: options.includeSecrets ? changes : redactChanges(changes) }
}

export async function diffOperation(ctx: ExecutionContext, options: DiffOperationOptions = {}): Promise<DiffResult> {
  const includeSecrets = options.includeSecrets ?? false

  const prereq = await runStage({
    progress: options.progress,
    command: 'diff',
    stage: 'auth',
    message: 'Checking provider availability and authentication',
    run: () => checkProviderReady(ctx),
  })
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

  const envPaths = await runStage({
    progress: options.progress,
    command: 'diff',
    stage: 'discover',
    message: 'Discovering configured template paths',
    run: async () =>
      options.path
        ? [resolveEnvPath(options.path, ctx.options, ctx.runtime)]
        : await resolveAllEnvPaths(ctx.options, ctx.runtime),
  })

  const paths: DiffPathData[] = []
  let totalNew = 0
  let totalUpdated = 0
  let totalLocalModified = 0
  let totalUnchanged = 0
  let hasAnyChanges = false
  const issues: Issue[] = []

  const results = await mapWithProgress({
    items: envPaths,
    concurrency: getDiffPathConcurrency(),
    progress: options.progress,
    command: 'diff',
    stage: 'paths',
    map: (pathInfo) => diffOne(ctx, pathInfo, { includeSecrets }),
    message: 'Processed path',
    path: (pathInfo) => pathInfo.envPath,
  })

  for (const result of results) {
    paths.push(result)

    if (result.error) {
      if (result.issues && result.issues.length > 0) {
        for (const issue of result.issues) {
          issues.push({
            ...issue,
            path: issue.path ?? result.pathInfo.envPath,
          })
        }
      } else {
        issues.push({ code: 'DIFF_FAILED', message: result.error, path: result.pathInfo.envPath })
      }
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

function formatDiffResolutionError(issues: Issue[]): string {
  if (issues.length === 0) {
    return 'Failed to resolve secrets'
  }

  const unresolved = summarizeUnresolvedVariableIssues(issues)
  if (unresolved.unresolved.length === issues.length) {
    const guidance = formatUnresolvedVariableGuidance({ issues, includeAffectedKeys: true })
    if (guidance) return guidance
  }

  return issues.map((issue) => issue.message).join('; ')
}
