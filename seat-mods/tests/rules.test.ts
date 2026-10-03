import { describe, test, expect } from 'claude-code/testing'
import { parseRole, parseAllow, bashRules, commitMessageFile, placeOf, decide, invalidText } from '../hooks/rules'

describe('parseRole', () => {
  test('unset and empty are off', () => {
    expect(parseRole(undefined)).toEqual({ kind: 'off' })
    expect(parseRole('')).toEqual({ kind: 'off' })
  })
  test('the three roles are on', () => {
    for (const role of ['implementer', 'verifier', 'reviewer']) expect(parseRole(role)).toEqual({ kind: 'on', role })
  })
  test('anything else is invalid, case included', () => {
    expect(parseRole('Implementer')).toEqual({ kind: 'invalid', value: 'Implementer' })
    expect(parseRole('orchestrator')).toEqual({ kind: 'invalid', value: 'orchestrator' })
  })
})

describe('parseAllow', () => {
  test('splits on colons and drops a trailing slash', () => {
    expect(parseAllow('/a/reports/:/b/scratch')).toEqual(['/a/reports', '/b/scratch'])
  })
  test('ignores relative entries and the root', () => {
    expect(parseAllow('rel/dir:/:/ok')).toEqual(['/ok'])
  })
  test('unset is empty', () => {
    expect(parseAllow(undefined)).toEqual([])
  })
})

describe('bashRules', () => {
  test('merges', () => {
    expect(bashRules('git merge main')).toContain('merge')
    expect(bashRules('git -C /w merge main')).toContain('merge')
    expect(bashRules('gh pr merge 12 --merge')).toContain('merge')
  })
  test('force-push spellings', () => {
    for (const c of ['git push --force', 'git push -f origin b', 'git push --force-with-lease', 'git push origin +b'])
      expect(bashRules(c)).toContain('force-push')
    expect(bashRules('git push origin b')).not.toContain('force-push')
  })
  test('branch deletion', () => {
    for (const c of ['git branch -D b', 'git push --delete origin b', 'git push -d origin b', 'git push origin :b'])
      expect(bashRules(c)).toContain('branch-delete')
    expect(bashRules('git branch -d b')).not.toContain('branch-delete')
  })
  test('no-verify', () => {
    expect(bashRules('git commit --no-verify -F m')).toContain('no-verify')
    expect(bashRules('git commit -n -F m')).toContain('no-verify')
    expect(bashRules('git push --no-verify')).toContain('no-verify')
  })
  test('trailers on the command line, in a heredoc, or in the message file', () => {
    expect(bashRules('git commit -m "x\n\nCo-Authored-By: a <b>"')).toContain('ai-trailer')
    expect(bashRules("git commit -F - <<'EOF'\nfix\n\n🤖 Generated with x\nEOF")).toContain('ai-trailer')
    expect(bashRules('git commit -F msg.txt', 'fix\n\nco-authored-by: a')).toContain('ai-trailer')
    expect(bashRules('git commit -F msg.txt', 'fix')).not.toContain('ai-trailer')
  })
  test('commit, push and pr create', () => {
    expect(bashRules('git commit -F m && git push origin b')).toEqual(expect.arrayContaining(['commit', 'push']))
    expect(bashRules('gh pr create --fill')).toContain('pr-create')
  })
  test('quoted words are not subcommands (Review Focus 2)', () => {
    expect(bashRules('git commit -m "merge the fix"')).not.toContain('merge')
    expect(bashRules('git log --merges')).toEqual([])
    expect(bashRules('echo git merge')).toContain('merge')
  })
})

describe('commitMessageFile', () => {
  test('finds -F, --file and --file=', () => {
    expect(commitMessageFile('git commit -F /m/a')).toBe('/m/a')
    expect(commitMessageFile('git commit --file "/m/b"')).toBe('/m/b')
    expect(commitMessageFile('git add . && git commit --file=/m/c')).toBe('/m/c')
  })
  test('stdin and no file are undefined', () => {
    expect(commitMessageFile('git commit -F -')).toBeUndefined()
    expect(commitMessageFile('git commit -m x')).toBeUndefined()
  })
})

describe('placeOf', () => {
  test('allow wins over the worktree, then the worktree, then outside', () => {
    expect(placeOf('/w/r/report.md', '/w', ['/w/r'])).toBe('allow')
    expect(placeOf('/w/src/a.ts', '/w', [])).toBe('worktree')
    expect(placeOf('/w', '/w', [])).toBe('worktree')
    expect(placeOf('/elsewhere/a', '/w', ['/s'])).toBe('outside')
  })
  test('a sibling that shares the prefix is outside', () => {
    expect(placeOf('/w2/a', '/w', [])).toBe('outside')
  })
})

describe('decide', () => {
  test('implementer: common rules deny, commit and push allow', () => {
    expect(decide('implementer', { kind: 'bash', rules: ['merge'] })).toStartWith('seat-mods (implementer): no merges')
    expect(decide('implementer', { kind: 'bash', rules: ['commit', 'push', 'pr-create'] })).toBeUndefined()
  })
  test('every role: each common rule denies', () => {
    for (const role of ['implementer', 'verifier', 'reviewer'] as const)
      for (const rule of ['merge', 'force-push', 'branch-delete', 'no-verify', 'ai-trailer'] as const)
        expect(decide(role, { kind: 'bash', rules: [rule] })).toBeDefined()
  })
  test('verifier and reviewer: commit, push and pr create deny', () => {
    for (const role of ['verifier', 'reviewer'] as const)
      for (const rule of ['commit', 'push', 'pr-create'] as const)
        expect(decide(role, { kind: 'bash', rules: [rule] })).toBeDefined()
  })
  test('writes per role', () => {
    expect(decide('implementer', { kind: 'write', place: 'worktree' })).toBeUndefined()
    expect(decide('verifier', { kind: 'write', place: 'worktree' })).toBeUndefined()
    expect(decide('reviewer', { kind: 'write', place: 'worktree' })).toContain('no edits in the worktree')
    for (const role of ['implementer', 'verifier', 'reviewer'] as const) {
      expect(decide(role, { kind: 'write', place: 'allow' })).toBeUndefined()
      expect(decide(role, { kind: 'write', place: 'outside' })).toContain('SEAT_MODS_ALLOW')
    }
  })
  test('the deny text has the spec shape', () => {
    expect(decide('verifier', { kind: 'bash', rules: ['push'] }))
      .toBe('seat-mods (verifier): no git push — this seat may not run this command; report it instead.')
  })
  test('invalidText names the value and the roles', () => {
    expect(invalidText('impl')).toContain('"impl"')
    expect(invalidText('impl')).toContain('implementer, verifier, reviewer')
  })
})
