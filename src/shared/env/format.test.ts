import { describe, expect, it } from 'bun:test'

import { truncateValue, redactSecret, formatBackupTimestamp } from './format'

describe('truncateValue', () => {
  it('should return short values unchanged', () => {
    expect(truncateValue('short')).toBe('short')
    expect(truncateValue('http://localhost:3500')).toBe('http://localhost:3500')
  })

  it('should truncate long values with ellipsis in the middle', () => {
    const longValue = 'a'.repeat(50)
    const result = truncateValue(longValue, 40)
    expect(result.length).toBeLessThanOrEqual(40)
    expect(result).toContain('...')
    expect(result.startsWith('aaa')).toBe(true)
    expect(result.endsWith('aaa')).toBe(true)
  })

  it('should respect custom maxLen', () => {
    const value = 'abcdefghij'
    expect(truncateValue(value, 5)).toBe('a...j')
    expect(truncateValue(value, 10)).toBe('abcdefghij')
  })

  it('should handle edge case where maxLen equals value length', () => {
    expect(truncateValue('abc', 3)).toBe('abc')
  })

  it('should handle very small maxLen', () => {
    const value = 'abcdefghij'
    // With maxLen=4, half = floor((4-3)/2) = 0
    // Result: first 0 chars + ... + last 0 chars = "..."
    expect(truncateValue(value, 4)).toBe('...')
  })
})

describe('redactSecret', () => {
  it('should redact long secrets showing 3 chars at start and end', () => {
    expect(redactSecret('abcdefghij')).toBe('abc...hij')
    expect(redactSecret('secretvalue123')).toBe('sec...123')
  })

  it('should return *** for short secrets (6 chars or less)', () => {
    expect(redactSecret('abc')).toBe('***')
    expect(redactSecret('abcdef')).toBe('***')
  })

  it('should handle 7 char secrets (boundary case)', () => {
    expect(redactSecret('abcdefg')).toBe('abc...efg')
  })

  it('should handle empty string', () => {
    expect(redactSecret('')).toBe('***')
  })

  it('should handle single character', () => {
    expect(redactSecret('a')).toBe('***')
  })
})

describe('formatBackupTimestamp', () => {
  it('should format timestamp with date, time and relative text', () => {
    const result = formatBackupTimestamp('2024-03-15_11-30-00')
    // Should contain the formatted date and time
    expect(result).toContain('2024-03-15 11:30:00')
    // Should contain relative text in parentheses (with ANSI codes for dim)
    expect(result).toContain('(')
    expect(result).toContain(')')
  })

  it('should format iso-like backup timestamps with relative text', () => {
    const result = formatBackupTimestamp('2026-03-07T15-39-54-840Z')
    expect(result).toContain('2026-03-07 15:39:54 UTC')
    expect(result).toContain('(')
    expect(result).toContain(')')
  })

  it('should produce deterministic relative text when now is provided', () => {
    const now = new Date('2026-03-10T15:39:54.840Z')
    const past = formatBackupTimestamp('2026-03-07T15-39-54-840Z', now)
    const future = formatBackupTimestamp('2026-03-12T15-39-54-840Z', now)

    expect(past).toContain('(3 days ago)')
    expect(future).toContain('(in 2 days)')
  })

  it('should return original string if no time part', () => {
    expect(formatBackupTimestamp('2024-03-15')).toBe('2024-03-15')
  })

  it('should handle invalid date format gracefully', () => {
    const result = formatBackupTimestamp('invalid_00-00-00')
    // Should return formatted string but without valid timeago
    expect(result).toContain('invalid 00:00:00')
  })
})
