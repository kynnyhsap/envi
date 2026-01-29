import { confirm } from '@inquirer/prompts'
import { log } from '../logger'
import { getProvider } from '../config'

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
  const provider = getProvider()

  if (!options.quiet) {
    log.info('')
    log.info('Checking prerequisites...')
  }

  // Pre-flight availability check
  const availability = await provider.checkAvailability()

  if (!options.quiet && availability.statusLines) {
    for (const line of availability.statusLines) {
      log.detail(line)
    }
  }

  if (!availability.available) {
    log.fail('No authentication method available')
    if (availability.helpLines) {
      log.info('')
      for (const line of availability.helpLines) {
        log.info(`  ${line}`)
      }
    }
    return false
  }

  const authInfo = provider.getAuthInfo()
  if (!options.quiet) {
    log.info(`  Authenticating via ${provider.name} (${authInfo.type})...`)
  }

  const authResult = await provider.verifyAuth()

  if (!authResult.success) {
    log.fail('Authentication failed')
    if (authResult.error) {
      log.detail(authResult.error)
    }
    const hints = provider.getAuthFailureHints()
    for (const line of hints.lines) {
      log.detail(line)
    }
    return false
  }

  if (!options.quiet) {
    log.success(`${provider.name} authentication verified`)
  }

  return true
}
