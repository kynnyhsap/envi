import { isSecretReference, toNativeReference, validateSecretReferenceFormat } from '../../providers'
import { parseEnvFile } from '../../shared/env/parse'
import { hasUnresolvedVariables, substituteVariables } from '../../shared/env/variables'
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
import { resolveReferenceBatch } from './resolve-secrets'

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
    const remoteCandidates: Array<{ key: string; reference: string; resolvedReference: string }> = []

    for (const [key, envVar] of template.vars) {
      if (!isSecretReference(envVar.value)) continue
      const reference = envVar.value.trim()
      const resolvedReference = substituteVariables(reference, ctx.options.vars)

      if (hasUnresolvedVariables(resolvedReference)) {
        if (!remote) {
          const res = validateSecretReferenceFormat(resolvedReference)
          if (!res.valid) {
            const message = res.error ?? 'Invalid reference'
            references.push({ key, reference, resolvedReference, valid: false, error: message })
            issues.push({ code: 'INVALID_REFERENCE', message, key, reference: resolvedReference })
            invalid++
            continue
          }

          references.push({ key, reference, resolvedReference, valid: true })
          valid++
          continue
        }

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

      if (remote) {
        remoteCandidates.push({ key, reference, resolvedReference })
        continue
      }

      const res = validateSecretReferenceFormat(resolvedReference)
      if (!res.valid) {
        const message = res.error ?? 'Invalid reference'
        references.push({ key, reference, resolvedReference, valid: false, error: message })
        issues.push({ code: 'INVALID_REFERENCE', message, key, reference: resolvedReference })
        invalid++
        continue
      }

      references.push({ key, reference, resolvedReference, valid: true })
      valid++
    }

    if (remote && remoteCandidates.length > 0) {
      const batch = await resolveReferenceBatch({
        references: remoteCandidates.map((candidate) => toNativeReference(candidate.resolvedReference)),
        provider: ctx.provider,
      })

      for (const candidate of remoteCandidates) {
        const nativeReference = toNativeReference(candidate.resolvedReference)
        const error = batch.errors.get(nativeReference)

        if (error) {
          const firstLine = error.split('\n')[0] ?? error
          references.push({
            key: candidate.key,
            reference: candidate.reference,
            resolvedReference: candidate.resolvedReference,
            valid: false,
            error: firstLine,
          })
          issues.push({
            code: 'INVALID_REFERENCE',
            message: firstLine,
            key: candidate.key,
            reference: candidate.resolvedReference,
          })
          invalid++
          continue
        }

        references.push({
          key: candidate.key,
          reference: candidate.reference,
          resolvedReference: candidate.resolvedReference,
          valid: true,
        })
        valid++
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
