import pc from 'picocolors'
import { confirm } from '@inquirer/prompts'
import { log } from '../logger'
import { OP_ACCOUNT_URL } from '../config'
import { getAuthMethod, verifyAuth } from '../sdk'

export async function promptConfirm(message: string, defaultValue = true): Promise<boolean> {
  try {
    return await confirm({ message, default: defaultValue })
  } catch {
    return false
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
  return Promise.race([promise, timeout])
}

async function is1PasswordAppRunning(): Promise<boolean> {
  try {
    const result = await Bun.$`pgrep -x "1Password"`.quiet().nothrow()
    return result.exitCode === 0
  } catch {
    return false
  }
}

export async function checkPrerequisites(options: { quiet?: boolean } = {}): Promise<boolean> {
  if (!options.quiet) {
    log.info('')
    log.info('Checking prerequisites...')
  }

  const authMethod = getAuthMethod()
  const hasServiceToken = !!process.env['OP_SERVICE_ACCOUNT_TOKEN']

  // Check if desktop app is running before attempting auth
  if (authMethod.type === 'desktop-app') {
    const appRunning = await is1PasswordAppRunning()
    if (!appRunning) {
      log.fail('No authentication method available')
      if (!hasServiceToken) {
        log.detail('OP_SERVICE_ACCOUNT_TOKEN: not set')
      }
      log.detail('1Password desktop app: not running')
      log.info('')
      log.info('  To authenticate, either:')
      log.info(`  ${pc.cyan('1.')} Open the 1Password desktop app`)
      log.info(`  ${pc.cyan('2.')} Set ${pc.cyan('OP_SERVICE_ACCOUNT_TOKEN')} env var`)
      log.info(`  Create one at ${pc.cyan(`${OP_ACCOUNT_URL}/developer-tools`)}`)
      return false
    }
  }

  if (!options.quiet) {
    if (authMethod.type === 'service-account') {
      log.info('  Authenticating via service account...')
    } else {
      log.info(`  Authenticating via desktop app (account: ${authMethod.identifier})...`)
    }
  }

  const authResult = await verifyAuth()

  if (!authResult.success) {
    log.fail('Authentication failed')
    if (authResult.error) {
      log.detail(authResult.error)
    }
    if (authMethod.type === 'desktop-app') {
      log.detail('Make sure "Integrate with other apps" is enabled in Settings > Developer')
    } else {
      log.detail('Check your OP_SERVICE_ACCOUNT_TOKEN value')
    }
    return false
  }

  if (!options.quiet) {
    log.success('1Password authentication verified')
  }

  return true
}
