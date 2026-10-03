import { describe, test, expect } from 'claude-code/testing'
import { parseRole, parseAllow, bashRules, commitMessageFiles, placeOf, decide, invalidText } from '../hooks/rules'

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
  test('commit message text is not read as commands (final review #2)', () => {
    const heredoc = "git commit -F - <<'EOF'\nfeat: guards\n\nDenies git merge and git push --force on seats.\nEOF"
    expect(bashRules(heredoc)).toEqual(['commit'])
    const substituted = 'git commit -m "$(cat <<\'EOF\'\nfeat: guards\n\ngh pr merge is denied.\nEOF\n)"'
    expect(bashRules(substituted)).toEqual(['commit'])
    expect(bashRules('git commit -m "add the -n flag"')).toEqual(['commit'])
    expect(bashRules('git commit -m "mention --no-verify | git merge"')).toEqual(['commit'])
  })
  test('a heredoc trailer is still found, and real commands after the message still count', () => {
    expect(bashRules("git commit -F - <<'EOF'\nfix\n\nCo-Authored-By: a\nEOF")).toContain('ai-trailer')
    expect(bashRules("git commit -F - <<'EOF'\nfix\nEOF\ngit push --force")).toContain('force-push')
  })
  test('only the command word counts: echo or grep naming git is not git (merge-bar condition 1)', () => {
    expect(bashRules('echo git merge')).toEqual([])
    expect(bashRules('echo merge')).toEqual([])
    expect(bashRules('grep -rn "git push --force" docs')).toEqual([])
  })
  test('control: wrappers and assignments before git are still git', () => {
    expect(bashRules('GIT_TRACE=1 git merge main')).toContain('merge')
    expect(bashRules('sudo git push --force')).toContain('force-push')
    expect(bashRules('env A=1 /usr/bin/git branch -D b')).toContain('branch-delete')
    expect(bashRules('(cd sub && git push -f)')).toContain('force-push')
  })
  test('the trailer check reads only the commit segment (merge-bar condition 1)', () => {
    expect(bashRules('git commit -m x && grep -rn "Co-Authored-By:" hooks/')).toEqual(['commit'])
    expect(bashRules('git commit -m "x\n\nCo-Authored-By: a" && echo done')).toContain('ai-trailer')
  })
  test('separate force and delete flags count', () => {
    expect(bashRules('git branch --delete --force x')).toContain('branch-delete')
    expect(bashRules('git push -d origin b')).toContain('branch-delete')
  })
  test('an attached option value is not a flag bundle (PR #644 round 5)', () => {
    expect(bashRules('git commit -mfixing')).toEqual(['commit'])
    expect(bashRules('git push -ofoo origin b')).toEqual(['push'])
  })
  test('a comment is not a command (PR #644 round 5)', () => {
    expect(bashRules('echo ok # ; git push --force')).toEqual([])
  })
  test('control: a command before a comment still counts', () => {
    expect(bashRules('echo ok; git push --force # note')).toContain('force-push')
    expect(bashRules('git push origin b#tag')).toEqual(['push'])
  })
  test('control: bundles without the letter do not count', () => {
    expect(bashRules('git push -qu origin b')).toEqual(['push'])
    expect(bashRules('git branch -d x')).toEqual([])
    expect(bashRules('git commit -am x')).toEqual(['commit'])
  })
  test('any heredoc delimiter is message text (PR #644 review)', () => {
    expect(bashRules("git commit -F - <<'COMMIT-MSG'\nfix\n\ngit merge main\nCOMMIT-MSG")).toEqual(['commit'])
    expect(bashRules('git commit -F - <<"END MSG"\nfix\ngit push -f\nEND MSG')).toEqual(['commit'])
    expect(bashRules('git commit -F - <<-EOF.1\n\tfix\n\tgit merge x\n\tEOF.1')).toEqual(['commit'])
    expect(bashRules('git commit -F - <<-EOF.1\n\tfix\n\tEOF.1\ngit push --force')).toContain('force-push')
  })
  test('control: a body line that only starts with the delimiter does not end the heredoc', () => {
    expect(bashRules("git commit -F - <<'MSG'\nfix\nMSG-not-the-end\ngit merge x\nMSG\ngit push --force")).toEqual(['commit', 'push', 'force-push'])
  })
  test('PR #644 round 2: spellings that slipped past', () => {
    expect(bashRules('git push \\\n  --force origin b')).toContain('force-push')
    expect(bashRules('git branch -d -f victim')).toContain('branch-delete')
    expect(bashRules('git branch -d --force victim')).toContain('branch-delete')
    expect(bashRules('git push --mirror origin')).toContain('force-push')
    expect(bashRules('git push --prune origin')).toContain('branch-delete')
    expect(bashRules('gh pr --repo o/r merge 12')).toContain('merge')
    expect(bashRules('gh pr -R o/r create --fill')).toContain('pr-create')
  })
  test('control: a backslash-newline joins lines, a plain newline still splits', () => {
    expect(bashRules('git push origin b\ngit status')).toEqual(['push'])
    expect(bashRules('gh pr --repo o/r view 12')).toEqual([])
  })
  test('an escaped operator is text, not a boundary (PR #644 round 3)', () => {
    expect(bashRules("printf '<%s>\\n' foo\\|git merge")).toEqual([])
    expect(bashRules('echo a\\;git push --force')).toEqual([])
  })
  test('control: an unescaped operator still splits', () => {
    expect(bashRules('echo a;git push --force')).toContain('force-push')
  })
  test('a trailer counts only at a line start, as the repo hook reads it (PR #644 round 4)', () => {
    expect(bashRules('git commit -m "docs: explain Co-Authored-By: trailers"')).toEqual(['commit'])
    expect(bashRules('git commit -m "chore: 🤖 Generated with marker stays mid-line"')).toEqual(['commit'])
    expect(bashRules('git commit -F m', 'docs: noting that Co-Authored-By: trailers exist mid-line\n')).toEqual(['commit'])
  })
  test('control: a line-start trailer still counts, in any case', () => {
    expect(bashRules('git commit -F m', 'fix\n\nco-authored-by: a <b>\n')).toContain('ai-trailer')
    expect(bashRules('git commit -F m', 'fix\n\n🤖 Generated with x\n')).toContain('ai-trailer')
  })
  test('a quoted -C path does not hide the subcommand', () => {
    expect(bashRules('git -C "/a b" push --force')).toContain('force-push')
  })
  test('quoted words are not subcommands (Review Focus 2)', () => {
    expect(bashRules('git commit -m "merge the fix"')).not.toContain('merge')
    expect(bashRules('git log --merges')).toEqual([])
  })
})

describe('commitMessageFiles', () => {
  test('finds -F, --file and --file=', () => {
    expect(commitMessageFiles('git commit -F /m/a')).toEqual(['/m/a'])
    expect(commitMessageFiles('git commit --file "/m/b"')).toEqual(['/m/b'])
    expect(commitMessageFiles('git add . && git commit --file=/m/c')).toEqual(['/m/c'])
  })
  test('a quoted path with spaces stays whole (PR #644 review)', () => {
    expect(commitMessageFiles('git commit -F "/r/scratch/seat x/msg"')).toEqual(['/r/scratch/seat x/msg'])
  })
  test('every commit in the call, not only the first (PR #644 review)', () => {
    expect(commitMessageFiles('git commit -F /m/clean && git commit -F /m/other')).toEqual(['/m/clean', '/m/other'])
  })
  test('the attached -F form names the file (PR #644 round 2)', () => {
    expect(commitMessageFiles('git commit -F/tmp/msg')).toEqual(['/tmp/msg'])
    expect(commitMessageFiles('git commit -F"/r/scratch/msg"')).toEqual(['/r/scratch/msg'])
  })
  test('stdin and no file are empty', () => {
    expect(commitMessageFiles('git commit -F -')).toEqual([])
    expect(commitMessageFiles('git commit -m x')).toEqual([])
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
