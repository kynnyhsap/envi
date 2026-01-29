import { describe, expect, it } from 'bun:test'
import { isSecretReference } from './secrets'

describe('isSecretReference', () => {
  it('should identify op:// references as secrets', () => {
    expect(isSecretReference('op://vault/item/field')).toBe(true)
    expect(isSecretReference('op://sandbox/engine-api/SECRET')).toBe(true)
    expect(isSecretReference('  op://vault/item/field  ')).toBe(true)
  })

  it('should identify envi:// references as secrets', () => {
    expect(isSecretReference('envi://vault/item/field')).toBe(true)
    expect(isSecretReference('envi://core-local/engine-api/SECRET')).toBe(true)
    expect(isSecretReference('  envi://vault/item/field  ')).toBe(true)
  })

  it('should identify pass:// references as secrets', () => {
    expect(isSecretReference('pass://vault/item/field')).toBe(true)
    expect(isSecretReference('pass://Work/GitHub/password')).toBe(true)
    expect(isSecretReference('  pass://vault/item/field  ')).toBe(true)
  })

  it('should not identify regular values as secrets', () => {
    expect(isSecretReference('development')).toBe(false)
    expect(isSecretReference('http://localhost:3000')).toBe(false)
    expect(isSecretReference('abc123')).toBe(false)
    expect(isSecretReference('')).toBe(false)
  })

  it('should not identify values containing scheme that are not at the start', () => {
    expect(isSecretReference('some text op://vault/item/field more text')).toBe(false)
    expect(isSecretReference('some text envi://vault/item/field more text')).toBe(false)
    expect(isSecretReference('some text pass://vault/item/field more text')).toBe(false)
  })
})
