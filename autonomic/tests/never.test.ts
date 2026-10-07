import { describe, test, expect } from 'claude-code/testing'
import { namesDanger, neverRules } from '../hooks/never'
import type { Where } from '../hooks/never'

const W: Where = { cwd: '/repo/sub', root: '/repo', home: '/h', branch: 'feat/x', defaultBranch: 'main' }
const rules = (c: string, w: Where = W) => neverRules(c, w).sort()

// autonomic 0.2.0 (#684 direction 2′): the floor reads the text as one bag of words, so every
// 0.1.1 `unreadable` case now names the rule its words show, or nothing when they show none.
describe('the never-approve list (spec §3.3, plan decision 3)', () => {
  test('a quote-split option is joined; a quoted value is not a flag (PR #681 round 18)', () => {
    expect(rules('git merge --no-""verify feat/x')).toContain('no-verify')
    expect(rules('git commit -m "msg"')).toEqual([])
  })
  test('~name is another home: outside (PR #681 round 18)', () => {
    expect(rules('rm -rf ~root')).toContain('rm-outside')
  })
  test('GIT_DIR or GIT_WORK_TREE makes the repository unknown (PR #681 round 17)', () => {
    expect(rules('GIT_DIR=/other/.git git push')).toContain('default-branch-push')
    expect(rules('GIT_WORK_TREE=/other git push')).toContain('default-branch-push')
  })
  test('heads/main is main (PR #681 round 17)', () => {
    expect(rules('git push origin heads/main')).toContain('default-branch-push')
  })
  test('nothing is below a worktree at / (PR #681 round 16)', () => {
    expect(rules('rm -rf --no-preserve-root /', { ...W, root: '/', cwd: '/' })).toContain('rm-outside')
  })
  test('with --repo, a positional may be the remote or a refspec: both readings are checked (PR #681 round 16)', () => {
    expect(rules('git push --repo x origin', { ...W, branch: 'main' })).toContain('default-branch-push')
    expect(rules('git push --repo origin main')).toContain('default-branch-push')
  })
  test('a quoted command word after a wrapper is read (PR #681 round 15)', () => {
    expect(rules('prlimit "git" push -f origin feat/x')).toContain('force-push')
    expect(rules("prlimit 'rm' -rf /tmp/x")).toContain('rm-outside')
    expect(rules('echo "done" && git push origin feat/x')).toEqual([])
  })
  test('an abbreviated option keeps its attached value (PR #681 round 15)', () => {
    expect(rules('git push --force-w=feat/x origin feat/x')).toContain('force-push')
  })
  test('any unlisted wrapper before git or rm is unreadable (PR #681 round 14)', () => {
    for (const c of ['prlimit git push -f origin feat/x', 'mywrap --x /usr/bin/git push -f', 'cgexec -g cpu:x rm -rf /tmp/x'])
      expect([c, rules(c).length > 0]).toEqual([c, true])
    expect(rules('npm test && git push origin feat/x')).toEqual([])
  })
  test('an inline alias value shows its verb (PR #681 round 14)', () => {
    expect(rules('git -c "alias.p=push" p -f origin feat/x')).toContain('force-push')
  })
  test('an abbreviated value-taking push option skips its value (PR #681 round 14)', () => {
    expect(rules('git push --recurse-submodule check origin', { ...W, branch: 'main' })).toContain('default-branch-push')
  })
  test('--recurse-submodules takes a value (PR #681 round 13)', () => {
    expect(rules('git push --recurse-submodules check origin', { ...W, branch: 'main' })).toContain('default-branch-push')
  })
  test('a cluster that starts with a numeric flag is split (PR #681 round 12)', () => {
    expect(rules('git push -4f origin feat/x')).toContain('force-push')
    expect(rules('git push -4d origin feat/x')).toContain('branch-delete')
  })
  test('a mirror push deletes refs too (PR #681 round 11)', () => {
    expect(rules('git push --mirror origin')).toContain('branch-delete')
  })
  test('an inline alias key is matched whatever its case (PR #681 round 10)', () => {
    expect(rules('git -c Alias.p=push p -f origin feat/x')).toContain('force-push')
  })
  test('an opaque push still reports what it shows (PR #681 round 10)', () => {
    expect(rules('git push "$REMOTE" feat/x:main')).toEqual(expect.arrayContaining(['force-push', 'default-branch-push']))
  })
  test('an abbreviated --no-verify passes the pre-check (PR #681 round 10)', () => {
    expect(namesDanger('git am --no-verif patch.mbox')).toBe(true)
    expect(rules('git am --no-verif patch.mbox')).toContain('no-verify')
  })
  test('a push flag that holds a variable may be any flag (PR #681 round 9)', () => {
    expect(rules('git push --force$EMPTY origin feat/x')).toEqual(['branch-delete', 'default-branch-push', 'force-push'])
  })
  test('a Bash builtin that runs a command is a runner (PR #681 round 7)', () => {
    for (const c of ['coproc git push -f origin feat/x', 'builtin command git push -f', "trap 'git push -f' EXIT"])
      expect(rules(c)).not.toEqual([])
  })
  test('a substitution in an unquoted heredoc is read; a quoted cat heredoc is text (PR #681 round 6)', () => {
    expect(rules('cat <<EOF\n$(git push -f origin feat/x)\nEOF')).toContain('force-push')
    expect(rules("git commit -m \"$(cat <<'EOF'\nfix: push the branch $(not run)\nEOF\n)\"")).toEqual([])
  })
  test('a path-qualified wrapper is a runner (PR #681 round 6)', () => {
    for (const c of ['/usr/bin/env git push -f origin feat/x', '/usr/bin/sudo git push -f', '/usr/bin/nohup git push -f'])
      expect(rules(c)).not.toEqual([])
  })
  test('rm operands after -- are paths whatever their first character (PR #681 round 6)', () => {
    expect(rules('rm -rf -- -/../../../tmp/victim')).toContain('rm-outside')
  })
  test('the matching refspec : may update the default branch (PR #681 round 6)', () => {
    expect(rules('git push origin :')).toContain('default-branch-push')
    expect(rules('git push origin +:')).toContain('default-branch-push')
  })
  test('a wrapper that runs a program is a runner (PR #681 round 4)', () => {
    for (const c of ['setsid git push -f origin feat/x', 'stdbuf -oL git push -f', 'flock /tmp/l git push -f', 'taskset 1 git push -f'])
      expect(rules(c)).not.toEqual([])
  })
  test('a short-flag cluster with an attached value is split up to the value (PR #681 round 4)', () => {
    expect(rules('git commit -nF/tmp/message')).toContain('no-verify')
    expect(rules('git commit -am"x"')).toEqual([])
    // 0.2.0: -ofoo holds an f, an accepted extra ask.
    expect(rules('git push -ofoo origin feat/x')).toEqual(['force-push'])
  })
  test('git send-pack and http-push are pushes; with no refspec they may update the default (PR #681 round 4)', () => {
    expect(rules('git send-pack --force origin refs/heads/feat/x:refs/heads/main')).toEqual(['default-branch-push', 'force-push'])
    expect(rules('git http-push -v https://x/r.git main')).toEqual(['default-branch-push'])
    expect(rules('git send-pack x')).toEqual(['default-branch-push'])
  })
  test('cd into a directory below the root reads the branch as unknown (PR #681 round 4)', () => {
    expect(rules('cd /repo/other && git push')).toContain('default-branch-push')
    // 0.2.0: any push after a move asks, refspec or not — an accepted extra ask.
    expect(rules('cd /repo/other && git push origin feat/x')).toEqual(['default-branch-push'])
    expect(rules('cd /repo/sub && git push')).toEqual([])
    expect(rules('cd /repo && git push')).toEqual([])
  })
  test('a wildcard refspec may push the default branch (PR #681 round 3)', () => {
    expect(rules('git push origin refs/heads/*:refs/heads/*')).toContain('default-branch-push')
    expect(rules('git push origin feat/*')).toContain('default-branch-push')
  })
  test('git -C into another directory reads the branch as unknown (PR #681 round 3)', () => {
    expect(rules('git -C /repo/sub/mod push')).toContain('default-branch-push')
    expect(rules('git -C /repo/sub/mod push origin feat/x')).toEqual(['default-branch-push'])
    expect(rules('git -C /repo push')).toEqual([])
    expect(rules('git -C sub push')).toContain('default-branch-push')
  })
  test('refspecs after -- are checked for force and delete (PR #681 round 3)', () => {
    expect(rules('git push origin -- +feat/x')).toContain('force-push')
    expect(rules('git push origin -- :feat/x')).toContain('branch-delete')
  })
  test('an escaped or quote-split word is unreadable when it may spell a danger (PR #681 round 2)', () => {
    for (const c of ['git pu\\sh -f origin feat/x', 'git pu""sh -f', "git p'u'sh -f", 'r\\m -rf /tmp/x', 'git push origin ma\\in'])
      expect(rules(c)).not.toEqual([])
  })
  test('--repo names the remote, so every positional is a refspec (PR #681 round 2)', () => {
    expect(rules('git push --repo origin main')).toContain('default-branch-push')
    expect(rules('git push --repo=origin main')).toContain('default-branch-push')
    expect(rules('git push --repo origin feat/x')).toEqual([])
  })
  test('@ is HEAD (PR #681 round 2)', () => {
    expect(rules('git push origin @', { ...W, branch: 'main' })).toContain('default-branch-push')
  })
  test('a brace or a dot-glob in an rm path may leave the root (PR #681 round 2)', () => {
    expect(rules('rm -rf /repo/{.,x}./victim')).toContain('rm-outside')
    expect(rules('rm -rf /repo/sub/.?')).toContain('rm-outside')
    expect(rules('rm -rf /repo/dist/*')).toEqual([])
    expect(rules('git push origin {main,x}')).not.toEqual([])
  })
  test('the program an interpreter runs shows its words (PR #681)', () => {
    for (const c of [`python3 -c 'import os; os.system("git push -f")'`, `node -e "require('child_process').execSync('git push -f')"`,
      `ruby -e 'system("git push -f")'`])
      expect([c, rules(c)]).toEqual([c, ['force-push']])
    expect(rules(`perl -e 'system("rm -rf /")'`)).toEqual(['rm-outside'])
    // 0.2.0: an interpreter beside a plain push is not an ask (live check L3).
    expect(rules(`/usr/bin/python3.12 -c 'x' && git push origin feat/x`)).toEqual([])
    expect(rules('python3 tools/build.py')).toEqual([])
  })
  test('git globals and inline aliases do not hide a push (PR #681)', () => {
    expect(rules('git --git-dir .git push -f origin main')).toEqual(['default-branch-push', 'force-push'])
    expect(rules('git --work-tree /x push origin main')).toEqual(['default-branch-push'])
    for (const c of ['git --namespace n push -f', 'git -c alias.p=push p -f', 'git --config-env alias.p=E push -f'])
      expect([c, rules(c)]).toEqual([c, ['force-push']])
    expect(rules('git --no-pager commit -m x')).toEqual([])
    expect(rules('git -C /repo push origin feat/x')).toEqual([])
    expect(rules('git --git-dir=/repo/.git push -f')).toContain('force-push')
  })
  test('an abbreviated long option is read as the option it abbreviates (PR #681)', () => {
    expect(rules('rm --recurs /tmp/x')).toContain('rm-outside')
    expect(rules('git push --forc origin feat/x')).toContain('force-push')
    expect(rules('git push --mir')).toContain('force-push')
    expect(rules('git push --force-w origin feat/x')).toContain('force-push')
    expect(rules('git commit --no-verif -m x')).toContain('no-verify')
    expect(rules('git push --del origin x')).toContain('branch-delete')
    expect(rules('git branch --del --forc x')).toContain('branch-delete')
    expect(rules('git push --dry-run origin feat/x')).toEqual([])
    expect(rules('git push --follow-tags origin feat/x')).toEqual([])
  })
  test('namesDanger is the cheap pre-check (Review Focus 2)', () => {
    for (const c of ['git push', 'rm -rf x', 'git commit -m x', 'x --no-verify', 'git branch -D y']) expect(namesDanger(c)).toBe(true)
    for (const c of ['ls -la', 'npm test', 'git status', 'cat README.md']) expect(namesDanger(c)).toBe(false)
    for (const c of ['git pu\\sh', 'git pu""sh', "r'm' -rf x"]) expect(namesDanger(c)).toBe(true)
  })
  test('force push, in every spelling', () => {
    for (const c of ['git push -f', 'git push --force origin feat/x', 'git push --force-with-lease', 'git push origin +feat/x', 'git push --mirror'])
      expect(rules(c)).toContain('force-push')
  })
  test('a push to the default branch', () => {
    for (const c of ['git push origin main', 'git push origin HEAD:main', 'git push origin feat/x:refs/heads/main', 'git push --all'])
      expect(rules(c)).toContain('default-branch-push')
    expect(rules('git push', { ...W, branch: 'main' })).toContain('default-branch-push')
    expect(rules('git push origin HEAD', { ...W, branch: 'main' })).toContain('default-branch-push')
  })
  test('the session branch is not the default branch (control)', () => {
    expect(rules('git push')).toEqual([])
    expect(rules('git push -u origin feat/x')).toEqual([])
  })
  test('an unknown default branch means main or master', () => {
    const w = { ...W, defaultBranch: undefined }
    expect(rules('git push origin master', w)).toContain('default-branch-push')
    expect(rules('git push origin trunk', w)).toEqual([])
  })
  test('an unknown current branch makes a bare push a default push', () => {
    expect(rules('git push', { ...W, branch: undefined })).toContain('default-branch-push')
  })
  test('branch deletion as seat-mods reads it; plain -d is not on the list', () => {
    for (const c of ['git branch -D x', 'git branch -d -f x', 'git push origin --delete x', 'git push origin :x'])
      expect(rules(c)).toContain('branch-delete')
    expect(rules('git branch -d merged')).toEqual([])
  })
  test('--no-verify and commit -n', () => {
    expect(rules('git commit -n -m x')).toContain('no-verify')
    expect(rules('git push --no-verify')).toContain('no-verify')
  })
  test('rm -r outside the worktree', () => {
    for (const c of ['rm -rf /tmp/x', 'rm -r ../../etc', 'rm -R ~/x', 'rm --recursive /repo', 'rm -rf "$DIR"', 'rm -rf $HOME/x'])
      expect(rules(c)).toContain('rm-outside')
  })
  test('rm -r inside the worktree, and plain rm, are not on the list (control)', () => {
    expect(rules('rm -rf build')).toEqual([])
    // 0.2.0: a .. segment is outside without resolving it — an accepted extra ask.
    expect(rules('rm -r ../other')).toEqual(['rm-outside'])
    expect(rules('rm -rf /repo/dist/*')).toEqual([])
    expect(rules('rm -f *.tmp')).toEqual([])
    expect(rules('rm -rf build/*')).toEqual([])
    expect(rules('docker run --rm -v /x:/y img')).toEqual([])
    expect(rules('rm /tmp/x')).toEqual([])
  })
  test('a hidden segment still counts (review focus 5)', () => {
    expect(rules('git status && git push -f')).toContain('force-push')
    expect(rules('cd /tmp && rm -rf x')).toContain('rm-outside')
    expect(rules('ls; (git push origin main)')).toContain('default-branch-push')
  })
  test('quoted text shows its words: a message naming a danger is an accepted extra ask (0.2.0)', () => {
    expect(rules('git commit -m "do not git push -f"')).toEqual(['force-push'])
    expect(rules('git commit -m "msg"')).toEqual([])
  })

  test('shapes the shared reader cannot read are listed when they name a danger (final review I1)', () => {
    const cases = ['git push -uf origin feat/x', 'git commit -nm wip', 'git branch -df old', 'sleep 1 & git push -f',
      'if true; then git push -f; fi', '{ git push -f; }', '! git push -f', 'for b in a; do git push -f; done',
      'echo `git push -f`', 'bash -c "git push -f"', "sh -c 'rm -rf /etc/x'", 'xargs rm -rf', 'timeout 60 git push -f',
      'nice git push -f', 'env -i git push -f', 'sudo -u root rm -rf /etc/x']
    for (const c of cases) expect([c, rules(c).length > 0]).toEqual([c, true])
    expect(rules('git push -o ci.skip origin', { ...W, branch: 'main' })).toContain('default-branch-push')
  })
  test('the same shapes with no danger stay off the list (control)', () => {
    for (const c of ['bash run-tests.sh', 'timeout 60 make test', 'xargs ls', 'if true; then echo hi; fi'])
      expect([c, rules(c)]).toEqual([c, []])
  })
  test('quoted, escaped and variable words, glued & and redirects are read or listed (PR #672 round 1)', () => {
    const main = { ...W, branch: 'main' }
    expect(rules('git push origin "main"')).toEqual(['default-branch-push'])
    // A bare variable beside a push may be any flag or ref.
    for (const c of ['git push origin "$BRANCH"', 'git push origin $BRANCH', 'BRANCH=main git push origin "$BRANCH"'])
      expect([c, rules(c)]).toEqual([c, ['branch-delete', 'default-branch-push', 'force-push']])
    // The substitution's own words are read: the current branch, no danger.
    expect(rules('git push -u origin "$(git branch --show-current)"')).toEqual([])
    for (const c of ['git "push" -f', '"git" push -f', 'git push "--force"']) expect([c, rules(c)]).toEqual([c, ['force-push']])
    expect(rules('\\rm -rf /')).toEqual(['rm-outside'])
    expect(rules('git push origin -- feat/x:main')).toContain('default-branch-push')
    expect(rules('sleep 1&git push -f')).toContain('force-push')
    expect(rules('git push -f>/dev/null')).toContain('force-push')
    expect(rules('git push origin main>log')).toContain('default-branch-push')
    expect(rules('git push >/dev/null 2>&1', main)).toContain('default-branch-push')
    expect(rules('git push 2> err.log', main)).toContain('default-branch-push')
  })
  test('the same syntax with no danger, or on the session branch, stays off the list (control)', () => {
    for (const c of ['git "status"', 'git push -u origin feat/x 2>&1', 'git push origin feat/x >/dev/null 2>&1', 'git commit -m "push it"',
      'git log --format="%h" 2>/dev/null', 'make test >log 2>&1 &', 'echo a&echo b', 'git push origin -- feat/x'])
      expect([c, rules(c)]).toEqual([c, []])
  })
  test('round 2: --branches, another repo, and variable options (PR #672 round 2)', () => {
    expect(rules('git push --branches')).toContain('default-branch-push')
    for (const c of ['git -C /other push', 'cd /other && git push', 'cd .. && cd .. && git push origin HEAD', 'git --git-dir=/o/.git push'])
      expect([c, rules(c)]).toEqual([c, ['default-branch-push']])
    for (const c of ['FLAGS=-rf; rm $FLAGS /tmp', 'rm "$X" /tmp']) expect([c, rules(c)]).toEqual([c, ['rm-outside']])
    expect(rules('NV=-n; git commit $NV -m x')).toEqual(['no-verify'])
    // 0.2.0 Known limit: a bare variable beside branch or commit is not read as a flag.
    expect(rules('git branch "$OPT" x')).toEqual([])
    expect(rules('git branch -f x "$Y"')).toEqual([])
  })
  test('round 2 controls: the same repo, an explicit refspec, commit message values', () => {
    for (const c of ['cd /repo && git push', 'git commit -m "msg"', 'git commit -am "msg"', 'git commit -F "$f"',
      'git commit --message "x" --author "A <a@b>"', 'rm -f x.txt'])
      expect([c, rules(c)]).toEqual([c, []])
    // 0.2.0: a push after a move asks whatever its refspec — an accepted extra ask.
    for (const c of ['git -C /other push origin feat/x', 'cd /other && git push origin feat/x'])
      expect([c, rules(c)]).toEqual([c, ['default-branch-push']])
  })
  test('a substitution inside double quotes is read as a command (PR #672 round 3)', () => {
    for (const c of ['echo "$(git push -f)"', 'OUT="$(git push origin main 2>&1)"', 'echo "`git push -f`"', 'X="a $(echo "$(git push -f)")"'])
      expect([c, rules(c).length > 0]).toEqual([c, true])
    for (const c of ['git commit -m "$(cat <<\'EOF\'\nfix(x): push the branch (see #1)\nEOF\n)"', 'echo "$(git branch --show-current)"', 'echo "push $(date)"'])
      expect([c, rules(c)]).toEqual([c, []])
    // A quoted cat heredoc piped to a shell is read: its body runs.
    expect(rules('echo "$(cat <<\'EOF\'\ngit push -f\nEOF\n)" | bash')).toEqual(['force-push'])
    expect(rules("cat <<'EOF' | sh\ngit push -f\nEOF")).toEqual(['force-push'])
  })

  test('the #684 gaps the token floor catches (0.2.0 spec §5)', () => {
    expect(rules('git push origin "$(echo a)")" && git push -f')).toContain('force-push')
    for (const c of ['/usr/lib/git-core/git-push -f origin feat/x', 'git-push --force origin feat/x'])
      expect([c, rules(c)]).toEqual([c, ['force-push']])
    expect(rules('git push --forc* origin feat/x')).toContain('force-push')
    expect(rules('git pu\\\nsh -f origin feat/x')).toEqual(['force-push'])
    expect(rules('git push -- origin', { ...W, branch: 'main' })).toEqual(['default-branch-push'])
    expect(rules('git -c remote.origin.push=refs/heads/main push origin')).toEqual(['default-branch-push'])
    expect(rules('git push origin +:feat/x')).toEqual(['branch-delete', 'force-push'])
    expect(rules('git push origin --{force,x}')).toContain('force-push')
  })
  test('the live check stalls reach no rule (0.2.0 spec §6, evidence L3)', () => {
    const cases = ["python3 -c 'print(1)' && git commit -m x",
      "cat > /tmp/s.txt <<'EOF'\nmolt 0.2.1 is a mod\nEOF\nawk '{print length($0)}' /tmp/s.txt",
      'cd /repo/sub; git branch --show-current && git status --porcelain; echo ---; git log -1 --format=\'%h %s\'; wc -l < NOTES.md; ' +
        'git rev-parse --abbrev-ref notes@{upstream}; echo "upstream rc=$?"; for p in NOTES.md /h/x; do test -e "$p" && echo "ok $p" || echo "MISSING $p"; done']
    for (const c of cases) expect([c, rules(c)]).toEqual([c, []])
  })
  test('own-branch pushes stay silent; a push after a move asks (0.2.0 spec §6)', () => {
    for (const c of ['git push', 'git push -u origin feat/x', 'git push origin HEAD', 'cd /repo && git push', 'git -C /repo/sub push',
      "git commit -m \"$(cat <<'EOF'\nfix(autonomic): push -f the floor to main\nEOF\n)\" && git push"])
      expect([c, rules(c)]).toEqual([c, []])
    for (const c of ['cd ../other && git push', 'git -C ../other push', 'pushd /x && git push', 'popd && git push'])
      expect([c, rules(c)]).toEqual([c, ['default-branch-push']])
  })
  test('the unreadable rule matches nothing (0.2.0 spec §3.4)', () => {
    for (const c of ['eval "$X"', 'bash -c "$CMD"', 'git push $(cat refs)', 'x=`git rev-parse HEAD`'])
      expect([c, rules(c).includes('unreadable')]).toEqual([c, false])
  })
})
