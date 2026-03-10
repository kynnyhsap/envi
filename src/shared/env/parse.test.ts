import { describe, expect, it } from 'bun:test'

import { parseEnvFile, serializeEnvFile } from './parse'
import { GENERATED_FILE_HEADER, type EnvFile, LOCAL_ENVS_SEPARATOR } from './types'

describe('parseEnvFile', () => {
  it('should parse simple key=value pairs', () => {
    const content = `NODE_ENV=development
SECRET=abc123
PORT=3000`

    const result = parseEnvFile(content)

    expect(result.vars.size).toBe(3)
    expect(result.vars.get('NODE_ENV')?.value).toBe('development')
    expect(result.vars.get('SECRET')?.value).toBe('abc123')
    expect(result.vars.get('PORT')?.value).toBe('3000')
    expect(result.order).toEqual(['NODE_ENV', 'SECRET', 'PORT'])
  })

  it('should preserve comments before variables', () => {
    const content = `# This is the environment
NODE_ENV=development

# Database configuration
# Multiple comment lines
DB_HOST=localhost`

    const result = parseEnvFile(content)

    expect(result.vars.get('NODE_ENV')?.comment).toBe('# This is the environment')
    expect(result.vars.get('DB_HOST')?.comment).toBe('\n# Database configuration\n# Multiple comment lines')
  })

  it('should handle values with equals signs', () => {
    const content = `CONNECTION_STRING=postgres://user:pass@host/db?ssl=true&timeout=30`

    const result = parseEnvFile(content)

    expect(result.vars.get('CONNECTION_STRING')?.value).toBe('postgres://user:pass@host/db?ssl=true&timeout=30')
  })

  it('should handle empty values', () => {
    const content = `EMPTY_VAR=
ANOTHER_EMPTY=`

    const result = parseEnvFile(content)

    expect(result.vars.get('EMPTY_VAR')?.value).toBe('')
    expect(result.vars.get('ANOTHER_EMPTY')?.value).toBe('')
  })

  it('should handle quoted values', () => {
    const content = `QUOTED="some value with spaces"
SINGLE_QUOTED='another value'`

    const result = parseEnvFile(content)

    expect(result.vars.get('QUOTED')?.value).toBe('"some value with spaces"')
    expect(result.vars.get('SINGLE_QUOTED')?.value).toBe("'another value'")
  })

  it('should parse vars metadata marker', () => {
    const content = `# envi:vars={"PROFILE":"local","REGION":"eu"}
API_KEY=value`

    const result = parseEnvFile(content)

    expect(result.sourceVars).toEqual({ PROFILE: 'local', REGION: 'eu' })
  })

  it('should ignore legacy env metadata markers', () => {
    const content = `# envi:env=local
API_KEY=value`

    const result = parseEnvFile(content)

    expect(result.sourceVars).toBeUndefined()
  })

  it('should preserve trailing comments', () => {
    const content = `NODE_ENV=development
# This is a trailing comment`

    const result = parseEnvFile(content)

    expect(result.trailingContent).toBe('# This is a trailing comment')
  })

  it('should identify local env section', () => {
    const content = `NODE_ENV=development
SECRET=abc123

${LOCAL_ENVS_SEPARATOR}
MY_CUSTOM_VAR=custom_value
DEBUG=true`

    const result = parseEnvFile(content)

    expect(result.vars.get('NODE_ENV')?.isCustom).toBe(false)
    expect(result.vars.get('SECRET')?.isCustom).toBe(false)
    expect(result.vars.get('MY_CUSTOM_VAR')?.isCustom).toBe(true)
    expect(result.vars.get('DEBUG')?.isCustom).toBe(true)
  })

  it('should still detect legacy local env separator text', () => {
    const content = `NODE_ENV=development

# ----------- PUT YOUR CUSTOM ENVS BELOW THIS LINE -----------
MY_CUSTOM_VAR=custom_value`

    const result = parseEnvFile(content)

    expect(result.vars.get('NODE_ENV')?.isCustom).toBe(false)
    expect(result.vars.get('MY_CUSTOM_VAR')?.isCustom).toBe(true)
  })

  it('should handle special characters in values', () => {
    const content = `PASSWORD=p@ss!w0rd#$%^&*()
URL=https://example.com?foo=bar&baz=qux`

    const result = parseEnvFile(content)

    expect(result.vars.get('PASSWORD')?.value).toBe('p@ss!w0rd#$%^&*()')
    expect(result.vars.get('URL')?.value).toBe('https://example.com?foo=bar&baz=qux')
  })

  it('should handle Windows line endings', () => {
    const content = 'NODE_ENV=development\r\nSECRET=abc123\r\n'

    const result = parseEnvFile(content)

    expect(result.vars.get('NODE_ENV')?.value).toBe('development')
    expect(result.vars.get('SECRET')?.value).toBe('abc123')
  })

  it('should handle file with only comments', () => {
    const content = `# Comment 1
# Comment 2
# Comment 3`

    const result = parseEnvFile(content)

    expect(result.vars.size).toBe(0)
    expect(result.trailingContent).toContain('Comment')
  })

  it('should handle inline comments (should NOT strip them - they are part of value)', () => {
    const content = `NODE_ENV=development # this is a comment`

    const result = parseEnvFile(content)

    expect(result.vars.get('NODE_ENV')?.value).toBe('development # this is a comment')
  })
})

describe('serializeEnvFile', () => {
  it('should serialize with comments and always add local separator', () => {
    const envFile: EnvFile = {
      vars: new Map([
        ['NODE_ENV', { key: 'NODE_ENV', value: 'development' }],
        ['SECRET', { key: 'SECRET', value: 'abc123', comment: '# Secret key' }],
      ]),
      order: ['NODE_ENV', 'SECRET'],
      trailingContent: '',
    }

    const result = serializeEnvFile(envFile)

    expect(result).toContain(GENERATED_FILE_HEADER)
    // Should contain vars with comments
    expect(result).toContain('NODE_ENV=development')
    expect(result).toContain('# Secret key')
    expect(result).toContain('SECRET=abc123')
    // Should always have local separator at the end
    expect(result).toContain(LOCAL_ENVS_SEPARATOR)
  })

  it('should add local envs section when there are local vars', () => {
    const envFile: EnvFile = {
      vars: new Map([
        ['NODE_ENV', { key: 'NODE_ENV', value: 'development', isCustom: false }],
        ['MY_VAR', { key: 'MY_VAR', value: 'custom', isCustom: true }],
      ]),
      order: ['NODE_ENV', 'MY_VAR'],
      trailingContent: '',
    }

    const result = serializeEnvFile(envFile)

    expect(result).toContain(LOCAL_ENVS_SEPARATOR)
    expect(result).toContain('MY_VAR=custom')
    // Local vars should come after separator
    const separatorIndex = result.indexOf(LOCAL_ENVS_SEPARATOR)
    const localVarIndex = result.indexOf('MY_VAR=custom')
    expect(localVarIndex).toBeGreaterThan(separatorIndex)
  })

  it('should always add local separator even with no local vars', () => {
    const envFile: EnvFile = {
      vars: new Map([['NODE_ENV', { key: 'NODE_ENV', value: 'development', isCustom: false }]]),
      order: ['NODE_ENV'],
      trailingContent: '',
    }

    const result = serializeEnvFile(envFile)

    expect(result).toContain(GENERATED_FILE_HEADER)
    expect(result).toContain(LOCAL_ENVS_SEPARATOR)
  })

  it('should keep generated header and custom separator the same width', () => {
    expect(GENERATED_FILE_HEADER.length).toBe(LOCAL_ENVS_SEPARATOR.length)
  })

  it('should serialize multiline values as quoted escaped strings', () => {
    const envFile: EnvFile = {
      vars: new Map([['PRIVATE_KEY', { key: 'PRIVATE_KEY', value: 'line1\nline2', isCustom: false }]]),
      order: ['PRIVATE_KEY'],
      trailingContent: '',
    }

    const result = serializeEnvFile(envFile)

    expect(result).toContain('PRIVATE_KEY="line1\\nline2"')
  })

  it('should serialize vars metadata marker', () => {
    const envFile: EnvFile = {
      vars: new Map([['NODE_ENV', { key: 'NODE_ENV', value: 'development', isCustom: false }]]),
      order: ['NODE_ENV'],
      trailingContent: '',
    }

    const result = serializeEnvFile(envFile, { REGION: 'eu', PROFILE: 'local' })

    expect(result).toContain('# envi:vars={"PROFILE":"local","REGION":"eu"}')
  })

  it('should not serialize metadata for default vars', () => {
    const envFile: EnvFile = {
      vars: new Map([['NODE_ENV', { key: 'NODE_ENV', value: 'development', isCustom: false }]]),
      order: ['NODE_ENV'],
      trailingContent: '',
    }

    const result = serializeEnvFile(envFile, {})
    const explicitDefault = serializeEnvFile(envFile, { PROFILE: 'default' })

    expect(result).not.toContain('# envi:vars=')
    expect(explicitDefault).not.toContain('# envi:vars=')
  })
})
