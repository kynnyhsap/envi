import { describe, expect, it } from 'bun:test'

import { createFakeProvider } from '../../test-helpers/fake-provider'
import { createMemoryRuntime } from '../../test-helpers/memory-runtime'
import { createEnviEngine, stringifyEnvelope } from '../index'

describe('sdk engine (smoke)', () => {
  it('diff returns JSON envelope and is stringify-able', async () => {
    const cwd = '/repo'
    const runtime = createMemoryRuntime({
      cwd,
      files: {
        '/repo/.env.example': 'API_KEY=envi://vault/item/API_KEY\nNON_SECRET=hello\n',
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
        '/repo/.env.example': 'API_KEY=envi://vault/item/API_KEY\n',
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

    const result = await engine.sync({ dryRun: true, force: true })
    expect(result.command).toBe('sync')
    expect(result.data.paths.length).toBe(1)
  })

  it('resolveRunEnvironment can include secrets when requested', async () => {
    const cwd = '/repo'
    const runtime = createMemoryRuntime({
      cwd,
      files: {
        '/repo/.env.example': 'API_KEY=envi://vault/item/API_KEY\n',
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

  it('status captures authInfo after verifyAuth', async () => {
    const cwd = '/repo'
    const runtime = createMemoryRuntime({
      cwd,
      files: {
        '/repo/.env.example': 'API_KEY=envi://vault/item/API_KEY\n',
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
