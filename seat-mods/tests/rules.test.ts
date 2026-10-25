import { describe, test, expect } from 'claude-code/testing'
import { parseRole, parseAllow, bashRules, commitMessageFiles, rmTargets, removalOf, UNREAD, placeOf, decide, invalidText, statusText } from '../hooks/rules'

describe('parseRole', () => {
  test('unset and empty default to the guarded implementer', () => {
    expect(parseRole(undefined)).toEqual({ kind: 'default', role: 'implementer' })
    expect(parseRole('')).toEqual({ kind: 'default', role: 'implementer' })
  })
  test('the three guarded roles are on', () => {
    for (const role of ['implementer', 'verifier', 'reviewer']) expect(parseRole(role)).toEqual({ kind: 'on', role })
  })
  test('orchestrator and coordinator are free; near misses stay invalid', () => {
    for (const role of ['orchestrator', 'coordinator']) expect(parseRole(role)).toEqual({ kind: 'free', role })
    for (const value of ['Implementer', 'Orchestrator', 'orchestrator ', 'orchestrater', 'Coordinator', 'co-ordinator'])
      expect(parseRole(value)).toEqual({ kind: 'invalid', value })
  })
})

describe('statusText', () => {
  test('every state reads distinctly', () => {
    expect(statusText({ kind: 'on', role: 'implementer' })).toBe('seat: implementer')
    expect(statusText({ kind: 'default', role: 'implementer' })).toBe('seat: implementer (default: SEAT_MODS_ROLE unset or empty)')
    expect(statusText({ kind: 'free', role: 'orchestrator' })).toBe('seat: orchestrator')
    expect(statusText({ kind: 'invalid', value: 'impl' })).toBe('seat: INVALID ROLE "impl"')
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
  test('a comment right after an operator is a comment (PR #644 round 6)', () => {
    expect(bashRules('echo ok;# x; git push --force')).toEqual([])
  })
  test('flags stop at -- (PR #644 round 6)', () => {
    expect(bashRules('git add -- --no-verify')).toEqual([])
    expect(bashRules('git commit -m x -- -n')).toEqual(['commit'])
  })
  test('control: flags before -- still count', () => {
    expect(bashRules('git commit --no-verify -m x -- a.ts')).toContain('no-verify')
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
  // #844: each deny says where a seat can go instead, so a scratch write or cleanup costs one turn, not several.
  test('an outside write names the SEAT_MODS_ALLOW folders when it has them', () => {
    const deny = decide('implementer', { kind: 'write', place: 'outside', allow: ['/s/a', '/s/b'] })
    expect(deny).toContain('no writes outside')
    expect(deny).toContain('go in /s/a, /s/b.')
    expect(decide('implementer', { kind: 'write', place: 'outside' })).not.toContain('go in')
    expect(decide('implementer', { kind: 'write', place: 'allow', allow: ['/s/a'] })).toBeUndefined()
  })
  test('an rm operand the guard cannot read says to spell it out; a placed one outside keeps its text', () => {
    const unread = decide('verifier', { kind: 'bash', rules: [], removals: [UNREAD] })
    expect(unread).toContain('no rm with an operand the guard cannot resolve')
    expect(unread).toContain('spell its path out literally')
    const outside = decide('verifier', { kind: 'bash', rules: [], removals: [removalOf('/etc/x', '/w', ['/s'], false)] })
    expect(outside).toContain('no rm outside writable places')
    expect(outside).not.toContain('literally')
    expect(decide('verifier', { kind: 'bash', rules: [], removals: [removalOf('/s/x', '/w', ['/s'], false)] })).toBeUndefined()
    // a target the glue could not place (a link's `..`, an omp URL cwd) is outside, not unread
    expect(removalOf(undefined, '/w', ['/s'], false).unresolved).toBeUndefined()
  })
  test('the deny text has the spec shape', () => {
    expect(decide('verifier', { kind: 'bash', rules: ['push'] }))
      .toBe('seat-mods (verifier): no git push — this seat may not run this command; report it instead.')
  })
  test('invalidText names the value and the roles', () => {
    expect(invalidText('impl')).toContain('"impl"')
    expect(invalidText('impl')).toContain('implementer, verifier, reviewer')
    expect(invalidText('impl')).toContain('orchestrator, coordinator')
  })
})

// Literal expectations distinguish quote handling and prefix placement from the
// resolver: these are inputs to the rail, not a second shell implementation.
describe('rm operand parsing', () => {
  test('only rm command segments produce targets', async () => {
    expect(rmTargets('echo "rm /var/x"; rm /w/x')).toEqual([{ path: '/w/x', glob: false }])
    expect(rmTargets("cat <<'EOF'\nrm /var/x\nEOF")).toEqual([])
    expect(rmTargets('git commit -m "rm -rf /var"')).toEqual([])
    expect(rmTargets('A=1 sudo env command /bin/rm -rf /w/build')).toEqual([{ path: '/w/build', glob: false }])
  })
  test('single quotes and escaped expansions are literal; active expansions are unknown', async () => {
    expect(rmTargets("rm '/w/$X' /w/\\$X")).toEqual([
      { path: '/w/$X', glob: false }, { path: '/w/$X', glob: false },
    ])
    for (const command of ['rm "$OLDPWD"', 'rm /w/"${X}"', 'rm "$(pwd)"', 'rm ~someone/x'])
      expect(rmTargets(command)).toEqual([{ path: undefined, glob: false }])
    expect(rmTargets("rm '~/x'")).toEqual([{ path: './~/x', glob: false }])
    expect(rmTargets('rm ~/x')).toEqual([{ path: '~/x', glob: false }])
  })
  test('glob directory is the directory of the literal prefix; quoted patterns stay literal', async () => {
    expect(rmTargets('rm /tmp/tmp.* build/*.o b*/x *.log /a? /[ab]')).toEqual([
      { path: '/tmp', glob: true }, { path: 'build', glob: true },
      { path: '.', glob: true }, { path: '.', glob: true },
      { path: '/', glob: true }, { path: '/', glob: true },
    ])
    expect(rmTargets("rm '/w/*.o' /w/\\*.o")).toEqual([
      { path: '/w/*.o', glob: false }, { path: '/w/*.o', glob: false },
    ])
  })
  test('options stop at --, even for a quoted delimiter', async () => {
    expect(rmTargets('rm -rf -- -file -')).toEqual([
      { path: '-file', glob: false }, { path: '-', glob: false },
    ])
    expect(rmTargets('rm "--" -file')).toEqual([{ path: '-file', glob: false }])
    expect(rmTargets('rm -rf')).toEqual([])
  })
  test('earlier directory changes poison only relative operands, including after --', async () => {
    for (const change of ['cd', 'pushd', 'popd'])
      expect(rmTargets(`${change} /var; rm -- -file /w/x ~/x`)).toEqual([
        { path: undefined, glob: false }, { path: '/w/x', glob: false }, { path: '~/x', glob: false },
      ])
    expect(rmTargets('rm x; cd /var')).toEqual([{ path: 'x', glob: false }])
  })
  test('malformed words fail closed beside valid quoted words', async () => {
    for (const command of ['rm "unterminated', 'rm dangling\\'])
      expect(rmTargets(command)).toEqual([{ path: undefined, glob: false }])
    expect(rmTargets('rm "a b"')).toEqual([{ path: 'a b', glob: false }])
  })
})

describe('fix1 expansion guard', () => {
  test('F6 self-reference fails explicitly, ordinary markers still expand', () => {
    expect(() => rmTargets('rm "\u00000\u0000"')).toThrow('unresolvable shell marker')
    expect(rmTargets('rm "/reports/x"')).toEqual([{ path: '/reports/x', glob: false }])
  })
})

describe('fix2 shared shell reader and root placement', () => {
  test('G2 herestring leaves following git commands visible beside a real heredoc body', () => {
    expect(bashRules('cat <<< x\ngit push --force')).toContain('force-push')
    expect(bashRules("cat <<'EOF'\ngit push --force\nEOF")).toEqual([])
  })
  test('G3 path-qualified wrapper uses the same command matching as a bare wrapper', () => {
    expect(bashRules('/usr/bin/sudo git push --force')).toContain('force-push')
    expect(bashRules('sudo git push --force')).toContain('force-push')
    expect(bashRules('/usr/bin/env git status')).toEqual([])
  })
  test('G4 root contains absolute descendants, not relative paths', () => {
    expect(placeOf('/tmp/x', '/', [])).toBe('worktree')
    expect(placeOf('/tmp/x', '/w', [])).toBe('outside')
    expect(placeOf('tmp/x', '/', [])).toBe('outside')
    expect(placeOf('/tmp/x', '/w', ['/'])).toBe('allow')
  })
})

// 0.3.1: the existing rails share rm's head-word walk, with safe commands beside them.
describe('reserved heads across Bash rails (#701)', () => {
  const cases: Array<[string, string, string]> = [
    ['if git push --force; then :; fi', 'force-push', 'if git status; then :; fi'],
    ['! git push --force', 'force-push', '! git diff --quiet'],
    ['{ git push --force; }', 'force-push', '{ git log -1; }'],
    ['if true; then git push -f; fi', 'force-push', 'if true; then git status; fi'],
    ['while true; do git merge x; done', 'merge', 'while read l; do echo "$l"; done'],
    ['! gh pr merge 1', 'merge', '! gh pr view 1'],
  ]
  for (const [command, rule, control] of cases) {
    test(`${command}: rail beside allowed control`, () => {
      expect(bashRules(command)).toContain(rule)
      expect(bashRules(control)).toEqual([])
    })
  }
  for (const prefix of ['if', 'then', 'elif', 'else', 'do', 'while', 'until', '!', '{', '(', 'time', 'builtin']) {
    // Some fragments are not complete Bash programs. time and ( are existing
    // wrapper/splitter controls; those rows do not prove HEAD_WORDS coverage.
    for (const [command, expected, control] of [
      ['git branch -D b', ['branch-delete'], 'git branch -d b'],
      ['git status --no-verify', ['no-verify'], 'git status'],
      ['gh pr create', ['pr-create'], 'gh pr view 1'],
      ['git commit -m x', ['commit'], 'git log -1'],
      ['git push', ['push'], 'git status'],
      ['git merge x', ['merge'], 'git diff --quiet'],
      ['git push -f', ['push', 'force-push'], 'git status'],
    ] as const) {
      test(`${prefix} ${command}: ${['time', '('].includes(prefix) ? 'wrapper/splitter control' : 'head recognition'} beside allowed control`, () => {
        expect(bashRules(`${prefix} ${command}`)).toEqual([...expected])
        expect(bashRules(`${prefix} ${control}`)).toEqual([])
      })
    }
  }
  test('plain push counts only as push; mentions remain text', () => {
    expect(bashRules('if git push; then :; fi')).toEqual(['push'])
    expect(bashRules('echo if git push --force')).toEqual([])
  })
  test('commit files follow the head walk; a non-commit mention has no file', () => {
    expect(commitMessageFiles('if git commit -F /w/msg-trailer.txt; then :; fi')).toEqual(['/w/msg-trailer.txt'])
    expect(commitMessageFiles('echo if git commit -F /w/msg-trailer.txt')).toEqual([])
  })
})

describe('rm heredoc input (#702 item 1)', () => {
  for (const input of ['<<EOF\ny\nEOF', '<<-EOF\n\ty\n\tEOF', "<<'EOF'\ny\nEOF"]) {
    test(`${input.split('\n')[0]} leaves only the operand, including when attached`, () => {
      expect(rmTargets(`rm -i /reports/x ${input}`)).toEqual([{ path: '/reports/x', glob: false }])
      expect(rmTargets(`rm -i /var/x ${input}`)).toEqual([{ path: '/var/x', glob: false }])
      expect(rmTargets(`rm -i /reports/x${input}`)).toEqual([{ path: '/reports/x', glob: false }])
      expect(rmTargets(`rm -i /var/x${input}`)).toEqual([{ path: '/var/x', glob: false }])
    })
  }
  test('quoted and escaped << words stay operands beside a real heredoc', () => {
    expect(rmTargets("rm '/reports/<<EOF'")).toEqual([{ path: '/reports/<<EOF', glob: false }])
    expect(rmTargets('rm /reports/\\<\\<EOF')).toEqual([{ path: '/reports/<<EOF', glob: false }])
    expect(rmTargets("rm /reports/x '<<EOF'")).toEqual([
      { path: '/reports/x', glob: false }, { path: '<<EOF', glob: false },
    ])
    expect(rmTargets('rm /reports/x <<EOF\ny\nEOF')).toEqual([{ path: '/reports/x', glob: false }])
  })
})

// Fix task 1: Bash syntax belongs to raw heads, not basenames or program argv.
describe('ordinary programs named like head words', () => {
  for (const prefix of ['/fixtures/if', '/fixtures/do', 'A=1 if', 'A=1 do', 'env if', '/usr/bin/env do', 'command if', 'exec if', 'nohup if', 'A=1 time if', 'time env if', 'if A=1 if', 'if env if', '"if"', '\\if', 'builtin if', 'A=1 builtin if']) {
    for (const [payload, rule] of [
      ['git push --force', 'force-push'], ['git merge x', 'merge'],
      ['git branch -D b', 'branch-delete'], ['git status --no-verify', 'no-verify'],
      ['gh pr create', 'pr-create'], ['git commit -m x', 'commit'], ['git push', 'push'],
    ]) {
      test(`${prefix} ${payload}: program argv allowed beside bare head rail`, () => {
        const bare = prefix.endsWith('do') ? `while true; do ${payload}; break; done` : `if ${payload}; then :; fi`
        expect(bashRules(bare)).toContain(rule)
        expect(bashRules(`${prefix} ${payload}`)).toEqual([])
      })
    }
    test(`${prefix}: commit file and rm argv stay text beside bare heads`, () => {
      const commit = prefix.endsWith('do') ? 'while true; do git commit -F /w/msg-trailer.txt; break; done' : 'if git commit -F /w/msg-trailer.txt; then :; fi'
      const remove = prefix.endsWith('do') ? 'while true; do rm /var/x; break; done' : 'if rm /var/x; then :; fi'
      expect(commitMessageFiles(commit)).toEqual(['/w/msg-trailer.txt'])
      expect(commitMessageFiles(`${prefix} git commit -F /w/msg-trailer.txt`)).toEqual([])
      expect(rmTargets(remove)).toEqual([{ path: '/var/x', glob: false }])
      expect(rmTargets(`${prefix} rm /var/x`)).toEqual([])
    })
  }
  test('builtin still invokes cd through assignments and the command builtin', () => {
    for (const prefix of ['builtin', 'A=1 builtin', 'command builtin', 'builtin builtin', 'time builtin']) {
      expect(rmTargets(`${prefix} cd /var; rm x`)).toEqual([{ path: undefined, glob: false }])
      expect(rmTargets(`${prefix} cd /var; rm /reports/x`)).toEqual([{ path: '/reports/x', glob: false }])
    }
  })
})

describe('rm heredoc fd and opener provenance', () => {
  test('fd 2 is shell input; an operand ending in 2 stays an operand', () => {
    expect(rmTargets('rm -i /reports/x 2<<EOF\ny\nEOF')).toEqual([{ path: '/reports/x', glob: false }])
    expect(rmTargets('rm -i /var/x 2<<EOF\ny\nEOF')).toEqual([{ path: '/var/x', glob: false }])
    expect(rmTargets('rm -i /reports/x2<<EOF\ny\nEOF')).toEqual([{ path: '/reports/x2', glob: false }])
    expect(rmTargets("rm -i /reports/x '2'<<EOF\ny\nEOF")).toEqual([{ path: '/reports/x', glob: false }, { path: '2', glob: false }])
  })
})

// #723: a lone `&` is Bash's background list separator. Without it the whole line
// read as one command with the first head, so every rail after the `&` was
// invisible — fail-open. `&&` and the redirections that carry `&` are not
// boundaries; the `&` of a `|&` pipe is.
describe('a lone & is a command boundary (#723)', () => {
  test('a command behind a lone & meets its rails, spaced or glued', () => {
    expect(bashRules('true & git push --force')).toEqual(expect.arrayContaining(['push', 'force-push']))
    expect(bashRules('true &git push origin main')).toContain('push')
    expect(bashRules('true& git push origin main')).toContain('push')
    expect(bashRules('true & gh pr merge 12')).toContain('merge')
  })
  test('control: && keeps its meaning beside the split', () => {
    expect(bashRules('git add f && git push origin b')).toContain('push')
    expect(bashRules('git log --oneline && git status')).toEqual([])
  })
  test('the trailer check reads the commit behind a lone &, not the line before it', () => {
    expect(bashRules('echo & git commit -m "x\n\nCo-Authored-By: a"')).toContain('ai-trailer')
    expect(bashRules('echo & git commit -m "x"')).toEqual(['commit'])
  })
  test('the commit-file reader sees the commit behind a lone &', () => {
    expect(commitMessageFiles('true & git status')).toEqual([])
    expect(commitMessageFiles('true & git commit -F /w/msg-trailer.txt')).toEqual(['/w/msg-trailer.txt'])
  })
  test('the & of a |& pipe splits too, and the piping command keeps its rules', () => {
    expect(bashRules('git push origin main |& cat')).toEqual(['push'])
    expect(bashRules('echo a |& git push --force')).toContain('force-push')
  })
  test('control: redirections carry & without splitting it', () => {
    expect(bashRules('git commit -m m 2>&1')).toEqual(['commit'])
    expect(bashRules('git push origin main >&2')).toEqual(['push'])
    expect(bashRules('git push origin main &>/dev/null')).toEqual(['push'])
    expect(bashRules('git push origin main &>>/dev/null')).toEqual(['push'])
    expect(bashRules('git push origin main <&0')).toEqual(['push'])
    expect(bashRules('git push origin main >&-')).toEqual(['push'])
    // The flag after the redirection stays with its command: this row dies if a
    // lookaround is dropped (review R4).
    expect(bashRules('git push origin main 2>&1 --force')).toContain('force-push')
  })
  test('control: a trailing & leaves the line to its one command', () => {
    expect(bashRules('git commit -m m &')).toEqual(['commit'])
    expect(bashRules('git push origin main &')).toEqual(['push'])
  })
})

// #723 review R1/C1/C2, round 3: an `&` inside an unquoted `${…}` or `$[…]` is
// literal in Bash — the word carries it — so only that `&` stops being a boundary;
// every other character (`(`, `)`, `;`, `|`, newline) keeps its COMMANDS meaning,
// and the `&` of a `$(…)` nested in an expansion is a real separator and keeps
// splitting. seat-mods-local; molt's gate keeps the raw split by ruling.
describe('an & inside an unquoted expansion is not a boundary (#723 review R1)', () => {
  test('an assignment-prefixed expansion leaves the command behind it reachable', () => {
    expect(bashRules('X=${x/a&b/c} git push --force')).toEqual(expect.arrayContaining(['push', 'force-push']))
    expect(bashRules('X=$[2&3] git push --force')).toEqual(expect.arrayContaining(['push', 'force-push']))
    expect(bashRules('X=${x/a&b/c} gh pr merge 12')).toContain('merge')
  })
  test('a nested expansion is one word, including a & after its close', () => {
    expect(bashRules('X=${a:-${b/&/c}} git push --force')).toEqual(expect.arrayContaining(['push', 'force-push']))
    // The nesting pin (review RR1): with the nested `${` untracked, the first `}`
    // closes the outer word and this `&` splits, junk-heading the follower.
    expect(bashRules('X=${a:-${b/&/c}&d} git push --force')).toEqual(expect.arrayContaining(['push', 'force-push']))
  })
  test('a nested command substitution stays executable (review C1)', () => {
    expect(bashRules('echo ${x:-$(git push --force)}')).toEqual(expect.arrayContaining(['push', 'force-push']))
    expect(bashRules('echo ${x:-$(git status)}')).toEqual([])
  })
  test('the & of a nested substitution still splits (review C1/P6)', () => {
    expect(bashRules('echo ${x:-$(true & git push --force)}')).toEqual(expect.arrayContaining(['push', 'force-push']))
    expect(bashRules('echo ${x:-$(true & git status)}')).toEqual([])
  })
  test('$$ is a complete token: ${ after it opens, the { after a bare $$ stays literal (review C2)', () => {
    expect(bashRules('X=$$${x/a&b/c} git push --force')).toEqual(expect.arrayContaining(['push', 'force-push']))
    expect(bashRules('X=$${x} git push --force')).toEqual(expect.arrayContaining(['push', 'force-push']))
    // The 0.3.1 reading of the third row splits at the expansion's `&` and reads no rule,
    // while its raw separator reads the rules; the union keeps the tag's reading, the only
    // denies it adds being the 0.3.1 reading's own (round 4, the structural fix).
    expect(bashRules('X=$${x/a&b/c} git push --force')).toEqual(expect.arrayContaining(['push', 'force-push']))
  })
  test('the union reads the 0.3.1 spelling too: a backtick } cannot sever the tail (review RR3-1)', () => {
    expect(bashRules('git push ${x:-`echo }` & echo hi} --force')).toEqual(expect.arrayContaining(['push', 'force-push']))
    expect(bashRules('git push origin ${x:-`echo }` & hi} :refs/heads/main')).toEqual(expect.arrayContaining(['push', 'branch-delete']))
  })
  test('the zone-level && and redirection guards stay pinned (review RR3-3)', () => {
    expect(bashRules('X=${x/a&&b/c} git push --force')).toEqual([])
    expect(bashRules('X=${x/a>&b/c} git push --force')).toEqual(expect.arrayContaining(['push', 'force-push']))
  })
  test('an escaped $ is text, and the & behind it splits as Bash splits it', () => {
    expect(bashRules('\\${x/a&b/c} git push --force')).toEqual([])
  })
  test('an unterminated expansion masks nothing: the split stays (fail closed)', () => {
    expect(bashRules('echo ${x & git push --force')).toEqual(expect.arrayContaining(['push', 'force-push']))
  })
  test('a flag and a message file beside the expansion stay with their command', () => {
    expect(bashRules('git push ${x/a&b/c} --force')).toContain('force-push')
    expect(commitMessageFiles('git commit -F ${x/a&b/c}')).toEqual(['${x/a&b/c}'])
  })
  test('control: an expansion without a boundary & reads as before', () => {
    expect(bashRules('git push ${x/a&b/c} origin main')).toEqual(['push'])
    expect(bashRules('echo ${x//&/y}')).toEqual([])
    expect(bashRules('printf x ${x/a/& git push --force }')).toEqual([])
  })
  test('control: the & beside an expansion still splits', () => {
    expect(bashRules('echo ${x//&/y} & git push --force')).toEqual(expect.arrayContaining(['push', 'force-push']))
  })
})


// RR3/round 4 structural pin: the union guarantee, row by row, over the round-3
// verifier's own matrix exports (scratch/s2-verifier-3, tag side; their msgFileText
// travels with each row). The rows below are every matrix row whose seat-mods-v0.3.1
// reading found a rule or a -F file; the other 311 rows read nothing
// there, which every head reading contains trivially. Every rule and file the 0.3.1
// reading found must appear in the head's reading of that row — the rails can miss
// nothing the tag caught (#723 round 4).
const TAG_SUPERSET_ROWS = [
  '["true &\\ngit push origin main","",["push"],[]]',
  '["true &\\ngit commit -F /w/msg.txt","",["commit"],["/w/msg.txt"]]',
  '["true &\\ngit push --force origin main","",["push","force-push"],[]]',
  '["true &\\ngit commit -F /w/msg.txt","",["commit"],["/w/msg.txt"]]',
  '["true &\\ngit merge feature","",["merge"],[]]',
  '["true &\\ngit commit -F /w/msg.txt","",["commit"],["/w/msg.txt"]]',
  '["true &\\ngh pr merge 12","",["merge"],[]]',
  '["true &\\ngit commit -F /w/msg.txt","",["commit"],["/w/msg.txt"]]',
  '["true &\\ngit commit -m \\"x\\n\\nCo-Authored-By: a\\"","",["commit","ai-trailer"],[]]',
  '["true &\\ngit commit -F /w/msg.txt","",["commit"],["/w/msg.txt"]]',
  '["true &\\ngit commit -F /w/msg-trailer.txt","fix\\n\\nCo-Authored-By: someone <x@y>\\n",["commit","ai-trailer"],["/w/msg-trailer.txt"]]',
  '["true &\\ngit commit -F /w/msg.txt","",["commit"],["/w/msg.txt"]]',
  '["true &\\ngit commit --no-verify -m m","",["no-verify","commit"],[]]',
  '["true &\\ngit commit -F /w/msg.txt","",["commit"],["/w/msg.txt"]]',
  '["true &\\ngit branch -D feature","",["branch-delete"],[]]',
  '["true &\\ngit commit -F /w/msg.txt","",["commit"],["/w/msg.txt"]]',
  '["true &\\ngit push --delete origin b","",["push","branch-delete"],[]]',
  '["true &\\ngit commit -F /w/msg.txt","",["commit"],["/w/msg.txt"]]',
  '["true &\\ngit commit -m m","",["commit"],[]]',
  '["true &\\ngit commit -F /w/msg.txt","",["commit"],["/w/msg.txt"]]',
  '["true & ( git push origin main )","",["push"],[]]',
  '["true & ( git commit -F /w/msg.txt )","",["commit"],["/w/msg.txt"]]',
  '["true & ( git push --force origin main )","",["push","force-push"],[]]',
  '["true & ( git commit -F /w/msg.txt )","",["commit"],["/w/msg.txt"]]',
  '["true & ( git merge feature )","",["merge"],[]]',
  '["true & ( git commit -F /w/msg.txt )","",["commit"],["/w/msg.txt"]]',
  '["true & ( gh pr merge 12 )","",["merge"],[]]',
  '["true & ( git commit -F /w/msg.txt )","",["commit"],["/w/msg.txt"]]',
  '["true & ( git commit -m \\"x\\n\\nCo-Authored-By: a\\" )","",["commit","ai-trailer"],[]]',
  '["true & ( git commit -F /w/msg.txt )","",["commit"],["/w/msg.txt"]]',
  '["true & ( git commit -F /w/msg-trailer.txt )","fix\\n\\nCo-Authored-By: someone <x@y>\\n",["commit","ai-trailer"],["/w/msg-trailer.txt"]]',
  '["true & ( git commit -F /w/msg.txt )","",["commit"],["/w/msg.txt"]]',
  '["true & ( git commit --no-verify -m m )","",["no-verify","commit"],[]]',
  '["true & ( git commit -F /w/msg.txt )","",["commit"],["/w/msg.txt"]]',
  '["true & ( git branch -D feature )","",["branch-delete"],[]]',
  '["true & ( git commit -F /w/msg.txt )","",["commit"],["/w/msg.txt"]]',
  '["true & ( git push --delete origin b )","",["push","branch-delete"],[]]',
  '["true & ( git commit -F /w/msg.txt )","",["commit"],["/w/msg.txt"]]',
  '["true & ( git commit -m m )","",["commit"],[]]',
  '["true & ( git commit -F /w/msg.txt )","",["commit"],["/w/msg.txt"]]',
  '["git push origin main & git merge x","",["push"],[]]',
  '["git status & git commit --no-verify -m m","",["no-verify"],[]]',
  '["git commit -m m 2>&1","",["commit"],[]]',
  '["git push origin main >&2","",["push"],[]]',
  '["git push origin main >& 2","",["push"],[]]',
  '["git push origin main &>","",["push"],[]]',
  '["git push origin main &>>","",["push"],[]]',
  '["git push origin main &>/dev/null","",["push"],[]]',
  '["git push origin main &> /dev/null","",["push"],[]]',
  '["git push origin main &>>/dev/null","",["push"],[]]',
  '["git push origin main <&0","",["push"],[]]',
  '["git push origin main >&-","",["push"],[]]',
  '["git push origin main 2>&-","",["push"],[]]',
  '["git commit -m \\"x\\n\\nCo-Authored-By: a\\" 2>&1","",["commit","ai-trailer"],[]]',
  '["git push origin main 2 >&1","",["push"],[]]',
  '["git push origin main > /dev/null 2>&1","",["push"],[]]',
  '["git commit -m m 2>&1 &","",["commit"],[]]',
  '["git commit -m m 2>&1 && git push origin main","",["commit","push"],[]]',
  '["git push origin main 2>&1 | tail -1","",["push"],[]]',
  '["git add f && git push --force","",["push","force-push"],[]]',
  '["git add f&&git push origin main","",["push"],[]]',
  '["git commit -m m &","",["commit"],[]]',
  '["git push origin main &","",["push"],[]]',
  '["git commit -m \\"a & b\\"","",["commit"],[]]',
  '["git commit -m \'a & b\'","",["commit"],[]]',
  '["git commit -m \'x & git push --force\'","",["commit"],[]]',
  '["git commit -m \\"x && y\\"","",["commit"],[]]',
  '["git commit -m m <<\'EOF\'\\nbody & more\\nEOF","",["commit"],[]]',
  '["git push origin main # & push & force","",["push"],[]]',
  '["git push origin main |& cat","",["push"],[]]',
  '["git add f\\ngit push origin main","",["push"],[]]',
  '["FOO=1 git push origin main &","",["push"],[]]',
  '["env git push origin main","",["push"],[]]',
  '["git push origin main","",["push"],[]]',
  '["git merge x 2>&1","",["merge"],[]]',
  '["gh pr merge 12 2>&1","",["merge"],[]]',
  '["git branch -D x 2>&1","",["branch-delete"],[]]',
  '["git commit -F /w/msg.txt 2>&1","",["commit"],["/w/msg.txt"]]',
  '["git commit -F /w/msg.txt &","",["commit"],["/w/msg.txt"]]',
  '["git commit -m m -F /w/msg.txt","",["commit"],["/w/msg.txt"]]',
  '["git commit --file=/w/msg2.txt","",["commit"],["/w/msg2.txt"]]',
  '["git commit -F/w/msg3.txt","",["commit"],["/w/msg3.txt"]]',
  '["X=${x/a&b/c} git push --force","",["push","force-push"],[]]',
  '["X=$[2&3] git push --force","",["push","force-push"],[]]',
  '["X=${x/a&b/c} gh pr merge 12","",["merge"],[]]',
  '["X=${a:-${b/&/c}} git push --force","",["push","force-push"],[]]',
  '["git push ${x/a&b/c} --force","",["push","force-push"],[]]',
  '["git push origin main ${x/a&b/c}","",["push"],[]]',
  '["git push origin main $[2&3]","",["push"],[]]',
  '["X=${x/[a&b]/c} git push --force","",["push","force-push"],[]]',
  '["X=$[a[1]&2] git push --force","",["push","force-push"],[]]',
  '["X=${x/a&b/c} git commit -F /w/msg.txt","",["commit"],["/w/msg.txt"]]',
  '["X=${x/a&b/c} git commit -F /w/msg.txt","",["commit"],["/w/msg.txt"]]',
  '["git commit -F ${x/a&b/c}","",["commit"],["${x/a&b/c}"]]',
  '["git commit -F ${d}/msg.txt","",["commit"],["${d}/msg.txt"]]',
  '["git commit ${x/a&b/c} -F /w/msg.txt","",["commit"],["/w/msg.txt"]]',
  '["git commit -m ${x:-a\\nCo-Authored-By: b}","",["commit"],[]]',
  '["X=${x/a&b/c} git commit -m \\"x\\n\\nCo-Authored-By: a\\"","",["commit","ai-trailer"],[]]',
  '["git push ${x/a&b/c} origin main","",["push"],[]]',
  '["git commit -m ${x/a&b/c}","",["commit"],[]]',
  '["git commit -m \'${x&y}\'","",["commit"],[]]',
  '["git commit -m \\"a & ${x&y}\\"","",["commit"],[]]',
  '["git push origin main ${x} 2>&1","",["push"],[]]',
  '["${x} && git push --force","",["push","force-push"],[]]',
  '["X=${x/a&b/c git push --force","",["push","force-push"],[]]',
  '["X=$[2&3 git push --force","",["push","force-push"],[]]',
  '["X=${x/a}b&c/d} git push --force","",["push","force-push"],[]]',
  '["X=$[a]b&c]d git push --force","",["push","force-push"],[]]',
  '["echo ${x:-$(git push --force)}","",["push","force-push"],[]]',
  '["X=${x:-$(git push --force)}","",["push","force-push"],[]]',
  '["echo ${x:-$(git push --force>&2)}","",["push"],[]]',
  '["echo ${x:-$(true&&git push --force)}","",["push","force-push"],[]]',
  '["echo ${x:-$(git push --force) & git status}","",["push","force-push"],[]]',
  '["echo ${x:-$(X=${y/a&b/c} git push --force)}","",["push","force-push"],[]]',
  '["echo $(X=${y/a&b/c} git push --force)","",["push","force-push"],[]]',
  '["X=${x:-$[2&3]} git push --force","",["push","force-push"],[]]',
  '["X=$[${x:-2}&3] git push --force","",["push","force-push"],[]]',
  '["X=$[$[2&3]&1] git push --force","",["push","force-push"],[]]',
  '["X=$[arr[1]&2] git push --force","",["push","force-push"],[]]',
  '["X=$$${x/a&b/c} git push --force","",["push","force-push"],[]]',
  '["X=$$$(git push --force)","",["push","force-push"],[]]',
  '["X=$$$[2&3] git push --force","",["push","force-push"],[]]',
  '["X=$$& git push --force","",["push","force-push"],[]]',
  '["X=$${x} git push --force","",["push","force-push"],[]]',
  '["X=$${x/a&b/c} git push --force","",["push","force-push"],[]]',
  '["X=$$$${x&y} git push --force","",["push","force-push"],[]]',
  '["X=\\\\$${x/a&b/c} git push --force","",["push","force-push"],[]]',
  '["X=${x:-\'a&b\'} git push --force","",["push","force-push"],[]]',
  '["X=${x:-\\"a&b\\"} git push --force","",["push","force-push"],[]]',
  '["X=${x/a\\"b&c\\"d/e} git push --force","",["push","force-push"],[]]',
  '["X=${x:-\\"a&b} git push --force","",["push","force-push"],[]]',
  '["X=${x:-\'a&b} git push --force","",["push","force-push"],[]]',
  '["X=\\"${x/a&b/c}\\" git push --force","",["push","force-push"],[]]',
  '["git push --force ${x/a&b/c","",["push","force-push"],[]]',
  '["git push --force $[2&3","",["push","force-push"],[]]',
  '["X=${a:-${b/&/c git push --force","",["push","force-push"],[]]',
  '["X=${x/[}a]&b/c} git push --force","",["push","force-push"],[]]',
  '["X=${x/a]b&c/d} git push --force","",["push","force-push"],[]]',
  '["X=$[a]&2] git push --force","",["push","force-push"],[]]',
  '["X=${x/a&>b/c} git push --force","",["push","force-push"],[]]',
  '["X=${x/a&}&b git push --force","",["push","force-push"],[]]',
  '["echo ${x/a&b/c}\\ngit push --force","",["push","force-push"],[]]',
  '["X=$(echo a\\ngit push --force)","",["push","force-push"],[]]',
  '["git commit -m ${x:-a&b\\n\\nCo-Authored-By: c}","",["commit"],[]]',
  '["git commit -F ${x/a&b/c}/msg.txt","",["commit"],["${x/a&b/c}/msg.txt"]]',
  '["git commit -F ${x/a&b/c}","",["commit"],["${x/a&b/c}"]]',
  '["X=${x/a&b/c} git commit -m \\"x\\n\\nCo-Authored-By: a\\"","",["commit","ai-trailer"],[]]',
  '["git push origin main 2>&1 --force","",["push","force-push"],[]]',
  '["git push origin main >&2","",["push"],[]]',
  '["git push origin main &>/dev/null","",["push"],[]]',
  '["git push origin main <&0","",["push"],[]]',
  '["a && git push --force","",["push","force-push"],[]]',
  '["git commit -m m &","",["commit"],[]]',
  '["X=$((2&3)) git push --force","",["push","force-push"],[]]',
  '["git push $((2&3)) --force","",["push"],[]]',
].map(row => JSON.parse(row) as [string, string, string[], string[]])
const TAG_SUPERSET_VACUOUS = 311

test('head rules and -F files are a superset of the 0.3.1 reading, over the verifier matrix', () => {
  expect(TAG_SUPERSET_ROWS.length + TAG_SUPERSET_VACUOUS).toBe(466)
  const missing: string[] = []
  for (const [command, messageFileText, rules, files] of TAG_SUPERSET_ROWS) {
    for (const rule of rules)
      if (!(bashRules(command, messageFileText) as string[]).includes(rule)) missing.push(`rule ${rule} :: ${command}`)
    for (const file of files)
      if (!commitMessageFiles(command).includes(file)) missing.push(`file ${file} :: ${command}`)
  }
  expect(missing).toEqual([])
})

// Batch 5, C3 and C4 (#702 B2/B8, #724 A10): the command word is read as Bash reads it
// after quote removal, and a redirection never hides the word it touches.
describe('batch 5: command word', () => {
  test('an escaped command word runs the command it spells', () => {
    expect(bashRules('\\git push --force origin main')).toContain('force-push')
    expect(rmTargets('\\rm -rf /etc/x')).toEqual([{ path: '/etc/x', glob: false }])
    expect(bashRules('git push \\--force origin main')).toContain('force-push')
  })
  test('an escaped path character is the character Bash passes on', () => {
    // Every member of the dropped class, and a word that starts like a reserved word (`\do`).
    expect(commitMessageFiles('git commit -F \\/w\\/m\\_\\1\\.\\-\\a\\Z')).toEqual(['/w/m_1.-aZ'])
    expect(commitMessageFiles('git commit -F /w/\\dos\\fi.txt')).toEqual(['/w/dosfi.txt'])
    // A reserved word at the very end of the command is still not unescaped (the value keeps
    // its backslash, as every kept escape does; it shows the word was not read as syntax).
    expect(commitMessageFiles('git commit -F \\do')).toEqual(['\\do'])
    // control: a character outside the class keeps its escape, which the path then carries
    expect(commitMessageFiles('git commit -F /w/m\\*')).toEqual(['/w/m\\*'])
  })
  test('control: an escaped backslash is not an escaped command word', () => {
    expect(bashRules('\\\\git push --force origin main')).toEqual([])
    expect(bashRules('\\git status')).toEqual([])
  })
  test('control: an escaped reserved word is a program, not a head word', () => {
    for (const word of ['if', 'then', 'elif', 'else', 'do', 'while', 'until']) {
      expect(bashRules(`\\${word} git push --force`)).toEqual([])
      expect(bashRules(`${word} git push --force`)).toContain('force-push')
    }
  })
  test('an fd-variable redirection before the command does not hide it', () => {
    expect(rmTargets('{log}>/w/f rm -rf /etc/x')).toEqual([{ path: '/etc/x', glob: false }])
    expect(bashRules('{log}>/w/f git push --force')).toContain('force-push')
    expect(bashRules('2>/w/f git push --force')).toContain('force-push')
    expect(bashRules('&>/w/f git push --force')).toContain('force-push')
  })
  test('control: a brace word that is not an fd variable stays an ordinary word', () => {
    expect(bashRules('{log,x}>/w/f git push --force')).toEqual([])
  })
  test('a lone redirection operator takes the next word as its target, not as the command', () => {
    expect(bashRules('> /w/f git push --force')).toContain('force-push')
    expect(bashRules('2> /w/f git push --force')).toContain('force-push')
    expect(bashRules('git push origin main > --force')).toEqual(['push'])
    expect(bashRules('git push origin main >& --force')).toEqual(['push'])
    // control: only the target is dropped; the flag after it is still the push's
    expect(bashRules('git push origin main > /w/f --force')).toContain('force-push')
  })
  test('a redirection glued to a flag is cut off it', () => {
    for (const c of ['git push --force>&2', 'git push --force&>f', 'git push -f>/dev/null',
      'git push --force</dev/null', 'git push --force<&0', 'git push --force>>f', 'git push --force>a>b'])
      expect(bashRules(c)).toContain('force-push')
    expect(bashRules('git push --force> /w/f')).toContain('force-push')
    expect(bashRules('git push origin main --x> --force')).toEqual(['push'])
    expect(bashRules('git push origin main --force2>/dev/null')).toEqual(['push'])
  })
  test('control: the redirection words are not the command\'s arguments', () => {
    expect(bashRules('git push origin main 2>&1')).toEqual(['push'])
    expect(bashRules('git push origin main 2>&1 --force')).toContain('force-push')
    expect(bashRules('git commit -m "a\\b" 2>/dev/null')).toEqual(['commit'])
  })
  test('a path-qualified wrapper is skipped as its bare name', () => {
    expect(bashRules('./env git push --force origin main')).toContain('force-push')
    expect(bashRules('./env git status')).toEqual([])
  })
})

// Batch 5, C2 (#724 A3/A9/A11, #702 B3/B10/B10b/B11): heredocs read as Bash reads them —
// the opener line runs, a `<<` in arithmetic or a comment opens nothing, and the
// delimiter is its word after quote removal, found before any line is folded.
describe('batch 5: heredocs', () => {
  const RULED = 'git push --force origin main'
  // The 11 closing spellings of evidence row 702-B10: each closes at a line `EOF`.
  const CLOSES = ['\\EOF', 'E\\OF', '\\E\\O\\F', "E'OF'", 'E"OF"', "'E'OF", '"E"OF', 'E\\O"F"', "\\E'OF'"]
  test('C2a: the opener line after the delimiter word runs', () => {
    expect(bashRules(`cat <<EOF; ${RULED}\nbody\nEOF`)).toContain('force-push')
    expect(bashRules(`cat <<EOF & ${RULED}\nbody\nEOF`)).toContain('force-push')
    expect(bashRules(`cat <<EOF \\\n; ${RULED}\nbody\nEOF`)).toContain('force-push')
    // an escaped backslash ends the opener line, and its text joins nothing after the body
    expect(bashRules(`echo <<EOF x\\\\\nbody\nEOF\n${RULED}`)).toContain('force-push')
    expect(bashRules(`echo a\\\\\n${RULED}`)).toContain('force-push')
    // control: the body is still text
    expect(bashRules(`cat <<EOF; echo x\n${RULED}\nEOF`)).toEqual([])
    expect(bashRules(`cat <<EOF \\\n> out\n${RULED}\nEOF`)).toEqual([])
  })
  test('C2a: the body marker stays in the opener\'s own segment for the trailer check', () => {
    expect(bashRules("git commit -F - <<'EOF' && echo done\nfix\n\nCo-Authored-By: a\nEOF")).toContain('ai-trailer')
    expect(bashRules("git commit -m \"$(cat <<'EOF'\nfix\n\nCo-Authored-By: a\nEOF\n)\"")).toContain('ai-trailer')
    // control: a trailer-shaped body fed to another command is not the commit's message
    expect(bashRules("git commit -m x && cat <<'EOF'\nCo-Authored-By: a\nEOF")).toEqual(['commit'])
  })
  test('C2b: a << in arithmetic or in a comment opens no heredoc', () => {
    expect(bashRules(`echo $((1<<c))\n${RULED}`)).toContain('force-push')
    expect(bashRules(`echo "$((1<<c))"\n${RULED}`)).toContain('force-push')
    expect(bashRules(`(( a << b ))\n${RULED}`)).toContain('force-push')
    expect(bashRules(`# <<EOF\n${RULED}`)).toContain('force-push')
    expect(bashRules(`echo ok # <<EOF\n${RULED}`)).toContain('force-push')
    expect(bashRules(`cat <<EOF # <<X\nbody\nEOF\n${RULED}`)).toContain('force-push')
    expect(bashRules(`echo $(( (1) + (2) << c ))\n${RULED}`)).toContain('force-push')
    // a comment starts after an operator, a closed quote and a continued line; a body's quote is text
    expect(bashRules(`echo ok;# <<EOF\n${RULED}`)).toContain('force-push')
    expect(bashRules(`echo "a" # <<EOF\n${RULED}`)).toContain('force-push')
    expect(bashRules(`echo 'a' # <<EOF\n${RULED}`)).toContain('force-push')
    expect(bashRules(`echo ok \\\n# <<EOF\n${RULED}`)).toContain('force-push')
    expect(bashRules(`cat <<EOF\nit's\nEOF\n# <<X\n${RULED}`)).toContain('force-push')
    expect(rmTargets('# <<EOF\nrm -rf /etc/x')).toEqual([{ path: '/etc/x', glob: false }])
    expect(rmTargets('echo $((1<<c))\nrm -rf /etc/x')).toEqual([{ path: '/etc/x', glob: false }])
  })
  test('control: a heredoc after arithmetic, or after a # that starts no comment, still opens', () => {
    expect(bashRules(`(( a )) && cat <<EOF\n${RULED}\nEOF`)).toEqual([])
    expect(bashRules(`echo $((1)) <<EOF\n${RULED}\nEOF`)).toEqual([])
    expect(bashRules(`echo "#" <<EOF\n${RULED}\nEOF`)).toEqual([])
    expect(bashRules(`echo "x #" <<EOF\n${RULED}\nEOF`)).toEqual([])
    expect(bashRules(`echo 'x #' <<EOF\n${RULED}\nEOF`)).toEqual([])
    expect(bashRules(`echo a#b <<EOF\n${RULED}\nEOF`)).toEqual([])
    expect(bashRules(`echo \\ #b <<EOF\n${RULED}\nEOF`)).toEqual([])
    expect(bashRules(`cat <<EOF # note\n${RULED}\nEOF`)).toEqual([])
    expect(bashRules(`# note\ncat <<EOF\n${RULED}\nEOF`)).toEqual([])
    // `$((` in single quotes is text, and `((` inside a word starts no arithmetic
    expect(bashRules(`echo '$((' <<EOF\n${RULED}\nEOF`)).toEqual([])
    expect(bashRules(`cat <((cat <<EOF\n${RULED}\nEOF\n))`)).toEqual([])
  })
  test('C2c: the delimiter is its word after quote removal', () => {
    for (const d of CLOSES) {
      expect(bashRules(`cat <<${d}\nbody\nEOF\n${RULED}`)).toContain('force-push')
      expect(rmTargets(`cat <<${d}\nbody\nEOF\nrm -f /etc/x`)).toEqual([{ path: '/etc/x', glob: false }])
      // control: what comes before the closing line is still body text
      expect(bashRules(`cat <<${d}\n${RULED}\nEOF`)).toEqual([])
    }
    expect(bashRules(`cat <<-\\EOF\n\tbody\n\tEOF\n${RULED}`)).toContain('force-push')
    expect(bashRules(`cat 2<<\\EOF\nbody\nEOF\n${RULED}`)).toContain('force-push')
    expect(bashRules(`cat <<E''OF\nbody\nEOF\n${RULED}`)).toContain('force-push')
    expect(bashRules(`cat <<"E\\$OF"\nbody\nE$OF\n${RULED}`)).toContain('force-push')
    // `<<-` strips the tabs of the joined line: this one closes at its second line
    expect(bashRules(`cat <<-EOF\n\t\\\n\tEOF\n${RULED}\nEOF`)).toContain('force-push')
    // An empty quoted delimiter closes at the first empty line.
    expect(bashRules(`cat <<''\nbody\n\n${RULED}`)).toContain('force-push')
    expect(bashRules(`cat <<''\n${RULED}\n\necho done`)).toEqual([])
  })
  test('C2c: E"O\\F" never closes at EOF; Bash\'s delimiter is EO\\F', () => {
    expect(bashRules(`cat <<E"O\\F"\nbody\nEOF\n${RULED}`)).not.toContain('force-push')
    // control: its own delimiter closes it
    expect(bashRules(`cat <<E"O\\F"\nbody\nEO\\F\n${RULED}`)).toContain('force-push')
  })
  test('B10b: a body line E does not close <<E\'OF\' early', () => {
    expect(bashRules(`cat <<E'OF'\nE\n${RULED}\nEOF`)).not.toContain('force-push')
  })
  test('B11: a quoted body line ending in a backslash is not folded into the closing line', () => {
    expect(rmTargets("cat <<'EOF'\ny\\\nEOF\nrm -f /var/x")).toEqual([{ path: '/var/x', glob: false }])
    expect(bashRules(`cat <<'EOF'\ny\\\nEOF\n${RULED}`)).toContain('force-push')
    // a quoted body keeps its lines, so git reads this trailer on a line of its own
    expect(bashRules("git commit -F - <<'EOF'\nfix\\\nCo-Authored-By: a\nEOF")).toContain('ai-trailer')
  })
  test('control: an unquoted body line ending in a backslash joins the next, as in Bash', () => {
    expect(bashRules(`cat <<EOF\ny\\\nEOF\n${RULED}`)).toEqual([])
    expect(bashRules(`cat <<EOF\ny\\\nEOF\nEOF\n${RULED}`)).toContain('force-push')
    expect(bashRules(`cat <<EOF\ny\\\\\nEOF\n${RULED}`)).toContain('force-push')
    expect(bashRules("git commit -F - <<EOF\nfix\\\nCo-Authored-By: a\nEOF")).toEqual(['commit'])
  })
  test('Review Focus 5: two heredocs on one line close in order', () => {
    expect(bashRules(`cat <<A <<'B'\na\nA\nb\nB\n${RULED}`)).toContain('force-push')
    expect(rmTargets("rm -i /reports/x <<A <<'B'\na\nA\nb\nB\nrm -rf /etc/x")).toEqual([
      { path: '/reports/x', glob: false }, { path: '/etc/x', glob: false },
    ])
    // control: the second body is text, and it starts after the first one's closing line
    expect(bashRules(`cat <<A <<'B'\na\nA\n${RULED}\nB`)).toEqual([])
    expect(bashRules(`cat <<A <<B\nB\nA\n${RULED}\nB`)).toEqual([])
  })
  test('control: the standard commit form stays a commit', () => {
    expect(bashRules("git commit -m \"$(cat <<'EOF'\nfix: x\n\ngit merge and git push --force are words here\nEOF\n)\"")).toEqual(['commit'])
  })
})
