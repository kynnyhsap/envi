import { type EnvFile, type EnvVar, LOCAL_ENVS_SEPARATOR, VARS_MARKER_PREFIX } from './types'
import { normalizeReferenceVars, shouldPersistReferenceVars } from './variables'

export function parseEnvFile(content: string): EnvFile {
  const vars = new Map<string, EnvVar>()
  const order: string[] = []
  const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalizedContent.split('\n')

  let pendingComments: string[] = []
  let inCustomSection = false
  let sourceVars: Record<string, string> | undefined

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith(VARS_MARKER_PREFIX)) {
      sourceVars = parseVarsMarker(trimmed.slice(VARS_MARKER_PREFIX.length).trim())
      continue
    }

    if (trimmed.includes('PUT YOUR CUSTOM ENVS') || trimmed.includes('LOCAL ENVS')) {
      inCustomSection = true
      pendingComments.push(line)
      continue
    }

    if (trimmed === '' || trimmed.startsWith('#')) {
      pendingComments.push(line)
      continue
    }

    const eqIndex = line.indexOf('=')
    if (eqIndex !== -1) {
      const key = line.substring(0, eqIndex).trim()
      const value = line.substring(eqIndex + 1)

      vars.set(key, {
        key,
        value,
        comment: pendingComments.length > 0 ? pendingComments.join('\n') : undefined,
        isCustom: inCustomSection,
      })
      order.push(key)
      pendingComments = []
    }
  }

  const trailingContent = pendingComments.join('\n')
  return { vars, order, trailingContent, sourceVars }
}

export function serializeEnvFile(envFile: EnvFile, sourceVars?: Record<string, string>): string {
  const lines: string[] = []

  if (sourceVars && shouldPersistReferenceVars(sourceVars)) {
    lines.push(`${VARS_MARKER_PREFIX}${JSON.stringify(normalizeReferenceVars(sourceVars))}`)
    lines.push('')
  }

  const templateVars = envFile.order.filter((key) => !envFile.vars.get(key)?.isCustom)
  const customVars = envFile.order.filter((key) => envFile.vars.get(key)?.isCustom)

  for (const key of templateVars) {
    const envVar = envFile.vars.get(key)
    if (!envVar) continue

    if (envVar.comment !== undefined) {
      lines.push(envVar.comment)
    }
    lines.push(`${envVar.key}=${formatEnvValue(envVar.value)}`)
  }

  lines.push('')
  lines.push(LOCAL_ENVS_SEPARATOR)

  let isFirstCustomVar = true
  for (const key of customVars) {
    const envVar = envFile.vars.get(key)
    if (!envVar) continue

    if (!isFirstCustomVar) {
      lines.push('')
    }
    isFirstCustomVar = false

    let comment = envVar.comment
    if (comment !== undefined) {
      const filteredLines = comment
        .split('\n')
        .filter((line) => !line.includes('PUT YOUR CUSTOM ENVS') && !line.includes('LOCAL ENVS'))

      while (filteredLines.length > 0 && filteredLines[0]?.trim() === '') {
        filteredLines.shift()
      }

      comment = filteredLines.join('\n')
      if (comment.trim()) {
        lines.push(comment)
      }
    }
    lines.push(`${envVar.key}=${formatEnvValue(envVar.value)}`)
  }

  return lines.join('\n') + '\n'
}

function formatEnvValue(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized.includes('\n')) return value
  return JSON.stringify(normalized)
}

function parseVarsMarker(value: string): Record<string, string> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined

    const vars: Record<string, string> = {}
    for (const [key, rawValue] of Object.entries(parsed)) {
      if (typeof rawValue === 'string') vars[key] = rawValue
    }
    return normalizeReferenceVars(vars)
  } catch {
    return undefined
  }
}
