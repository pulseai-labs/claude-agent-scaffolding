import { describe, test, expect } from 'claude-code/testing'
import { namesDanger, neverRules } from '../hooks/never'
import type { Where } from '../hooks/never'

const W: Where = { cwd: '/repo/sub', root: '/repo', home: '/h', branch: 'feat/x', defaultBranch: 'main' }
const rules = (c: string, w: Where = W) => neverRules(c, w).sort()

describe('the never-approve list (spec §3.3, plan decision 3)', () => {
  test('a push flag that is a variable is unreadable (PR #681 round 9)', () => {
    expect(rules('git push --force$EMPTY origin feat/x')).toContain('unreadable')
  })
  test('a Bash builtin that runs a command is a runner (PR #681 round 7)', () => {
    for (const c of ['coproc git push -f origin feat/x', 'builtin command git push -f', "trap 'git push -f' EXIT"])
      expect(rules(c)).not.toEqual([])
  })
  test('a substitution in an unquoted heredoc is unreadable (PR #681 round 6)', () => {
    expect(rules('cat <<EOF\n$(git push -f origin feat/x)\nEOF')).toContain('unreadable')
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
    expect(rules('git push -ofoo origin feat/x')).toEqual([])
  })
  test('git send-pack and http-push are pushes the reader cannot follow (PR #681 round 4)', () => {
    expect(rules('git send-pack --force origin refs/heads/feat/x:refs/heads/main')).toContain('unreadable')
    expect(rules('git http-push -v https://x/r.git main')).toContain('unreadable')
  })
  test('cd into a directory below the root reads the branch as unknown (PR #681 round 4)', () => {
    expect(rules('cd /repo/other && git push')).toContain('default-branch-push')
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
    expect(rules('git -C /repo/sub/mod push origin feat/x')).toEqual([])
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
  test('an interpreter running a program that names a danger is unreadable (PR #681)', () => {
    for (const c of [`python3 -c 'import os; os.system("git push -f")'`, `node -e "require('child_process').execSync('git push -f')"`,
      `perl -e 'system("rm -rf /")'`, `/usr/bin/python3.12 -c 'x' && git push origin feat/x`, `ruby -e 'system("git push -f")'`])
      expect(rules(c)).toContain('unreadable')
    expect(rules('python3 tools/build.py')).toEqual([])
  })
  test('a git global the reader cannot skip, or an alias defined inline, is unreadable (PR #681)', () => {
    for (const c of ['git --git-dir .git push -f origin main', 'git --work-tree /x push origin main', 'git --namespace n push -f',
      'git -c alias.p=push p -f', 'git --config-env alias.p=E push -f'])
      expect(rules(c)).toContain('unreadable')
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
    expect(rules('rm -r ../other')).toEqual([])
    expect(rules('rm /tmp/x')).toEqual([])
  })
  test('a hidden segment still counts (review focus 5)', () => {
    expect(rules('git status && git push -f')).toContain('force-push')
    expect(rules('cd /tmp && rm -rf x')).toContain('rm-outside')
    expect(rules('ls; (git push origin main)')).toContain('default-branch-push')
  })
  test('quoted text is not a command (control)', () => {
    expect(rules('git commit -m "do not git push -f"')).toEqual([])
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
    for (const c of ['git push origin "main"', 'git push origin "$BRANCH"', 'git push origin $BRANCH', 'BRANCH=main git push origin "$BRANCH"',
      'git push -u origin "$(git branch --show-current)"', 'git "push" -f', '"git" push -f', '\\rm -rf /', 'git push "--force"'])
      expect([c, rules(c)]).toEqual([c, ['unreadable']])
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
    for (const c of ['FLAGS=-rf; rm $FLAGS /tmp', 'rm "$X" /tmp', 'NV=-n; git commit $NV -m x', 'git branch "$OPT" x'])
      expect([c, rules(c)]).toEqual([c, ['unreadable']])
  })
  test('round 2 controls: the same repo, an explicit refspec, commit message values', () => {
    for (const c of ['git -C /other push origin feat/x', 'cd /repo && git push', 'cd /other && git push origin feat/x',
      'git commit -m "msg"', 'git commit -am "msg"', 'git commit -F "$f"', 'git commit --message "x" --author "A <a@b>"', 'rm -f x.txt'])
      expect([c, rules(c)]).toEqual([c, []])
  })
  test('a substitution inside double quotes is read as a command (PR #672 round 3)', () => {
    for (const c of ['echo "$(git push -f)"', 'OUT="$(git push origin main 2>&1)"', 'echo "`git push -f`"', 'X="a $(echo "$(git push -f)")"'])
      expect([c, rules(c).length > 0]).toEqual([c, true])
    for (const c of ['git commit -m "$(cat <<\'EOF\'\nfix(x): push the branch (see #1)\nEOF\n)"', 'echo "$(git branch --show-current)"', 'echo "push $(date)"'])
      expect([c, rules(c)]).toEqual([c, []])
  })
})
