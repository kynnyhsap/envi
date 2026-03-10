import { describe, expect, it } from 'bun:test'

import {
  DEFAULT_REFERENCE_VARS,
  hasUnresolvedVariables,
  normalizeReferenceVars,
  shouldPersistReferenceVars,
  substituteVariables,
} from './variables'

describe('DEFAULT_REFERENCE_VARS', () => {
  it('defaults to PROFILE=default', () => {
    expect(DEFAULT_REFERENCE_VARS).toEqual({ PROFILE: 'default' })
  })
})

describe('shouldPersistReferenceVars', () => {
  it('does not persist missing or default-only vars', () => {
    expect(shouldPersistReferenceVars(undefined)).toBe(false)
    expect(shouldPersistReferenceVars({})).toBe(false)
    expect(shouldPersistReferenceVars({ PROFILE: 'default' })).toBe(false)
  })

  it('persists non-default vars', () => {
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
