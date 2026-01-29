import pc from 'picocolors'
import { log } from '../logger'
import { getConfig } from '../config'
import { formatBackupTimestamp, parseEnvFile, resolveAllEnvPaths, getBackupRootDir, type EnvPathInfo } from '../utils'
import { getDefaultProvider, is1PasswordAppRunning, OP_ACCOUNT_URL } from '../providers'

interface PathStatus {
  pathInfo: EnvPathInfo
  hasTemplate: boolean
  hasEnv: boolean
  hasBackup: boolean
  templateVarCount: number
  envVarCount: number
  status: 'missing' | 'synced' | 'outdated' | 'no-template'
}

interface AuthStatus {
  authenticated: boolean
  authMethod?: string | undefined
  accountName?: string | undefined
  vaultCount?: number | undefined
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

async function getAuthStatus(): Promise<AuthStatus> {
  const provider = getDefaultProvider()
  const authInfo = provider.getAuthInfo()

  const status: AuthStatus = {
    authenticated: false,
    authMethod: authInfo.type,
    accountName: authInfo.type === 'desktop-app' ? authInfo.identifier : undefined,
  }

  // Provider-specific pre-flight checks
  if (provider.id === '1password' && authInfo.type === 'desktop-app') {
    const appRunning = await is1PasswordAppRunning()
    if (!appRunning) {
      return status
    }
  }

  const authResult = await provider.verifyAuth()
  if (authResult.success) {
    status.authenticated = true
    try {
      const vaults = await provider.listVaults()
      status.vaultCount = vaults.length
    } catch {
      // Ignore vault listing errors
    }
  }

  return status
}

export async function statusCommand(): Promise<void> {
  const config = getConfig()
  const provider = getDefaultProvider()

  log.banner('Environment Status')
  log.info(`  Environment: ${pc.cyan(config.environment)}`)
  log.info(`  Provider: ${pc.cyan(provider.name)}`)

  // Auth status section
  log.header(provider.name)
  log.info('')

  if (provider.id === '1password') {
    const hasServiceToken = !!process.env['OP_SERVICE_ACCOUNT_TOKEN']
    const appRunning = await is1PasswordAppRunning()
    const authInfo = provider.getAuthInfo()

    if (hasServiceToken) {
      log.detail(`OP_SERVICE_ACCOUNT_TOKEN: ${pc.green('found')}`)
    } else {
      log.detail(`OP_SERVICE_ACCOUNT_TOKEN: ${pc.dim('not set')}`)
    }

    if (appRunning) {
      log.detail(`1Password desktop app: ${pc.green('running')}`)
    } else {
      log.detail(`1Password desktop app: ${pc.dim('not running')}`)
    }

    log.info('')

    if (!hasServiceToken && !appRunning) {
      log.fail('No authentication method available')
      log.info('')
      log.info('  To authenticate, either:')
      log.info(`  ${pc.cyan('1.')} Open the 1Password desktop app`)
      log.info(`  ${pc.cyan('2.')} Set ${pc.cyan('OP_SERVICE_ACCOUNT_TOKEN')} env var`)
      log.info(`  Create one at ${pc.cyan(`${OP_ACCOUNT_URL}/developer-tools`)}`)
    } else {
      if (authInfo.type === 'service-account') {
        log.info('  Authenticating via service account...')
      } else {
        log.info(`  Authenticating via desktop app (account: ${authInfo.identifier})...`)
      }

      const auth = await getAuthStatus()

      if (auth.authenticated) {
        const method = auth.authMethod === 'service-account' ? 'service account' : 'desktop app'
        log.success(`Authenticated via ${method}`)
        if (auth.accountName) {
          log.detail(`Account: ${auth.accountName}`)
        }
        if (auth.vaultCount !== undefined) {
          log.detail(`${auth.vaultCount} vault(s) accessible`)
        }
      } else {
        log.fail('Authentication failed')
        if (authInfo.type === 'desktop-app') {
          log.detail('Make sure "Integrate with other apps" is enabled in Settings > Developer')
        } else {
          log.detail('Check your OP_SERVICE_ACCOUNT_TOKEN value')
        }
      }
    }
  } else if (provider.id === 'proton-pass') {
    log.info('  Authenticating via Proton Pass CLI...')
    const auth = await getAuthStatus()

    if (auth.authenticated) {
      log.success('Authenticated via Proton Pass CLI')
      if (auth.vaultCount !== undefined) {
        log.detail(`${auth.vaultCount} vault(s) accessible`)
      }
    } else {
      log.fail('Authentication failed')
      log.detail(`Make sure ${pc.cyan('pass-cli')} is installed and you are logged in`)
    }
  }

  // Configured paths section
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

  // Backups section
  log.header('Backups')
  log.info('')

  const backupInfo = await getBackupInfo()
  if (backupInfo.count === 0) {
    log.info(`  ${pc.dim('No backups found')}`)
  } else {
    const latestFormatted = backupInfo.latestTimestamp ? formatBackupTimestamp(backupInfo.latestTimestamp) : 'unknown'
    log.info(`  ${pc.green(String(backupInfo.count))} backup(s), latest: ${latestFormatted}`)
  }

  // Summary
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
