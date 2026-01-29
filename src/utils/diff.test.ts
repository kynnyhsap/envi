import { describe, expect, it } from 'bun:test'

import { computeChanges } from './diff'
import type { EnvFile } from './types'

// Helper function to create EnvFile for testing
function createEnvFile(vars: Record<string, string>): EnvFile {
  const envVars = new Map(Object.entries(vars).map(([key, value]) => [key, { key, value, isCustom: false }]))
  return {
    vars: envVars,
    order: Object.keys(vars),
    trailingContent: '',
  }
}

describe('computeChanges', () => {
  describe('when local .env does not exist (first run)', () => {
    it('should mark all vars as NEW', () => {
      const template = createEnvFile({
        NODE_ENV: 'development',
        SECRET: 'op://vault/item/SECRET',
      })
      const injected = createEnvFile({
        NODE_ENV: 'development',
        SECRET: 'actual-secret-value',
      })

      const changes = computeChanges(template, injected, null)

      expect(changes.filter((c) => c.type === 'new')).toHaveLength(2)
      expect(changes.find((c) => c.key === 'NODE_ENV')?.type).toBe('new')
      expect(changes.find((c) => c.key === 'SECRET')?.type).toBe('new')
    })
  })

  describe('when local .env exists', () => {
    it('should mark unchanged values as UNCHANGED', () => {
      const template = createEnvFile({ NODE_ENV: 'development' })
      const injected = createEnvFile({ NODE_ENV: 'development' })
      const local = createEnvFile({ NODE_ENV: 'development' })

      const changes = computeChanges(template, injected, local)

      expect(changes.find((c) => c.key === 'NODE_ENV')?.type).toBe('unchanged')
    })

    it('should mark updated secrets as UPDATED', () => {
      const template = createEnvFile({
        SECRET: 'op://vault/item/SECRET',
      })
      const injected = createEnvFile({
        SECRET: 'new-secret-value',
      })
      const local = createEnvFile({
        SECRET: 'old-secret-value',
      })

      const changes = computeChanges(template, injected, local)

      const change = changes.find((c) => c.key === 'SECRET')
      expect(change?.type).toBe('updated')
      expect(change?.localValue).toBe('old-secret-value')
      expect(change?.newValue).toBe('new-secret-value')
    })

    it('should preserve local customizations of non-secrets', () => {
      const template = createEnvFile({
        NODE_ENV: 'development',
      })
      const injected = createEnvFile({
        NODE_ENV: 'development',
      })
      const local = createEnvFile({
        NODE_ENV: 'production', // User changed this
      })

      const changes = computeChanges(template, injected, local)

      const change = changes.find((c) => c.key === 'NODE_ENV')
      expect(change?.type).toBe('local_modified')
      expect(change?.localValue).toBe('production')
      expect(change?.templateValue).toBe('development')
    })

    it('should identify local-only vars (not in template)', () => {
      const template = createEnvFile({
        NODE_ENV: 'development',
      })
      const injected = createEnvFile({
        NODE_ENV: 'development',
      })
      const local = createEnvFile({
        NODE_ENV: 'development',
        DEBUG: 'true', // User added this
        MY_CUSTOM_VAR: 'custom', // User added this too
      })

      const changes = computeChanges(template, injected, local)

      expect(changes.find((c) => c.key === 'DEBUG')?.type).toBe('custom')
      expect(changes.find((c) => c.key === 'MY_CUSTOM_VAR')?.type).toBe('custom')
    })

    it('should identify missing vars (in template but not in local)', () => {
      const template = createEnvFile({
        NODE_ENV: 'development',
        NEW_VAR: 'op://vault/item/NEW_VAR',
      })
      const injected = createEnvFile({
        NODE_ENV: 'development',
        NEW_VAR: 'new-value',
      })
      const local = createEnvFile({
        NODE_ENV: 'development',
        // NEW_VAR is missing
      })

      const changes = computeChanges(template, injected, local)

      const change = changes.find((c) => c.key === 'NEW_VAR')
      expect(change?.type).toBe('new')
      expect(change?.newValue).toBe('new-value')
    })
  })

  describe('edge cases', () => {
    it('should handle empty template', () => {
      const template = createEnvFile({})
      const injected = createEnvFile({})
      const local = createEnvFile({ CUSTOM: 'value' })

      const changes = computeChanges(template, injected, local)

      expect(changes.find((c) => c.key === 'CUSTOM')?.type).toBe('custom')
    })

    it('should not lose vars when template removes a var that exists locally', () => {
      // Old template had SECRET, new template removed it, but user still has it
      const template = createEnvFile({
        NODE_ENV: 'development',
        // SECRET was removed from template
      })
      const injected = createEnvFile({
        NODE_ENV: 'development',
      })
      const local = createEnvFile({
        NODE_ENV: 'development',
        SECRET: 'my-secret', // User still has this
      })

      const changes = computeChanges(template, injected, local)

      // SECRET should be preserved as local-only
      expect(changes.find((c) => c.key === 'SECRET')?.type).toBe('custom')
    })
  })
})
