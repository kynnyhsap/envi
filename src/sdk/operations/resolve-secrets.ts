import { isSecretReference, toNativeReference, type Provider } from '../../providers'
import { parseEnvFile } from '../../utils/parse'
import type { EnvFile } from '../../utils/types'
import { hasUnresolvedVariables, substituteVariables } from '../../utils/variables'
import type { Issue } from '../types'

interface CollectedSecretReference {
  key: string
  reference: string
  original: string
}

function injectResolvedValues(
  template: EnvFile,
  refs: CollectedSecretReference[],
  resolved: Map<string, string>,
): EnvFile {
  const resolvedVars = new Map(template.vars)

  for (const ref of refs) {
    const value = resolved.get(ref.reference)
    if (value === undefined) continue

    const existing = resolvedVars.get(ref.key)
    if (!existing) continue
    resolvedVars.set(ref.key, { ...existing, value })
  }

  return {
    vars: resolvedVars,
    order: template.order,
    trailingContent: template.trailingContent,
  }
}

export async function resolveReferenceBatch(args: {
  references: string[]
  provider: Provider
}): Promise<{ resolved: Map<string, string>; errors: Map<string, string> }> {
  const uniqueReferences = Array.from(new Set(args.references))
  const resolved = new Map<string, string>()
  const errors = new Map<string, string>()

  if (uniqueReferences.length === 0) {
    return { resolved, errors }
  }

  const nativeByReference = new Map<string, string>()
  for (const reference of uniqueReferences) {
    nativeByReference.set(reference, toNativeReference(reference, args.provider.scheme))
  }

  const nativeRefs = uniqueReferences.map((reference) => nativeByReference.get(reference)!)
  const providerResult = await args.provider.resolveSecrets(nativeRefs)

  for (const reference of uniqueReferences) {
    const native = nativeByReference.get(reference)!
    const error = providerResult.errors.get(native)
    if (error) {
      errors.set(reference, error)
      continue
    }

    const value = providerResult.resolved.get(native)
    if (value === undefined) {
      errors.set(reference, 'Secret was not returned by provider')
      continue
    }

    resolved.set(reference, value)
  }

  return { resolved, errors }
}

export function collectSecretReferences(
  template: EnvFile,
  env: string,
): {
  refs: CollectedSecretReference[]
  issues: Issue[]
} {
  const refs: CollectedSecretReference[] = []
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

  const { resolved, errors } = await resolveReferenceBatch({
    references: refs.map((r) => r.reference),
    provider: args.provider,
  })

  if (errors.size > 0) {
    const outIssues: Issue[] = []
    for (const ref of refs) {
      const error = errors.get(ref.reference)
      if (error) {
        outIssues.push({
          code: 'SECRET_RESOLUTION_FAILED',
          message: `Failed to resolve ${ref.key}: ${error}`,
          key: ref.key,
          reference: ref.reference,
        })
      }
    }
    return { injected: null, issues: outIssues }
  }

  return {
    injected: injectResolvedValues(args.template, refs, resolved),
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

  const { resolved, errors } = await resolveReferenceBatch({
    references: refs.map((r) => r.reference),
    provider: args.provider,
  })

  if (errors.size > 0) {
    const outIssues: Issue[] = []
    for (const ref of refs) {
      const error = errors.get(ref.reference)
      if (error) {
        outIssues.push({
          code: 'SECRET_RESOLUTION_FAILED',
          message: `Failed to resolve ${ref.key}: ${error}`,
          key: ref.key,
          reference: ref.reference,
        })
      }
    }
    return { vars: null, issues: outIssues, secretKeys }
  }

  for (const ref of refs) {
    const value = resolved.get(ref.reference)
    if (value !== undefined) vars.set(ref.key, value)
  }

  return { vars, issues: [], secretKeys }
}
