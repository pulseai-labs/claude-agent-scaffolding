import { describe, test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

// The world beneath the plugin. The test kit routes $.fs, $.process and
// $.session.cwd as events the test answers, so this is a small file system:
// a git worktree at /w (the session runs in /w/seat-mods), and three plain
// folders outside it. The test's own tool.call hook stands for the engine: a
// call that reaches it answers `ran`; a denied call resolves with { deny }
// carrying the deny text. A mocked call answers { value }, or { deny } for a
// missing path, as the kit requires.
const DIRS = new Set(['/', '/w', '/w/seat-mods', '/w/seat x', '/etc', '/var', '/reports'])
// A dangling symbolic link: it exists, but resolving it fails.
const LINKS = new Set(['/w/link'])
const FILES = new Map<string, string>([
  ['/w/README.md', 'readme'],
  ['/w/msg-trailer.txt', 'fix: a thing\n\nCo-Authored-By: someone <x@y>\n'],
  ['/w/seat x/msg.txt', 'fix\n\nCo-Authored-By: someone <x@y>\n'],
])

// What realpath gives for the mock: `.` and `..` resolved, no links. Like
// realpath, `..` through a folder that does not exist fails (undefined).
function normal(path: string): string | undefined {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (!DIRS.has('/' + parts.join('/'))) return undefined
      parts.pop()
    } else parts.push(part)
  }
  return '/' + parts.join('/')
}

function world(on: On, env: Record<string, string>, gitRepo = true) {
  mock.env(on, env)
  on('tool.call', () => ({ result: 'ran' }) as never)
  on('session.cwd', () => ({ value: '/w/seat-mods' }))
  on('process.run', (_$, e) =>
    ({ value: e.argv.includes('rev-parse')
      ? (gitRepo
        ? { exitCode: 0, stdout: '/w\n', stderr: '', isStdoutTruncated: false }
        : { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository', isStdoutTruncated: false })
      : { exitCode: 1, stdout: '', stderr: 'unmocked', isStdoutTruncated: false } }) as never)
  on('fs.stat', (_$, e) => {
    const path = normal(e.path)
    if (path !== undefined && LINKS.has(path) && !e.resolve)
      return { value: { kind: 'other', size: 0, mtimeMs: 0, isLink: true } } as never
    if (path !== undefined && DIRS.has(path)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: path } } as never
    if (path !== undefined && FILES.has(path)) return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false, realPath: path } } as never
    return { deny: `ENOENT: ${e.path}` } as never
  })
  on('fs.read', (_$, e) => {
    const path = normal(e.path)
    const text = path === undefined ? undefined : FILES.get(path)
    if (text === undefined) return { deny: `ENOENT: ${e.path}` } as never
    return { value: text } as never
  })
}

describe('unset role: guarded as the default implementer', () => {
  test('unset: merge denied, a plain commit allowed, an outside write denied', async ($, on) => {
    world(on, {})
    const merge = await $.tool.call({ tool: 'Bash', command: 'git merge main' })
    expect(merge.deny).toContain('seat-mods (implementer): no merges')
    const commit = await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix"' })
    expect(commit.deny).toBeUndefined()
    const outside = await $.tool.call({ tool: 'Write', file_path: '/var/seat-mods-never', content: 'x' })
    expect(outside.deny).toBeDefined()
    expect(outside.deny).toContain('SEAT_MODS_ALLOW')
  })
  test('empty string: the same default', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: '' })
    const merge = await $.tool.call({ tool: 'Bash', command: 'git merge main' })
    expect(merge.deny).toBeDefined()
    const outside = await $.tool.call({ tool: 'Write', file_path: '/var/seat-mods-never', content: 'x' })
    expect(outside.deny).toBeDefined()
  })
  test('outside a git repo the session cwd is the worktree', async ($, on) => {
    world(on, {}, false)
    const inside = await $.tool.call({ tool: 'Write', file_path: '/w/seat-mods/notes.md', content: 'x' })
    expect(inside.deny).toBeUndefined()
    const sibling = await $.tool.call({ tool: 'Write', file_path: '/w/README.md', content: 'x' })
    expect(sibling.deny).toBeDefined()
    const outside = await $.tool.call({ tool: 'Write', file_path: '/etc/notes.md', content: 'x' })
    expect(outside.deny).toBeDefined()
  })
})

describe('free roles: no rails', () => {
  for (const role of ['orchestrator', 'coordinator']) {
    test(`${role}: merge, force-push and an outside write pass through`, async ($, on) => {
      world(on, { SEAT_MODS_ROLE: role })
      const merge = await $.tool.call({ tool: 'Bash', command: 'gh pr merge 1' })
      expect(merge.deny).toBeUndefined()
      const force = await $.tool.call({ tool: 'Bash', command: 'git push --force' })
      expect(force.deny).toBeUndefined()
      const outside = await $.tool.call({ tool: 'Write', file_path: '/var/seat-mods-x', content: 'x' })
      expect(outside.deny).toBeUndefined()
    })
  }
})

describe('invalid role: fail closed', () => {
  test('every tool call is denied with the bad value', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementr' })
    const r = await $.tool.call({ tool: 'Read', file_path: '/w/README.md' })
    expect(r.deny).toBeDefined()
    expect(r.deny).toContain('"implementr"')
  })
  for (const value of ['orchestrater', 'Orchestrator', 'orchestrator ', 'Coordinator']) {
    test(`${value}: denied as invalid, not free`, async ($, on) => {
      world(on, { SEAT_MODS_ROLE: value })
      const r = await $.tool.call({ tool: 'Write', file_path: '/w/README.md', content: 'x' })
      expect(r.deny).toBeDefined()
      expect(r.deny).toContain(`"${value}"`)
    })
  }
})

describe('Bash guards', () => {
  test('implementer: merge denied, commit and push allowed', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const merge = await $.tool.call({ tool: 'Bash', command: 'git merge main' })
    expect(merge.deny).toBeDefined()
    expect(merge.deny).toContain('seat-mods (implementer): no merges')
    const ok = await $.tool.call({ tool: 'Bash', command: 'git commit -m "merge the fix" && git push origin b' })
    expect(ok.deny).toBeUndefined()
  })
  test('verifier: push denied', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'verifier' })
    const r = await $.tool.call({ tool: 'Bash', command: 'git push origin b' })
    expect(r.deny).toBeDefined()
  })
  test('a trailer in the -F message file is denied (Review Focus 1)', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const r = await $.tool.call({ tool: 'Bash', command: 'git commit -F /w/msg-trailer.txt' })
    expect(r.deny).toBeDefined()
    expect(r.deny).toContain('AI trailers')
    const clean = await $.tool.call({ tool: 'Bash', command: 'git commit -F /w/README.md' })
    expect(clean.deny).toBeUndefined()
  })
  test('a trailer in a second -F file, or a quoted path with spaces, is denied (PR #644 review)', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const second = await $.tool.call({ tool: 'Bash', command: 'git commit -F /w/README.md && git commit -F /w/msg-trailer.txt' })
    expect(second.deny).toContain('AI trailers')
    const spaced = await $.tool.call({ tool: 'Bash', command: 'git commit -F "/w/seat x/msg.txt"' })
    expect(spaced.deny).toContain('AI trailers')
  })
})

describe('write placement', () => {
  test('reviewer: worktree denied, SEAT_MODS_ALLOW allowed, outside denied', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'reviewer', SEAT_MODS_ALLOW: '/reports' })
    const inside = await $.tool.call({ tool: 'Write', file_path: '/w/README.md', content: 'x' })
    expect(inside.deny).toBeDefined()
    expect(inside.deny).toContain('no edits in the worktree')
    const report = await $.tool.call({ tool: 'Write', file_path: '/reports/review.md', content: 'x' })
    expect(report.deny).toBeUndefined()
    const outside = await $.tool.call({ tool: 'Write', file_path: '/var/seat-mods-x', content: 'x' })
    expect(outside.deny).toBeDefined()
  })
  test('implementer: a new file in the worktree is allowed (Review Focus 3)', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const r = await $.tool.call({ tool: 'Write', file_path: '/w/seat-mods/not-there-yet.md', content: 'x' })
    expect(r.deny).toBeUndefined()
  })
  test('implementer: a .. path that leaves the worktree is denied (Review Focus 4)', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const r = await $.tool.call({ tool: 'Edit', file_path: '/w/seat-mods/../../escape.md', old_string: 'a', new_string: 'b' })
    expect(r.deny).toBeDefined()
  })
  test('implementer: a file in new nested folders inside the worktree is allowed (final review #1)', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const r = await $.tool.call({ tool: 'Write', file_path: '/w/newdir/sub/a.ts', content: 'x' })
    expect(r.deny).toBeUndefined()
  })
  test('implementer: .. under a folder that does not exist is denied, not appended as text', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const r = await $.tool.call({ tool: 'Write', file_path: '/w/newdir/../../escape.md', content: 'x' })
    expect(r.deny).toBeDefined()
  })
  test('reviewer: a SEAT_MODS_ALLOW directory not created yet still allows its report', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'reviewer', SEAT_MODS_ALLOW: '/reports/run-1' })
    const r = await $.tool.call({ tool: 'Write', file_path: '/reports/run-1/review.md', content: 'x' })
    expect(r.deny).toBeUndefined()
  })
  test('implementer: a Write through a dangling symlink is denied (PR #644 round 4)', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const r = await $.tool.call({ tool: 'Write', file_path: '/w/link', content: 'x' })
    expect(r.deny).toBeDefined()
  })
  test('implementer with no SEAT_MODS_ALLOW: the report directory is denied, naming the variable', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const r = await $.tool.call({ tool: 'Write', file_path: '/reports/report.md', content: 'x' })
    expect(r.deny).toBeDefined()
    expect(r.deny).toContain('SEAT_MODS_ALLOW')
  })
})
