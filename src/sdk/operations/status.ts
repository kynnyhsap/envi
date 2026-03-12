import { parseEnvFile } from '../../shared/env/parse'
import { makeEnvelope } from '../json'
import { resolveAllEnvPaths } from '../paths'
import type { ExecutionContext, StatusData, StatusOperationOptions, StatusResult, StatusPathData } from '../types'
import { listBackupSnapshots } from './backup-helpers'
import { mapWithProgress, runStage } from './progress'
import { getProviderReadiness } from './provider-check'
const DEFAULT_STATUS_PATH_CONCURRENCY = 8

function getStatusPathConcurrency(): number {
  const raw = Number(process.env['ENVI_STATUS_PATH_CONCURRENCY'])
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_STATUS_PATH_CONCURRENCY
  return Math.floor(raw)
}

async function getBackupInfo(ctx: ExecutionContext): Promise<{ count: number; latestTimestamp?: string }> {
  const snapshots = await listBackupSnapshots(ctx)
  if (snapshots.length === 0) return { count: 0 }
  const latestTimestamp = snapshots[0]?.timestamp
  if (!latestTimestamp) return { count: snapshots.length }
  return { count: snapshots.length, latestTimestamp }
}

async function getPathStatus(ctx: ExecutionContext, pathInfo: StatusPathData['pathInfo']): Promise<StatusPathData> {
  const hasTemplate = await ctx.runtime.exists(pathInfo.templatePath)
  const hasEnv = await ctx.runtime.exists(pathInfo.envPath)
  const hasBackup = await ctx.runtime.exists(pathInfo.backupDir)

  let templateVarCount = 0
  let envVarCount = 0
  let status: StatusPathData['status'] = 'no-template'

  if (hasTemplate) {
    const template = parseEnvFile(await ctx.runtime.readText(pathInfo.templatePath))
    templateVarCount = template.vars.size

    if (!hasEnv) {
      status = 'missing'
    } else {
      const env = parseEnvFile(await ctx.runtime.readText(pathInfo.envPath))
      envVarCount = env.vars.size

      let allPresent = true
      for (const key of template.order) {
        if (!env.vars.has(key)) {
          allPresent = false
          break
        }
      }
      status = allPresent ? 'synced' : 'outdated'
    }
  }

  return {
    pathInfo,
    hasTemplate,
    hasEnv,
    hasBackup,
    templateVarCount,
    envVarCount,
    status,
  }
}

export async function statusOperation(
  ctx: ExecutionContext,
  options: StatusOperationOptions = {},
): Promise<StatusResult> {
  const readiness = await runStage({
    progress: options.progress,
    command: 'status',
    stage: 'auth',
    message: 'Checking provider availability and authentication',
    run: () => getProviderReadiness(ctx),
  })
  const { availability, auth: authResult, authInfo, hints, issues } = readiness

  const envPaths = await runStage({
    progress: options.progress,
    command: 'status',
    stage: 'discover',
    message: 'Discovering configured template paths',
    run: () => resolveAllEnvPaths(ctx.options, ctx.runtime),
  })

  const statuses = await mapWithProgress({
    items: envPaths,
    concurrency: getStatusPathConcurrency(),
    progress: options.progress,
    command: 'status',
    stage: 'paths',
    map: (pathInfo) => getPathStatus(ctx, pathInfo),
    message: () => 'Scanned path status',
    path: (pathInfo) => pathInfo.envPath,
  })

  const backups = await runStage({
    progress: options.progress,
    command: 'status',
    stage: 'backups',
    message: 'Loading backup snapshot metadata',
    run: () => getBackupInfo(ctx),
  })

  const summary = {
    synced: statuses.filter((s) => s.status === 'synced').length,
    outdated: statuses.filter((s) => s.status === 'outdated').length,
    missing: statuses.filter((s) => s.status === 'missing').length,
    noTemplate: statuses.filter((s) => s.status === 'no-template').length,
  }

  const data: StatusData = {
    provider: {
      id: ctx.provider.id,
      name: ctx.provider.name,
      availability: {
        available: availability.available,
        statusLines: availability.statusLines ?? [],
        helpLines: availability.helpLines ?? [],
      },
      auth: {
        success: !!(availability.available && authResult.success),
        type: authInfo.type,
        identifier: authInfo.identifier,
        ...(authResult.error ? { error: authResult.error } : {}),
        hints: hints.lines,
      },
    },
    paths: statuses,
    backups,
    summary,
  }

  return makeEnvelope({
    command: 'status',
    ok: true,
    data,
    issues,
    options: ctx.options,
    providerId: ctx.provider.id,
  })
}
