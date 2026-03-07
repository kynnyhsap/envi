import path from 'node:path'

import { generateBackupTimestamp } from '../../app/config'
import { mapWithConcurrency } from '../../shared/concurrency'
import { computeChanges } from '../../shared/env/diff'
import { mergeEnvFiles } from '../../shared/env/merge'
import { parseEnvFile, serializeEnvFile } from '../../shared/env/parse'
import type { EnvFile } from '../../shared/env/types'
import { makeEnvelope } from '../json'
import { resolveAllEnvPaths } from '../paths'
import type { ExecutionContext, Issue, SyncData, SyncOperationOptions, SyncPathData, SyncResult } from '../types'
import { createLatestSnapshot } from './backup-helpers'
import { checkProviderReady } from './provider-check'
import { redactChanges } from './redact'
import { injectResolvedSecrets } from './resolve-secrets'

const DEFAULT_SYNC_PATH_CONCURRENCY = 8

function getSyncPathConcurrency(): number {
  const raw = Number(process.env['ENVI_SYNC_PATH_CONCURRENCY'])
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SYNC_PATH_CONCURRENCY
  return Math.floor(raw)
}

async function createAutoBackup(ctx: ExecutionContext, envFilePaths: string[]): Promise<void> {
  if (envFilePaths.length === 0) return

  const rootPrefix = `${ctx.runtime.cwd().replace(/\\/g, '/')}/`
  const existingRelativePaths: string[] = []
  for (const absoluteFile of envFilePaths) {
    if (await ctx.runtime.exists(absoluteFile)) {
      existingRelativePaths.push(absoluteFile.replace(/\\/g, '/').replace(rootPrefix, ''))
    }
  }

  try {
    await createLatestSnapshot(ctx, {
      id: generateBackupTimestamp(),
      createdAt: new Date().toISOString(),
      filePaths: existingRelativePaths,
    })
  } catch {
    // Silent backup failure (matches previous auto-backup intent)
  }
}

async function processEnvPath(
  ctx: ExecutionContext,
  pathInfo: SyncPathData['pathInfo'],
  options: {
    dryRun: boolean
    includeSecrets: boolean
  },
): Promise<{ data: SyncPathData; issues: Issue[] }> {
  const issues: Issue[] = []

  const hasTemplate = await ctx.runtime.exists(pathInfo.templatePath)
  if (!hasTemplate) {
    return {
      data: {
        pathInfo,
        success: false,
        skipped: true,
        changes: [],
        envSwitched: false,
        message: `Template not found: ${pathInfo.templatePath}`,
      },
      issues,
    }
  }

  let template: EnvFile
  try {
    template = parseEnvFile(await ctx.runtime.readText(pathInfo.templatePath))
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return {
      data: {
        pathInfo,
        success: false,
        skipped: false,
        changes: [],
        envSwitched: false,
        message: msg,
      },
      issues: [{ code: 'TEMPLATE_READ_FAILED', message: msg, path: pathInfo.templatePath }],
    }
  }

  const injectedResult = await injectResolvedSecrets({
    template,
    environment: ctx.options.environment,
    provider: ctx.provider,
  })

  if (!injectedResult.injected) {
    return {
      data: {
        pathInfo,
        success: false,
        skipped: false,
        changes: [],
        envSwitched: false,
        message: 'Failed to resolve secrets',
      },
      issues: injectedResult.issues,
    }
  }

  const hasEnv = await ctx.runtime.exists(pathInfo.envPath)
  const local = hasEnv ? parseEnvFile(await ctx.runtime.readText(pathInfo.envPath)) : null

  const currentEnv = ctx.options.environment
  const envSwitched = !!(local?.sourceEnv && local.sourceEnv !== currentEnv)

  const rawChanges = computeChanges(template, injectedResult.injected, local, envSwitched)
  const changes = options.includeSecrets ? rawChanges : redactChanges(rawChanges)
  if (options.dryRun) {
    return {
      data: {
        pathInfo,
        success: true,
        skipped: false,
        changes,
        envSwitched,
        message: 'Dry run - no changes written',
      },
      issues,
    }
  }

  try {
    const merged = mergeEnvFiles(template, injectedResult.injected, local, changes)
    const output = serializeEnvFile(merged, currentEnv)
    await ctx.runtime.mkdirp(path.dirname(pathInfo.envPath))
    await ctx.runtime.writeText(pathInfo.envPath, output)
    return {
      data: {
        pathInfo,
        success: true,
        skipped: false,
        changes,
        envSwitched,
      },
      issues,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    issues.push({ code: 'WRITE_FAILED', message: msg, path: pathInfo.envPath })
    return {
      data: {
        pathInfo,
        success: false,
        skipped: false,
        changes,
        envSwitched,
        message: msg,
      },
      issues,
    }
  }
}

export async function syncOperation(ctx: ExecutionContext, options: SyncOperationOptions = {}): Promise<SyncResult> {
  const dryRun = options.dryRun ?? false
  const noBackup = options.noBackup ?? false
  const includeSecrets = options.includeSecrets ?? false

  const prereq = await checkProviderReady(ctx)
  if (!prereq.ok) {
    return makeEnvelope({
      command: 'sync',
      ok: false,
      data: {
        options: { dryRun, noBackup },
        paths: [],
        summary: { success: 0, failed: 0, skipped: 0, new: 0, updated: 0, custom: 0 },
      },
      issues: prereq.issues,
      options: ctx.options,
      providerId: ctx.provider.id,
    })
  }

  const envPaths = await resolveAllEnvPaths(ctx.options, ctx.runtime)

  if (!dryRun && !noBackup) {
    await createAutoBackup(
      ctx,
      envPaths.map((p) => p.envPath),
    )
  }

  const pathResults: SyncPathData[] = []
  const issues: Issue[] = []
  let success = 0
  let failed = 0
  let skipped = 0
  let totalNew = 0
  let totalUpdated = 0
  let totalCustom = 0

  const canParallelize = true
  const pathWork = canParallelize
    ? await mapWithConcurrency(envPaths, getSyncPathConcurrency(), async (pathInfo) =>
        processEnvPath(ctx, pathInfo, { dryRun, includeSecrets }),
      )
    : await mapWithConcurrency(envPaths, 1, async (pathInfo) =>
        processEnvPath(ctx, pathInfo, { dryRun, includeSecrets }),
      )

  for (const result of pathWork) {
    pathResults.push(result.data)
    issues.push(...result.issues)

    if (result.data.skipped) {
      skipped++
      continue
    }

    if (result.data.success) {
      success++
      totalNew += result.data.changes.filter((c) => c.type === 'new').length
      totalUpdated += result.data.changes.filter((c) => c.type === 'updated').length
      totalCustom += result.data.changes.filter((c) => c.type === 'local_modified' || c.type === 'custom').length
    } else {
      failed++
    }
  }

  const data: SyncData = {
    options: { dryRun, noBackup },
    paths: pathResults,
    summary: {
      success,
      failed,
      skipped,
      new: totalNew,
      updated: totalUpdated,
      custom: totalCustom,
    },
  }

  return makeEnvelope({
    command: 'sync',
    ok:
      failed === 0 &&
      issues.filter((i) => i.code === 'SECRET_RESOLUTION_FAILED' || i.code === 'WRITE_FAILED').length === 0,
    data,
    issues,
    options: ctx.options,
    providerId: ctx.provider.id,
  })
}
