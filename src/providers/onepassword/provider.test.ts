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
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k]
    if (v === undefined) {
      delete process.env[k]
    } else {
      process.env[k] = v
    }
  }

  return fn().finally(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })
}

describe('OnePasswordProvider (backend selection)', () => {
  it('does not leak OP_SERVICE_ACCOUNT_TOKEN via getAuthInfo', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: 'super-secret-token', OP_ACCOUNT_NAME: undefined }, async () => {
      const provider = new OnePasswordProvider({ backend: 'sdk' })
      const auth = provider.getAuthInfo()
      expect(auth.type).toBe('service-account')
      expect(auth.identifier).toBe('set')
    })
  })

  it('backend=auto uses CLI when installed + authenticated and SDK is unavailable', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: undefined, OP_ACCOUNT_NAME: undefined }, async () => {
      const exec = makeExec({
        'op --version': () => ({ exitCode: 0, stdout: '2.0.0\n', stderr: '' }),
        'op whoami --format json': () => ({ exitCode: 0, stdout: '{"account":"x"}\n', stderr: '' }),
        'op read op://vault/item/field': () => ({ exitCode: 0, stdout: 'value\n', stderr: '' }),
      })

      const provider = new OnePasswordProvider(
        { backend: 'auto' },
        {
          exec,
          createClient: async () => {
            throw new Error('SDK should not be used')
          },
        },
      )

      const auth = await provider.verifyAuth()
      expect(auth.success).toBe(true)
      expect(provider.getAuthInfo().type).toBe('cli')

      const value = await provider.resolveSecret('op://vault/item/field')
      expect(value).toBe('value')
    })
  })

  it('default backend prefers SDK when available', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: 'token', OP_ACCOUNT_NAME: undefined }, async () => {
      let createClientCalls = 0
      const calls: string[] = []
      const exec = makeExec({
        'op --version': () => ({ exitCode: 0, stdout: '2.0.0\n', stderr: '' }),
      })

      const execWithTrace = async (command: string, args: string[] = []) => {
        calls.push(`${command} ${args.join(' ')}`.trim())
        return exec(command, args)
      }

      const provider = new OnePasswordProvider(
        {},
        {
          exec: execWithTrace,
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
      expect(provider.getAuthInfo().type).toBe('service-account')
      expect(createClientCalls).toBe(1)
      expect(calls).toEqual([])
    })
  })

  it('backend=cli does not fall back to SDK', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: 'token', OP_ACCOUNT_NAME: undefined }, async () => {
      let createClientCalls = 0
      const exec = makeExec({
        'op --version': () => ({ exitCode: 0, stdout: '2.0.0\n', stderr: '' }),
        'op whoami --format json': () => ({ exitCode: 1, stdout: '', stderr: 'not signed in' }),
      })

      const provider = new OnePasswordProvider(
        { backend: 'cli' },
        {
          exec,
          createClient: async () => {
            createClientCalls++
            return {} as any
          },
        },
      )

      const auth = await provider.verifyAuth()
      expect(auth.success).toBe(false)
      expect(createClientCalls).toBe(0)
    })
  })

  it('backend=auto uses SDK when op is not installed', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: 'token', OP_ACCOUNT_NAME: undefined }, async () => {
      const exec = makeExec({
        'op --version': () => ({ exitCode: 1, stdout: '', stderr: 'spawn op ENOENT' }),
      })

      const provider = new OnePasswordProvider(
        { backend: 'auto' },
        {
          exec,
          createClient: async () => ({ vaults: { list: async () => [] }, secrets: { resolve: async () => '' } }) as any,
        },
      )

      const auth = await provider.verifyAuth()
      expect(auth.success).toBe(true)
      expect(provider.getAuthInfo().type).toBe('service-account')
    })
  })

  it('treats timed out CLI availability checks as unavailable', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: 'token', OP_ACCOUNT_NAME: undefined }, async () => {
      let createClientCalls = 0
      const exec = makeExec({
        'op --version': () => ({ exitCode: 1, stdout: '', stderr: 'Command timed out after 10000ms' }),
      })

      const provider = new OnePasswordProvider(
        { backend: 'auto' },
        {
          exec,
          createClient: async () => {
            createClientCalls++
            return { vaults: { list: async () => [] }, secrets: { resolve: async () => '' } } as any
          },
        },
      )

      const auth = await provider.verifyAuth()
      expect(auth.success).toBe(true)
      expect(provider.getAuthInfo().type).toBe('service-account')
      expect(createClientCalls).toBe(1)
    })
  })

  it('desktop auth auto-detects personal account when OP_ACCOUNT_NAME is unset', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: undefined, OP_ACCOUNT_NAME: undefined }, async () => {
      let createClientCalls = 0
      const exec = makeExec({
        'op --version': () => ({ exitCode: 0, stdout: '2.0.0\n', stderr: '' }),
        'pgrep -x 1Password': () => ({ exitCode: 0, stdout: '123\n', stderr: '' }),
        'op account list --format json': () =>
          ({
            exitCode: 0,
            stdout:
              JSON.stringify([
                { url: 'my.1password.com', email: 'me@example.com' },
                { url: 'team.1password.com', email: 'me@company.com' },
              ]) + '\n',
            stderr: '',
          }) satisfies ExecResult,
      })

      const provider = new OnePasswordProvider(
        { backend: 'sdk' },
        {
          exec,
          createClient: async (args: any) => {
            createClientCalls++
            expect(args.auth).toBeTruthy()
            expect(args.auth.accountName).toBe('my.1password.com')
            return {
              vaults: { list: async () => [] },
              secrets: { resolve: async () => '' },
            } as any
          },
        },
      )

      const auth = await provider.verifyAuth()
      expect(auth.success).toBe(true)
      expect(provider.getAuthInfo().type).toBe('desktop-app')
      expect(createClientCalls).toBe(1)
    })
  })
})

describe('OnePasswordProvider (secret resolution modes)', () => {
  it('uses resolveAll and deduplicates references in SDK mode', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: 'token', OP_ACCOUNT_NAME: undefined }, async () => {
      const seenBatches: string[][] = []

      const provider = new OnePasswordProvider(
        { backend: 'sdk', resolveMode: 'batch' },
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
        { backend: 'sdk', resolveMode: 'batch' },
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
        { backend: 'sdk', resolveMode: 'batch' },
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
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: 'token', OP_ACCOUNT_NAME: undefined }, async () => {
      let resolveCalls = 0

      const provider = new OnePasswordProvider(
        { backend: 'sdk', resolveMode: 'sequential' },
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
      expect(result.resolved.get('op://vault/item/field')).toBe('resolved(op://vault/item/field)')
      expect(result.resolved.get('op://vault/item/other')).toBe('resolved(op://vault/item/other)')
    })
  })
})
