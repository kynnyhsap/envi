import { describe, expect, it } from 'bun:test'

import { DEFAULT_ENVIRONMENT, hasUnresolvedVariables, substituteVariables } from './variables'

describe('DEFAULT_ENVIRONMENT', () => {
  it('defaults to "local"', () => {
    expect(DEFAULT_ENVIRONMENT).toBe('local')
  })
})

describe('substituteVariables', () => {
  it('substitutes ${ENV} in op:// references', () => {
    expect(substituteVariables('op://core-${ENV}/engine-api/SECRET', 'local')).toBe('op://core-local/engine-api/SECRET')
    expect(substituteVariables('op://core-${ENV}/engine-api/SECRET', 'prod')).toBe('op://core-prod/engine-api/SECRET')
  })

  it('substitutes multiple ${ENV} occurrences', () => {
    expect(substituteVariables('op://${ENV}/${ENV}/field', 'dev')).toBe('op://dev/dev/field')
  })

  it('does not substitute in non-secret values', () => {
    expect(substituteVariables('${ENV}_value', 'prod')).toBe('${ENV}_value')
    expect(substituteVariables('some-${ENV}-string', 'dev')).toBe('some-${ENV}-string')
  })

  it('handles values without ${ENV}', () => {
    expect(substituteVariables('op://vault/item/field', 'prod')).toBe('op://vault/item/field')
  })

  it('handles whitespace before op://', () => {
    expect(substituteVariables('  op://core-${ENV}/item/field', 'staging')).toBe('  op://core-staging/item/field')
  })

  it('works with any custom environment name', () => {
    expect(substituteVariables('op://core-${ENV}/item/field', 'my-custom-env')).toBe(
      'op://core-my-custom-env/item/field',
    )
    expect(substituteVariables('op://${ENV}/item/field', 'production')).toBe('op://production/item/field')
  })

  describe('flexible vault structures', () => {
    it('supports env-prefixed vault names: op://core-${ENV}/item/field', () => {
      expect(substituteVariables('op://core-${ENV}/engine-api/SECRET', 'prod')).toBe('op://core-prod/engine-api/SECRET')
    })

    it('supports env-only vault names: op://${ENV}/item/field', () => {
      expect(substituteVariables('op://${ENV}/engine-api/SECRET', 'local')).toBe('op://local/engine-api/SECRET')
    })

    it('supports env-prefixed item names: op://vault/${ENV}-item/field', () => {
      expect(substituteVariables('op://core/${ENV}-engine-api/SECRET', 'dev')).toBe('op://core/dev-engine-api/SECRET')
    })

    it('supports env in section: op://vault/item/${ENV}/field', () => {
      expect(substituteVariables('op://core/engine-api/${ENV}/SECRET', 'self-host')).toBe(
        'op://core/engine-api/self-host/SECRET',
      )
    })
  })
})

describe('hasUnresolvedVariables', () => {
  it('detects unresolved ${VAR} patterns', () => {
    expect(hasUnresolvedVariables('op://vault/${UNKNOWN}/item')).toBe(true)
    expect(hasUnresolvedVariables('${ENV}')).toBe(true)
    expect(hasUnresolvedVariables('op://core-${ENV}/item/${FIELD}')).toBe(true)
  })

  it('returns false when no variables present', () => {
    expect(hasUnresolvedVariables('op://vault/item/field')).toBe(false)
    expect(hasUnresolvedVariables('plain-value')).toBe(false)
    expect(hasUnresolvedVariables('')).toBe(false)
  })

  it('does not match lowercase or mixed case variables', () => {
    expect(hasUnresolvedVariables('${env}')).toBe(false)
    expect(hasUnresolvedVariables('${Env}')).toBe(false)
  })
})
