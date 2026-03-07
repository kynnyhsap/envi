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
        environment: 'local',
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
        environment: 'local',
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
        environment: 'local',
      },
    })

    const redacted = await engine.resolveRunEnvironment()
    expect(redacted.data.env['API_KEY']).toBe('<redacted>')

    const full = await engine.resolveRunEnvironment({ includeSecrets: true })
    expect(full.data.env['API_KEY']).toContain('resolved(')
  })

  it('resolveSecret resolves a single reference with env substitution', async () => {
    const engine = createEnviEngine({
      provider: createFakeProvider(),
      options: {
        provider: '1password',
        environment: 'local',
      },
    })

    const result = await engine.resolveSecret({ reference: 'op://core-${ENV}/api/API_KEY' })
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
        environment: 'local',
      },
    })

    const result = await engine.resolveSecret({
      reference: 'op://core-${ENV}/api/API_KEY',
      references: ['op://core-${ENV}/api/API_KEY', 'op://core-${ENV}/api/JWT_SECRET'],
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
        environment: 'local',
      },
    })

    const result = await engine.status()
    expect(result.data.provider.auth.type).toBe('post')
  })
})
