import { describe, test, expect } from 'claude-code/testing'
import { DEFAULTS, parseConfig, retiredNote } from '../hooks/config'
import { enforced } from '../hooks/enforce'

describe('settings', () => {
  test('neverApprove: default all four; a list; empty is none; unknown names reported (#677)', () => {
    expect(parseConfig({}).neverApprove).toEqual(['force-push', 'default-branch-push', 'no-verify', 'ai-trailer'])
    expect(parseConfig({ neverApprove: 'force-push, no-verify' }).neverApprove).toEqual(['force-push', 'no-verify'])
    expect(parseConfig({ neverApprove: '' }).neverApprove).toEqual([])
    const c = parseConfig({ neverApprove: 'force-push merge' })
    expect(c.neverApprove).toEqual(['force-push'])
    expect(c.problems.join(';')).toContain('neverApprove: unknown rule "merge"')
  })
  test('a retired name is skipped, with no problem, and the status note names it (0.10.0; call 7)', () => {
    const c = parseConfig({ neverApprove: 'force-push branch-delete rm-outside' })
    expect(c.neverApprove).toEqual(['force-push'])
    expect(c.retired).toEqual(['branch-delete', 'rm-outside'])
    expect(c.problems).toEqual([])
    expect(retiredNote(c.retired)).toBe('retired in 0.10.0, now judged: branch-delete rm-outside')
    expect(retiredNote([])).toBeUndefined()
  })
  test("a 0.9.x value loads with no problem and the retired names stay readable (Review Focus 2)", () => {
    const c = parseConfig({ neverApprove: 'force-push default-branch-push branch-delete rm-outside no-verify unreadable' })
    expect(c.neverApprove).toEqual(['force-push', 'default-branch-push', 'no-verify'])
    expect(c.retired).toEqual(['branch-delete', 'rm-outside', 'unreadable'])
    expect(c.problems).toEqual([])
  })
  test('enforced keeps only enabled rules', () => {
    expect(enforced(['force-push', 'default-branch-push'], ['force-push'])).toEqual(['force-push'])
    expect(enforced(['force-push'], [])).toEqual([])
  })
  test('defaults', () => {
    expect(parseConfig(undefined)).toEqual(DEFAULTS)
    expect(DEFAULTS).toEqual({ policyPath: '~/.claude/autonomic/policy.md', loopMax: 3, tailChars: 4000, yieldAtPercent: 65, neverApprove: ['force-push', 'default-branch-push', 'no-verify', 'ai-trailer'], retired: [], problems: [] })
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

describe('readers (0.4.3 §3.5)', () => {
  test('absent: no readers field, so never.ts uses its default', () => {
    expect(parseConfig({}).readers).toBeUndefined()
  })
  test('a ;-separated list is parsed; empty is none', () => {
    expect(parseConfig({ readers: 'gh pr create; herdr agent prompt' }).readers).toEqual([['gh', 'pr', 'create'], ['herdr', 'agent', 'prompt']])
    expect(parseConfig({ readers: '' }).readers).toEqual([])
  })
})
