import pc from 'picocolors'

import { getConfig } from '../config'
import { getProvider } from '../config'
import { log } from '../logger'
import { formatBackupTimestamp, parseEnvFile, resolveAllEnvPaths, getBackupRootDir, type EnvPathInfo } from '../utils'

interface PathStatus {
  pathInfo: EnvPathInfo
  hasTemplate: boolean
  hasEnv: boolean
  hasBackup: boolean
  templateVarCount: number
  envVarCount: number
  status: 'missing' | 'synced' | 'outdated' | 'no-template'
}

async function getPathStatus(pathInfo: EnvPathInfo): Promise<PathStatus> {
  const templateFile = Bun.file(pathInfo.templatePath)
  const outputFile = Bun.file(pathInfo.envPath)
  const backupFile = Bun.file(pathInfo.backupDir)

  const hasTemplate = await templateFile.exists()
  const hasEnv = await outputFile.exists()
  const hasBackup = await backupFile.exists()

  let templateVarCount = 0
  let envVarCount = 0
  let status: PathStatus['status'] = 'no-template'

  if (hasTemplate) {
    const templateContent = await templateFile.text()
    const template = parseEnvFile(templateContent)
    templateVarCount = template.vars.size

    if (!hasEnv) {
      status = 'missing'
    } else {
      const envContent = await outputFile.text()
      const env = parseEnvFile(envContent)
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

interface BackupInfo {
  count: number
  latestTimestamp?: string
}

async function getBackupInfo(): Promise<BackupInfo> {
  const backupDir = getBackupRootDir()

  try {
    await Bun.file(backupDir).stat()
  } catch {
    return { count: 0 }
  }

  const glob = new Bun.Glob('*')
  let count = 0
  let latestTimestamp = ''

  for await (const entry of glob.scan({ cwd: backupDir, onlyFiles: false })) {
    if (/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(entry)) {
      count++
      if (entry > latestTimestamp) {
        latestTimestamp = entry
      }
    }
  }

  if (count === 0) {
    return { count: 0 }
  }

  return { count, latestTimestamp }
}

export async function statusCommand(): Promise<void> {
  const config = getConfig()
  const provider = getProvider()

  log.banner('Environment Status')
  log.info(`  Environment: ${pc.cyan(config.environment)}`)
  log.info(`  Provider: ${pc.cyan(provider.name)}`)

  log.header(provider.name)
  log.info('')

  // Provider-agnostic availability check
  const availability = await provider.checkAvailability()

  if (availability.statusLines) {
    for (const line of availability.statusLines) {
      log.detail(line)
    }
  }

  log.info('')

  if (!availability.available) {
    log.fail('No authentication method available')
    if (availability.helpLines) {
      log.info('')
      for (const line of availability.helpLines) {
        log.info(`  ${line}`)
      }
    }
  } else {
    const authInfo = provider.getAuthInfo()
    log.info(`  Authenticating via ${provider.name} (${authInfo.type})...`)

    const authResult = await provider.verifyAuth()

    if (authResult.success) {
      log.success(`Authenticated via ${authInfo.type}`)
      try {
        const vaults = await provider.listVaults()
        log.detail(`${vaults.length} vault(s) accessible`)
      } catch {
        // Ignore vault listing errors
      }
    } else {
      log.fail('Authentication failed')
      if (authResult.error) {
        log.detail(authResult.error)
      }
      const hints = provider.getAuthFailureHints()
      for (const line of hints.lines) {
        log.detail(line)
      }
    }
  }

  log.header('Configured Paths')
  log.info('')

  const envPaths = resolveAllEnvPaths()
  const statuses: PathStatus[] = []
  for (const pathInfo of envPaths) {
    const status = await getPathStatus(pathInfo)
    statuses.push(status)

    const backupIndicator = status.hasBackup ? ` ${pc.dim('(backup exists)')}` : ''

    switch (status.status) {
      case 'missing':
        log.missing(`${pathInfo.envPath}${backupIndicator}`)
        log.detail(`Template: ${pathInfo.templatePath}`)
        log.detail(`Template has ${status.templateVarCount} vars, file not found`)
        break
      case 'synced':
        log.synced(`${pathInfo.envPath}${backupIndicator}`)
        log.detail(`${status.envVarCount} vars (template: ${status.templateVarCount})`)
        log.detail(pc.dim('Note: only checks key presence, run diff to verify values'))
        break
      case 'outdated':
        log.outdated(`${pathInfo.envPath}${backupIndicator}`)
        log.detail(`${status.envVarCount} vars, template expects ${status.templateVarCount}`)
        log.detail(pc.dim('Run sync to add missing variables'))
        break
      case 'no-template':
        log.skip(`${pathInfo.envPath} (no template)`)
        log.detail(`Template not found: ${pathInfo.templatePath}`)
        break
    }
  }

  log.header('Backups')
  log.info('')

  const backupInfo = await getBackupInfo()
  if (backupInfo.count === 0) {
    log.info(`  ${pc.dim('No backups found')}`)
  } else {
    const latestFormatted = backupInfo.latestTimestamp ? formatBackupTimestamp(backupInfo.latestTimestamp) : 'unknown'
    log.info(`  ${pc.green(String(backupInfo.count))} backup(s), latest: ${latestFormatted}`)
  }

  const missing = statuses.filter((s) => s.status === 'missing').length
  const synced = statuses.filter((s) => s.status === 'synced').length
  const outdated = statuses.filter((s) => s.status === 'outdated').length
  const noTemplate = statuses.filter((s) => s.status === 'no-template').length

  log.header('Summary')
  log.info('')
  log.info(
    `  ${pc.green(`${synced} synced`)}, ` +
      `${pc.yellow(`${outdated} outdated`)}, ` +
      `${pc.red(`${missing} missing`)}, ` +
      `${pc.dim(`${noTemplate} no template`)}`,
  )

  if (missing > 0 || outdated > 0) {
    log.info('')
    log.info(`  Run ${pc.cyan('envi sync')} to sync secrets`)
  }

  log.info('')
}
