import { describe, test, expect } from 'claude-code/testing'
import { DEFAULT_READERS, namesDanger, neverRules, parseReaders } from '../hooks/never'
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
      expect([c, rules(c)]).toEqual([c, ['branch-delete', 'default-branch-push', 'force-push']])
    expect(rules('rm ${OPTS} /tmp/x')).toEqual(['rm-outside'])
  })
  test('every unique prefix the tools accept is read (PR #685 round 1)', () => {
    expect(rules('rm --r /tmp/victim')).toEqual(['rm-outside'])
    expect(rules('git push --de origin x')).toEqual(['branch-delete'])
    expect(rules('git push --mi')).toEqual(['branch-delete', 'default-branch-push', 'force-push'])
    expect(rules('git push --f origin feat/x')).toEqual(['force-push'])
    expect(rules('git push --a')).toEqual(['default-branch-push'])
    expect(rules('git branch --de --f x')).toEqual(['branch-delete'])
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
    expect(namesDanger(c)).toBe(false)
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
    expect(rules('V=push; git $V -f origin feat/x')).toContain('force-push')
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
    expect(rules("cat > f <<'X'\ndon't\nX\nbash f; echo -f; git push origin feat/x")).toContain('force-push')
    // No runner here: only the << gate stops the body's apostrophe from hiding -f (final review 12).
    expect(rules("cat > f <<'X'\necho don't\nX\n./f; echo it\\'s -f\ngit push origin feat/x")).toContain('force-push')
  })
  test('printf -v defines a name; sort can run a program; a hooks directory is run by git', () => {
    expect(rules('printf -v V push; git $V -f origin feat/x')).toContain('force-push')
    expect(rules("cat > c <<'X'\ngit push -f origin feat/x\nX\nsort --compress-program=./c big.txt")).toContain('force-push')
    expect(rules("cat > h <<'X'\ngit push -f origin feat/x\nX\ncp h .git/hooks/pre-commit")).toContain('force-push')
  })
  test('the dashed and path forms of a verb are still verbs', () => {
    expect(rules('/usr/lib/git-core/git-push -f origin feat/x')).toContain('force-push')
    expect(rules('git-push -f origin feat/x')).toContain('force-push')
    expect(rules('/bin/rm -rf /tmp/x')).toContain('rm-outside')
  })
  test('known limit: a command that is not inert and names the written file keeps the jq words', () => {
    const c = `jq '.note = "do not rm -rf $X"' run.json > run.json.tmp && dagr check run.json.tmp && mv run.json.tmp run.json`
    expect(rules(c)).toContain('rm-outside')
  })
  test('known limit: prose quoted in one argument of a command that is not inert still pools', () => {
    expect(rules('herdr agent prompt spine "the verifier ran rm -rf $X" ; printf x >> rulings.md')).toContain('rm-outside')
  })
})

describe('review focus (0.4.2 plan)', () => {
  test('two heredocs: the run one keeps its body, the other is dropped', () => {
    const c = "cat > a <<'X'\nno-rm prose\nX\ncat > b.sh <<'Y'\ngit push -f origin feat/x\nY\n./b.sh"
    expect(rules(c)).toContain('force-push')
    expect(rules("cat > a <<'X'\ngit push -f origin feat/x\nX\ncat > b <<'Y'\nok\nY\nwc -l a b")).toEqual([])
  })
  test('a move beside an inert command is still a move', () => {
    expect(rules('echo x; cd /repo/other && git push origin feat/x')).toEqual(['default-branch-push'])
  })
  test('a 2>&1 stays in its command', () => {
    expect(rules("echo 'git push -f origin feat/x' > x.sh 2>&1; ./x.sh")).toContain('force-push')
  })
  test('the pre-check sees an escape route', () => {
    expect(namesDanger("echo 'git push -f' > x.sh; ./x.sh")).toBe(true)
  })
  test('a file run through a differently spelled variable keeps its body (0.4.1 dropped it)', () => {
    expect(rules("cat > x.sh <<'X'\ngit push -f origin feat/x\nX\nT=x; \"$T.sh\"")).toContain('force-push')
  })
})

// Final review of the 0.4.2 branch: each case was held by 0.4.1 and must still ask.
describe('0.4.2 final review: no new false negative against 0.4.1', () => {
  test('a comment does not open a quote or join the next line', () => {
    expect(rules("echo start # don't skip\ngit push -f origin feat/x\necho done # that's all")).toContain('force-push')
    expect(rules('echo x # trailing \\\ngit push -f origin feat/x')).toContain('force-push')
  })
  test('a process substitution keeps the whole bag', () => {
    expect(rules('cat <(git push -f origin feat/x)')).toContain('force-push')
    expect(rules('echo >(git push -f origin feat/x)')).toContain('force-push')
  })
  test('a function defined in the same text is not inert', () => {
    expect(rules('echo() { git push -f origin feat/x; }; echo hi')).toContain('force-push')
    expect(rules('cat () { rm -rf ~/work; }; cat f')).toContain('rm-outside')
    expect(rules('function echo { git push -f origin feat/x; }; echo hi')).toContain('force-push')
  })
  test('an inert command piped onward keeps its words', () => {
    expect(rules("echo 'git push -f origin feat/x' | at now")).toContain('force-push')
    expect(rules("echo 'git push -f origin feat/x' | cat > x.sh; ./x.sh")).toContain('force-push')
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
    expect(rules('./scripts/test push -f origin feat/x')).toContain('force-push')
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
    expect(rules('/repo/echo git push -f origin feat/x')).toContain('force-push')
    expect(rules('/bin/echo git push -f origin feat/x; true')).toEqual([])
  })
  test('a dashed executable path is a verb; bare dashed prose is not (r4220518572)', () => {
    expect(rules('./force-push -f origin feat/x')).toContain('force-push')
    expect(rules('bin/force-push -f origin feat/x')).toContain('force-push')
  })
})

// PR #700 round 2 (Codex): each case was held by 0.4.1 and must still ask.
describe('PR #700 round 2: shadowed names and git control files', () => {
  test('a name defined in the text keeps the whole bag (r4220653778)', () => {
    expect(rules('echo() { "$@"; }; echo git push -f origin feat/x')).toContain('force-push')
    expect(rules("alias echo='git'; echo push -f origin feat/x")).toContain('force-push')
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
    expect(rules('echo "$(git push -f origin feat/x)"')).toContain('force-push')
    expect(rules('test -n "$(git commit -n -m x)"')).toContain('no-verify')
    expect(rules('echo "$(echo "$(git push -f origin feat/x)")"')).toContain('force-push')
  })
  test('an unbalanced substitution or arithmetic keeps the whole bag', () => {
    expect(rules('echo "$(git push -f origin feat/x"')).toContain('force-push')
    expect(rules('echo $((1)) -f; git push origin feat/x')).toContain('force-push')
  })
  test('a substitution inside single quotes is text', () => {
    expect(rules("echo '$(git push -f origin feat/x)'")).toEqual([])
  })
})

describe('0.4.3 §3.2 groups: escape routes', () => {
  test('a redirect on a group applies to its commands', () => {
    expect(rules("{ echo 'git push -f origin feat/x'; } > x.sh; ./x.sh")).toContain('force-push')
    expect(rules("( echo 'git push -f origin feat/x' ) > .git/hooks/pre-commit")).toContain('force-push')
    expect(rules("if true; then cat <<'X'\ngit push -f origin feat/x\nX\nfi > x.sh; ./x.sh")).toContain('force-push')
    expect(rules("for i in 1; do echo 'git push -f origin feat/x'; done > x.sh; ./x.sh")).toContain('force-push')
  })
  test('a pipe on a group applies to its commands', () => {
    expect(rules("{ echo 'git push -f origin feat/x'; } | at now")).toContain('force-push')
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
    expect(rules('cat <<X\n$(git push -f origin feat/x)\nX')).toContain('force-push')
    expect(rules('cat <<X\n`git push -f origin feat/x`\nX')).toContain('force-push')
  })
  test('a stdout body that only prints is text', () => {
    expect(rules(`cat <<'X'\n${PROSE}\nX`)).toEqual([])
  })
})

describe('0.4.3 §3.4 sed: escape routes', () => {
  test('a sed that may run code stays a runner', () => {
    for (const c of ["sed 1e f; echo 'git push -f origin feat/x'", "sed 's/x/y/e' f; echo 'git push -f origin feat/x'",
      "sed -e 1p -e 2e f; echo 'git push -f origin feat/x'", "sed -f s.sed f; echo 'git push -f origin feat/x'",
      "sed -ni 1p f; echo 'git push -f origin feat/x'"])
      expect([c, rules(c)]).toEqual([c, ['force-push']])
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
  test('a reader keeps its own words (#693 case E)', () => {
    expect(neverRules('herdr agent prompt p "the verifier ran rm -rf $X"', W, HERDR)).toContain('rm-outside')
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
    expect(rules('case "$x" in a) git push -f origin feat/x;; esac')).toContain('force-push')
  })
  test('an input redirect or a here-string keeps an inert head', () => {
    expect(rules(`cat > b.md <<'X'\n${PROSE}\nX\nwc -l < b.md; grep -c x <<< "$v"`)).toEqual([])
  })
  test('a substitution in a redirect target is opaque', () => {
    expect(rules(`echo '${PROSE}' > "$(mktemp)"`)).toEqual([])
    expect(rules("echo 'git push -f origin feat/x' > \"$(mktemp)\"; git status")).toContain('force-push')
  })
  test('a sed script with more than one command stays a runner', () => {
    expect(rules("sed -n '1,5p;8q' f; echo 'git push -f origin feat/x'")).toEqual(['force-push'])
  })
})

describe('0.4.3 plan review focus: sed reads its quoted script whole', () => {
  test('a quoted script with a second command is not a narrow sed', () => {
    expect(rules("sed -n '1p;e id' f; echo 'git push -f origin feat/x'")).toEqual(['force-push'])
  })
})
