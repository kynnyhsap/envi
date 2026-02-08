import { isSecretReference, toNativeReference, type Provider } from '../../providers'
import { parseEnvFile } from '../../utils/parse'
import type { EnvFile } from '../../utils/types'
import { hasUnresolvedVariables, substituteVariables } from '../../utils/variables'
import type { Issue } from '../types'

export function collectSecretReferences(
  template: EnvFile,
  env: string,
): {
  refs: { key: string; reference: string; original: string }[]
  issues: Issue[]
} {
  const refs: { key: string; reference: string; original: string }[] = []
  const issues: Issue[] = []

  for (const [key, envVar] of template.vars) {
    if (!isSecretReference(envVar.value)) continue

    const original = envVar.value.trim()
    const substituted = substituteVariables(original, env)

    if (hasUnresolvedVariables(substituted)) {
      issues.push({
        code: 'UNRESOLVED_VARIABLE',
        message: `Unresolved variable in ${key}: ${substituted}`,
        key,
        reference: substituted,
      })
      continue
    }

    refs.push({ key, reference: substituted, original })
  }

  return { refs, issues }
}

export async function injectResolvedSecrets(args: {
  template: EnvFile
  environment: string
  provider: Provider
}): Promise<{ injected: EnvFile | null; issues: Issue[] }> {
  const { refs, issues } = collectSecretReferences(args.template, args.environment)
  if (issues.length > 0) {
    return { injected: null, issues }
  }

  if (refs.length === 0) {
    return { injected: args.template, issues: [] }
  }

  const references = refs.map((r) => r.reference)
  const nativeRefs = references.map((ref) => toNativeReference(ref, args.provider.scheme))

  const { resolved, errors } = await args.provider.resolveSecrets(nativeRefs)
  if (errors.size > 0) {
    const outIssues: Issue[] = []
    for (let i = 0; i < refs.length; i++) {
      const key = refs[i]!.key
      const ref = refs[i]!.reference
      const native = nativeRefs[i]!
      const error = errors.get(native)
      if (error) {
        outIssues.push({
          code: 'SECRET_RESOLUTION_FAILED',
          message: `Failed to resolve ${key}: ${error}`,
          key,
          reference: ref,
        })
      }
    }
    return { injected: null, issues: outIssues }
  }

  const resolvedVars = new Map(args.template.vars)
  for (let i = 0; i < refs.length; i++) {
    const key = refs[i]!.key
    const native = nativeRefs[i]!
    const value = resolved.get(native)
    if (value !== undefined) {
      const existing = resolvedVars.get(key)!
      resolvedVars.set(key, { ...existing, value })
    }
  }

  return {
    injected: {
      vars: resolvedVars,
      order: args.template.order,
      trailingContent: args.template.trailingContent,
    },
    issues: [],
  }
}

export async function resolveEnvFileToKeyValue(args: {
  content: string
  environment: string
  provider: Provider
}): Promise<{ vars: Map<string, string> | null; issues: Issue[]; secretKeys: Set<string> }> {
  const parsed = parseEnvFile(args.content)
  const vars = new Map<string, string>()
  const secretKeys = new Set<string>()

  const refs: { key: string; reference: string }[] = []
  const issues: Issue[] = []

  for (const [key, envVar] of parsed.vars) {
    if (isSecretReference(envVar.value)) {
      const substituted = substituteVariables(envVar.value.trim(), args.environment)
      secretKeys.add(key)
      if (hasUnresolvedVariables(substituted)) {
        issues.push({
          code: 'UNRESOLVED_VARIABLE',
          message: `Unresolved variable in ${key}: ${substituted}`,
          key,
          reference: substituted,
        })
        continue
      }
      refs.push({ key, reference: substituted })
    } else {
      vars.set(key, envVar.value)
    }
  }

  if (issues.length > 0) {
    return { vars: null, issues, secretKeys }
  }

  if (refs.length === 0) {
    return { vars, issues: [], secretKeys }
  }

  const references = refs.map((r) => r.reference)
  const nativeRefs = references.map((ref) => toNativeReference(ref, args.provider.scheme))
  const { resolved, errors } = await args.provider.resolveSecrets(nativeRefs)
  if (errors.size > 0) {
    const outIssues: Issue[] = []
    for (let i = 0; i < refs.length; i++) {
      const key = refs[i]!.key
      const ref = refs[i]!.reference
      const native = nativeRefs[i]!
      const error = errors.get(native)
      if (error) {
        outIssues.push({
          code: 'SECRET_RESOLUTION_FAILED',
          message: `Failed to resolve ${key}: ${error}`,
          key,
          reference: ref,
        })
      }
    }
    return { vars: null, issues: outIssues, secretKeys }
  }

  for (let i = 0; i < refs.length; i++) {
    const key = refs[i]!.key
    const native = nativeRefs[i]!
    const value = resolved.get(native)
    if (value !== undefined) vars.set(key, value)
  }

  return { vars, issues: [], secretKeys }
}
