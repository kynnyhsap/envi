import pc from 'picocolors'
import { Table } from 'console-table-printer'
import { log } from '../logger'
import { getConfig } from '../config'
import {
  checkPrerequisites,
  promptConfirm,
  truncateValue,
  redactSecret,
  parseEnvFile,
  serializeEnvFile,
  computeChanges,
  mergeEnvFiles,
  resolveAllEnvPaths,
  isSecretReference,
  substituteVariables,
  hasUnresolvedVariables,
  type Change,
  type EnvPathInfo,
  type EnvFile,
} from '../utils'
import { createAutoBackup } from './backup.command'
import { getDefaultProvider, detectProvider, getProvider, toNativeReference } from '../providers'

async function resolveTemplateSecrets(template: EnvFile): Promise<EnvFile | null> {
  const config = getConfig()
  const env = config.environment

  const secretRefs: { key: string; reference: string; originalRef: string }[] = []
  for (const [key, envVar] of template.vars) {
    if (isSecretReference(envVar.value)) {
      const originalRef = envVar.value.trim()
      // Substitute ${ENV} in the reference
      const substituted = substituteVariables(originalRef, env)

      // Check for unresolved variables
      if (hasUnresolvedVariables(substituted)) {
        log.fail(`Unresolved variable in ${key}: ${substituted}`)
        return null
      }

      secretRefs.push({ key, reference: substituted, originalRef })
    }
  }

  if (secretRefs.length === 0) {
    return template
  }

  const references = secretRefs.map((s) => s.reference)

  // Route references to appropriate provider
  const defaultProvider = getDefaultProvider()
  const provider = (() => {
    // Check the first reference to determine provider (all refs in a template should use same scheme)
    const firstRef = references[0]
    if (firstRef) {
      const providerId = detectProvider(firstRef)
      if (providerId) return getProvider(providerId)
    }
    return defaultProvider
  })()

  // Convert envi:// references to native format
  const nativeRefs = references.map((ref) => toNativeReference(ref, provider.scheme))
  const { resolved, errors } = await provider.resolveSecrets(nativeRefs)

  // Map native refs back to original refs for lookup
  const nativeToOriginal = new Map<string, string>()
  for (let i = 0; i < references.length; i++) {
    nativeToOriginal.set(nativeRefs[i]!, references[i]!)
  }

  // Report any errors with the specific references that failed
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

  return {
    vars: resolvedVars,
    order: template.order,
    trailingContent: template.trailingContent,
  }
}

function formatValue(value: string, isSecret: boolean): string {
  if (isSecret) {
    return redactSecret(value)
  }
  return truncateValue(value)
}

function isSecretValue(templateValue: string | undefined): boolean {
  if (!templateValue) return false
  return isSecretReference(templateValue)
}

function displayChanges(changes: Change[]): {
  newCount: number
  updateCount: number
  customCount: number
  unchangedCount: number
} {
  let newCount = 0
  let updateCount = 0
  let customCount = 0
  let unchangedCount = 0

  const templateChanges: { change: Change; status: 'NEW' | 'UPDATED' | 'UNCHANGED' }[] = []
  const customChanges: Change[] = []

  for (const change of changes) {
    switch (change.type) {
      case 'new':
        templateChanges.push({ change, status: 'NEW' })
        newCount++
        break
      case 'updated':
        templateChanges.push({ change, status: 'UPDATED' })
        updateCount++
        break
      case 'unchanged':
        templateChanges.push({ change, status: 'UNCHANGED' })
        unchangedCount++
        break
      case 'local_modified':
      case 'custom':
        customChanges.push(change)
        customCount++
        break
    }
  }

  if (templateChanges.length === 0 && customChanges.length === 0) {
    return { newCount, updateCount, customCount, unchangedCount }
  }

  const hasUpdates = updateCount > 0

  const columns = [
    { name: 'source', title: 'Source', alignment: 'left' as const },
    { name: 'status', title: 'Status', alignment: 'left' as const },
    { name: 'key', title: 'Variable', alignment: 'left' as const },
    { name: 'value', title: 'Value', alignment: 'left' as const },
  ]
  if (hasUpdates) {
    columns.push({ name: 'oldValue', title: 'Old Value', alignment: 'left' as const })
  }

  const table = new Table({ columns })

  const statusOrder = { NEW: 0, UPDATED: 1, UNCHANGED: 2 }
  templateChanges.sort((a, b) => statusOrder[a.status] - statusOrder[b.status])

  for (const { change, status } of templateChanges) {
    const isSecret = isSecretValue(change.templateValue)
    const displayValue = status === 'UNCHANGED' ? change.localValue : change.newValue
    const row: Record<string, string> = {
      source: 'TEMPLATE',
      status,
      key: change.key,
      value: formatValue(displayValue || '', isSecret),
    }
    if (hasUpdates) {
      row['oldValue'] = status === 'UPDATED' ? formatValue(change.localValue || '', isSecret) : ''
    }

    let color: 'green' | 'yellow' | 'white' = 'white'
    if (status === 'NEW') color = 'green'
    else if (status === 'UPDATED') color = 'yellow'

    table.addRow(row, { color })
  }

  for (const change of customChanges) {
    const row: Record<string, string> = {
      source: 'CUSTOM',
      status: 'KEPT',
      key: change.key,
      value: formatValue(change.localValue || '', false),
    }
    if (hasUpdates) row['oldValue'] = ''
    table.addRow(row, { color: 'cyan' })
  }

  table.printTable()

  return { newCount, updateCount, customCount, unchangedCount }
}

async function processEnvPath(
  pathInfo: EnvPathInfo,
  options: { force: boolean; dryRun: boolean },
): Promise<{ success: boolean; changes: Change[] }> {
  log.header(`Processing ${pathInfo.envPath}`)

  const templateFile = Bun.file(pathInfo.templatePath)
  if (!(await templateFile.exists())) {
    log.skip(`Template not found: ${pathInfo.templatePath}`)
    return { success: false, changes: [] }
  }

  const templateContent = await templateFile.text()
  const template = parseEnvFile(templateContent)
  log.detail(`Template: ${pathInfo.templatePath}`)
  log.detail(`Template has ${template.vars.size} variables`)

  log.info('')
  log.info('  Resolving secrets...')
  const injected = await resolveTemplateSecrets(template)
  if (!injected) {
    return { success: false, changes: [] }
  }
  log.success('Secrets resolved successfully')

  const config = getConfig()
  const currentEnv = config.environment

  const localFile = Bun.file(pathInfo.envPath)
  const localExists = await localFile.exists()
  const local = localExists ? parseEnvFile(await localFile.text()) : null

  if (localExists) {
    log.detail(`Found existing .env with ${local!.vars.size} variables`)
    if (local!.sourceEnv && local!.sourceEnv !== currentEnv) {
      log.warn(`Environment change detected: ${local!.sourceEnv} → ${currentEnv}`)
    }
  } else {
    log.detail(`No existing .env found - will create new file`)
  }

  // Check for environment switch - if switching, treat all secrets as needing update
  const envSwitched = !!(local?.sourceEnv && local.sourceEnv !== currentEnv)
  const changes = computeChanges(template, injected, local, envSwitched)

  log.info('')
  const { newCount, updateCount, customCount, unchangedCount } = displayChanges(changes)

  log.info('')
  log.info(
    `  Summary: ${pc.green(`${newCount} new`)}, ` +
      `${pc.yellow(`${updateCount} updated`)}, ` +
      `${pc.cyan(`${customCount} custom`)}, ` +
      `${pc.dim(`${unchangedCount} unchanged`)}`,
  )

  if (options.dryRun) {
    log.warn('Dry run - no changes written')
    return { success: true, changes }
  }

  // Prompt for confirmation on env switch or if there are changes
  if (!options.force) {
    // Environment switch prompt
    if (envSwitched) {
      const envPrompt = `Switch from ${pc.yellow(local!.sourceEnv!)} to ${pc.cyan(currentEnv)}? All secrets will be updated.`
      const confirmed = await promptConfirm(envPrompt)
      if (!confirmed) {
        log.skip('Environment switch cancelled')
        return { success: false, changes }
      }
    } else if (updateCount > 0 || newCount > 0) {
      let promptMsg = ''
      if (updateCount > 0 && newCount > 0) {
        promptMsg = `${updateCount} secrets will be updated and ${newCount} new vars added. Continue?`
      } else if (updateCount > 0) {
        promptMsg = `${updateCount} secrets will be updated. Continue?`
      } else {
        promptMsg = `${newCount} new vars will be added. Continue?`
      }

      const confirmed = await promptConfirm(promptMsg)
      if (!confirmed) {
        log.skip('Skipped by user')
        return { success: false, changes }
      }
    }
  }

  // Always write the file to ensure proper formatting and local var placement
  const merged = mergeEnvFiles(template, injected, local, changes)
  const outputContent = serializeEnvFile(merged, currentEnv)
  await Bun.write(pathInfo.envPath, outputContent)

  if (newCount === 0 && updateCount === 0) {
    log.success('File reformatted (no value changes)')
  } else {
    log.success(`Written to ${pathInfo.envPath}`)
  }

  return { success: true, changes }
}

export async function syncCommand(options: { force: boolean; dryRun: boolean; noBackup: boolean }): Promise<void> {
  const config = getConfig()

  log.banner('Environment Sync')
  log.info(`  Environment: ${pc.cyan(config.environment)}`)

  if (options.dryRun) {
    log.info(pc.yellow('  Running in dry-run mode'))
  }
  if (options.force) {
    log.info(pc.yellow('  Running in force mode (no prompts)'))
  }

  const prereqsOk = await checkPrerequisites()
  if (!prereqsOk) {
    process.exit(1)
  }

  const envPaths = resolveAllEnvPaths()

  // Auto-backup existing .env files before making changes
  if (!options.dryRun && !options.noBackup) {
    const envFilePaths = envPaths.map((p) => p.envPath)
    const backupPath = await createAutoBackup(envFilePaths)
    if (backupPath) {
      log.info('')
      log.info(`  ${pc.dim(`Backed up existing files to ${backupPath}`)}`)
    }
  }

  let successCount = 0
  let failCount = 0
  let totalNew = 0
  let totalUpdated = 0
  let totalCustom = 0

  for (const pathInfo of envPaths) {
    const { success, changes } = await processEnvPath(pathInfo, options)

    if (success) {
      successCount++
      totalNew += changes.filter((c) => c.type === 'new').length
      totalUpdated += changes.filter((c) => c.type === 'updated').length
      totalCustom += changes.filter((c) => c.type === 'local_modified' || c.type === 'custom').length
    } else {
      failCount++
    }
  }

  log.banner('Summary')
  log.info('')
  log.info(`  Files processed: ${pc.green(`${successCount} success`)}, ${pc.red(`${failCount} failed`)}`)
  log.info(
    `  Variables: ${pc.green(`${totalNew} new`)}, ${pc.yellow(`${totalUpdated} updated`)}, ${pc.cyan(`${totalCustom} custom`)}`,
  )
  log.info('')

  if (failCount > 0) {
    process.exit(1)
  }
}
