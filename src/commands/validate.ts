import pc from 'picocolors'
import { getConfig } from '../config'
import { log } from '../logger'
import { parseEnvFile, isSecretReference, resolveAllEnvPaths, type EnvPathInfo } from '../utils'
import { substituteVariables, hasUnresolvedVariables } from '../utils/variables'
import { resolveSecret } from '../sdk'

/**
 * Format an op:// reference with colored parts.
 * op://vault/item/field -> op://vault/item/field with vault, item, field highlighted
 */
function formatOpReference(reference: string): string {
  const trimmed = reference.trim()
  if (!trimmed.startsWith('op://')) {
    return trimmed
  }

  const path = trimmed.slice(5) // Remove 'op://'
  const parts = path.split('/')

  // op://vault/item/field or op://vault/item/section/field
  const [vault, item, ...rest] = parts
  const field = rest.join('/')

  return pc.dim('op://') + pc.blue(vault ?? '') + pc.dim('/') + pc.cyan(item ?? '') + pc.dim('/') + pc.yellow(field)
}

interface SecretToValidate {
  key: string
  reference: string // Original reference from template (may contain ${ENV})
  resolvedReference: string // Reference with ${ENV} substituted
}

/**
 * Validate reference format using regex (fast, offline).
 */
function validateReferenceFormat(reference: string): { valid: boolean; error?: string | undefined } {
  const trimmed = reference.trim()

  if (!trimmed.startsWith('op://')) {
    return { valid: false, error: 'Must start with op://' }
  }

  const path = trimmed.slice(5) // Remove 'op://'
  const parts = path.split('/')

  if (parts.length < 3) {
    return { valid: false, error: 'Must have at least 3 parts: vault/item/field' }
  }

  const [vault, item, ...rest] = parts
  const field = rest.join('/')

  if (!vault || vault.trim() === '') {
    return { valid: false, error: 'Vault name is empty' }
  }

  if (!item || item.trim() === '') {
    return { valid: false, error: 'Item name is empty' }
  }

  if (!field || field.trim() === '') {
    return { valid: false, error: 'Field name is empty' }
  }

  return { valid: true }
}

/**
 * Validate reference by actually fetching from 1Password (slow, requires auth).
 */
async function validateReferenceRemote(reference: string): Promise<{ valid: boolean; error?: string | undefined }> {
  try {
    // Use SDK to resolve the secret (verifies it exists)
    await resolveSecret(reference)
    return { valid: true }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('could not find item') || msg.includes('not found')) {
      return { valid: false, error: 'Item not found' }
    } else if (msg.includes('could not find vault') || msg.includes('vault')) {
      return { valid: false, error: 'Vault not found' }
    } else if (msg.includes('could not find field') || msg.includes('field')) {
      return { valid: false, error: 'Field not found' }
    } else if (msg.includes("isn't a secret reference") || msg.includes('invalid')) {
      return { valid: false, error: 'Invalid reference format' }
    }
    const firstLine = msg.split('\n')[0]
    return { valid: false, error: firstLine ?? msg }
  }
}

async function getSecretsFromTemplate(
  pathInfo: EnvPathInfo,
): Promise<{ hasTemplate: boolean; secrets: SecretToValidate[] }> {
  const templateFile = Bun.file(pathInfo.templatePath)
  const hasTemplate = await templateFile.exists()

  if (!hasTemplate) {
    return { hasTemplate: false, secrets: [] }
  }

  const templateContent = await templateFile.text()
  const template = parseEnvFile(templateContent)
  const { environment } = getConfig()

  const secrets: SecretToValidate[] = []

  for (const [key, envVar] of template.vars) {
    if (isSecretReference(envVar.value)) {
      const reference = envVar.value.trim()
      secrets.push({
        key,
        reference,
        resolvedReference: substituteVariables(reference, environment),
      })
    }
  }

  return { hasTemplate: true, secrets }
}

interface ValidateOptions {
  remote?: boolean
}

export async function validateCommand(options: ValidateOptions = {}): Promise<void> {
  const isRemote = options.remote ?? false
  const { environment } = getConfig()

  log.banner('Validate 1Password References')

  const envPaths = resolveAllEnvPaths()

  log.info('')
  log.info(`  Environment: ${pc.cyan(environment)}`)
  if (isRemote) {
    log.info('  Validating op:// references against 1Password...')
  } else {
    log.info('  Validating op:// reference format in templates...')
  }
  log.info('')

  let totalValid = 0
  let totalInvalid = 0
  let totalTemplates = 0

  for (const pathInfo of envPaths) {
    const { hasTemplate, secrets } = await getSecretsFromTemplate(pathInfo)

    if (!hasTemplate) {
      log.skip(`${pathInfo.templatePath} (not found)`)
      continue
    }

    totalTemplates++

    if (secrets.length === 0) {
      log.info(`  ${pc.cyan(pathInfo.templatePath)}`)
      log.detail('No secret references found')
      continue
    }

    log.header(pathInfo.templatePath)

    // Validate each secret one by one
    for (const secret of secrets) {
      // Show the resolved reference (with ${ENV} substituted)
      const formattedRef = formatOpReference(secret.resolvedReference)
      const line = `${secret.key}=${formattedRef}`

      // Check for unresolved variables first (e.g., ${FOO} still in the reference)
      if (hasUnresolvedVariables(secret.resolvedReference)) {
        log.invalid(line)
        log.detail(pc.red('Error: Unresolved variables in reference'))
        totalInvalid++
        continue
      }

      const result = isRemote
        ? await validateReferenceRemote(secret.resolvedReference)
        : validateReferenceFormat(secret.resolvedReference)

      if (result.valid) {
        log.valid(line)
        totalValid++
      } else {
        log.invalid(line)
        log.detail(pc.red(`Error: ${result.error}`))
        totalInvalid++
      }
    }
  }

  // Summary
  log.banner('Summary')
  log.info('')

  if (totalTemplates === 0) {
    log.warn('No templates found')
  } else if (totalInvalid === 0) {
    log.info(`  ${pc.green('All references are valid!')}`)
    log.info(`  ${pc.green(String(totalValid))} reference(s) validated across ${totalTemplates} template(s)`)
    if (!isRemote) {
      log.info('')
      log.info(`  ${pc.dim(`Use ${pc.cyan('--remote')} to check against 1Password`)}`)
    }
  } else {
    log.info(
      `  ${pc.green(`${totalValid} valid`)}, ${pc.red(`${totalInvalid} invalid`)} ` +
        `across ${totalTemplates} template(s)`,
    )
    log.info('')
    log.info(`  ${pc.red('Fix invalid references before running setup')}`)
  }

  log.info('')

  if (totalInvalid > 0) {
    process.exit(1)
  }
}
