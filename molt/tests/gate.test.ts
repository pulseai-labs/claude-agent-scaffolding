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
