import { type EnvFile, type EnvVar, LOCAL_ENVS_SEPARATOR, ENV_MARKER_PREFIX } from './types'

export function parseEnvFile(content: string): EnvFile {
  const vars = new Map<string, EnvVar>()
  const order: string[] = []
  const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalizedContent.split('\n')

  let pendingComments: string[] = []
  let inCustomSection = false
  let sourceEnv: string | undefined

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith(ENV_MARKER_PREFIX)) {
      sourceEnv = trimmed.slice(ENV_MARKER_PREFIX.length).trim()
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
  return { vars, order, trailingContent, sourceEnv }
}

export function serializeEnvFile(envFile: EnvFile, env?: string): string {
  const lines: string[] = []

  if (env) {
    lines.push(`${ENV_MARKER_PREFIX}${env}`)
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
    lines.push(`${envVar.key}=${envVar.value}`)
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
    lines.push(`${envVar.key}=${envVar.value}`)
  }

  return lines.join('\n') + '\n'
}
