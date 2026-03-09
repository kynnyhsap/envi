import { describe, expect, it } from 'bun:test'

import { isSecretReference, toNativeReference, validateSecretReferenceFormat } from './index'

describe('provider reference helpers', () => {
  it('recognizes quoted secret references and unwraps them', () => {
    expect(isSecretReference('"op://vault/item/field"')).toBe(true)
    expect(isSecretReference("'op://vault/item/field'")).toBe(true)
    expect(toNativeReference('"op://vault/item/field"')).toBe('op://vault/item/field')
    expect(validateSecretReferenceFormat('"op://vault/item/field"').valid).toBe(true)
  })
})
