import { isSecretReference, toNativeReference, validateSecretReferenceFormat } from '../../providers'
import { hasUnresolvedVariables, substituteVariables } from '../../shared/env/variables'
import { makeEnvelope } from '../json'
import type {
  ExecutionContext,
  Issue,
  ResolveSecretEntryData,
  ResolveSecretOperationOptions,
  ResolveSecretResult,
} from '../types'
import { checkProviderReady } from './provider-check'

function firstLine(message: string): string {
  const line = message.split('\n')[0]
  return line ?? message
}

function failSingle(
  ctx: ExecutionContext,
  args: { input: string; resolvedReference: string; code: string; message: string },
): ResolveSecretResult {
  return makeEnvelope({
    command: 'resolve',
    ok: false,
    data: {
      input: args.input,
      resolvedReference: args.resolvedReference,
      nativeReference: toNativeReference(args.resolvedReference),
      secret: '',
    },
    issues: [{ code: args.code, message: args.message, reference: args.resolvedReference || args.input }],
    options: ctx.options,
    providerId: ctx.provider.id,
  })
}

function makeSingleEntry(input: string, resolvedReference: string, secret = ''): ResolveSecretEntryData {
  return {
    input,
    resolvedReference,
    nativeReference: toNativeReference(resolvedReference),
    secret,
  }
}

function normalizeInputs(options: ResolveSecretOperationOptions): string[] {
  const refs = options.references && options.references.length > 0 ? options.references : [options.reference]
  return refs.map((reference) => reference.trim()).filter((reference) => reference.length > 0)
}

export async function resolveSecretOperation(
  ctx: ExecutionContext,
  options: ResolveSecretOperationOptions,
): Promise<ResolveSecretResult> {
  const inputs = normalizeInputs(options)
  if (inputs.length === 0) {
    return failSingle(ctx, {
      input: '',
      resolvedReference: '',
      code: 'REFERENCE_REQUIRED',
      message: 'Reference is required',
    })
  }

  if (inputs.length === 1) {
    const input = inputs[0]!

    if (!isSecretReference(input)) {
      return failSingle(ctx, {
        input,
        resolvedReference: input,
        code: 'INVALID_REFERENCE',
        message: 'Invalid reference: must start with op://',
      })
    }

    const resolvedReference = substituteVariables(input, ctx.options.vars)
    if (hasUnresolvedVariables(resolvedReference)) {
      return failSingle(ctx, {
        input,
        resolvedReference,
        code: 'UNRESOLVED_VARIABLE',
        message: `Reference contains unresolved variables for vars ${JSON.stringify(ctx.options.vars)}: ${resolvedReference}`,
      })
    }

    const validation = validateSecretReferenceFormat(resolvedReference)
    if (!validation.valid) {
      return failSingle(ctx, {
        input,
        resolvedReference,
        code: 'INVALID_REFERENCE',
        message: `Invalid reference: ${validation.error}`,
      })
    }

    const prereq = await checkProviderReady(ctx)
    if (!prereq.ok) {
      return makeEnvelope({
        command: 'resolve',
        ok: false,
        data: makeSingleEntry(input, resolvedReference),
        issues: prereq.issues,
        options: ctx.options,
        providerId: ctx.provider.id,
      })
    }

    try {
      const nativeReference = toNativeReference(resolvedReference)
      const secret = await ctx.provider.resolveSecret(nativeReference)
      return makeEnvelope({
        command: 'resolve',
        ok: true,
        data: makeSingleEntry(input, resolvedReference, secret),
        issues: [],
        options: ctx.options,
        providerId: ctx.provider.id,
      })
    } catch (error) {
      return failSingle(ctx, {
        input,
        resolvedReference,
        code: 'SECRET_RESOLUTION_FAILED',
        message: firstLine(error instanceof Error ? error.message : String(error)),
      })
    }
  }

  const issues: Issue[] = []
  const entries: Array<{ input: string; data: ResolveSecretEntryData }> = []
  const validNativeReferences: string[] = []

  for (const input of inputs) {
    if (!isSecretReference(input)) {
      entries.push({ input, data: makeSingleEntry(input, input) })
      issues.push({ code: 'INVALID_REFERENCE', message: 'Invalid reference: must start with op://', reference: input })
      continue
    }

    const resolvedReference = substituteVariables(input, ctx.options.vars)
    if (hasUnresolvedVariables(resolvedReference)) {
      entries.push({ input, data: makeSingleEntry(input, resolvedReference) })
      issues.push({
        code: 'UNRESOLVED_VARIABLE',
        message: `Reference contains unresolved variables for vars ${JSON.stringify(ctx.options.vars)}: ${resolvedReference}`,
        reference: resolvedReference,
      })
      continue
    }

    const validation = validateSecretReferenceFormat(resolvedReference)
    if (!validation.valid) {
      entries.push({ input, data: makeSingleEntry(input, resolvedReference) })
      issues.push({
        code: 'INVALID_REFERENCE',
        message: `Invalid reference: ${validation.error}`,
        reference: resolvedReference,
      })
      continue
    }

    const nativeReference = toNativeReference(resolvedReference)
    entries.push({ input, data: makeSingleEntry(input, resolvedReference) })
    validNativeReferences.push(nativeReference)
  }

  if (validNativeReferences.length > 0) {
    const prereq = await checkProviderReady(ctx)
    if (!prereq.ok) {
      return makeEnvelope({
        command: 'resolve',
        ok: false,
        data: {
          inputs,
          results: entries.map((entry) => entry.data),
        },
        issues: [...issues, ...prereq.issues],
        options: ctx.options,
        providerId: ctx.provider.id,
      })
    }

    const resolved = await ctx.provider.resolveSecrets(validNativeReferences)

    for (const entry of entries) {
      const data = entry.data

      if (resolved.resolved.has(data.nativeReference)) {
        data.secret = resolved.resolved.get(data.nativeReference) ?? ''
      }

      if (resolved.errors.has(data.nativeReference)) {
        issues.push({
          code: 'SECRET_RESOLUTION_FAILED',
          message: firstLine(resolved.errors.get(data.nativeReference) ?? 'Failed to resolve secret'),
          reference: data.resolvedReference,
        })
      }
    }
  }

  return makeEnvelope({
    command: 'resolve',
    ok: issues.length === 0,
    data: {
      inputs,
      results: entries.map((entry) => entry.data),
    },
    issues,
    options: ctx.options,
    providerId: ctx.provider.id,
  })
}
