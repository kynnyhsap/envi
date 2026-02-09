import { describe, expect, it } from 'bun:test'

import type { ExecResult } from '../runtime/exec'
import { OnePasswordProvider } from './1password.provider'

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

  it('auto mode uses CLI when installed + authenticated', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: undefined, OP_ACCOUNT_NAME: undefined }, async () => {
      const exec = makeExec({
        'op --version': () => ({ exitCode: 0, stdout: '2.0.0\n', stderr: '' }),
        'op whoami --format json': () => ({ exitCode: 0, stdout: '{"account":"x"}\n', stderr: '' }),
        'op read op://vault/item/field': () => ({ exitCode: 0, stdout: 'value\n', stderr: '' }),
      })

      const provider = new OnePasswordProvider(
        {},
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

  it('auto mode prefers SDK when available', async () => {
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
      expect(calls).toEqual(['op --version'])
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

  it('auto mode uses SDK when op is not installed', async () => {
    await withEnv({ OP_SERVICE_ACCOUNT_TOKEN: 'token', OP_ACCOUNT_NAME: undefined }, async () => {
      const exec = makeExec({
        'op --version': () => ({ exitCode: 1, stdout: '', stderr: 'spawn op ENOENT' }),
      })

      const provider = new OnePasswordProvider(
        {},
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
})
