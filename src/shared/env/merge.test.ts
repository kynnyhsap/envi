import { describe, expect, it } from 'bun:test'

import { mergeEnvFiles } from './merge'
import type { EnvFile, Change } from './types'

// Helper function to create EnvFile for testing
function createEnvFile(vars: Record<string, string>, comments?: Record<string, string>): EnvFile {
  const envVars = new Map(
    Object.entries(vars).map(([key, value]) => [key, { key, value, isCustom: false, comment: comments?.[key] }]),
  )
  return {
    vars: envVars,
    order: Object.keys(vars),
    trailingContent: '',
  }
}

describe('mergeEnvFiles', () => {
  it('should create file from scratch when no local exists', () => {
    const template = createEnvFile({
      NODE_ENV: 'development',
      SECRET: 'op://vault/item/SECRET',
    })
    const injected = createEnvFile({
      NODE_ENV: 'development',
      SECRET: 'actual-secret',
    })
    const changes: Change[] = [
      { type: 'new', key: 'NODE_ENV', newValue: 'development' },
      { type: 'new', key: 'SECRET', newValue: 'actual-secret' },
    ]

    const result = mergeEnvFiles(template, injected, null, changes)

    expect(result.vars.get('NODE_ENV')?.value).toBe('development')
    expect(result.vars.get('SECRET')?.value).toBe('actual-secret')
  })

  it('should preserve local customizations', () => {
    const template = createEnvFile({
      NODE_ENV: 'development',
      PORT: '3000',
    })
    const injected = createEnvFile({
      NODE_ENV: 'development',
      PORT: '3000',
    })
    const local = createEnvFile({
      NODE_ENV: 'production', // customized
      PORT: '3000',
    })
    const changes: Change[] = [
      {
        type: 'local_modified',
        key: 'NODE_ENV',
        templateValue: 'development',
        localValue: 'production',
      },
      { type: 'unchanged', key: 'PORT' },
    ]

    const result = mergeEnvFiles(template, injected, local, changes)

    expect(result.vars.get('NODE_ENV')?.value).toBe('production')
    expect(result.vars.get('PORT')?.value).toBe('3000')
  })

  it('should apply updated secrets from 1Password', () => {
    const template = createEnvFile({
      SECRET: 'op://vault/item/SECRET',
    })
    const injected = createEnvFile({
      SECRET: 'new-secret-value',
    })
    const local = createEnvFile({
      SECRET: 'old-secret-value',
    })
    const changes: Change[] = [
      {
        type: 'updated',
        key: 'SECRET',
        localValue: 'old-secret-value',
        newValue: 'new-secret-value',
      },
    ]

    const result = mergeEnvFiles(template, injected, local, changes)

    expect(result.vars.get('SECRET')?.value).toBe('new-secret-value')
  })

  it('should add local-only vars at the bottom with separator', () => {
    const template = createEnvFile({
      NODE_ENV: 'development',
    })
    const injected = createEnvFile({
      NODE_ENV: 'development',
    })
    const local = createEnvFile({
      NODE_ENV: 'development',
      MY_DEBUG: 'true',
      CUSTOM_VAR: 'value',
    })
    const changes: Change[] = [
      { type: 'unchanged', key: 'NODE_ENV' },
      { type: 'custom', key: 'MY_DEBUG', localValue: 'true' },
      { type: 'custom', key: 'CUSTOM_VAR', localValue: 'value' },
    ]

    const result = mergeEnvFiles(template, injected, local, changes)

    expect(result.vars.get('MY_DEBUG')?.value).toBe('true')
    expect(result.vars.get('MY_DEBUG')?.isCustom).toBe(true)
    expect(result.vars.get('CUSTOM_VAR')?.isCustom).toBe(true)

    // Local vars should come after template vars in order
    const nodeEnvIndex = result.order.indexOf('NODE_ENV')
    const debugIndex = result.order.indexOf('MY_DEBUG')
    expect(debugIndex).toBeGreaterThan(nodeEnvIndex)
  })

  it('should preserve order of template vars', () => {
    const template = createEnvFile({
      FIRST: 'a',
      SECOND: 'b',
      THIRD: 'c',
    })
    const injected = createEnvFile({
      FIRST: 'a',
      SECOND: 'b',
      THIRD: 'c',
    })

    const changes: Change[] = [
      { type: 'new', key: 'FIRST', newValue: 'a' },
      { type: 'new', key: 'SECOND', newValue: 'b' },
      { type: 'new', key: 'THIRD', newValue: 'c' },
    ]

    const result = mergeEnvFiles(template, injected, null, changes)

    expect(result.order).toEqual(['FIRST', 'SECOND', 'THIRD'])
  })

  it('should use template trailing content', () => {
    const template: EnvFile = {
      vars: new Map([['NODE_ENV', { key: 'NODE_ENV', value: 'development', isCustom: false }]]),
      order: ['NODE_ENV'],
      trailingContent: '# Footer comment',
    }
    const injected: EnvFile = {
      vars: new Map([['NODE_ENV', { key: 'NODE_ENV', value: 'dev', isCustom: false }]]),
      order: ['NODE_ENV'],
      trailingContent: '',
    }
    const changes: Change[] = [{ type: 'new', key: 'NODE_ENV', newValue: 'dev' }]

    const result = mergeEnvFiles(template, injected, null, changes)

    expect(result.trailingContent).toBe('# Footer comment')
  })

  it('should preserve template comments in output', () => {
    const template = createEnvFile(
      {
        NODE_ENV: 'development',
        SECRET: 'op://vault/item/SECRET',
      },
      {
        SECRET: '# DEV Auth0 credentials',
      },
    )
    const injected = createEnvFile({
      NODE_ENV: 'development',
      SECRET: 'actual-secret',
    })
    const changes: Change[] = [
      { type: 'new', key: 'NODE_ENV', newValue: 'development' },
      { type: 'new', key: 'SECRET', newValue: 'actual-secret' },
    ]

    const result = mergeEnvFiles(template, injected, null, changes)

    expect(result.vars.get('SECRET')?.comment).toBe('# DEV Auth0 credentials')
  })
})
