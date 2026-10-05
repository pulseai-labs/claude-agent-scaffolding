import { describe, test, expect } from 'claude-code/testing'
import { neverRules } from '../hooks/never'
import type { Where } from '../hooks/never'

const W: Where = { cwd: '/repo/sub', root: '/repo', home: '/h', branch: 'feat/x', defaultBranch: 'main' }
const rules = (c: string, w: Where = W) => neverRules(c, w).sort()

describe('the never-approve list (spec §3.3, plan decision 3)', () => {
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
})
