import path from 'node:path'

import { generateBackupTimestamp } from '../../app/config'
import { mapWithConcurrency } from '../../shared/concurrency'
import { computeChanges } from '../../shared/env/diff'
import { mergeEnvFiles } from '../../shared/env/merge'
import { parseEnvFile, serializeEnvFile } from '../../shared/env/parse'
import type { Change, EnvFile } from '../../shared/env/types'
import { makeEnvelope } from '../json'
import { resolveAllEnvPaths } from '../paths'
import type { ExecutionContext, Issue, SyncData, SyncOperationOptions, SyncPathData, SyncResult } from '../types'
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

  const rootDir = ctx.options.rootDir ? path.resolve(ctx.options.rootDir) : ctx.runtime.cwd()
  const timestamp = generateBackupTimestamp()
  const backupRoot = path.join(rootDir, ctx.options.backupDir, timestamp)

  await mapWithConcurrency(envFilePaths, getSyncPathConcurrency(), async (absoluteFile) => {
    const exists = await ctx.runtime.exists(absoluteFile)
    if (!exists) return

    const relative = path.relative(rootDir, absoluteFile)
    const backupPath = path.join(backupRoot, relative)
    const backupDirPath = path.dirname(backupPath)
    try {
      await ctx.runtime.mkdirp(backupDirPath)
      const content = await ctx.runtime.readText(absoluteFile)
      await ctx.runtime.writeText(backupPath, content)
    } catch {
      // Silent backup failure (matches previous auto-backup intent)
    }
  })
}

function countChanges(changes: Change[]) {
  return {
    newCount: changes.filter((c) => c.type === 'new').length,
    updatedCount: changes.filter((c) => c.type === 'updated').length,
    customCount: changes.filter((c) => c.type === 'local_modified' || c.type === 'custom').length,
    unchangedCount: changes.filter((c) => c.type === 'unchanged').length,
  }
}

async function confirmIfNeeded(
  ctx: ExecutionContext,
  args: {
    envSwitched: boolean
    fromEnv: string | undefined
    toEnv: string
    newCount: number
    updatedCount: number
  },
): Promise<{ confirmed: boolean; issue?: Issue }> {
  if (ctx.prompts?.confirm === undefined) {
    return {
      confirmed: false,
      issue: {
        code: 'PROMPT_REQUIRED',
        message: 'Confirmation required but no prompt adapter provided. Use force=true or provide prompts.confirm.',
      },
    }
  }

  if (args.envSwitched) {
    const msg = `Switch from ${args.fromEnv ?? 'unknown'} to ${args.toEnv}? All secrets will be updated.`
    const confirmed = await ctx.prompts.confirm(msg, true)
    return { confirmed }
  }

  if (args.updatedCount > 0 || args.newCount > 0) {
    let msg = ''
    if (args.updatedCount > 0 && args.newCount > 0) {
      msg = `${args.updatedCount} secrets will be updated and ${args.newCount} new vars added. Continue?`
    } else if (args.updatedCount > 0) {
      msg = `${args.updatedCount} secrets will be updated. Continue?`
    } else {
      msg = `${args.newCount} new vars will be added. Continue?`
    }

    const confirmed = await ctx.prompts.confirm(msg, true)
    return { confirmed }
  }

  return { confirmed: true }
}

async function processEnvPath(
  ctx: ExecutionContext,
  pathInfo: SyncPathData['pathInfo'],
  options: {
    force: boolean
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
  const counts = countChanges(rawChanges)

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

  if (!options.force) {
    const confirm = await confirmIfNeeded(ctx, {
      envSwitched,
      fromEnv: local?.sourceEnv,
      toEnv: currentEnv,
      newCount: counts.newCount,
      updatedCount: counts.updatedCount,
    })

    if (confirm.issue) issues.push(confirm.issue)
    if (!confirm.confirmed) {
      return {
        data: {
          pathInfo,
          success: false,
          skipped: true,
          changes,
          envSwitched,
          message: 'Skipped by user',
        },
        issues,
      }
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
  const force = options.force ?? false
  const dryRun = options.dryRun ?? false
  const noBackup = options.noBackup ?? false
  const includeSecrets = options.includeSecrets ?? false

  const prereq = await checkProviderReady(ctx)
  if (!prereq.ok) {
    return makeEnvelope({
      command: 'sync',
      ok: false,
      data: {
        options: { force, dryRun, noBackup },
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

  const canParallelize = force || dryRun
  const pathWork = canParallelize
    ? await mapWithConcurrency(envPaths, getSyncPathConcurrency(), async (pathInfo) =>
        processEnvPath(ctx, pathInfo, { force, dryRun, includeSecrets }),
      )
    : await mapWithConcurrency(envPaths, 1, async (pathInfo) =>
        processEnvPath(ctx, pathInfo, { force, dryRun, includeSecrets }),
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
    options: { force, dryRun, noBackup },
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
