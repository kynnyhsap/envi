import pc from 'picocolors'

import { getConfig } from '../config'
import { getProvider } from '../config'
import { log } from '../logger'
import { isSecretReference, toNativeReference } from '../providers'
import {
  checkPrerequisites,
  parseEnvFile,
  computeChanges,
  resolveEnvPath,
  resolveAllEnvPaths,
  substituteVariables,
  hasUnresolvedVariables,
  type Change,
  type EnvPathInfo,
  type EnvFile,
} from '../utils'

interface DiffResult {
  pathInfo: EnvPathInfo
  hasTemplate: boolean
  hasEnv: boolean
  changes: Change[]
  error?: string
}

async function diffEnvPath(pathInfo: EnvPathInfo): Promise<DiffResult> {
  const config = getConfig()
  const env = config.environment

  const templateFile = Bun.file(pathInfo.templatePath)
  const outputFile = Bun.file(pathInfo.envPath)

  const hasTemplate = await templateFile.exists()
  const hasEnv = await outputFile.exists()

  if (!hasTemplate) {
    return { pathInfo, hasTemplate: false, hasEnv, changes: [] }
  }

  // Parse template
  const templateContent = await templateFile.text()
  const template = parseEnvFile(templateContent)

  // Resolve secrets using the configured provider
  let injected: EnvFile

  // Collect all secret references
  const secretRefs: { key: string; reference: string }[] = []
  for (const [key, envVar] of template.vars) {
    if (isSecretReference(envVar.value)) {
      const originalRef = envVar.value.trim()
      const substituted = substituteVariables(originalRef, env)

      if (hasUnresolvedVariables(substituted)) {
        return { pathInfo, hasTemplate, hasEnv, changes: [], error: `Unresolved variable in ${key}: ${substituted}` }
      }

      secretRefs.push({ key, reference: substituted })
    }
  }

  if (secretRefs.length === 0) {
    injected = template
  } else {
    const references = secretRefs.map((s) => s.reference)

    // Route to appropriate provider
    const provider = getProvider()

    const nativeRefs = references.map((ref) => toNativeReference(ref, provider.scheme))
    const { resolved, errors } = await provider.resolveSecrets(nativeRefs)

    if (errors.size > 0) {
      const failedRefs = secretRefs
        .filter((_, i) => errors.has(nativeRefs[i]!))
        .map((s) => `${s.key}: ${s.reference}`)
        .join(', ')
      return { pathInfo, hasTemplate, hasEnv, changes: [], error: `Failed to resolve: ${failedRefs}` }
    }

    const resolvedVars = new Map(template.vars)
    for (let i = 0; i < secretRefs.length; i++) {
      const { key } = secretRefs[i]!
      const nativeRef = nativeRefs[i]!
      const value = resolved.get(nativeRef)
      if (value !== undefined) {
        const existing = resolvedVars.get(key)!
        resolvedVars.set(key, { ...existing, value })
      }
    }

    injected = {
      vars: resolvedVars,
      order: template.order,
      trailingContent: template.trailingContent,
    }
  }

  // Parse local if exists
  const local = hasEnv ? parseEnvFile(await outputFile.text()) : null

  // Compute changes
  const changes = computeChanges(template, injected, local)

  return { pathInfo, hasTemplate, hasEnv, changes }
}

function maskValue(value: string, maxLen = 40): string {
  if (value.length <= 8) return value
  if (value.length <= maxLen) {
    return value.substring(0, 4) + '...' + value.substring(value.length - 4)
  }
  return value.substring(0, 4) + '...' + value.substring(value.length - 4)
}

function displayGitStyleDiff(changes: Change[], pathInfo: EnvPathInfo): void {
  // Group changes by type
  const newChanges = changes.filter((c) => c.type === 'new')
  const updatedChanges = changes.filter((c) => c.type === 'updated')
  const localModifiedChanges = changes.filter((c) => c.type === 'local_modified')
  const localOnlyChanges = changes.filter((c) => c.type === 'custom')

  // Only show diff if there are actual changes
  if (newChanges.length === 0 && updatedChanges.length === 0 && localModifiedChanges.length === 0) {
    return
  }

  log.diffHeader(pathInfo.envPath)

  // New vars (will be added)
  for (const change of newChanges) {
    log.diffAdd(`${change.key}=${maskValue(change.newValue || '')}`)
  }

  // Updated secrets
  for (const change of updatedChanges) {
    log.diffRemove(`${change.key}=${maskValue(change.localValue || '')}`)
    log.diffAdd(`${change.key}=${maskValue(change.newValue || '')}`)
  }

  // Local modifications (shown as context - they'll be preserved)
  for (const change of localModifiedChanges) {
    log.info(
      pc.blue(`~ ${change.key}=${maskValue(change.localValue || '')} ${pc.dim('(local modification, preserved)')}`),
    )
  }

  // Local-only vars (shown as context)
  if (localOnlyChanges.length > 0) {
    log.info('')
    log.info(pc.dim(`  # ${localOnlyChanges.length} local-only var(s) will be preserved`))
  }
}

export async function diffCommand(options: { path?: string }): Promise<void> {
  const config = getConfig()

  log.banner('Environment Diff')
  log.info(`  Environment: ${pc.cyan(config.environment)}`)

  const prereqsOk = await checkPrerequisites({ quiet: true })
  if (!prereqsOk) {
    process.exit(1)
  }

  const envPaths = options.path ? [resolveEnvPath(options.path)] : resolveAllEnvPaths()

  let totalNew = 0
  let totalUpdated = 0
  let totalLocalModified = 0
  let totalUnchanged = 0
  let hasAnyChanges = false

  for (const pathInfo of envPaths) {
    const result = await diffEnvPath(pathInfo)

    if (!result.hasTemplate) {
      log.skip(`${pathInfo.envPath} (no template)`)
      log.detail(`Template not found: ${pathInfo.templatePath}`)
      continue
    }

    if (result.error) {
      log.fail(`${pathInfo.envPath}: Failed to resolve secrets`)
      log.detail(result.error)
      continue
    }

    if (!result.hasEnv) {
      log.missing(`${pathInfo.envPath} not found`)
      log.detail(`Run ${pc.cyan('env-cli setup')} to create it`)
      totalNew += result.changes.filter((c) => c.type === 'new').length
      hasAnyChanges = true
      continue
    }

    const newChanges = result.changes.filter((c) => c.type === 'new')
    const updatedChanges = result.changes.filter((c) => c.type === 'updated')
    const localModifiedChanges = result.changes.filter((c) => c.type === 'local_modified')
    const localOnlyChanges = result.changes.filter((c) => c.type === 'custom')
    const unchangedChanges = result.changes.filter((c) => c.type === 'unchanged')

    totalNew += newChanges.length
    totalUpdated += updatedChanges.length
    totalLocalModified += localModifiedChanges.length
    totalUnchanged += unchangedChanges.length

    if (newChanges.length === 0 && updatedChanges.length === 0 && localModifiedChanges.length === 0) {
      log.synced(`${pathInfo.envPath}`)
      if (localOnlyChanges.length > 0) {
        log.detail(`${localOnlyChanges.length} local-only var(s)`)
      }
      continue
    }

    hasAnyChanges = true

    // Display git-style diff
    displayGitStyleDiff(result.changes, pathInfo)
  }

  // Summary
  log.banner('Summary')
  log.info('')

  if (!hasAnyChanges) {
    log.info(`  ${pc.green('All environments are in sync!')}`)
    if (totalLocalModified > 0) {
      log.info(`  ${pc.blue(`${totalLocalModified} local modification(s)`)} preserved`)
    }
  } else {
    log.info(
      `  ${pc.green(`${totalNew} new`)}, ` +
        `${pc.yellow(`${totalUpdated} updated`)}, ` +
        `${pc.blue(`${totalLocalModified} local mods`)}, ` +
        `${pc.dim(`${totalUnchanged} unchanged`)}`,
    )
    log.info('')
    log.info(`  Run ${pc.cyan('env-cli setup')} to apply changes`)
  }
  log.info('')
}
