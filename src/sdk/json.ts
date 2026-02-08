import type { EnviCommand, JsonEnvelope, RuntimeOptions } from './types'

function normalizeForJson(value: unknown): unknown {
  if (value instanceof Map) {
    const entries = Array.from(value.entries()).sort(([a], [b]) => String(a).localeCompare(String(b)))
    return Object.fromEntries(entries)
  }

  if (Array.isArray(value)) {
    return value.map(normalizeForJson)
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b))
    const out: Record<string, unknown> = {}
    for (const key of keys) {
      out[key] = normalizeForJson(obj[key])
    }
    return out
  }

  return value
}

export function makeEnvelope<TData, TCommand extends EnviCommand>(args: {
  command: TCommand
  ok: boolean
  data: TData
  issues: JsonEnvelope<TData, TCommand>['issues']
  options: Pick<RuntimeOptions, 'environment'>
  providerId: string
}): JsonEnvelope<TData, TCommand> {
  return {
    schemaVersion: 1,
    command: args.command,
    ok: args.ok,
    data: normalizeForJson(args.data) as TData,
    issues: args.issues,
    meta: {
      environment: args.options.environment,
      provider: args.providerId,
      timestamp: new Date().toISOString(),
    },
  }
}

export function stringifyEnvelope(envelope: unknown): string {
  return JSON.stringify(normalizeForJson(envelope), null, 2) + '\n'
}
