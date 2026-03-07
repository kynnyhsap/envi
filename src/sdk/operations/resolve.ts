import { isSecretReference, toNativeReference, validateSecretReferenceFormat } from '../../providers'
import { hasUnresolvedVariables, substituteVariables } from '../../shared/env/variables'
import { makeEnvelope } from '../json'
import type {
  ExecutionContext,
  Issue,
  ResolveSecretData,
  ResolveSecretOperationOptions,
  ResolveSecretResult,
} from '../types'
import { checkProviderReady } from './provider-check'

function firstLine(message: string): string {
  const line = message.split('\n')[0]
  return line ?? message
}

export async function resolveSecretOperation(
  ctx: ExecutionContext,
  options: ResolveSecretOperationOptions,
): Promise<ResolveSecretResult> {
  const issues: Issue[] = []
  const input = options.reference.trim()

  const fail = (message: string, code: string, reference = input): ResolveSecretResult => {
    issues.push({ code, message, reference })
    const data: ResolveSecretData = {
      input,
      resolvedReference: reference,
      nativeReference: toNativeReference(reference),
      secret: '',
    }

    return makeEnvelope({
      command: 'resolve',
      ok: false,
      data,
      issues,
      options: ctx.options,
      providerId: ctx.provider.id,
    })
  }

  if (!input) {
    return fail('Reference is required', 'REFERENCE_REQUIRED', '')
  }

  if (!isSecretReference(input)) {
    return fail('Invalid reference: must start with op://', 'INVALID_REFERENCE')
  }

  const resolvedReference = substituteVariables(input, ctx.options.environment)
  if (hasUnresolvedVariables(resolvedReference)) {
    return fail(
      `Reference contains unresolved variables for environment '${ctx.options.environment}': ${resolvedReference}`,
      'UNRESOLVED_VARIABLE',
      resolvedReference,
    )
  }

  const validation = validateSecretReferenceFormat(resolvedReference)
  if (!validation.valid) {
    return fail(`Invalid reference: ${validation.error}`, 'INVALID_REFERENCE', resolvedReference)
  }

  const prereq = await checkProviderReady(ctx)
  if (!prereq.ok) {
    return makeEnvelope({
      command: 'resolve',
      ok: false,
      data: {
        input,
        resolvedReference,
        nativeReference: toNativeReference(resolvedReference),
        secret: '',
      },
      issues: prereq.issues,
      options: ctx.options,
      providerId: ctx.provider.id,
    })
  }

  const nativeReference = toNativeReference(resolvedReference)

  try {
    const secret = await ctx.provider.resolveSecret(nativeReference)
    return makeEnvelope({
      command: 'resolve',
      ok: true,
      data: { input, resolvedReference, nativeReference, secret },
      issues: [],
      options: ctx.options,
      providerId: ctx.provider.id,
    })
  } catch (error) {
    return fail(
      firstLine(error instanceof Error ? error.message : String(error)),
      'SECRET_RESOLUTION_FAILED',
      resolvedReference,
    )
  }
}
