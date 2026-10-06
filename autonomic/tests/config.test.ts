import { describe, test, expect } from 'claude-code/testing'
import { DEFAULTS, parseConfig } from '../hooks/config'
import { enforced } from '../hooks/enforce'

describe('settings', () => {
  test('neverApprove: default all six; a list; empty is none; unknown names reported (#677)', () => {
    expect(parseConfig({}).neverApprove).toEqual(['force-push', 'default-branch-push', 'branch-delete', 'rm-outside', 'no-verify', 'unreadable'])
    expect(parseConfig({ neverApprove: 'force-push, no-verify' }).neverApprove).toEqual(['force-push', 'no-verify'])
    expect(parseConfig({ neverApprove: '' }).neverApprove).toEqual([])
    const c = parseConfig({ neverApprove: 'force-push merge' })
    expect(c.neverApprove).toEqual(['force-push'])
    expect(c.problems.join(';')).toContain('neverApprove: unknown rule "merge"')
  })
  test('enforced keeps only enabled rules', () => {
    expect(enforced(['force-push', 'default-branch-push'], ['force-push'])).toEqual(['force-push'])
    expect(enforced(['force-push'], [])).toEqual([])
  })
  test('defaults', () => {
    expect(parseConfig(undefined)).toEqual(DEFAULTS)
    expect(DEFAULTS).toEqual({ policyPath: '~/.claude/autonomic/policy.md', loopMax: 3, tailChars: 4000, yieldAtPercent: 65, neverApprove: ['force-push', 'default-branch-push', 'branch-delete', 'rm-outside', 'no-verify', 'unreadable'], problems: [] })
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
