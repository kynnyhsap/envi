import { isSecretReference, parseSecretReference, toNativeReference } from '../../providers'
import { parseEnvFile } from '../../utils/parse'
import { substituteVariables, hasUnresolvedVariables } from '../../utils/variables'
import { makeEnvelope } from '../json'
import { resolveAllEnvPaths } from '../paths'
import type {
  ExecutionContext,
  Issue,
  ValidateData,
  ValidateOperationOptions,
  ValidatePathData,
  ValidateReferenceData,
  ValidateResult,
} from '../types'
import { checkProviderReady } from './provider-check'

function validateReferenceFormat(reference: string): { valid: boolean; error?: string } {
  try {
    parseSecretReference(reference)
    return { valid: true }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { valid: false, error: msg }
  }
}

async function validateReferenceRemote(
  ctx: ExecutionContext,
  reference: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
    const nativeRef = toNativeReference(reference, ctx.provider.scheme)
    await ctx.provider.resolveSecret(nativeRef)
    return { valid: true }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const firstLine = msg.split('\n')[0]
    return { valid: false, error: firstLine ?? msg }
  }
}

export async function validateOperation(
  ctx: ExecutionContext,
  options: ValidateOperationOptions = {},
): Promise<ValidateResult> {
  const remote = options.remote ?? false
  const issues: Issue[] = []

  if (remote) {
    const prereq = await checkProviderReady(ctx)
    if (!prereq.ok) {
      return makeEnvelope({
        command: 'validate',
        ok: false,
        data: { remote, paths: [], summary: { templates: 0, valid: 0, invalid: 0 } },
        issues: prereq.issues,
        options: ctx.options,
        providerId: ctx.provider.id,
      })
    }
  }

  const envPaths = await resolveAllEnvPaths(ctx.options, ctx.runtime)
  const paths: ValidatePathData[] = []
  let templates = 0
  let valid = 0
  let invalid = 0

  for (const pathInfo of envPaths) {
    const hasTemplate = await ctx.runtime.exists(pathInfo.templatePath)
    if (!hasTemplate) {
      paths.push({ pathInfo, hasTemplate: false, references: [] })
      continue
    }

    templates++

    const template = parseEnvFile(await ctx.runtime.readText(pathInfo.templatePath))
    const references: ValidateReferenceData[] = []

    for (const [key, envVar] of template.vars) {
      if (!isSecretReference(envVar.value)) continue
      const reference = envVar.value.trim()
      const resolvedReference = substituteVariables(reference, ctx.options.environment)

      if (hasUnresolvedVariables(resolvedReference)) {
        references.push({
          key,
          reference,
          resolvedReference,
          valid: false,
          error: 'Unresolved variables in reference',
        })
        issues.push({
          code: 'UNRESOLVED_VARIABLE',
          message: `Unresolved variables in ${key}`,
          key,
          reference: resolvedReference,
        })
        invalid++
        continue
      }

      const res = remote
        ? await validateReferenceRemote(ctx, resolvedReference)
        : validateReferenceFormat(resolvedReference)
      if (res.valid) {
        references.push({ key, reference, resolvedReference, valid: true })
        valid++
      } else {
        if (res.error) {
          references.push({ key, reference, resolvedReference, valid: false, error: res.error })
        } else {
          references.push({ key, reference, resolvedReference, valid: false, error: 'Invalid reference' })
        }
        issues.push({
          code: 'INVALID_REFERENCE',
          message: res.error ?? 'Invalid reference',
          key,
          reference: resolvedReference,
        })
        invalid++
      }
    }

    paths.push({ pathInfo, hasTemplate: true, references })
  }

  const data: ValidateData = {
    remote,
    paths,
    summary: { templates, valid, invalid },
  }

  return makeEnvelope({
    command: 'validate',
    ok: invalid === 0,
    data,
    issues,
    options: ctx.options,
    providerId: ctx.provider.id,
  })
}
