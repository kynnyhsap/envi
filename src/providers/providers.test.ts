import { describe, expect, it } from 'bun:test'

import { isSecretReference, toNativeReference, parseSecretReference, validateSecretReferenceFormat } from './index'

describe('isSecretReference', () => {
  it('detects op:// references', () => {
    expect(isSecretReference('op://vault/item/field')).toBe(true)
  })

  it('handles whitespace', () => {
    expect(isSecretReference('  op://vault/item/field  ')).toBe(true)
  })

  it('rejects non-secret values', () => {
    expect(isSecretReference('http://example.com')).toBe(false)
    expect(isSecretReference('plain-value')).toBe(false)
    expect(isSecretReference('')).toBe(false)
  })
})

describe('toNativeReference', () => {
  it('passes through op:// unchanged', () => {
    expect(toNativeReference('op://vault/item/field')).toBe('op://vault/item/field')
  })

  it('handles whitespace', () => {
    expect(toNativeReference('  op://vault/item/field  ')).toBe('op://vault/item/field')
  })
})

describe('parseSecretReference', () => {
  it('parses op:// references', () => {
    const ref = parseSecretReference('op://vault/item/field')
    expect(ref.vault).toBe('vault')
    expect(ref.item).toBe('item')
    expect(ref.field).toBe('field')
  })

  it('handles section in field (op:// vault/item/section/field)', () => {
    const ref = parseSecretReference('op://vault/item/section/field')
    expect(ref.vault).toBe('vault')
    expect(ref.item).toBe('item')
    expect(ref.field).toBe('section/field')
  })

  it('trims whitespace', () => {
    const ref = parseSecretReference('  op://vault/item/field  ')
    expect(ref.vault).toBe('vault')
  })

  it('throws on too few parts', () => {
    expect(() => parseSecretReference('op://vault/item')).toThrow()
  })

  it('throws on unknown scheme', () => {
    expect(() => parseSecretReference('http://example.com')).toThrow()
  })

  it('throws on empty parts', () => {
    expect(() => parseSecretReference('op:///item/field')).toThrow('Vault name is empty')
    expect(() => parseSecretReference('op://vault//field')).toThrow('Item name is empty')
    expect(() => parseSecretReference('op://vault/item/')).toThrow('Field name is empty')
  })
})

describe('validateSecretReferenceFormat', () => {
  it('accepts valid references', () => {
    expect(validateSecretReferenceFormat('op://core-local/sentry/SENTRY_READ_ONLY_PAT')).toEqual({ valid: true })
  })

  it('rejects invalid references', () => {
    expect(validateSecretReferenceFormat('not-a-reference')).toEqual({
      valid: false,
      error: 'Must start with op://',
    })

    expect(validateSecretReferenceFormat('op://vault/item')).toEqual({
      valid: false,
      error: 'Must have at least 3 parts: vault/item/field',
    })

    expect(validateSecretReferenceFormat('op:///item/field')).toEqual({ valid: false, error: 'Vault name is empty' })
    expect(validateSecretReferenceFormat('op://vault//field')).toEqual({ valid: false, error: 'Item name is empty' })
    expect(validateSecretReferenceFormat('op://vault/item/')).toEqual({ valid: false, error: 'Field name is empty' })
  })
})
