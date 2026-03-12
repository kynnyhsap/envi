import { describe, expect, it } from 'bun:test'

import {
  hasUnresolvedVariables,
  normalizeReferenceVars,
  resolveReferenceVars,
  shouldPersistReferenceVars,
  substituteVariables,
} from './variables'

describe('resolveReferenceVars', () => {
  it('does not inject defaults', () => {
    expect(resolveReferenceVars({})).toEqual({})
    expect(resolveReferenceVars({ PROFILE: 'prod' })).toEqual({ PROFILE: 'prod' })
  })
})

describe('shouldPersistReferenceVars', () => {
  it('does not persist missing or empty vars', () => {
    expect(shouldPersistReferenceVars(undefined)).toBe(false)
    expect(shouldPersistReferenceVars({})).toBe(false)
    expect(shouldPersistReferenceVars({ ' ': 'value' })).toBe(false)
  })

  it('persists explicit vars', () => {
    expect(shouldPersistReferenceVars({ PROFILE: 'default' })).toBe(true)
    expect(shouldPersistReferenceVars({ PROFILE: 'prod' })).toBe(true)
    expect(shouldPersistReferenceVars({ REGION: 'eu' })).toBe(true)
  })
})

describe('normalizeReferenceVars', () => {
  it('trims and sorts vars', () => {
    expect(normalizeReferenceVars({ ' PROFILE ': ' local ', REGION: 'eu' })).toEqual({ PROFILE: 'local', REGION: 'eu' })
  })
})

describe('substituteVariables', () => {
  it('substitutes ${PROFILE} in op:// references', () => {
    expect(substituteVariables('op://core-${PROFILE}/engine-api/SECRET', { PROFILE: 'local' })).toBe(
      'op://core-local/engine-api/SECRET',
    )
    expect(substituteVariables('op://core-${PROFILE}/engine-api/SECRET', { PROFILE: 'prod' })).toBe(
      'op://core-prod/engine-api/SECRET',
    )
  })

  it('substitutes multiple placeholders', () => {
    expect(substituteVariables('op://${PROFILE}/${REGION}/field', { PROFILE: 'dev', REGION: 'eu' })).toBe(
      'op://dev/eu/field',
    )
  })

  it('supports quoted secret references', () => {
    expect(substituteVariables('"op://core-${PROFILE}/item/field"', { PROFILE: 'staging' })).toBe(
      '"op://core-staging/item/field"',
    )
  })

  it('does not substitute in non-secret values', () => {
    expect(substituteVariables('${PROFILE}_value', { PROFILE: 'prod' })).toBe('${PROFILE}_value')
    expect(substituteVariables('some-${PROFILE}-string', { PROFILE: 'dev' })).toBe('some-${PROFILE}-string')
  })

  it('handles values without placeholders', () => {
    expect(substituteVariables('op://vault/item/field', { PROFILE: 'prod' })).toBe('op://vault/item/field')
  })

  it('handles whitespace before op://', () => {
    expect(substituteVariables('  op://core-${PROFILE}/item/field', { PROFILE: 'staging' })).toBe(
      '  op://core-staging/item/field',
    )
  })

  it('works with any custom variable values', () => {
    expect(substituteVariables('op://core-${PROFILE}/item/field', { PROFILE: 'my-custom-profile' })).toBe(
      'op://core-my-custom-profile/item/field',
    )
    expect(substituteVariables('op://${PROFILE}/item/field', { PROFILE: 'production' })).toBe(
      'op://production/item/field',
    )
  })

  it('keeps placeholders unresolved when vars are missing', () => {
    expect(substituteVariables('op://core-${PROFILE}/item/field', {})).toBe('op://core-${PROFILE}/item/field')
  })
})

describe('hasUnresolvedVariables', () => {
  it('detects unresolved ${VAR} patterns', () => {
    expect(hasUnresolvedVariables('op://vault/${UNKNOWN}/item')).toBe(true)
    expect(hasUnresolvedVariables('${PROFILE}')).toBe(true)
    expect(hasUnresolvedVariables('op://core-${PROFILE}/item/${FIELD}')).toBe(true)
  })

  it('returns false when no variables present', () => {
    expect(hasUnresolvedVariables('op://vault/item/field')).toBe(false)
    expect(hasUnresolvedVariables('plain-value')).toBe(false)
    expect(hasUnresolvedVariables('')).toBe(false)
  })

  it('does not match lowercase or mixed case variables', () => {
    expect(hasUnresolvedVariables('${profile}')).toBe(false)
    expect(hasUnresolvedVariables('${Profile}')).toBe(false)
  })
})
