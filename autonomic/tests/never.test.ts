import { describe, test, expect } from 'claude-code/testing'
import { DEFAULT_READERS, floorFindings, neverRules, parseReaders, redLineOf, routes } from '../hooks/never'
import type { Where } from '../hooks/never'

const W: Where = { cwd: '/repo/sub', root: '/repo', home: '/h', branch: 'feat/x', defaultBranch: 'main' }
// 0.10.0: an own-branch force leaves the floor. A case that proves the reader still catches a
// spelling or an escape route keeps its point on a branch the seat does not own, where force-push
// is a live red line; a case whose rule is retired flips to what now reaches the judge.
const FOREIGN: Where = { ...W, branch: 'feat/other' }
const rules = (c: string, w: Where = W) => neverRules(c, w).sort()

// autonomic 0.2.0 (#684 direction 2′): the floor reads the text as one bag of words, so every
// 0.1.1 `unreadable` case now names the rule its words show, or nothing when they show none.
describe('the never-approve list (spec §3.3, plan decision 3)', () => {
  test('a quote-split option is joined; a quoted value is not a flag (PR #681 round 18)', () => {
    expect(rules('git merge --no-""verify feat/x')).toContain('no-verify')
    expect(rules('git commit -m "msg"')).toEqual([])
  })
  test('~name is another home: outside (PR #681 round 18; rm leaves the floor in 0.10.0)', () => {
    expect(rules('rm -rf ~root')).toEqual([])
  })
  test('GIT_DIR or GIT_WORK_TREE makes the repository unknown (PR #681 round 17)', () => {
    expect(rules('GIT_DIR=/other/.git git push')).toContain('default-branch-push')
    expect(rules('GIT_WORK_TREE=/other git push')).toContain('default-branch-push')
  })
  test('heads/main is main (PR #681 round 17)', () => {
    expect(rules('git push origin heads/main')).toContain('default-branch-push')
  })
  test('nothing is below a worktree at / (PR #681 round 16)', () => {
    expect(rules('rm -rf --no-preserve-root /', { ...W, root: '/', cwd: '/' })).toEqual([])
  })
  test('with --repo, a positional may be the remote or a refspec: both readings are checked (PR #681 round 16)', () => {
    expect(rules('git push --repo x origin', { ...W, branch: 'main' })).toContain('default-branch-push')
    expect(rules('git push --repo origin main')).toContain('default-branch-push')
  })
  test('a quoted command word after a wrapper is read (PR #681 round 15)', () => {
    expect(rules('prlimit "git" push -f origin feat/x', FOREIGN)).toContain('force-push')
    expect(rules("prlimit 'rm' -rf /tmp/x")).toEqual([])
    expect(rules('echo "done" && git push origin feat/x')).toEqual([])
  })
  test('an abbreviated option keeps its attached value (PR #681 round 15)', () => {
    expect(rules('git push --force-w=feat/x origin feat/x')).toContain('force-push')
  })
  test('any unlisted wrapper before git is unreadable; rm leaves the floor (PR #681 round 14; 0.10.0)', () => {
    for (const c of ['prlimit git push -f origin feat/x', 'mywrap --x /usr/bin/git push -f'])
      expect([c, rules(c, FOREIGN).length > 0]).toEqual([c, true])
    expect(rules('cgexec -g cpu:x rm -rf /tmp/x')).toEqual([])
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
    expect(rules('git push -4d origin feat/x')).toEqual([])
  })
  test('a mirror push is a default and a force push (PR #681 round 11; 0.10.0)', () => {
    expect(rules('git push --mirror origin')).toEqual(['default-branch-push', 'force-push'])
  })
  test('an inline alias key is matched whatever its case (PR #681 round 10)', () => {
    expect(rules('git -c Alias.p=push p -f origin feat/x')).toContain('force-push')
  })
  test('an opaque push still reports what it shows (PR #681 round 10)', () => {
    expect(rules('git push "$REMOTE" feat/x:main')).toEqual(expect.arrayContaining(['force-push', 'default-branch-push']))
  })
  test('an abbreviated --no-verify passes the pre-check (PR #681 round 10)', () => {
    expect(routes({ tool: 'bash', input: { command: 'git am --no-verif patch.mbox' } })).toBe(true)
    expect(rules('git am --no-verif patch.mbox')).toContain('no-verify')
  })
  test('a push flag that holds a variable may be any flag (PR #681 round 9)', () => {
    expect(rules('git push --force$EMPTY origin feat/x')).toEqual(['default-branch-push', 'force-push'])
  })
  test('a Bash builtin that runs a command is a runner (PR #681 round 7)', () => {
    for (const c of ['coproc git push -f origin feat/x', 'builtin command git push -f', "trap 'git push -f' EXIT"])
      expect(rules(c, FOREIGN)).not.toEqual([])
  })
  test('a substitution in an unquoted heredoc is read; a quoted cat heredoc is text (PR #681 round 6)', () => {
    expect(rules('cat <<EOF\n$(git push -f origin feat/x)\nEOF', FOREIGN)).toContain('force-push')
    expect(rules("git commit -m \"$(cat <<'EOF'\nfix: push the branch $(not run)\nEOF\n)\"")).toEqual([])
  })
  test('a path-qualified wrapper is a runner (PR #681 round 6)', () => {
    for (const c of ['/usr/bin/env git push -f origin feat/x', '/usr/bin/sudo git push -f', '/usr/bin/nohup git push -f'])
      expect(rules(c, FOREIGN)).not.toEqual([])
  })
  test('rm operands after -- are paths whatever their first character (PR #681 round 6)', () => {
    expect(rules('rm -rf -- -/../../../tmp/victim')).toEqual([])
  })
  test('the matching refspec : may update the default branch (PR #681 round 6)', () => {
    expect(rules('git push origin :')).toContain('default-branch-push')
    expect(rules('git push origin +:')).toContain('default-branch-push')
  })
  test('a wrapper that runs a program is a runner (PR #681 round 4)', () => {
    for (const c of ['setsid git push -f origin feat/x', 'stdbuf -oL git push -f', 'flock /tmp/l git push -f', 'taskset 1 git push -f'])
      expect(rules(c, FOREIGN)).not.toEqual([])
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
    // 0.5.0 §3.3: a moved push that names a literal non-default destination no longer asks.
    expect(rules('cd /repo/other && git push origin feat/x')).toEqual([])
    expect(rules('cd /repo/sub && git push')).toEqual([])
    expect(rules('cd /repo && git push')).toEqual([])
  })
  test('a wildcard refspec may push the default branch (PR #681 round 3)', () => {
    expect(rules('git push origin refs/heads/*:refs/heads/*')).toContain('default-branch-push')
    expect(rules('git push origin feat/*')).toContain('default-branch-push')
  })
  test('git -C into another directory reads the branch as unknown (PR #681 round 3)', () => {
    expect(rules('git -C /repo/sub/mod push')).toContain('default-branch-push')
    expect(rules('git -C /repo/sub/mod push origin feat/x')).toEqual([]) // 0.5.0 §3.3
    expect(rules('git -C /repo push')).toEqual([])
    expect(rules('git -C sub push')).toContain('default-branch-push')
  })
  test('refspecs after -- are checked for force; a delete leaves the floor (PR #681 round 3; 0.10.0)', () => {
    expect(rules('git push origin -- +feat/x')).toContain('force-push')
    expect(rules('git push origin -- :feat/x')).toEqual([])
  })
  test('an escaped or quote-split word is unreadable when it may spell a danger (PR #681 round 2)', () => {
    for (const c of ['git pu\\sh -f origin feat/x', 'git pu""sh -f', "git p'u'sh -f", 'git push origin ma\\in'])
      expect(rules(c, FOREIGN)).not.toEqual([])
    expect(rules('r\\m -rf /tmp/x')).toEqual([])
  })
  test('--repo names the remote, so every positional is a refspec (PR #681 round 2)', () => {
    expect(rules('git push --repo origin main')).toContain('default-branch-push')
    expect(rules('git push --repo=origin main')).toContain('default-branch-push')
    expect(rules('git push --repo origin feat/x')).toEqual([])
  })
  test('@ is HEAD (PR #681 round 2)', () => {
    expect(rules('git push origin @', { ...W, branch: 'main' })).toContain('default-branch-push')
  })
  test('a brace or a dot-glob in an rm path may leave the root (PR #681 round 2; rm leaves the floor in 0.10.0)', () => {
    expect(rules('rm -rf /repo/{.,x}./victim')).toEqual([])
    expect(rules('rm -rf /repo/sub/.?')).toEqual([])
    expect(rules('rm -rf /repo/dist/*')).toEqual([])
    expect(rules('git push origin {main,x}')).not.toEqual([])
  })
  test('the program an interpreter runs shows its words (PR #681)', () => {
    for (const c of [`python3 -c 'import os; os.system("git push -f")'`, `node -e "require('child_process').execSync('git push -f')"`,
      `ruby -e 'system("git push -f")'`])
      expect([c, rules(c)]).toEqual([c, ['force-push']])
    expect(rules(`perl -e 'system("rm -rf /")'`)).toEqual([])
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
    expect(rules('rm --recurs /tmp/x')).toEqual([])
    expect(rules('git push --forc origin feat/x')).toContain('force-push')
    expect(rules('git push --mir')).toContain('force-push')
    expect(rules('git push --force-w origin feat/x')).toContain('force-push')
    expect(rules('git commit --no-verif -m x')).toContain('no-verify')
    expect(rules('git push --del origin x')).toEqual([])
    expect(rules('git branch --del --forc x')).toEqual([])
    expect(rules('git push --dry-run origin feat/x')).toEqual([])
    expect(rules('git push --follow-tags origin feat/x')).toEqual([])
  })
  test('routes is the cheap pre-check (Review Focus 2)', () => {
    for (const c of ['git push', 'rm -rf x', 'git commit -m x', 'x --no-verify', 'git branch -D y']) expect(routes({ tool: 'bash', input: { command: c } })).toBe(true)
    for (const c of ['ls -la', 'npm test', 'git status', 'cat README.md']) expect(routes({ tool: 'bash', input: { command: c } })).toBe(false)
    for (const c of ['git pu\\sh', 'git pu""sh', "r'm' -rf x"]) expect(routes({ tool: 'bash', input: { command: c } })).toBe(true)
  })
  test('force push, in every spelling', () => {
    for (const c of ['git push -f', 'git push --force origin feat/x', 'git push --force-with-lease', 'git push origin +feat/x', 'git push --mirror'])
      expect(rules(c, FOREIGN)).toContain('force-push')
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
  test('a bare push on an unknown branch leaves the floor (#766; 0.10.0 drops the unknown-branch arm)', () => {
    expect(rules('git push', { ...W, branch: undefined })).toEqual([])
  })
  test('branch deletion leaves the floor (0.10.0): the judge decides it now (#764)', () => {
    for (const c of ['git branch -D x', 'git branch -d -f x', 'git push origin --delete x', 'git push origin :x'])
      expect(rules(c)).toEqual([])
    expect(rules('git branch -d merged')).toEqual([])
  })
  test('--no-verify and commit -n', () => {
    expect(rules('git commit -n -m x')).toContain('no-verify')
    expect(rules('git push --no-verify')).toContain('no-verify')
  })
  test('rm outside the worktree leaves the floor (0.10.0): the judge decides it now', () => {
    for (const c of ['rm -rf /tmp/x', 'rm -r ../../etc', 'rm -R ~/x', 'rm --recursive /repo', 'rm -rf "$DIR"', 'rm -rf $HOME/x'])
      expect(rules(c)).toEqual([])
  })
  test('rm -r inside the worktree, and plain rm, are not on the list (control)', () => {
    expect(rules('rm -rf build')).toEqual([])
    // 0.10.0: rm is the judge's now; the call stays, and no rule fires.
    expect(rules('rm -r ../other')).toEqual([])
    expect(rules('rm -rf /repo/dist/*')).toEqual([])
    expect(rules('rm -f *.tmp')).toEqual([])
    expect(rules('rm -rf build/*')).toEqual([])
    expect(rules('docker run --rm -v /x:/y img')).toEqual([])
    expect(rules('rm /tmp/x')).toEqual([])
  })
  test('a hidden segment still counts (review focus 5)', () => {
    expect(rules('git status && git push -f')).toContain('force-push')
    expect(rules('cd /tmp && rm -rf x')).toEqual([])
    expect(rules('ls; (git push origin main)')).toContain('default-branch-push')
  })
  test('quoted text shows its words: a message naming a danger is an accepted extra ask (0.2.0)', () => {
    expect(rules('git commit -m "do not git push -f"')).toEqual(['force-push'])
    expect(rules('git commit -m "msg"')).toEqual([])
  })

  test('shapes the shared reader cannot read are listed when they name a danger (final review I1)', () => {
    const cases = ['git commit -nm wip', 'sleep 1 & git push -f',
      'if true; then git push -f; fi', '{ git push -f; }', '! git push -f', 'for b in a; do git push -f; done',
      'echo `git push -f`', 'bash -c "git push -f"', 'timeout 60 git push -f',
      'nice git push -f', 'env -i git push -f']
    for (const c of cases) expect([c, rules(c).length > 0]).toEqual([c, true])
    // 0.10.0: the shapes whose danger left the floor — an own-branch force, and the retired rules.
    for (const c of ['git push -uf origin feat/x', 'git branch -df old', "sh -c 'rm -rf /etc/x'", 'xargs rm -rf', 'sudo -u root rm -rf /etc/x'])
      expect([c, rules(c)]).toEqual([c, []])
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
      expect([c, rules(c)]).toEqual([c, ['default-branch-push', 'force-push']])
    // The substitution's own words are read: the current branch, no danger.
    expect(rules('git push -u origin "$(git branch --show-current)"')).toEqual([])
    for (const c of ['git "push" -f', '"git" push -f', 'git push "--force"']) expect([c, rules(c)]).toEqual([c, ['force-push']])
    expect(rules('\\rm -rf /')).toEqual([])
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
    for (const c of ['FLAGS=-rf; rm $FLAGS /tmp', 'rm "$X" /tmp']) expect([c, rules(c)]).toEqual([c, []])
    expect(rules('NV=-n; git commit $NV -m x')).toEqual(['no-verify'])
    // 0.2.0 Known limit: a bare variable beside branch or commit is not read as a flag.
    expect(rules('git branch "$OPT" x')).toEqual([])
    expect(rules('git branch -f x "$Y"')).toEqual([])
  })
  test('round 2 controls: the same repo, an explicit refspec, commit message values', () => {
    for (const c of ['cd /repo && git push', 'git commit -m "msg"', 'git commit -am "msg"', 'git commit -F "$f"',
      'git commit --message "x" --author "A <a@b>"', 'rm -f x.txt'])
      expect([c, rules(c)]).toEqual([c, []])
    // 0.5.0 §3.3: a moved push that names a literal non-default destination no longer asks.
    for (const c of ['git -C /other push origin feat/x', 'cd /other && git push origin feat/x'])
      expect([c, rules(c)]).toEqual([c, []])
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
      expect([c, rules(c, FOREIGN)]).toEqual([c, ['force-push']])
    expect(rules('git push --forc* origin feat/x')).toContain('force-push')
    expect(rules('git pu\\\nsh -f origin feat/x', FOREIGN)).toEqual(['force-push'])
    expect(rules('git push -- origin', { ...W, branch: 'main' })).toEqual(['default-branch-push'])
    expect(rules('git -c remote.origin.push=refs/heads/main push origin')).toEqual(['default-branch-push'])
    expect(rules('git push origin +:feat/x', FOREIGN)).toEqual(['force-push'])
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

  test('a heredoc another program runs keeps its words (PR #685 round 1)', () => {
    const run = ["cat setup.cfg; python3 - <<'EOF'\nimport os; os.system(\"git push -f origin main\")\nEOF",
      "python3 cat.py <<'EOF'\ngit push -f\nEOF", "python3 -c \"$(cat <<'EOF'\nimport os; os.system('git push -f')\nEOF\n)\"",
      "ssh host \"$(cat <<'EOF'\ngit push -f\nEOF\n)\"", "cat > x.sh <<'EOF'\ngit push -f origin main\nEOF\nchmod +x x.sh && ./x.sh",
      "$(cat <<'EOF'\ngit push -f\nEOF\n)", ". ./env.sh && git commit -m \"$(cat <<'EOF'\npush -f\nEOF\n)\"",
      "echo -m \"$(cat <<'EOF'\ngit push -f origin main\nEOF\n)\" | sh"]
    for (const c of run) expect([c, rules(c)]).toEqual([c, expect.arrayContaining(['force-push'])])
  })
  test('the usual commit message stays text, whatever it says (PR #685 round 1)', () => {
    const footer = "git add . && git commit -m \"$(cat <<'EOF'\nfeat: x\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\nEOF\n)\" && git push"
    const bash = "git commit -m \"$(cat <<'EOF'\nfix: the bash reader; never git push -f to main\nEOF\n)\" && git push"
    const written = "cat > /tmp/brief.md <<'EOF'\nrun git push -f origin main\nEOF"
    for (const c of [footer, bash, written]) expect([c, rules(c)]).toEqual([c, []])
  })
  test('a braced variable may be any flag or ref (PR #685 round 1)', () => {
    for (const c of ['git push ${OPTS}', 'git push origin ${BRANCH}', 'git push origin "${BRANCH:-x}"'])
      expect([c, rules(c)]).toEqual([c, ['default-branch-push', 'force-push']])
    expect(rules('rm ${OPTS} /tmp/x')).toEqual([])
  })
  test('every unique prefix the tools accept is read (PR #685 round 1; 0.10.0 keeps 1-3)', () => {
    expect(rules('rm --r /tmp/victim')).toEqual([])
    expect(rules('git push --de origin x')).toEqual([])
    expect(rules('git push --mi')).toEqual(['default-branch-push', 'force-push'])
    expect(rules('git push --f origin feat/x')).toEqual(['force-push'])
    expect(rules('git push --a')).toEqual(['default-branch-push'])
    expect(rules('git branch --de --f x')).toEqual([])
  })
  test('a forced default ref is a default push too (PR #685 round 1)', () => {
    expect(rules('git push origin +main')).toEqual(['default-branch-push', 'force-push'])
  })
})

// autonomic 0.4.2 (#693): inert commands leave the bag; a heredoc body stays dropped unless a
// later command that is not inert names its file; prose with a dash is not a verb.
describe('never-approve false positives (0.4.2 spec §4)', () => {
  test('case A: a test command does not lend its -n to a commit', () => {
    expect(rules('[ -n "$staged" ] || exit 1\ngit add -A\ngit commit -q -m "msg"')).toEqual([])
  })
  test('case A′: the same with a heredoc commit message', () => {
    expect(rules("[ -n \"$staged\" ] || exit 1\ngit commit -q -m \"$(cat <<'EOF'\nfix: x\nEOF\n)\"")).toEqual([])
  })
  test('case B: a report written to a temp file and renamed over the path', () => {
    const c = "T=/s/r.md.tmp\ncat > \"$T\" <<'EOF'\nper the standing no-rm rule.\nEOF\nmv \"$T\" /s/r.md"
    expect(rules(c)).toEqual([])
    expect(routes({ tool: 'bash', input: { command: c } })).toBe(false)
  })
  test('case C: rules prose saved to scratch and counted', () => {
    const c = "cat > $R/rules.txt <<'EOF'\nNever force-push; never rm -rf outside a worktree; no branch-delete.\nEOF\nwc -l $R/rules.txt"
    expect(rules(c)).toEqual([])
  })
  test('case D: a jq note with deletion words, checked by a command that does not name the file', () => {
    const c = `jq '.note = "do not rm -rf $X"' run.json > run.json.tmp && dagr check --strict && mv run.json.tmp run.json`
    expect(rules(c)).toEqual([])
  })
})

describe('escape routes the 0.4.2 reading must not open (spec §5)', () => {
  test('a verb kept in an assignment or an alias still pairs with a flag', () => {
    expect(rules('V=push; git $V -f origin feat/x', FOREIGN)).toContain('force-push')
    expect(rules('git config alias.p push; git p -f origin feat/x')).toContain('force-push')
  })
  test('an inert redirect into a file that is run later keeps its words', () => {
    expect(rules("echo 'git push -f origin feat/x' > x.sh; ./x.sh")).toContain('force-push')
    expect(rules("echo 'git push -f origin feat/x' &> x.sh; ./x.sh")).toContain('force-push')
  })
  test('a heredoc file renamed, then run through a wrapper, keeps its body', () => {
    expect(rules("cat > f <<'X'\ngit push -f origin feat/x\nX\nmv f g; nohup g")).toContain('force-push')
  })
  test('a quoted ; does not split a command', () => {
    expect(rules('git push "x; echo" -f')).toContain('force-push')
  })
  test('an apostrophe in a kept heredoc body keeps the whole bag', () => {
    expect(rules("cat > f <<'X'\ndon't\nX\nbash f; echo -f; git push origin feat/x", FOREIGN)).toContain('force-push')
    // No runner here: only the << gate stops the body's apostrophe from hiding -f (final review 12).
    expect(rules("cat > f <<'X'\necho don't\nX\n./f; echo it\\'s -f\ngit push origin feat/x", FOREIGN)).toContain('force-push')
  })
  test('printf -v defines a name; sort can run a program; a hooks directory is run by git', () => {
    expect(rules('printf -v V push; git $V -f origin feat/x')).toContain('force-push')
    expect(rules("cat > c <<'X'\ngit push -f origin feat/x\nX\nsort --compress-program=./c big.txt")).toContain('force-push')
    expect(rules("cat > h <<'X'\ngit push -f origin feat/x\nX\ncp h .git/hooks/pre-commit")).toContain('force-push')
  })
  test('the dashed and path forms of a verb are still verbs', () => {
    expect(rules('/usr/lib/git-core/git-push -f origin feat/x', FOREIGN)).toContain('force-push')
    expect(rules('git-push -f origin feat/x', FOREIGN)).toContain('force-push')
    expect(rules('/bin/rm -rf /tmp/x')).toEqual([])
  })
  test('known limit: a command that is not inert and names the written file keeps the jq words (rm leaves the floor in 0.10.0)', () => {
    const c = `jq '.note = "do not rm -rf $X"' run.json > run.json.tmp && dagr check run.json.tmp && mv run.json.tmp run.json`
    expect(rules(c)).toEqual([])
  })
  test('known limit: prose quoted in one argument of a command that is not inert still pools (rm leaves the floor in 0.10.0)', () => {
    expect(rules('herdr agent prompt spine "the verifier ran rm -rf $X" ; printf x >> rulings.md')).toEqual([])
  })
})

describe('review focus (0.4.2 plan)', () => {
  test('two heredocs: the run one keeps its body, the other is dropped', () => {
    const c = "cat > a <<'X'\nno-rm prose\nX\ncat > b.sh <<'Y'\ngit push -f origin feat/x\nY\n./b.sh"
    expect(rules(c)).toContain('force-push')
    expect(rules("cat > a <<'X'\ngit push -f origin feat/x\nX\ncat > b <<'Y'\nok\nY\nwc -l a b")).toEqual([])
  })
  test('a move beside an inert command is still a move', () => {
    expect(rules('echo x; cd /repo/other && git push')).toEqual(['default-branch-push'])
    expect(rules('echo x; cd /repo/other && git push origin feat/x')).toEqual([]) // 0.5.0 §3.3
  })
  test('a 2>&1 stays in its command', () => {
    expect(rules("echo 'git push -f origin feat/x' > x.sh 2>&1; ./x.sh")).toContain('force-push')
  })
  test('the pre-check sees an escape route', () => {
    expect(routes({ tool: 'bash', input: { command: "echo 'git push -f' > x.sh; ./x.sh" } })).toBe(true)
  })
  test('a file run through a differently spelled variable keeps its body (0.4.1 dropped it)', () => {
    expect(rules("cat > x.sh <<'X'\ngit push -f origin feat/x\nX\nT=x; \"$T.sh\"")).toContain('force-push')
  })
})

// Final review of the 0.4.2 branch: each case was held by 0.4.1 and must still ask.
describe('0.4.2 final review: no new false negative against 0.4.1', () => {
  test('a comment does not open a quote or join the next line', () => {
    expect(rules("echo start # don't skip\ngit push -f origin feat/x\necho done # that's all", FOREIGN)).toContain('force-push')
    expect(rules('echo x # trailing \\\ngit push -f origin feat/x', FOREIGN)).toContain('force-push')
  })
  test('a process substitution keeps the whole bag', () => {
    expect(rules('cat <(git push -f origin feat/x)', FOREIGN)).toContain('force-push')
    expect(rules('echo >(git push -f origin feat/x)', FOREIGN)).toContain('force-push')
  })
  test('a function defined in the same text is not inert', () => {
    expect(rules('echo() { git push -f origin feat/x; }; echo hi')).toContain('force-push')
    expect(rules('cat () { rm -rf ~/work; }; cat f')).toEqual([])
    expect(rules('function echo { git push -f origin feat/x; }; echo hi')).toContain('force-push')
  })
  test('an inert command piped onward keeps its words', () => {
    expect(rules("echo 'git push -f origin feat/x' | at now")).toContain('force-push')
    expect(rules("echo 'git push -f origin feat/x' | cat > x.sh; ./x.sh", FOREIGN)).toContain('force-push')
    expect(rules("echo 'git push -f origin feat/x' |& at now")).toContain('force-push')
    expect(rules("cat > f <<'X'\ngit push -f origin feat/x\nX\ncat f | at now")).toContain('force-push')
  })
  test('>&file is a redirect', () => {
    expect(rules("echo 'git push -f origin feat/x' >& x.sh; ./x.sh")).toContain('force-push')
  })
  test('printf with a -v cluster defines a name', () => {
    expect(rules('printf -vV push; git $V -f origin feat/x')).toContain('force-push')
  })
  test('a write straight into .git/ or hooks/ counts as run', () => {
    expect(rules("printf '[alias]\\n\\tp = push -f\\n' >> .git/config; git p origin feat/x")).toContain('force-push')
    expect(rules("echo 'git push -f origin feat/x' > .git/hooks/pre-commit; git commit -m x")).toContain('force-push')
    expect(rules("cat > .git/hooks/pre-commit <<'X'\ngit push -f origin feat/x\nX\ngit commit -m x")).toContain('force-push')
  })
  test('an inert copy by redirect passes the name on', () => {
    expect(rules("cat > f <<'X'\ngit push -f origin feat/x\nX\ncat f > g; chmod +x g; ./g")).toContain('force-push')
  })
  test('a kept body that runs another written file keeps that body too', () => {
    expect(rules("cat > a.sh <<'A'\ngit push -f origin feat/x\nA\ncat > b.sh <<'B'\n./a.sh\nB\n./b.sh")).toContain('force-push')
  })
  test('a relative path is not inert by its last part', () => {
    expect(rules('./scripts/test push -f origin feat/x', FOREIGN)).toContain('force-push')
  })
  test('a command named by a variable or a glob may be any written file', () => {
    expect(rules("echo 'git push -f origin feat/x' > x.sh; T=x; ./$T.sh")).toContain('force-push')
    expect(rules("echo 'git push -f origin feat/x' > x.sh; ./x*")).toContain('force-push')
  })
  test('a file name matches whatever its case', () => {
    expect(rules("echo 'git push -f origin feat/x' > x.sh; ./X.SH")).toContain('force-push')
  })
})

// PR #700 round 1 (Codex): each case was held by 0.4.1 and must still ask.
describe('PR #700 round 1: the inert test trusts no more than it must', () => {
  test('a redirect through a variable is resolved, or kept when it cannot be (r4220518542)', () => {
    expect(rules("P=.git/config; printf '[alias]\\np = push -f\\n' > \"$P\"; git p origin feat/x")).toContain('force-push')
    expect(rules("printf '[alias]\\np = push -f\\n' > \"$GITCFG\"; git p origin feat/x")).toContain('force-push')
    // An assignment after the write names its own value, so it never lets the write's words go.
    expect(rules("printf '[alias]\\np = push -f\\n' > \"$P\"; P=zq9; git p origin feat/x")).toContain('force-push')
    // An assigned temp file that is only moved stays dropped (case B).
    expect(rules("T=/s/r.md.tmp\ncat > \"$T\" <<'EOF'\nno-rm\nEOF\nmv \"$T\" /s/r.md\nherdr pane run x ok")).toEqual([])
  })
  test('a function defined after a keyword is not inert (r4220518555)', () => {
    expect(rules('if true; then echo() { git push -f origin feat/x; }; echo hi; fi')).toContain('force-push')
  })
  test('only a system path to an inert name is inert (r4220518565)', () => {
    expect(rules('/repo/echo git push -f origin feat/x', FOREIGN)).toContain('force-push')
    expect(rules('/bin/echo git push -f origin feat/x; true')).toEqual([])
  })
  test('a dashed executable path is a verb; bare dashed prose is not (r4220518572)', () => {
    expect(rules('./force-push -f origin feat/x', FOREIGN)).toContain('force-push')
    expect(rules('bin/force-push -f origin feat/x', FOREIGN)).toContain('force-push')
  })
})

// PR #700 round 2 (Codex): each case was held by 0.4.1 and must still ask.
describe('PR #700 round 2: shadowed names and git control files', () => {
  test('a name defined in the text keeps the whole bag (r4220653778)', () => {
    expect(rules('echo() { "$@"; }; echo git push -f origin feat/x', FOREIGN)).toContain('force-push')
    expect(rules("alias echo='git'; echo push -f origin feat/x", FOREIGN)).toContain('force-push')
  })
  test('after a directory change a relative write may land in .git (r4220653797)', () => {
    expect(rules("cd .git; printf '[alias]\\np = push -f\\n' > config; cd ..; git p origin feat/x")).toContain('force-push')
  })
  test('a write into a git config file outside .git counts as run (class sweep)', () => {
    expect(rules("printf '[alias]\\np = push -f\\n' >> ~/.gitconfig; git p origin feat/x")).toContain('force-push')
    expect(rules("printf '[alias]\\np = push -f\\n' >> ~/.config/git/config; git p origin feat/x")).toContain('force-push')
  })
})

const HERDR = [...DEFAULT_READERS, ['herdr', 'agent', 'prompt']]
const PROSE = 'Never rm -rf outside a worktree; never git push -f or --force; never --no-verify; no git branch -D.'

// autonomic 0.4.3 (spec 2026-10-09 §4): the live brief writes and close scripts, sanitized.
describe('0.4.3 live fixtures: brief writes and close scripts go silent', () => {
  test('a group brief with an unquoted header, a rules file and a quoted tail, checked with sed (19:18:45Z)', () => {
    const c = `cd ~/.cache/scratch/run; SB=$(git -C /repo branch --show-current); SP=/repo-ai/docs/specs\n{\ncat <<EOF\nROLE: close for s2 on \\\`$SB\\\`.\n${PROSE}\nEOF\ncat scratch/rules-a.txt\ncat <<'EOF'\n${PROSE}\nEOF\n} > briefs/close-1.md; wc -l briefs/close-1.md; grep -n 'PING:' briefs/close-1.md | cut -c1-400; sed -n 8,9p briefs/close-1.md | cut -c1-300`
    expect(rules(c)).toEqual([])
  })
  test('a group brief, then a ruling line with a date substitution (19:37:00Z)', () => {
    const c = `cd ~/.cache/scratch/run; mkdir -p scratch/writer-2\n{\ncat <<'EOF'\n${PROSE}\nEOF\ngrep -E '^\\| F[123] \\|' reports/close-1.md\ncat <<'EOF'\n${PROSE}\nEOF\n} > briefs/writer-1.md; grep -c '^| F' briefs/writer-1.md; wc -l briefs/writer-1.md\necho "- $(date -u +%FT%TZ) operator: writer brief briefs/writer-1.md." >> rulings.md`
    expect(rules(c)).toEqual([])
  })
  test('a brief written, then named in herdr agent prompt: silent with the reader, asks without (19:12:50Z)', () => {
    const c = `cat > /run/briefs/impl-1.md <<'EOF'\n${PROSE}\nEOF\nherdr pane read w1:p1 --source visible | grep -oE 'Model [a-z]+' | tail -1\nherdr agent prompt w1:p1 'Your brief is /run/briefs/impl-1.md. Read it in full.' | jq -r .ok`
    expect(neverRules(c, W, HERDR)).toEqual([])
    expect(rules(c)).not.toEqual([])
  })
  test('an item close guarded by test -n "$(git diff --cached …)" (17:54:39Z)', () => {
    const c = `set -euo pipefail\nwt="$($oss get '.items[0].worktree')"\ntest "$(git -C "$wt" rev-parse --abbrev-ref HEAD)" = "$branch"\ntest -z "$(git -C "$root" status --porcelain)"\ntest -n "$(git -C "$wt" diff --cached --name-only)"\ngit -C "$wt" diff --exit-code\ngit -C "$wt" commit -m 'feat: deliver events'\ngit -C "$root" merge --no-ff "$branch" -m 'merge w3'\nprintf 'ITEM=%s\\n' "$(git -C "$wt" rev-parse HEAD)"`
    expect(rules(c)).toEqual([])
  })
})

describe('0.4.3 §3.1 substitutions: escape routes', () => {
  test('a substitution feeding a non-inert command keeps its words', () => {
    expect(rules('git commit $(echo -n) -m x')).toContain('no-verify')
  })
  test('the commands inside an inert command\'s substitution are judged', () => {
    expect(rules('echo "$(git push -f origin feat/x)"', FOREIGN)).toContain('force-push')
    expect(rules('test -n "$(git commit -n -m x)"')).toContain('no-verify')
    expect(rules('echo "$(echo "$(git push -f origin feat/x)")"', FOREIGN)).toContain('force-push')
  })
  test('an unbalanced substitution or arithmetic keeps the whole bag', () => {
    expect(rules('echo "$(git push -f origin feat/x"', FOREIGN)).toContain('force-push')
    expect(rules('echo $((1)) -f; git push origin feat/x', FOREIGN)).toContain('force-push')
  })
  test('a substitution inside single quotes is text', () => {
    expect(rules("echo '$(git push -f origin feat/x)'")).toEqual([])
  })
})

describe('0.4.3 §3.2 groups: escape routes', () => {
  test('a redirect on a group applies to its commands', () => {
    expect(rules("{ echo 'git push -f origin feat/x'; } > x.sh; ./x.sh", FOREIGN)).toContain('force-push')
    expect(rules("( echo 'git push -f origin feat/x' ) > .git/hooks/pre-commit")).toContain('force-push')
    expect(rules("if true; then cat <<'X'\ngit push -f origin feat/x\nX\nfi > x.sh; ./x.sh")).toContain('force-push')
    expect(rules("for i in 1; do echo 'git push -f origin feat/x'; done > x.sh; ./x.sh", FOREIGN)).toContain('force-push')
  })
  test('a pipe on a group applies to its commands', () => {
    expect(rules("{ echo 'git push -f origin feat/x'; } | at now", FOREIGN)).toContain('force-push')
  })
  test('an unmatched closer keeps the whole bag', () => {
    expect(rules("echo 'git push -f origin feat/x'; } > x")).toContain('force-push')
  })
})

describe('0.4.3 §3.3 stdout heredocs: escape routes', () => {
  test('a stdout body piped onward or captured keeps its words', () => {
    expect(rules("cat <<'X' | sh\ngit push -f origin feat/x\nX")).toContain('force-push')
    expect(rules("cat <<'X' | at now\ngit push -f origin feat/x\nX")).toContain('force-push')
    expect(rules("cmd=$(cat <<'X'\ngit push -f origin feat/x\nX\n); $cmd")).toContain('force-push')
  })
  test('an unquoted body with a substitution or a backtick keeps its words', () => {
    expect(rules('cat <<X\n$(git push -f origin feat/x)\nX', FOREIGN)).toContain('force-push')
    expect(rules('cat <<X\n`git push -f origin feat/x`\nX', FOREIGN)).toContain('force-push')
  })
  test('a stdout body that only prints is text', () => {
    expect(rules(`cat <<'X'\n${PROSE}\nX`)).toEqual([])
  })
})

describe('0.4.3 §3.4 sed: escape routes', () => {
  test('a sed that may run code stays a runner', () => {
    for (const c of ["sed 1e f; echo 'git push -f origin feat/x'", "sed 's/x/y/e' f; echo 'git push -f origin feat/x'",
      "sed -e 1p -e 2e f; echo 'git push -f origin feat/x'", "sed -f s.sed f; echo 'git push -f origin feat/x'"])
      expect([c, rules(c, FOREIGN)]).toEqual([c, ['force-push']])
  })
  test('a narrow sed that names a written file does not run it', () => {
    expect(rules(`cat > b.md <<'X'\n${PROSE}\nX\nsed -n 1,5p b.md`)).toEqual([])
  })
})

describe('0.4.3 §3.5 readers: escape routes', () => {
  test('a command that runs a file is not a reader', () => {
    expect(neverRules("cat > b.sh <<'X'\ngit push -f origin feat/x\nX\nherdr pane run p './b.sh'", W, HERDR)).toContain('force-push')
  })
  test('a reader does not hide a later run, or a run in its substitution', () => {
    expect(neverRules("cat > b.md <<'X'\ngit push -f origin feat/x\nX\nherdr agent prompt p 'read b.md'; ./b.md", W, HERDR)).toContain('force-push')
    expect(neverRules("cat > b.sh <<'X'\ngit push -f origin feat/x\nX\nherdr agent prompt p \"$(./b.sh)\"", W, HERDR)).toContain('force-push')
  })
  test('a reader matches whole words only', () => {
    expect(rules("cat > b.md <<'X'\ngit push -f origin feat/x\nX\ngh pr creator --body-file b.md")).toContain('force-push')
    expect(rules(`cat > b.md <<'X'\n${PROSE}\nX\ngh pr create --body-file b.md`)).toEqual([])
  })
  test('a reader keeps its own words (#693 case E; rm leaves the floor in 0.10.0)', () => {
    expect(neverRules('herdr agent prompt p "the verifier ran rm -rf $X"', W, HERDR)).toEqual([])
  })
  test('parseReaders reads ;-separated prefixes; blank is none', () => {
    expect(parseReaders('gh pr create; herdr agent prompt;;')).toEqual([['gh', 'pr', 'create'], ['herdr', 'agent', 'prompt']])
    expect(parseReaders('')).toEqual([])
  })
})

describe('0.4.3 prototype findings: escape routes', () => {
  test('a cd to a literal directory resolves relative writes; .git stays a git control path', () => {
    expect(rules("cd .git; printf '[alias]\\np = push -f\\n' > config; cd ..; git p origin feat/x")).toContain('force-push')
    expect(rules("cd sub && printf '[alias]\\np = push -f\\n' > ../.git/config; git p origin feat/x")).toContain('force-push')
    expect(rules("cd ~ && printf '[alias]\\np = push -f\\n' >> .gitconfig; git p origin feat/x")).toContain('force-push')
  })
  test('a cd to a variable, cd - or popd leaves relative writes opaque', () => {
    expect(rules("cd \"$D\"; printf '[alias]\\np = push -f\\n' > config; git p origin feat/x")).toContain('force-push')
    expect(rules("cd -; printf '[alias]\\np = push -f\\n' > config; git p origin feat/x")).toContain('force-push')
    expect(rules("popd; printf '[alias]\\np = push -f\\n' > config; git p origin feat/x")).toContain('force-push')
  })
  test('a redirect target is never a command word', () => {
    expect(rules(`{ cat <<'X'\n${PROSE}\nX\n} > notes.md; wc -l notes.md`)).toEqual([])
  })
  test('a pipeline of inert commands only prints; a later stage that runs or saves counts', () => {
    expect(rules(`cat > b.md <<'X'\n${PROSE}\nX\ngrep -n x b.md | cut -c1-80`)).toEqual([])
    expect(rules("cat > b.sh <<'X'\ngit push -f origin feat/x\nX\ncat b.sh | cut -c1-999 | at now")).toContain('force-push')
    expect(rules("cat > b.sh <<'X'\ngit push -f origin feat/x\nX\ncat b.sh | cut -c1-999 > c.sh; ./c.sh")).toContain('force-push')
  })
})

describe('0.4.3 plan review focus', () => {
  test('a case statement parses; a push inside it still asks', () => {
    expect(rules(`case "$x" in a) echo ok;; b) cat <<'X'\n${PROSE}\nX\n;; esac`)).toEqual([])
    expect(rules('case "$x" in a) git push -f origin feat/x;; esac', FOREIGN)).toContain('force-push')
  })
  test('an input redirect or a here-string keeps an inert head', () => {
    expect(rules(`cat > b.md <<'X'\n${PROSE}\nX\nwc -l < b.md; grep -c x <<< "$v"`)).toEqual([])
  })
  test('a substitution in a redirect target is opaque', () => {
    expect(rules(`echo '${PROSE}' > "$(mktemp)"`)).toEqual([])
    expect(rules("echo 'git push -f origin feat/x' > \"$(mktemp)\"; git status")).toContain('force-push')
  })
  test('a sed script with more than one command stays a runner', () => {
    // 0.5.0 §3.7: a multi-command script of p/d/q is inert; one holding `e` stays a runner.
    expect(rules("sed -n '1p;2e id' f; echo 'git push -f origin feat/x'", FOREIGN)).toEqual(['force-push'])
  })
})

describe('0.4.3 plan review focus: sed reads its quoted script whole', () => {
  test('a quoted script with a second command is not a narrow sed', () => {
    expect(rules("sed -n '1p;e id' f; echo 'git push -f origin feat/x'", FOREIGN)).toEqual(['force-push'])
  })
})

// The final review: a stdout heredoc anywhere inside a substitution is captured, and a
// substitution in command position runs it; 0.4.2 kept these words.
describe('0.4.3 final review: a heredoc inside a substitution keeps its body', () => {
  const P = 'git push -f origin feat/x'
  test('after a newline, a command or a group inside $(', () => {
    expect(rules(`$(\ncat <<'X'\n${P}\nX\n)`)).toContain('force-push')
    expect(rules(`$(true; cat <<'X'\n${P}\nX\n)`)).toContain('force-push')
    expect(rules(`$({ cat <<'X'\n${P}\nX\n})`)).toContain('force-push')
    expect(rules(`x=$(\ncat <<'X'\n${P}\nX\n)\n$x`)).toContain('force-push')
  })
  test('inside backticks', () => {
    expect(rules(`\`\ncat <<'X'\n${P}\nX\n\``)).toContain('force-push')
    expect(rules(`x=\`\ncat <<'X'\n${P}\nX\n\`\n$x`)).toContain('force-push')
  })
  test('a closed substitution before the heredoc does not keep it', () => {
    expect(rules(`echo "$(date)"\ncat <<'X'\n${PROSE}\nX\n`)).toEqual([])
  })
})

// PR #709 round 1 (Codex): spellings that 0.4.2 asked on and the first 0.4.3 head did not.
describe('0.4.3 PR review: shapes 0.4.2 asked on still ask', () => {
  const P = 'git push -f origin feat/x'
  test('a case or a comment inside $( keeps the whole bag', () => {
    expect(rules(`echo "$(case x in x) ${P};; esac)"`)).toContain('force-push')
    expect(rules(`echo "$(echo hi # )\n${P})"`, FOREIGN)).toContain('force-push')
  })
  test('an unquoted heredoc body with any backtick or a line continuation is live', () => {
    expect(rules(`cat <<X\n\\\\\`${P}\\\\\`\nX\n`)).toContain('force-push')
    expect(rules(`cat > b.md <<X\n\\\\\`${P}\\\\\`\nX\n`)).toContain('force-push')
    expect(rules(`cat <<X\n$\\\n(${P})\nX\n`, FOREIGN)).toContain('force-push')
  })
  test('a sed option that takes a value is not narrow', () => {
    expect(rules(`sed -l 1p "e ${P}" f`)).toContain('force-push')
    expect(rules(`sed --line-length=1 -n 1p "e ${P}" f`)).toContain('force-push')
    expect(rules('sed -n -E 8,9p f')).toEqual([])
  })
  test('a symlink made in the text makes a cd target unknown', () => {
    expect(rules("ln -s .git d; cd d; printf '[alias]\\np = push -f\\n' > config; cd ..; git p origin feat/x")).toContain('force-push')
  })
  test('a pipe into a group counts', () => {
    expect(rules(`{ cat <<'X'\nall:\n\t${P}\nX\n} | { cat; } | make -f -`)).toContain('force-push')
  })
})

// ---- autonomic 0.5.0: each command judged on its own words (spec 2026-10-10) ----
// A must-ask case also passes the cheap pre-check (routes), which runs first on the allow path.
const ask = (c: string, w: Where = W) => expect([c, rules(c, w).length > 0, routes({ tool: 'bash', input: { command: c } })]).toEqual([c, true, true])
const silent = (c: string, w: Where = W) => expect([c, rules(c, w)]).toEqual([c, []])

describe('0.5.0 §3.5 backticks are substitutions', () => {
  test('a quoted or escaped backtick is text; a live pair is judged as commands', () => {
    silent("echo 'run `git status` first' && git push -u origin feat/x && echo 'never -f'")
    silent('echo "head `git rev-parse HEAD`" && git push -u origin feat/x; echo \'not -f\'')
  })
  test('escape routes', () => {
    ask('echo "`git push -f origin feat/x`"', FOREIGN)
    silent('x=`rm -rf ~/a`')
    ask('echo `git status; git push -f origin feat/x', FOREIGN)
  })
})

describe('0.5.0 §3.1 each command on its own words', () => {
  test('flags in another command no longer pool', () => {
    silent('git add a.ts && git commit -q -m x && git push -q -u origin feat/x; npm run lint -- --fix -d')
    silent('make -n check; git commit -m y')
  })
  test('context from the whole text still applies', () => {
    ask('export GIT_DIR=/x; git push')
    ask('cd /other; git push')
    ask("git config alias.p 'push -f'; git p origin feat/x")
    ask('git config alias.p push; git p -f origin feat/x')
    ask('GIT_CONFIG_GLOBAL=/tmp/g git p origin x; npm push -f')
    ask('printf -v V push; git $V -f origin feat/x')
    ask('$CMD -f origin feat/x; npm push')
  })
  test('line endings, empty text and size', () => {
    ask('echo ok\r\ngit push -f origin feat/x\r\n', FOREIGN)
    silent('')
    const big = Array.from({ length: 2000 }, (_, i) => `echo line ${i}; git status --short`).join('\n')
    silent(big)
    // The timed pair stays small: the runner stops a test at 5000 ms, and CI is slower than a desktop.
    const small = Array.from({ length: 200 }, (_, i) => `echo line ${i}; git status --short`).join('\n')
    const large = Array.from({ length: 800 }, (_, i) => `echo line ${i}; git status --short`).join('\n')
    const elapsed = (text: string) => {
      const start = performance.now()
      rules(text)
      return performance.now() - start
    }
    // Warm both sizes, then pair samples so startup and transient host load do not set the bound.
    elapsed(small)
    elapsed(large)
    const smallTimes: number[] = [], largeTimes: number[] = []
    for (let run = 0; run < 3; run++) {
      smallTimes.push(elapsed(small))
      largeTimes.push(elapsed(large))
    }
    const median = (times: number[]) => times.sort((a, b) => a - b)[1]
    // 4x the lines should cost about 4x, not quadratic's 16x. A 1 ms floor absorbs timer noise.
    expect(median(largeTimes)).toBeLessThan(8 * Math.max(median(smallTimes), 1))
  })
})

describe('0.5.0 §3.1 variables and assignment-only commands', () => {
  test('a literal assigned once is read', () => {
    silent('M=/tmp/msg; git commit -q -F $M && git push -q -u origin feat/x')
    silent('B=spine/x; git push -u origin "$B"')
    silent('D="never git push -f"; git push -u origin feat/x')
  })
  test('escape routes', () => {
    for (const c of ['F=-f; git push $F origin feat/x', 'C=push; git $C -f origin feat/x']) ask(c, FOREIGN)
    for (const c of ['B=feat/x; B=main; git push origin $B',
      'if true; then B=feat/x; fi; git push origin $B', 'false && B=feat/x; git push origin $B', '(B=feat/x); git push origin $B',
      'git push origin $B; B=feat/x', 'B=feat/x; for B in main; do git push origin $B; done', 'B=feat/x; read B; git push origin $B',
      'B=feat/x; git push origin ${B:=main}', 'git push origin $UNSET', 'B=main; git push origin $B'])
      ask(c)
  })
})

describe('0.5.0 §3.1 variables: the paths the simple forms do not reach', () => {
  test('a binding on its own line inside a group is not top level', () => {
    ask('if true; then\nB=feat/x\nfi\ngit push origin $B')
    ask('(\nB=feat/x\n)\ngit push origin $B')
  })
  test('an opaque verb reads the values of assignment-only commands', () => {
    ask('C=push; git $C -f origin feat/x; C=x')
  })
})

describe('0.5.0 §3.2 and §3.5 runner words that cannot run', () => {
  test('an argument of cd or an inert command; dot-source per command', () => {
    silent('grep -n "bash" f.md && git push -u origin feat/x; echo -f')
    silent("echo 'run `. env.sh` first' && git push -u origin feat/x; echo -f")
  })
  test('escape routes', () => {
    ask('cd tests/eval && git push -f origin feat/x')
    ask('env bash x.sh; git status; echo -f push')
    ask('. ./env.sh; echo push -f')
  })
})

describe('0.5.0 §3.3 a moved push that names its destination', () => {
  test('a literal non-default destination', () => {
    silent('git -C /x push -u origin spine/x')
    silent('R=/x; git -C $R push -u origin spine/x')
    silent('cd /other && git push -u origin spine/x')
    // Moved here from Task 4 (§3.2): the runner word in a cd argument, then a moved push.
    silent('cd /repo/tests/eval && git push -u origin feat/x && echo -f')
  })
  test('escape routes', () => {
    for (const c of ['git -C /x push', 'git -C /x push origin HEAD', 'git -C /x push origin main', 'git -C /x push origin master',
      'git -C /x push origin x:main', 'git -C /x push -f origin spine/x', 'git -C /x push --repo origin spine/x', 'cd /x && git push origin @',
      'python3 x.py; git -C /x push origin spine/x', 'cd /repo/other && git push'])
      ask(c)
  })
})

describe('0.5.0 §3.6 sh -c read-through', () => {
  test('a literal string is read as commands', () => {
    silent("bash -c 'npm test -- -f' && git push -u origin feat/x")
    silent("sh -c 'cd /repo && git push -u origin feat/x'")
  })
  test('escape routes', () => {
    ask("sh -c 'git push -f origin feat/x'", FOREIGN)
    silent('bash -c "rm -rf ~/x"')
    for (const c of ["bash -lc 'git push origin main'", 'sh -c "$CMD"; echo push -f',
      "cd /other; sh -c 'git push'", "bash -c 'sh -c \"git push -f origin x\"'", "F=x; sh -c 'git push $F origin x'; echo -f"])
      ask(c)
  })
})

describe('0.5.0 §3.7 a wider safe sed', () => {
  test('substitutions, address prints and in-place edits', () => {
    silent("sed -i 's/a/b/g' src/x.ts && git push -u origin feat/x; echo -f")
    silent("sed -n '/re/p' f.md; git push -u origin feat/x; echo -f")
    silent("sed -i.bak -e 's|a|b|' -e '/x/d' f; git push -u origin feat/x; echo -f")
    silent("sed -ni 1p f; echo 'git push -f origin feat/x'")
    silent("sed -n '1,5p;8q' f; echo 'git push -f origin feat/x'")
  })
  test('escape routes', () => {
    ask("sed -i 's/x/y/e' f; git push origin feat/x; echo -f")
    for (const c of ["sed '1e id' f; echo 'git push -f origin feat/x'", "sed 's/x/y/w /tmp/o' f; echo 'git push -f origin feat/x'",
      "sed -f s.sed f; echo 'git push -f origin feat/x'", "sed -n '1p;2e id' f; echo 'git push -f origin feat/x'"])
      ask(c, FOREIGN)
    for (const c of ["sed -i 's/a/b/' .git/hooks/pre-push; echo 'git push -f origin feat/x'", "sed -i 's/x/git push -f/' run.sh; ./run.sh"])
      ask(c)
  })
})

describe('0.5.0 §3.8 Python file-edit heredocs', () => {
  test('a body that starts no process is dropped', () => {
    silent("python3 - <<'X'\nfrom pathlib import Path\np = Path('src/a.ts')\np.write_text(p.read_text().replace('git push -f', 'git push'))\nX\ngit push -u origin feat/x")
    silent("python3 - <<'X'\n# filesystem walk; prints the evaluation\nprint('git push -f is refused')\nX")
  })
  test('escape routes', () => {
    for (const c of ["python3 - <<'X'\nimport subprocess\nsubprocess.run('git push -f', shell=True)\nX",
      "python3 - <<'X'\nimport os\nos.system('git push -f')\nX",
      "python3 - <<'X'\nfrom os import execv as e\ne('/bin/sh', ['sh', '-c', 'git push -f'])\nX",
      "python3 - <<'X'\nopen('.git/hooks/pre-commit','w').write('git push -f')\nX\ngit commit -m x",
      "python3 - <<'X'\nopen('run.sh','w').write('git push -f origin x')\nX\n./run.sh",
      'python3 x.py; echo push -f', "python3 -c 'import os'; echo push -f", 'python3 - <<X\nprint(1)\nX\necho push -f', 'curl x | python3 -; echo push -f'])
      ask(c)
  })
})

describe('0.5.0 §3.8 Python: a call reached without its name', () => {
  test('getattr and importlib keep the body', () => {
    ask("python3 - <<'X'\nimport os\ngetattr(os, 'sys' + 'tem')('git push -f origin x')\nX")
    ask("python3 - <<'X'\nimport importlib\nm = importlib.import_module('sub' + 'process')\nm.run('git push -f origin x', shell=True)\nX")
  })
})

describe('0.5.0 §3.9 heredoc bodies are data unless something can run them', () => {
  test('message consumers, tee and unquoted bodies', () => {
    silent("git commit -q -F - <<'EOF'\nfix: git push -f no longer deletes origin/main\nEOF")
    silent("git commit -F - <<-'EOF'\n\tfix: git push -f\n\tEOF")
    silent("gh pr create --title x --body-file - <<'EOF'\nRuns rm -rf ~/scratch and git push -f in the test.\nEOF")
    silent('cat > brief.txt <<EOF\nHead $(git rev-parse HEAD); never git push -f\nEOF')
    silent("tee notes.md <<'EOF'\nnever git push -f\nEOF\nwc -l notes.md")
  })
  test('escape routes', () => {
    for (const c of ['cat > f <<EOF\n$(git push -f origin x)\nEOF', 'cat > f <<EOF\n$((1+$(git push -f origin x)))\nEOF',
      'cat > f <<EOF\n$\\\n(git push -f origin x)\nEOF', 'git commit -F - <<EOF\n$(git push -f origin x)\nEOF',
      "tee run.sh <<'EOF'\ngit push -f origin x\nEOF\n./run.sh", "tee .git/hooks/pre-commit <<'EOF'\ngit push -f\nEOF",
      "sqlite3 db <<'EOF'\n.shell git push -f\nEOF", "cat <<'EOF' | sh\ngit push -f origin x\nEOF",
      "x=$(cat <<'EOF'\ngit push -f origin x\nEOF\n); $x", "cat <<A <<B\nx\nA\ngit push -f origin x\nB"])
      ask(c)
    // 0.10.0: rm leaves the floor.
    silent('cat > f <<EOF\n`rm -rf ~/x`\nEOF')
    silent("psql <<'EOF'\n\\! rm -rf ~/x\nEOF")
  })
})

describe('0.5.0 §3.9 unquoted bodies that run code with no substitution in them', () => {
  test('arithmetic and a parameter transform keep the body', () => {
    ask('cat > f <<EOF\n$[$(git push -f origin x)]\nEOF')
    ask("a='x[$(git push -f origin x)]'; cat > f <<EOF\n$((a))\nEOF")
    ask("a='x[$(git push -f origin x)]'; cat > f <<EOF\n$[a]\nEOF")
    ask("X='$(git push -f origin x)'; cat > f <<EOF\n${X@P}\nEOF")
  })
  test('a git command that is not a message consumer keeps its body', () => {
    ask("git config -F - <<'EOF'\n[alias] p = push -f\nEOF\ngit p origin x")
  })
})

describe('0.5.0 §3.10 file names and the named-later fix', () => {
  test('mktemp and built names are read', () => {
    silent("S=/x; D=$S/r.md; cat > $D <<'EOF'\nrm -rf ~ is refused\nEOF\nwc -l $D; gh issue comment 1 --body-file $D")
    silent("T=$(mktemp); cat > $T <<'EOF'\nverdict: git push -f was refused\nEOF\nmv $T /x/report.md; gh issue comment 1 --body-file /x/report.md")
  })
  test('escape routes', () => {
    for (const c of ["T=$(mktemp); cat > $T <<'EOF'\ngit push -f origin x\nEOF\nchmod +x $T; $T",
      "T=$(mktemp); cat > $T <<'EOF'\ngit push -f origin x\nEOF\nmv $T run.sh; ./run.sh",
      "T=$(mktemp -d); cat > $T/a.sh <<'EOF'\ngit push -f origin x\nEOF\n$T/a.sh",
      "S=/x; D=$S/x.sh; cat > $D <<'EOF'\ngit push -f\nEOF\n./x.sh", "D=$UNSET/x.sh; cat > $D <<'EOF'\ngit push -f\nEOF\nmake",
      // the 0.4.3 defect: a later word holding a variable is read with its value
      "P=/x/a.sh; cat > $P <<'EOF'\ngit push -f origin x\nEOF\nmv $P run.sh; ./run.sh"])
      ask(c)
  })
})

describe('0.5.0 §3.11 namers', () => {
  test('a file named only to add, commit or remove it is not run', () => {
    silent("cat > b.md <<'EOF'\nnever git push -f\nEOF\ngit add b.md && git commit -q -m x && git push -u origin feat/x")
    silent("cat > b.md <<'EOF'\nnever git push -f\nEOF\ngh issue comment 1 --body-file b.md; rm -f b.md")
  })
  test('escape routes', () => {
    ask("cat > b.md <<'EOF'\ngit push -f origin feat/x\nEOF\ngh pr creator --body-file b.md")
    // 0.10.0: rm leaves the floor.
    silent("cat > b.md <<'EOF'\nx\nEOF\nrm -rf ~/x")
    ask("cat > c.sh <<'EOF'\ngit push -f origin x\nEOF\ngit -c core.pager=./c.sh log")
  })
})

describe('0.5.0 final review: shapes 0.4.3 asked on still ask', () => {
  test('C1: a branch switch earlier in the text makes the branch unknown', () => {
    for (const c of ['git checkout main && git merge feat/x && git push', 'git switch main; git merge --ff-only feat/x; git push origin HEAD',
      'git checkout -q main\ngit merge feat/x\ngit push -q', 'git branch -m main && git push -u origin HEAD',
      'git checkout -B main && git push origin HEAD', 'git symbolic-ref HEAD refs/heads/main && git push',
      'git checkout -b feat/y origin/main && git push', 'git checkout $B && git push'])
      ask(c)
    // A push that names a literal non-default destination still passes, and a switch to no default name is no switch.
    silent('git checkout main && git pull && git checkout -b feat/y && git push -u origin feat/y')
    silent('git checkout -b feat/y && git push -u origin feat/y')
    silent('git checkout -- a.ts && git push')
  })
  test('C2: an assignment after &&, || or a pipe across a newline, or sent to the background, is not read', () => {
    for (const c of ['test -d /repo/sub/build &&\nB=/repo/sub/build\nrm -rf "$B"/*', 'test -d /repo/sub/build ||\nB=/repo/sub/build\nrm -rf "$B"/*',
      'echo x |\nB=/repo/sub/build\nrm -rf "$B"/*', 'B=/repo/sub/build & rm -rf "$B"/*',
      "git commit -F - <<'EOF' &&\nmsg\nEOF\nB=/repo/sub/build\nrm -rf \"$B\"/*"])
      silent(c)
    // 0.10.0: rm leaves the floor; the unread variable still decides a live rule.
    ask('cd /other\ngit fetch &&\nB=feat/x\ngit push origin $B')
    silent('git fetch\nB=/repo/sub/build\nrm -rf "$B"/*')
  })
  test('I1: a flag in a variable the text binds but the floor cannot read, beside commit or branch', () => {
    for (const c of ['export NV=-n; git commit $NV -m x', 'declare NV=-n; git commit $NV -m x', 'if true; then NV=-n; fi; git commit $NV -m x',
      'NV=-n; NV=-n; git commit $NV -m x', 'for F in -n; do git commit $F -m x; done'])
      ask(c)
    // 0.10.0: the branch half left the floor with branch-delete.
    silent('export F=-D; git branch $F feat/y')
    // A variable the text never binds is still not read as a flag beside commit (0.2.0).
    silent('make -n check; git commit -q -F "$M"')
  })
  test('I2: a move or a config write inside a loop applies to the whole loop', () => {
    for (const c of ['while true; do git push; cd /other; done',
      'for i in 1 2; do git p origin feat/x; V=$(echo push -f); git config alias.p "$V"; done'])
      ask(c)
    // 0.10.0: the loop still reads the move, but the rm half left the floor.
    silent('for p in a b; do rm -rf node_modules; cd ../$p; done')
    silent('for p in a b; do echo $p; done; git push -u origin feat/x')
  })
  test('I3: a message consumer does not reach past ; && or a pipe', () => {
    ask("git commit --allow-empty -m wip; make --file - <<'EOF'\nall:\n\tgit push -f origin main\nEOF")
    ask("git tag -l | make --file - <<'EOF'\nall:\n\tgit push -f origin main\nEOF")
    silent("git commit -q --file - <<'EOF'\nfix: git push -f\nEOF")
  })
  test('I4: a large script of redirects stays fast', () => {
    const same = [...Array.from({ length: 2000 }, (_, i) => `echo "step ${i}" >> log.txt`), 'git push -u origin feat/x'].join('\n')
    const distinct = [...Array.from({ length: 2000 }, (_, i) => `echo "step ${i}" > out${i}.txt`), 'git push -u origin feat/x'].join('\n')
    for (const big of [same, distinct]) {
      const t0 = Date.now()
      silent(big)
      routes({ tool: 'bash', input: { command: big } })
      expect(Date.now() - t0 < 2000).toEqual(true)
    }
  })
  test('M2: Python process calls behind an underscore', () => {
    ask("python3 - <<'X'\nimport asyncio\nasyncio.run(asyncio.create_subprocess_shell('git push -f origin x'))\nX")
    ask("python3 - <<'X'\nimport os\nos.posix_spawnp('sh', ['sh', '-c', 'git push -f origin x'], {})\nX")
  })
  test('M5: a hook in .husky/ or .githooks/ is a git control path', () => {
    ask("cat > .husky/pre-commit <<'EOF'\ngit push -f origin main\nEOF\ngit add .husky/pre-commit && git commit -m x")
    ask("cat > .githooks/pre-push <<'EOF'\ngit push -f origin main\nEOF\ngit add .githooks/pre-push && git commit -m x")
    silent("cat > docs/husky.md <<'EOF'\nnever git push -f\nEOF\ngit add docs/husky.md && git commit -m x")
  })
})

describe('0.5.0 PR #735 round 1: shapes 0.4.3 asked on still ask', () => {
  test('a git config write lets a later git command run a written file it does not name', () => {
    ask("git config alias.x '!/tmp/a.sh'; cat > /tmp/a.sh <<'EOF'\ngit push -f origin main\nEOF\nchmod +x /tmp/a.sh; git x")
    ask("git config core.hooksPath /tmp/h; cat > /tmp/h/pre-commit <<'EOF'\ngit push -f origin main\nEOF\nchmod +x /tmp/h/pre-commit; git commit -m x")
    // With no config write, a namer and a git namer still do not run it.
    silent("cat > /tmp/a.sh <<'EOF'\nnever git push -f\nEOF\nchmod +x /tmp/a.sh; git status")
  })
  test('an alias or function keyword split by quotes is still a definition', () => {
    ask('shopt -s expand_aliases; a""lias p="git push"; p -f origin main')
    ask("shopt -s expand_aliases; a\\lias p='git push'; p -f origin main")
  })
  test('a sed script is the whole shell word, quoted pieces joined', () => {
    ask("sed 's/x/git push -f origin main/'e file")
    ask(`sed 's/x/y/'"w /tmp/o" f; echo 'git push -f origin feat/x'`, FOREIGN)
    silent("sed 's/a/b/'g f; git push -u origin feat/x; echo -f")
  })
})

describe('0.5.0 PR #735 round 2: shapes 0.4.3 asked on still ask', () => {
  test('a Python write to a bare file name that a later command runs', () => {
    ask("python3 - <<'X'\nopen('run','w').write('#!/bin/sh\\ngit push -f origin x')\nX\nchmod +x run; ./run")
    silent("python3 - <<'X'\nopen('notes','w').write('never git push -f')\nX\ngit push -u origin feat/x")
  })
  test('a write into a git control file changes git context', () => {
    ask("printf '%s\\n' '[alias]' 'p = push' > /repo/.git/config; git p -f origin feat/x")
    ask("echo 'ref: refs/heads/main' > /repo/.git/HEAD; git push")
  })
  test('a dynamically named assignment reads no variables', () => {
    ask('X=f; F=x; printf -v "${X^^}" %s -f; git push $F origin feat/x')
    ask('F=x; N=F; read -r "$N" < /tmp/v; git push $F origin feat/x')
  })
  test('an alias or function in the text keeps every heredoc body', () => {
    ask("shopt -s expand_aliases; alias tee='$SHELL -s --'\ntee note <<'X'\ngit push -f origin main\nX")
    // A `()` or the word alias in quoted prose defines nothing: the body stays dropped.
    silent("cat > r.md <<'EOF'\nnever run git commit -n here\nEOF\ngh issue create --title \"x.exp() is missing; alias rules\" --body-file r.md")
  })
  test('a command that reads a pipe is judged with the words piped into it', () => {
    ask("printf 'all:\\n\\tgit push $(F) origin feat/x\\n' | make -f - F=-f")
    silent('git log --oneline | grep -n push; git push -u origin feat/x; echo -f')
  })
  test('only a system mktemp names a fresh temp file', () => {
    ask("T=$(./mktemp); cat > $T <<'EOF'\ngit push -f origin main\nEOF\ngit commit -m x")
    silent("T=$(/usr/bin/mktemp); cat > $T <<'EOF'\nverdict: git push -f was refused\nEOF\nmv $T /x/report.md; gh issue comment 1 --body-file /x/report.md")
  })
})

describe('0.5.0 PR #735: ordinary script shapes 0.4.3 asked on', () => {
  test('a Python or tee heredoc whose stdout goes to a file a later command runs', () => {
    ask("python3 - <<'X' > run.sh\nprint('git push -f origin main')\nX\nchmod +x run.sh; ./run.sh")
    ask("tee /dev/null <<'EOF' > run.sh\ngit push -f origin main\nEOF\nchmod +x run.sh; ./run.sh")
    silent("python3 - <<'X' > out.txt\nprint('never git push -f')\nX\ngit push -u origin feat/x")
  })
  test('a ${NAME:-…} expansion in a file name is not read as $NAME', () => {
    ask("S=x; D=${S:+run}.sh; cat > $D <<'EOF'\ngit push -f origin main\nEOF\nchmod +x $D; ./run.sh")
    ask("OUT=/x; D=${OUT:-/tmp}/run.sh; cat > $D <<'EOF'\ngit push -f origin main\nEOF\n/x/run.sh")
    ask("cat > ${OUT:-.}/run.sh <<'EOF'\ngit push -f origin main\nEOF\n./run.sh")
  })
})

describe('0.5.0 PR #735: cp -t names its destination directory', () => {
  test('a hook installed with cp -t or --target-directory still asks', () => {
    ask("cat > pre-commit <<'EOF'\ngit push -f origin main\nEOF\nchmod +x pre-commit; cp -t .git/hooks pre-commit; git commit -m x")
    ask("cat > pre-commit <<'EOF'\ngit push -f origin main\nEOF\ncp --target-directory=.git/hooks pre-commit; git commit -m x")
    silent("cat > notes.md <<'EOF'\nnever git push -f\nEOF\ncp -t docs notes.md; git add docs/notes.md && git commit -m x")
  })
})

// 0.5.1 (spec §1–2): the level of each finding.
const levels = (c: string, w: Where = W) => {
  const f = floorFindings(c, w).findings
  const of = (l: string) => [...new Set(f.filter(x => x.level === l).map(x => x.rule))].sort()
  return { ask: of('ask'), fork: of('fork') }
}
describe('0.5.1: own words ask, text goes to the fork (spec §1–2)', () => {
  test('a parsed command whose own words match asks', () => {
    for (const c of ['git push -f origin feat/x', "'git' push -f origin feat/x", 'git "push" -f origin feat/x',
      'git pu""sh -f origin feat/x', 'F=-f; git push $F origin feat/x', '$CMD push -f origin feat/x'])
      expect([c, levels(c, FOREIGN).ask.includes('force-push')]).toEqual([c, true])
  })
  test('text the floor cannot read command by command goes to the fork', () => {
    for (const c of ["python3 -c 'git push -f origin feat/x'", "herdr pane run p 'git push -f origin feat/x'",
      "tmux send-keys 'git push -f origin feat/x' Enter", "git config alias.p 'push -f'; git p origin feat/x"]) {
      const l = levels(c, FOREIGN)
      expect([c, l.ask]).toEqual([c, []])
      expect([c, l.fork.includes('force-push')]).toEqual([c, true])
    }
  })
  test('a quoted message holds no verb: fork, never ask', () => {
    expect(levels("gh api repos/o/r/pulls/1/comments/2/replies -f body='we do not push here'")).toEqual({ ask: [], fork: ['force-push'] })
    expect(levels('git commit -m "fix: push the branch"', { ...W, branch: undefined }).ask).toEqual([])
  })
  test('an escaped character is part of its word, as Bash passes it (PR #763 round 6)', () => {
    expect(levels('git push \\> -f origin feat/x').ask).toContain('force-push')
    expect(levels('curl --data git\\ push\\ -f https://x').ask).toEqual([])
    // A line continuation still joins: `pu\<newline>sh` is push.
    expect(levels('git pu\\\nsh -f origin feat/x', FOREIGN).ask).toContain('force-push')
  })
  test('a rule found at both levels is ask only', () => {
    expect(levels("git push -f origin feat/x -o 'push -f'")).toEqual({ ask: ['force-push'], fork: [] })
  })
  test('the focus is the command that matched', () => {
    const f = floorFindings('cd /repo\nnpm test\ngit push -f origin feat/x', FOREIGN).findings
    expect(f.find(x => x.rule === 'force-push')?.focus).toBe('git push -f origin feat/x')
  })
  test('neverRules is the union of both levels', () => {
    expect(rules("python3 -c 'git push -f origin feat/x'", FOREIGN)).toContain('force-push')
    expect(rules('git push -f origin feat/x', FOREIGN)).toContain('force-push')
  })
})

describe('0.5.1: shell words for sed, and rm of a variable path (spec §2, §4)', () => {
  test('a sed script with an escaped slash is a safe sed, not a runner (cause 5)', () => {
    expect(levels("sed -i 's/a\\/b/c/' $S/pr.md; git push -q")).toEqual({ ask: [], fork: [] })
  })
  test('an unresolved variable may hold flags even before a path (PR #763 review; rm leaves the floor in 0.10.0)', () => {
    // 0.10.0: rm is the judge's now; the calls stay, and no rule fires.
    for (const c of ['rm $T/x', 'rm -f $W/reports/.seen', 'rm ${OUT}/a.md']) expect([c, rules(c)]).toEqual([c, []])
    // A variable the text assigns once to a literal is read as its value.
    expect(rules('T=/repo/a; rm "$T/x"')).toEqual([])
  })
  test('a bare variable or a recursive flag still makes rm recursive (rm leaves the floor in 0.10.0)', () => {
    for (const c of ['rm -rf $T', 'rm $F /x', 'rm -rf ../x', 'rm -r ~/x']) expect([c, rules(c)]).toEqual([c, []])
  })
})

describe('0.5.1: the session branch still decides a push (0.5.0 reading; #766)', () => {
  test('a text-only finding survives beside an own-words one in another command (PR #763 round 2)', () => {
    const f = floorFindings("herdr pane run p 'git push -f origin feat/y'; git push -f origin feat/z", W).findings
    expect(f.filter(x => x.rule === 'force-push').map(x => x.level).sort()).toEqual(['ask', 'fork'])
  })
  test('the default branch, HEAD, no refspec and an opaque destination still ask', () => {
    for (const c of ['git push origin main', 'git push origin HEAD', 'git push origin x:main', 'git push', 'git push origin $B', 'git push origin --delete main'])
      expect([c, rules(c, { ...W, branch: 'main' }).includes('default-branch-push')]).toEqual([c, true])
    // 0.10.0 (#766): a detached session's push leaves the floor unless the text names the default.
    for (const c of ['git push', 'git push origin HEAD']) expect([c, rules(c, { ...W, branch: undefined })]).toEqual([c, []])
    for (const c of ['git push origin main', 'git push origin x:main', 'git push origin $B', 'git push origin --delete main'])
      expect([c, rules(c, { ...W, branch: undefined }).includes('default-branch-push')]).toEqual([c, true])
  })
})

// ---- autonomic 0.10.0: the floor holds red lines 1–3 only (slice 2 plan, Task 1) ----
// The floor's ask level parks a call for the operator. 0.10.0 keeps exactly three red lines on
// it: 1 (a direct push to the default branch), 2 (a force-push to a branch the seat does not
// own) and 3 (--no-verify, an AI trailer in a message the floor can read). Everything else
// leaves the floor for the judge (Task 2's routing).
describe('0.10.0 red lines', () => {
  test('redLineOf names each rule its red line (spec §3)', () => {
    expect([redLineOf('default-branch-push'), redLineOf('force-push'), redLineOf('no-verify'), redLineOf('ai-trailer')]).toEqual([1, 2, 3, 3])
  })
  test('red line 1: the default branch, named, matched, or the session branch itself', () => {
    for (const c of ['git push origin main', 'git push origin HEAD:main', 'git push --all origin', 'git push origin x:refs/heads/main'])
      expect([c, levels(c).ask]).toEqual([c, ['default-branch-push']])
    expect(levels('git push', { ...W, branch: 'main' }).ask).toEqual(['default-branch-push'])
  })
  test('red line 2: a force-push to a branch the seat does not own', () => {
    for (const c of ['git push -f origin feat/y', 'git push -f origin "$B"', 'git push -f', 'git push --mirror origin',
      'git push origin +refs/heads/feat/x', 'git push -f origin feat/x feat/y'])
      expect([c, levels(c).ask.includes('force-push')]).toEqual([c, true])
    expect(levels('git push --force-with-lease origin main').ask).toEqual(['default-branch-push', 'force-push'])
  })
  test('an own-branch force leaves the floor; the controls above still park', () => {
    for (const c of ['git push -f origin feat/x', 'git push origin +feat/x', 'git push -f origin feat/x:feat/x', 'git push --force-with-lease origin feat/x'])
      expect([c, rules(c)]).toEqual([c, []])
  })
  test('red line 3: --no-verify and a trailer in a message the floor can read', () => {
    expect(levels('git commit --no-verify -m x').ask).toEqual(['no-verify'])
    for (const c of ['git commit -m "x" -m "Co-Authored-By: A <a@b>"', 'git commit -m "🤖 Generated with [Claude Code]"',
      "git commit -am 'Co-Authored-By: A <a@b>'"])
      expect([c, levels(c).ask]).toEqual([c, ['ai-trailer']])
  })
  test("a message the floor cannot read is the judge's (red line 3 is in its prompt)", () => {
    for (const c of ['git commit -m "x"', 'git commit -F msg.txt', "git commit -F - <<'EOF'\nCo-Authored-By: A\nEOF",
      'git commit -m "$(cat <<\'EOF\'\nCo-Authored-By: A <a@b>\nEOF\n)"'])
      expect([c, levels(c)]).toEqual([c, { ask: [], fork: [] }])
  })
  test('the retired rules leave the floor: the judge decides them now (#764, call 7)', () => {
    for (const c of ['git push origin --delete feat/y', 'git branch -D feat/y', 'git branch -d -f x', 'git push origin :feat/y', 'rm -rf ../x'])
      expect([c, levels(c)]).toEqual([c, { ask: [], fork: [] }])
  })
  test('a detached session leaves the floor unless the text names the default branch (#766)', () => {
    expect(levels('git push origin feat/y', { ...W, branch: undefined })).toEqual({ ask: [], fork: [] })
    expect(levels('git push', { ...W, branch: undefined })).toEqual({ ask: [], fork: [] })
    expect(levels('git push origin main', { ...W, branch: undefined }).ask).toEqual(['default-branch-push'])
  })
  test('text-only red-line words never park (Review Focus 5)', () => {
    expect(levels('grep -n "push -f" x.ts')).toEqual({ ask: [], fork: [] })
    expect(levels("cat <<'EOF' | sh\ngit push origin main\nEOF")).toEqual({ ask: [], fork: ['default-branch-push'] })
  })
})

// ---- autonomic 0.10.0: the routing check (Task 2) ----
// routes decides which calls reach the judge at all: a call it does not see runs unjudged, as
// before 0.10.0. It only adds a judgment, never approves, so a word that routes too much is the
// safe direction (plan Task 2). Each routed case sits beside a quiet one that must not route.
describe('0.10.0 routing', () => {
  test('every Task 1 own-word case routes', () => {
    for (const c of ['git push origin main', 'git push origin HEAD:main', 'git push --all origin',
      'git push', 'git push origin feat/y', 'git push -f origin feat/x', 'git push -f origin feat/y',
      'git push --force-with-lease origin main', 'git push -f origin "$B"',
      'git commit -m "x" -m "Co-Authored-By: A <a@b>"', 'git commit --no-verify -m x'])
      expect([c, routes({ tool: 'bash', input: { command: c } })]).toEqual([c, true])
  })
  test('the retired rules and an own-branch force still route to the judge (#764)', () => {
    for (const c of ['git push origin --delete feat/y', 'git branch -D x', 'rm -rf "$tmp"', 'git push -f origin feat/x'])
      expect([c, routes({ tool: 'bash', input: { command: c } })]).toEqual([c, true])
  })
  test('the escape-route spellings the old pre-check caught still route (superset pin)', () => {
    for (const c of ['git pu""sh -f origin feat/y', 'git pu\\sh -f origin feat/y', 'git am --no-verif patch.mbox', "r'm' -rf x"])
      expect([c, routes({ tool: 'bash', input: { command: c } })]).toEqual([c, true])
  })
  test('red line 4 words route', () => {
    for (const c of ['vercel deploy --prod', 'fly deploy', 'kubectl apply -f x', 'helm upgrade x', 'terraform apply', 'docker push x', 'npm publish', 'cargo publish'])
      expect([c, routes({ tool: 'bash', input: { command: c } })]).toEqual([c, true])
  })
  test('red line 6 words route: credential commands and file shapes', () => {
    for (const c of ['cat ~/.ssh/id_ed25519', 'printenv', 'env', 'security find-generic-password', 'op read x', 'pass show x',
      'cat .env', 'cat prod.env', 'cat certs/x.pem', 'cat certs/x.key', 'cat ~/.aws/credentials', 'cat ~/.config/auth.json', 'sqlite3 agent.db .dump'])
      expect([c, routes({ tool: 'bash', input: { command: c } })]).toEqual([c, true])
  })
  test('red line 5 words and the merge gate route', () => {
    for (const c of ['stripe payments list', 'subscribe plan b', 'purchase extra seats', 'billing report', 'gh pr merge 12'])
      expect([c, routes({ tool: 'bash', input: { command: c } })]).toEqual([c, true])
  })
  test('the file tools route by their path (red line 6)', () => {
    for (const tool of ['Read', 'Write', 'Edit', 'NotebookEdit'])
      expect([tool, routes({ tool, input: { file_path: '/repo/.env' } })]).toEqual([tool, true])
  })
  test('an input naming the park store directory routes (Task 3 formalises the mark)', () => {
    expect(routes({ tool: 'bash', input: { command: 'cat /home/u/.local/state/autonomic/parks/ab12.json' } })).toBe(true)
    expect(routes({ tool: 'Write', input: { file_path: '/home/u/.local/state/autonomic/parks/ab12.json' } })).toBe(true)
  })
  test('text-only red-line words still route: the floor decides what parks, routing decides what is judged', () => {
    expect(routes({ tool: 'bash', input: { command: 'grep -n "push -f" x.ts' } })).toBe(true)
    expect(routes({ tool: 'bash', input: { command: "cat <<'EOF' | sh\ngit push origin main\nEOF" } })).toBe(true)
  })
  // 0.10.0 follow-up (operator ruling, 2026-10-19): ten more red-line shapes route — the six
  // first named, then destroy, shadow, secret and secrets. Each route case routes only through
  // its own new word, so removing that word fails it; each control is the near-miss that must
  // stay quiet beside it.
  test('the added red-line 4–6 words route, each beside a control that must stay quiet', () => {
    const pairs: Array<[string, string]> = [
      ['ssh-keygen -t ed25519 -f /tmp/k', 'ssh-copy-id host'],
      ['cat id_rsa', 'cat id_rsa.pub'],
      ['cat id_ed25519', 'cat id_ed25519.pub'],
      ['kubectl rollout restart deployment/web', 'kubectl describe deployment web'],
      ['make payment', 'cat payments.csv'],
      ['send invoice', 'ls invoices'],
      ['terraform destroy -auto-approve', 'terraform plan'],
      ['cat /etc/shadow', 'cat docs/box-shadow.md'],
      ['vault read secret/db', 'cat docs/secret-handling.md'],
      ['cat /run/secrets', 'cat docs/secrets-handling.md'],
    ]
    for (const [hit, quiet] of pairs) {
      expect([hit, routes({ tool: 'bash', input: { command: hit } })]).toEqual([hit, true])
      expect([quiet, routes({ tool: 'bash', input: { command: quiet } })]).toEqual([quiet, false])
    }
  })
  test('a quiet call does not route (the adjacent controls)', () => {
    for (const c of ['git status', 'bun test', 'gh release create v1', 'ls -la', 'cat README.md'])
      expect([c, routes({ tool: 'bash', input: { command: c } })]).toEqual([c, false])
  })
})

