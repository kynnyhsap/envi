import { describe, expect, it } from 'bun:test'
import { isSecretReference } from './secrets'

describe('isSecretReference', () => {
  it('should identify op:// references as secrets', () => {
    expect(isSecretReference('op://vault/item/field')).toBe(true)
    expect(isSecretReference('op://sandbox/engine-api/SECRET')).toBe(true)
    expect(isSecretReference('  op://vault/item/field  ')).toBe(true)
  })

  it('should not identify regular values as secrets', () => {
    expect(isSecretReference('development')).toBe(false)
    expect(isSecretReference('http://localhost:3000')).toBe(false)
    expect(isSecretReference('abc123')).toBe(false)
    expect(isSecretReference('')).toBe(false)
  })

  it('should not identify values containing op:// that are not at the start', () => {
    const value = 'some text op://vault/item/field more text'
    expect(isSecretReference(value)).toBe(false)
  })
})
