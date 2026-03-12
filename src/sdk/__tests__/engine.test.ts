import { describe, expect, it } from 'bun:test'

import { createFakeProvider } from '../../testing/fake-provider'
import { createMemoryRuntime } from '../../testing/memory-runtime'
import { createEnviEngine, stringifyEnvelope } from '../index'

describe('sdk engine (smoke)', () => {
  it('diff returns JSON envelope and is stringify-able', async () => {
    const cwd = '/repo'
    const runtime = createMemoryRuntime({
      cwd,
      files: {
        '/repo/.env.example': 'API_KEY=op://vault/item/API_KEY\nNON_SECRET=hello\n',
        '/repo/.env': 'NON_SECRET=hello\n',
      },
      templateMatches: ['.env.example'],
    })

    const engine = createEnviEngine({
      runtime,
      provider: createFakeProvider(),
      options: {
        rootDir: cwd,
        provider: '1password',
        vars: { PROFILE: 'local' },
      },
    })

    const result = await engine.diff()
    expect(result.command).toBe('diff')
    expect(result.schemaVersion).toBe(1)
    expect(typeof stringifyEnvelope(result)).toBe('string')

    const firstPath = result.data.paths[0]
    expect(firstPath).toBeTruthy()
    const secretChange = firstPath!.changes.find((c) => c.key === 'API_KEY')
    expect(secretChange?.newValue).toBe('<redacted>')
  })

  it('diff reports missing dynamic vars with actionable guidance', async () => {
    const cwd = '/repo'
    const runtime = createMemoryRuntime({
      cwd,
      files: {
        '/repo/.env.example': 'API_KEY=op://vault-${PROFILE}/item/API_KEY\n',
      },
      templateMatches: ['.env.example'],
    })

    const engine = createEnviEngine({
      runtime,
      provider: createFakeProvider(),
      options: {
        rootDir: cwd,
        provider: '1password',
      },
    })

    const result = await engine.diff()
    expect(result.ok).toBe(false)
    expect(result.issues.some((issue) => issue.code === 'UNRESOLVED_VARIABLE')).toBe(true)

    const firstPath = result.data.paths[0]
    expect(firstPath?.hasEnv).toBe(false)
    expect(firstPath?.error).toContain('Missing dynamic vars: PROFILE')
    expect(firstPath?.error).toContain('Pass required vars:\n  --var PROFILE=<value>')
    expect(firstPath?.error).toContain('--var PROFILE=<value>')
    expect(firstPath?.error).toContain('envi.json')
  })

  it('sync dry-run computes changes without writing', async () => {
    const cwd = '/repo'
    const runtime = createMemoryRuntime({
      cwd,
      files: {
        '/repo/.env.example': 'API_KEY=op://vault/item/API_KEY\n',
      },
      templateMatches: ['.env.example'],
    })

    const engine = createEnviEngine({
      runtime,
      provider: createFakeProvider(),
      options: {
        rootDir: cwd,
        provider: '1password',
        vars: { PROFILE: 'local' },
      },
    })

    const result = await engine.sync({ dryRun: true })
    expect(result.command).toBe('sync')
    expect(result.data.paths.length).toBe(1)
  })

  it('resolveRunEnvironment can include secrets when requested', async () => {
    const cwd = '/repo'
    const runtime = createMemoryRuntime({
      cwd,
      files: {
        '/repo/.env.example': 'API_KEY=op://vault/item/API_KEY\n',
      },
      templateMatches: ['.env.example'],
    })

    const engine = createEnviEngine({
      runtime,
      provider: createFakeProvider(),
      options: {
        rootDir: cwd,
        provider: '1password',
        vars: { PROFILE: 'local' },
      },
    })

    const redacted = await engine.resolveRunEnvironment()
    expect(redacted.data.env['API_KEY']).toBe('<redacted>')

    const full = await engine.resolveRunEnvironment({ includeSecrets: true })
    expect(full.data.env['API_KEY']).toContain('resolved(')
  })

  it('resolveSecret resolves a single reference with var substitution', async () => {
    const engine = createEnviEngine({
      provider: createFakeProvider(),
      options: {
        provider: '1password',
        vars: { PROFILE: 'local' },
      },
    })

    const result = await engine.resolveSecret({ reference: 'op://core-${PROFILE}/api/API_KEY' })
    expect(result.command).toBe('resolve')
    expect(result.ok).toBe(true)
    expect('results' in result.data).toBe(false)
    if (!('results' in result.data)) {
      expect(result.data.nativeReference).toBe('op://core-local/api/API_KEY')
      expect(result.data.secret).toBe('resolved(op://core-local/api/API_KEY)')
    }
  })

  it('resolveSecret resolves multiple references in order', async () => {
    const engine = createEnviEngine({
      provider: createFakeProvider(),
      options: {
        provider: '1password',
        vars: { PROFILE: 'local' },
      },
    })

    const result = await engine.resolveSecret({
      reference: 'op://core-${PROFILE}/api/API_KEY',
      references: ['op://core-${PROFILE}/api/API_KEY', 'op://core-${PROFILE}/api/JWT_SECRET'],
    })

    expect(result.command).toBe('resolve')
    expect(result.ok).toBe(true)
    expect('results' in result.data).toBe(true)
    if ('results' in result.data) {
      expect(result.data.results.map((entry) => entry.nativeReference)).toEqual([
        'op://core-local/api/API_KEY',
        'op://core-local/api/JWT_SECRET',
      ])
      expect(result.data.results.map((entry) => entry.secret)).toEqual([
        'resolved(op://core-local/api/API_KEY)',
        'resolved(op://core-local/api/JWT_SECRET)',
      ])
    }
  })

  it('status captures authInfo after verifyAuth', async () => {
    const cwd = '/repo'
    const runtime = createMemoryRuntime({
      cwd,
      files: {
        '/repo/.env.example': 'API_KEY=op://vault/item/API_KEY\n',
      },
      templateMatches: ['.env.example'],
    })

    let mode: 'pre' | 'post' = 'pre'

    const provider = {
      id: 'test',
      name: 'Test Provider',
      scheme: 'op://',
      getAuthInfo() {
        return { type: mode, identifier: mode }
      },
      async checkAvailability() {
        return { available: true, statusLines: [], helpLines: [] }
      },
      async verifyAuth() {
        mode = 'post'
        return { success: true }
      },
      getAuthFailureHints() {
        return { lines: [] }
      },
      async resolveSecret() {
        return ''
      },
      async resolveSecrets() {
        return { resolved: new Map(), errors: new Map() }
      },
      async listVaults() {
        return []
      },
    } as any

    const engine = createEnviEngine({
      runtime,
      provider,
      options: {
        rootDir: cwd,
        provider: '1password',
        vars: { PROFILE: 'local' },
      },
    })

    const result = await engine.status()
    expect(result.data.provider.auth.type).toBe('post')
  })

  it('sync resolves quoted and unquoted secret references to escaped multiline values', async () => {
    const cwd = '/repo'
    const runtime = createMemoryRuntime({
      cwd,
      files: {
        '/repo/.env.example': 'MULTILINE=op://vault/item/MULTI\nQUOTED="op://vault/item/MULTI"\n',
      },
      templateMatches: ['.env.example'],
    })

    const provider = {
      ...createFakeProvider(),
      async resolveSecrets(references: string[]) {
        return {
          resolved: new Map(references.map((reference) => [reference, 'line1\nline2'])),
          errors: new Map(),
        }
      },
      async resolveSecret() {
        return 'line1\nline2'
      },
    }

    const engine = createEnviEngine({
      runtime,
      provider,
      options: {
        rootDir: cwd,
        provider: '1password',
        vars: { PROFILE: 'local' },
      },
    })

    const result = await engine.sync()
    expect(result.ok).toBe(true)

    const output = await runtime.readText('/repo/.env')
    expect(output).toContain('MULTILINE="line1\\nline2"')
    expect(output).toContain('QUOTED="line1\\nline2"')
  })

  it('resolveRunEnvironment resolves quoted env-file references', async () => {
    const cwd = '/repo'
    const runtime = createMemoryRuntime({
      cwd,
      files: {
        '/repo/.env.secrets': 'APP_STORE_CONNECT_API_KEY_CONTENT="op://vault/item/MULTI"\n',
      },
      templateMatches: [],
    })

    const provider = {
      ...createFakeProvider(),
      async resolveSecrets(references: string[]) {
        return {
          resolved: new Map(references.map((reference) => [reference, 'line1\nline2'])),
          errors: new Map(),
        }
      },
      async resolveSecret() {
        return 'line1\nline2'
      },
    }

    const engine = createEnviEngine({
      runtime,
      provider,
      options: {
        rootDir: cwd,
        provider: '1password',
        vars: { PROFILE: 'local' },
      },
    })

    const result = await engine.resolveRunEnvironment({ envFile: ['/repo/.env.secrets'], includeSecrets: true })
    expect(result.ok).toBe(true)
    expect(result.data.env['APP_STORE_CONNECT_API_KEY_CONTENT']).toBe('line1\nline2')
  })
})
