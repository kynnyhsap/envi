import { describe, expect, it } from 'bun:test'

import type { ExecResult } from '../../shared/process/exec'
import { OnePasswordProvider } from './provider'

function makeExec(handlers: Record<string, (args: string[]) => ExecResult | Promise<ExecResult>>) {
  return async (command: string, args: string[] = []) => {
    const key = `${command} ${args.join(' ')}`.trim()
    const handler = handlers[key]
    if (!handler) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `No exec handler for: ${key}`,
      }
    }
    return handler(args)
  }
}

function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>) {
  const prev: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    prev[key] = process.env[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  return fn().finally(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

describe('OnePasswordProvider (sdk auth)', () => {
  it('does not leak OP_SERVICE_ACCOUNT_TOKEN via getAuthInfo', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: 'super-secret-token', OP_ACCOUNT_NAME: undefined }, async () => {
      const provider = new OnePasswordProvider()
      const auth = provider.getAuthInfo()
      expect(auth.type).toBe('service-account')
      expect(auth.identifier).toBe('set')
    })
  })

  it('marks availability ready when service account token is set', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: 'token', OP_ACCOUNT_NAME: undefined }, async () => {
      const calls: string[] = []
      const provider = new OnePasswordProvider(
        {},
        {
          exec: async (command: string, args: string[] = []) => {
            calls.push(`${command} ${args.join(' ')}`.trim())
            return { exitCode: 1, stdout: '', stderr: 'unexpected exec call' }
          },
        },
      )

      const availability = await provider.checkAvailability()
      expect(availability.available).toBe(true)
      expect(availability.statusLines).toContain('OP_SERVICE_ACCOUNT_TOKEN: found')
      expect(calls).toEqual([])
    })
  })

  it('reports desktop auth readiness when app is running and OP_ACCOUNT_NAME is set', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: undefined, OP_ACCOUNT_NAME: 'my.1password.com' }, async () => {
      const exec = makeExec({
        'pgrep -x 1Password': () => ({ exitCode: 0, stdout: '123\n', stderr: '' }),
      })

      const provider = new OnePasswordProvider({}, { exec })
      const availability = await provider.checkAvailability()

      expect(availability.available).toBe(true)
      expect(availability.statusLines).toContain('OP_SERVICE_ACCOUNT_TOKEN: not set')
      expect(availability.statusLines).toContain('1Password desktop app: running')
      expect(availability.statusLines).toContain('OP_ACCOUNT_NAME: set (my.1password.com)')
    })
  })

  it('reports default desktop account when OP_ACCOUNT_NAME is unset', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: undefined, OP_ACCOUNT_NAME: undefined }, async () => {
      const exec = makeExec({
        'pgrep -x 1Password': () => ({ exitCode: 0, stdout: '123\n', stderr: '' }),
      })

      const provider = new OnePasswordProvider({}, { exec })
      const availability = await provider.checkAvailability()

      expect(availability.available).toBe(true)
      expect(availability.statusLines).toContain('OP_ACCOUNT_NAME: default (my.1password.com)')
    })
  })

  it('reports unavailable when desktop auth prerequisites are missing', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: undefined, OP_ACCOUNT_NAME: undefined }, async () => {
      const exec = makeExec({
        'pgrep -x 1Password': () => ({ exitCode: 1, stdout: '', stderr: '' }),
      })

      const provider = new OnePasswordProvider({}, { exec })
      const availability = await provider.checkAvailability()

      expect(availability.available).toBe(false)
      expect(availability.helpLines).toContain('Configure 1Password SDK authentication:')
    })
  })

  it('verifyAuth succeeds with service account token', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: 'token', OP_ACCOUNT_NAME: undefined }, async () => {
      let createClientCalls = 0
      const provider = new OnePasswordProvider(
        {},
        {
          createClient: async (args: any) => {
            createClientCalls++
            expect(args.auth).toBe('token')
            return {
              vaults: { list: async () => [] },
              secrets: { resolve: async () => 'sdk-value' },
            } as any
          },
        },
      )

      const auth = await provider.verifyAuth()
      expect(auth.success).toBe(true)
      expect(createClientCalls).toBe(1)
    })
  })

  it('verifyAuth uses default desktop account name when unset', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: undefined, OP_ACCOUNT_NAME: undefined }, async () => {
      const exec = makeExec({
        'pgrep -x 1Password': () => ({ exitCode: 0, stdout: '123\n', stderr: '' }),
      })

      const provider = new OnePasswordProvider(
        {},
        {
          exec,
          createClient: async (args: any) => {
            expect(args.auth.accountName).toBe('my.1password.com')
            return {
              vaults: { list: async () => [] },
              secrets: { resolve: async () => 'sdk-value' },
            } as any
          },
        },
      )
      const auth = await provider.verifyAuth()

      expect(auth.success).toBe(true)
    })
  })
})

describe('OnePasswordProvider (secret resolution modes)', () => {
  it('uses resolveAll and deduplicates references in SDK mode', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: 'token', OP_ACCOUNT_NAME: undefined }, async () => {
      const seenBatches: string[][] = []

      const provider = new OnePasswordProvider(
        {},
        {
          createClient: async () =>
            ({
              vaults: { list: async () => [] },
              secrets: {
                resolve: async () => {
                  throw new Error('resolve should not be used when resolveAll succeeds')
                },
                resolveAll: async (refs: string[]) => {
                  seenBatches.push([...refs])
                  return {
                    individualResponses: Object.fromEntries(
                      refs.map((ref) => [ref, { content: { secret: `resolved(${ref})` } }]),
                    ),
                  }
                },
              },
            }) as any,
        },
      )

      const refs = ['op://vault/item/field', 'op://vault/item/field', 'op://vault/item/other']
      const result = await provider.resolveSecrets(refs)

      expect(seenBatches.length).toBe(1)
      expect(seenBatches[0]).toEqual(['op://vault/item/field', 'op://vault/item/other'])
      expect(result.errors.size).toBe(0)
      expect(result.resolved.get('op://vault/item/field')).toBe('resolved(op://vault/item/field)')
      expect(result.resolved.get('op://vault/item/other')).toBe('resolved(op://vault/item/other)')
    })
  })

  it('falls back to per-reference resolve when resolveAll fails', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: 'token', OP_ACCOUNT_NAME: undefined }, async () => {
      let resolveCalls = 0

      const provider = new OnePasswordProvider(
        {},
        {
          createClient: async () =>
            ({
              vaults: { list: async () => [] },
              secrets: {
                resolveAll: async () => {
                  throw new Error('resolveAll failed')
                },
                resolve: async (ref: string) => {
                  resolveCalls++
                  return `resolved(${ref})`
                },
              },
            }) as any,
        },
      )

      const refs = ['op://vault/item/field', 'op://vault/item/other']
      const result = await provider.resolveSecrets(refs)

      expect(resolveCalls).toBe(2)
      expect(result.errors.size).toBe(0)
      expect(result.resolved.get('op://vault/item/field')).toBe('resolved(op://vault/item/field)')
      expect(result.resolved.get('op://vault/item/other')).toBe('resolved(op://vault/item/other)')
    })
  })

  it('reuses in-memory cache across resolveSecrets calls', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: 'token', OP_ACCOUNT_NAME: undefined }, async () => {
      let resolveAllCalls = 0

      const provider = new OnePasswordProvider(
        {},
        {
          createClient: async () =>
            ({
              vaults: { list: async () => [] },
              secrets: {
                resolveAll: async (refs: string[]) => {
                  resolveAllCalls++
                  return {
                    individualResponses: Object.fromEntries(
                      refs.map((ref) => [ref, { content: { secret: `resolved(${ref})` } }]),
                    ),
                  }
                },
                resolve: async () => {
                  throw new Error('resolve should not be used when resolveAll succeeds')
                },
              },
            }) as any,
        },
      )

      const reference = 'op://vault/item/field'

      const first = await provider.resolveSecrets([reference])
      const second = await provider.resolveSecrets([reference])

      expect(resolveAllCalls).toBe(1)
      expect(first.resolved.get(reference)).toBe('resolved(op://vault/item/field)')
      expect(second.resolved.get(reference)).toBe('resolved(op://vault/item/field)')
    })
  })

  it('resolveMode=sequential skips resolveAll', async () => {
    await withEnv(
      {
        OP_SERVICE_ACCOUNT_TOKEN: 'token',
        OP_ACCOUNT_NAME: undefined,
        ENVI_OP_RESOLVE_MODE: 'sequential',
      },
      async () => {
        let resolveCalls = 0

        const provider = new OnePasswordProvider(
          {},
          {
            createClient: async () =>
              ({
                vaults: { list: async () => [] },
                secrets: {
                  resolveAll: async () => {
                    throw new Error('resolveAll should not be used in sequential mode')
                  },
                  resolve: async (ref: string) => {
                    resolveCalls++
                    return `resolved(${ref})`
                  },
                },
              }) as any,
          },
        )

        const refs = ['op://vault/item/field', 'op://vault/item/other']
        const result = await provider.resolveSecrets(refs)

        expect(resolveCalls).toBe(2)
        expect(result.errors.size).toBe(0)
      },
    )
  })
})
