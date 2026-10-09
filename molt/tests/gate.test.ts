import { describe, test, expect } from 'claude-code/testing'
import { gateAllows, isProgress } from '../hooks/gate'
import { gitSubcommands } from '../hooks/shell'

const bash = (command: string) => gateAllows('Bash', { command })

describe('gitSubcommands', () => {
  test('one entry per command segment', () => {
    expect(gitSubcommands('git add a && git commit -F m')).toEqual(['add', 'commit'])
    expect(gitSubcommands('git -C /r commit -m x; ls')).toEqual(['commit', undefined])
  })
  test('quoted text and heredoc bodies are not commands', () => {
    expect(gitSubcommands(`git commit -m "fix; cat secrets"`)).toEqual(['commit'])
    expect(gitSubcommands('git commit -F - <<EOF\nrm -rf /\nEOF')).toEqual(['commit'])
  })
})

describe('gateAllows past the hard threshold', () => {
  test('the handoff tools run', () => {
    expect(gateAllows('Write', { file_path: '/r/h.md', content: 'x' })).toBe(true)
    expect(gateAllows('Edit', { file_path: '/r/h.md' })).toBe(true)
    expect(gateAllows('Skill', { skill: 'ossify:handoff' })).toBe(true)
    expect(bash('git add docs/h.md && git commit -F /tmp/m')).toBe(true)
    expect(bash('git -C /r add h.md')).toBe(true)
  })
  test('reads and everything else are refused', () => {
    expect(gateAllows('Read', { file_path: '/r/a' })).toBe(false)
    expect(gateAllows('Grep', { pattern: 'x' })).toBe(false)
    expect(bash('cat huge.log')).toBe(false)
    expect(bash('git log -p')).toBe(false)
  })
  test('a read hidden behind a commit is refused (review focus 5)', () => {
    expect(bash('git add a && cat huge.log')).toBe(false)
    expect(bash('cd docs && git commit -m x')).toBe(false)
    expect(bash('git commit -m x | tee out')).toBe(false)
  })
  test('an empty or missing command is refused', () => {
    expect(bash('')).toBe(false)
    expect(gateAllows('Bash', {})).toBe(false)
  })
})

describe('isProgress', () => {
  test('a file written or a commit made', () => {
    expect(isProgress('Write', { file_path: '/r/a' })).toBe(true)
    expect(isProgress('Edit', { file_path: '/r/a' })).toBe(true)
    expect(isProgress('Bash', { command: 'git add a && git commit -F m' })).toBe(true)
  })
  test('reads and other commands are not progress', () => {
    expect(isProgress('Read', { file_path: '/r/a' })).toBe(false)
    expect(isProgress('Bash', { command: 'git status' })).toBe(false)
    expect(isProgress('Bash', { command: 'echo git commit' })).toBe(false)
  })
})

// Pins for the shared reader changes shipped in molt 0.2.2 / seat-mods 0.3.0.
describe('shared shell reader pins (#702 item 4)', () => {
  test('herestring leaves later commands visible beside inert heredoc text', () => {
    const command = 'git add a <<<EOF\ncat huge.log\nEOF'
    expect(gitSubcommands(command)).toEqual(['add', undefined, undefined])
    expect(bash(command)).toBe(false)
    const heredoc = 'git add a <<EOF\ncat huge.log\nEOF'
    expect(gitSubcommands(heredoc)).toEqual(['add'])
    expect(bash(heredoc)).toBe(true)
  })
  test('path-qualified wrapper matches bare wrapper beside a non-git command', () => {
    expect(gitSubcommands('/usr/bin/env git add h.md')).toEqual(['add'])
    expect(bash('/usr/bin/env git add h.md')).toBe(true)
    expect(gitSubcommands('env git add h.md')).toEqual(['add'])
    expect(bash('env git add h.md')).toBe(true)
    expect(gitSubcommands('/usr/bin/env cat huge.log')).toEqual([undefined])
    expect(bash('/usr/bin/env cat huge.log')).toBe(false)
  })
})

// #711: the reserved head walk. A head-wrapped git add / git commit runs past the
// hard threshold; each acceptance sits beside a case the fix must keep refusing.
describe('reserved head words past the hard threshold (#711)', () => {
  test('if git add f; then git commit -m m; fi is allowed', () => {
    expect(bash('if git add f; then git commit -m m; fi')).toBe(true)
  })
  test('! git commit -m m is allowed', () => {
    expect(bash('! git commit -m m')).toBe(true)
  })
  test('{ git add f; git commit -m m; } is allowed', () => {
    expect(bash('{ git add f; git commit -m m; }')).toBe(true)
  })
  test('a path-qualified or quoted head word is a program, not a head word', () => {
    expect(bash('/x/if git commit -m m')).toBe(false)
    expect(bash('"if" git commit -m m')).toBe(false)
  })
  test('the walk exposes the non-git command it finds, and the gate still refuses it', () => {
    expect(bash('if rm -rf x; then git commit -m m; fi')).toBe(false)
    expect(bash('if git add f; then cat x; fi')).toBe(false)
    expect(bash('then rm -rf x')).toBe(false)
    expect(bash('if git add f; then git commit -m m; fi; cat x')).toBe(false)
  })
  test('builtin is an execution prefix, not a head word (A1 decision)', () => {
    expect(bash('builtin git add f')).toBe(false)
    expect(bash('builtin git commit -m m')).toBe(false)
  })
  test('a closer with arguments is not a bare closer', () => {
    expect(bash('fi git commit -m m')).toBe(false)
    expect(bash('} git commit -m m')).toBe(false)
    expect(bash('fi foo')).toBe(false)
  })
  test('a command of only head words or closers names no command: refused (control)', () => {
    expect(bash('fi')).toBe(false)
    expect(bash('!')).toBe(false)
    expect(bash('then')).toBe(false)
    expect(bash('{ }')).toBe(false)
  })
  test('a command of only head words or closers returns no segment, so nothing can be allowed from it', () => {
    expect(gitSubcommands('fi')).toEqual([])
    expect(gitSubcommands('!')).toEqual([])
    expect(gitSubcommands('then')).toEqual([])
    expect(gitSubcommands('{ }')).toEqual([])
  })
  test('a bare git commit -m m is still allowed (control)', () => {
    expect(bash('git commit -m m')).toBe(true)
  })
})

describe('isProgress with reserved head words (#711)', () => {
  test('a head-wrapped commit counts as progress', () => {
    expect(isProgress('Bash', { command: 'if git commit -m m; then :; fi' })).toBe(true)
  })
  test('a negated commit counts as progress', () => {
    expect(isProgress('Bash', { command: '! git commit -m m' })).toBe(true)
  })
  test('a path-qualified or builtin-wrapped commit is not progress (control)', () => {
    expect(isProgress('Bash', { command: '/x/if git commit -m m' })).toBe(false)
    expect(isProgress('Bash', { command: 'builtin git commit -m m' })).toBe(false)
  })
  test('a command of only head words or closers is not progress (control)', () => {
    expect(isProgress('Bash', { command: 'fi' })).toBe(false)
    expect(isProgress('Bash', { command: '!' })).toBe(false)
  })
})
