import { describe, expect, it } from 'bun:test'

import { isSecretReference, detectProvider, toNativeReference, parseSecretReference } from './index'

describe('isSecretReference', () => {
  it('detects envi:// references', () => {
    expect(isSecretReference('envi://vault/item/field')).toBe(true)
  })

  it('detects op:// references', () => {
    expect(isSecretReference('op://vault/item/field')).toBe(true)
  })

  it('detects pass:// references', () => {
    expect(isSecretReference('pass://vault/item/field')).toBe(true)
  })

  it('handles whitespace', () => {
    expect(isSecretReference('  envi://vault/item/field  ')).toBe(true)
  })

  it('rejects non-secret values', () => {
    expect(isSecretReference('http://example.com')).toBe(false)
    expect(isSecretReference('plain-value')).toBe(false)
    expect(isSecretReference('')).toBe(false)
  })
})

describe('detectProvider', () => {
  it('routes op:// to 1password', () => {
    expect(detectProvider('op://vault/item/field')).toBe('1password')
  })

  it('routes pass:// to proton-pass', () => {
    expect(detectProvider('pass://vault/item/field')).toBe('proton-pass')
  })

  it('returns undefined for envi:// (use default)', () => {
    expect(detectProvider('envi://vault/item/field')).toBeUndefined()
  })

  it('returns undefined for unknown schemes', () => {
    expect(detectProvider('http://example.com')).toBeUndefined()
  })
})

describe('toNativeReference', () => {
  it('converts envi:// to op://', () => {
    expect(toNativeReference('envi://vault/item/field', 'op://')).toBe('op://vault/item/field')
  })

  it('converts envi:// to pass://', () => {
    expect(toNativeReference('envi://vault/item/field', 'pass://')).toBe('pass://vault/item/field')
  })

  it('passes through op:// unchanged', () => {
    expect(toNativeReference('op://vault/item/field', 'pass://')).toBe('op://vault/item/field')
  })

  it('passes through pass:// unchanged', () => {
    expect(toNativeReference('pass://vault/item/field', 'op://')).toBe('pass://vault/item/field')
  })

  it('handles whitespace', () => {
    expect(toNativeReference('  envi://vault/item/field  ', 'op://')).toBe('op://vault/item/field')
  })
})

describe('parseSecretReference', () => {
  it('parses envi:// references', () => {
    const ref = parseSecretReference('envi://core-local/engine-api/SECRET')
    expect(ref.vault).toBe('core-local')
    expect(ref.item).toBe('engine-api')
    expect(ref.field).toBe('SECRET')
    expect(ref.raw).toBe('envi://core-local/engine-api/SECRET')
  })

  it('parses op:// references', () => {
    const ref = parseSecretReference('op://vault/item/field')
    expect(ref.vault).toBe('vault')
    expect(ref.item).toBe('item')
    expect(ref.field).toBe('field')
  })

  it('parses pass:// references', () => {
    const ref = parseSecretReference('pass://Work/GitHub/password')
    expect(ref.vault).toBe('Work')
    expect(ref.item).toBe('GitHub')
    expect(ref.field).toBe('password')
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
})
