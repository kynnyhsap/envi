import pc from 'picocolors'
import { confirm } from '@inquirer/prompts'
import { log } from '../logger'
import { getDefaultProvider, is1PasswordAppRunning } from '../providers'

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

export async function checkPrerequisites(options: { quiet?: boolean } = {}): Promise<boolean> {
  const provider = getDefaultProvider()

  if (!options.quiet) {
    log.info('')
    log.info('Checking prerequisites...')
  }

  const authInfo = provider.getAuthInfo()

  // Provider-specific pre-flight checks
  if (provider.id === '1password') {
    const hasServiceToken = !!process.env['OP_SERVICE_ACCOUNT_TOKEN']

    if (authInfo.type === 'desktop-app') {
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
        return false
      }
    }

    if (!options.quiet) {
      if (authInfo.type === 'service-account') {
        log.info('  Authenticating via service account...')
      } else {
        log.info(`  Authenticating via desktop app (account: ${authInfo.identifier})...`)
      }
    }
  } else if (provider.id === 'proton-pass') {
    if (!options.quiet) {
      log.info(`  Authenticating via ${provider.name} CLI...`)
    }
  }

  const authResult = await provider.verifyAuth()

  if (!authResult.success) {
    log.fail('Authentication failed')
    if (authResult.error) {
      log.detail(authResult.error)
    }
    if (provider.id === '1password' && authInfo.type === 'desktop-app') {
      log.detail('Make sure "Integrate with other apps" is enabled in Settings > Developer')
    } else if (provider.id === '1password') {
      log.detail('Check your OP_SERVICE_ACCOUNT_TOKEN value')
    } else if (provider.id === 'proton-pass') {
      log.detail(`Make sure ${pc.cyan('pass-cli')} is installed and you are logged in`)
    }
    return false
  }

  if (!options.quiet) {
    log.success(`${provider.name} authentication verified`)
  }

  return true
}
