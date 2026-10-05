import { describe, test, expect } from 'claude-code/testing'
import { DEFAULTS, parseConfig } from '../hooks/config'

describe('settings', () => {
  test('defaults', () => {
    expect(parseConfig(undefined)).toEqual(DEFAULTS)
    expect(DEFAULTS).toEqual({ policyPath: '~/.claude/autonomic/policy.md', loopMax: 3, tailChars: 4000, problems: [] })
  })
  test('values are read', () => {
    const c = parseConfig({ policyPath: '/p.md', bell: 'ntfy', loopMax: 5, tailChars: 800 })
    expect([c.policyPath, c.bell, c.loopMax, c.tailChars]).toEqual(['/p.md', 'ntfy', 5, 800])
  })
  test('a bad number falls back and is reported', () => {
    const c = parseConfig({ loopMax: 0, tailChars: 10 })
    expect([c.loopMax, c.tailChars]).toEqual([3, 4000])
    expect(c.problems).toHaveLength(2)
  })
  test('a blank bell is no bell', () => {
    expect(parseConfig({ bell: '   ' }).bell).toBeUndefined()
  })
})
