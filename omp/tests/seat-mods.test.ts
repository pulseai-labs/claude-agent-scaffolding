import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { childRole, roleFor, writeTargets, guard, realOf, spawnDecision } from '../../seat-mods/omp/extension'

const deps = (over: Partial<Parameters<typeof guard>[0]> = {}) => ({
  env: { SEAT_MODS_ROLE: 'coordinator', SEAT_MODS_ALLOW: '/tmp/allow', HOME: '/home/u' } as Record<string, string | undefined>,
  cwd: '/repo/wt',
  worktree: async () => '/repo/wt',
  real: async (p: string) => (p.startsWith('/') ? p : `/repo/wt/${p}`),
  readFile: async () => '',
  ...over,
})
const child = (name: string) => ({ kind: 'sub', name })

describe('roles', () => {
  test('implementer, task and unknown children get the verifier profile (planner decision 1)', () => {
    expect(childRole('implementer')).toBe('verifier')
    expect(childRole('task')).toBe('verifier')
    expect(childRole('someone-else')).toBe('verifier')
    expect(childRole(undefined)).toBe('verifier')
  })
  test('reviewer and scout children get the reviewer profile', () => {
    expect(childRole('reviewer')).toBe('reviewer')
    expect(childRole('scout')).toBe('reviewer')
  })
  test('seat-reviewer child gets the reviewer profile and confines writes to SEAT_MODS_ALLOW', async () => {
    expect(childRole('seat-reviewer')).toBe('reviewer')
    expect(await guard(deps(), 'write', { path: '/tmp/allow/report.md' }, child('seat-reviewer'))).toBeUndefined()
    expect(await guard(deps(), 'write', { path: 'src/x.ts' }, child('seat-reviewer'))).toContain('no edits in the worktree')
  })
  test('the main session follows SEAT_MODS_ROLE', () => {
    expect(roleFor('coordinator', { kind: 'main' })).toEqual({ kind: 'free', role: 'coordinator' })
    expect(roleFor(undefined, { kind: 'main' })).toEqual({ kind: 'default', role: 'implementer' })
    expect(roleFor('bogus', { kind: 'main' })).toEqual({ kind: 'invalid', value: 'bogus' })
  })
  test('a child ignores the inherited env', () => {
    expect(roleFor('coordinator', child('implementer'))).toEqual({ kind: 'on', role: 'verifier' })
  })
})

describe('write targets', () => {
  test('edit with several paths yields each', () => {
    expect(writeTargets('edit', { path: 'a.txt', paths: ['a.txt', '/etc/x'] })).toEqual(['a.txt', '/etc/x'])
  })
  test('write yields path; read is not a write tool', () => {
    expect(writeTargets('write', { path: 'a.txt' })).toEqual(['a.txt'])
    expect(writeTargets('read', { path: 'a.txt' })).toBeUndefined()
  })
  test('ast_edit with no recognisable path yields an empty list (blocked as unchecked)', () => {
    expect(writeTargets('ast_edit', { pattern: 'x' })).toEqual([])
  })
})

describe('guard', () => {
  test('coordinator main session: push allowed', async () => {
    expect(await guard(deps(), 'bash', { command: 'git push origin HEAD' }, { kind: 'main' })).toBeUndefined()
  })
  test('implementer child: push, commit and task are blocked', async () => {
    expect(await guard(deps(), 'bash', { command: 'git push origin HEAD' }, child('implementer'))).toContain('no git push')
    expect(await guard(deps(), 'bash', { command: 'git commit -m x' }, child('implementer'))).toContain('no git commit')
    expect(await guard(deps(), 'task', { agent: 'task' }, child('implementer'))).toContain('may not spawn')
  })
  test('implementer child: a multi-file edit with one path outside the worktree is blocked', async () => {
    expect(await guard(deps(), 'edit', { paths: ['a.txt', '/etc/passwd'] }, child('implementer'))).toContain('no writes outside')
  })
  test('reviewer child: eval and debug blocked; write only in SEAT_MODS_ALLOW', async () => {
    expect(await guard(deps(), 'eval', { language: 'py', code: 'print(1)' }, child('reviewer'))).toContain('may not run')
    expect(await guard(deps(), 'debug', {}, child('reviewer'))).toContain('may not run')
    expect(await guard(deps(), 'write', { path: '/tmp/allow/report.md' }, child('reviewer'))).toBeUndefined()
    expect(await guard(deps(), 'write', { path: 'src/x.ts' }, child('reviewer'))).toContain('no edits in the worktree')
  })
  test('implementer child: eval source naming a push is blocked (best effort)', async () => {
    const argv = "import subprocess; subprocess.run(['git', 'push'])"
    expect(await guard(deps(), 'eval', { language: 'py', code: argv }, child('implementer'))).toContain('no git push')
    expect(await guard(deps(), 'eval', { language: 'py', code: 'import os; os.system("git push origin HEAD")' }, child('implementer'))).toContain('no git push')
    expect(await guard(deps(), 'eval', { language: 'py', code: 'print(1 + 1)' }, child('implementer'))).toBeUndefined()
  })
  test('implementer child: rm of a ~ path is read against HOME, not the worktree', async () => {
    expect(await guard(deps(), 'bash', { command: 'rm ~/x' }, child('implementer'))).toContain('no rm outside')
    expect(await guard(deps({ env: { SEAT_MODS_ROLE: 'coordinator' } }), 'bash', { command: 'rm ~/x' }, child('implementer'))).toContain('could not be checked')
    expect(await guard(deps(), 'bash', { command: 'rm junk.txt' }, child('implementer'))).toBeUndefined()
  })
  test('a path whose real() is unresolvable (a .. below a link) is denied for write, edit and rm', async () => {
    const seen: string[] = []
    const d = deps({ real: async (p: string) => { seen.push(p); return p.includes('..') ? undefined : p.startsWith('/') ? p : `/repo/wt/${p}` } })
    expect(await guard(d, 'write', { path: 'link/../x' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(d, 'edit', { paths: ['link/../x'] }, child('implementer'))).toContain('no writes outside')
    expect(await guard(d, 'bash', { command: 'rm link/../x' }, child('implementer'))).toContain('no rm outside')
    expect(seen).toContain('/repo/wt/link/../x') // the raw absolute path reaches real(), not a collapsed one
  })
  test('rm resolves the parent and keeps the final component literal', async () => {
    const seen: string[] = []
    const d = deps({ real: async (p: string) => { seen.push(p); return p === '/repo/wt/sub' ? '/outside' : p } })
    expect(await guard(d, 'bash', { command: 'rm sub/f' }, child('implementer'))).toContain('no rm outside')
    expect(seen).toContain('/repo/wt/sub')
  })
  test('a missing agent is guarded as a child, whatever SEAT_MODS_ROLE says', async () => {
    expect(roleFor('coordinator', undefined)).toEqual({ kind: 'on', role: 'verifier' })
    expect(await guard(deps(), 'bash', { command: 'git push origin HEAD' }, undefined)).toContain('no git push')
    expect(await guard(deps(), 'bash', { command: 'git push origin HEAD' }, { kind: 'main' })).toBeUndefined()
  })
  test('invalid SEAT_MODS_ROLE blocks every call', async () => {
    expect(await guard(deps({ env: { SEAT_MODS_ROLE: 'bogus' } }), 'read', { path: 'a' }, { kind: 'main' })).toContain('is not a role')
  })
})

describe('realOf on a real file system', () => {
  // bun's realpathSync collapses `..` lexically, before the kernel follows a link: link/.. read as the
  // link's own folder. (Paths are built with template strings: path.join would collapse the `..` itself.) The live OMP run (omp 18.8.9) let a child write through `link/../x.txt` until realOf walked `..` itself.
  const fx = realpathSync(mkdtempSync(join(tmpdir(), 'realof-')))
  mkdirSync(join(fx, 'repo', 'src'), { recursive: true })
  mkdirSync(join(fx, 'outside'))
  symlinkSync(join(fx, 'outside'), join(fx, 'repo', 'link'))
  writeFileSync(join(fx, 'repo', 'a.txt'), 'a')
  symlinkSync(join(fx, 'outside', 'new.txt'), join(fx, 'repo', 'dl')) // dangling: a write through it creates outside/new.txt
  symlinkSync(join(fx, 'repo', 'dl'), join(fx, 'repo', 'll')) // a link to the dangling link
  test('.. below a link is read where the kernel lands: beside the link target, not beside the link', () => {
    expect(realOf(`${fx}/repo/link/../x.txt`)).toBe(join(fx, 'x.txt'))
    expect(realOf(`${fx}/repo/link/../repo/a.txt`)).toBe(join(fx, 'repo', 'a.txt'))
  })
  test('a guard over the real file system denies a child write through link/../x.txt but not src/../x.txt', async () => {
    const d = deps({ cwd: join(fx, 'repo'), worktree: async () => join(fx, 'repo'), real: async (p: string) => realOf(p), env: { SEAT_MODS_ROLE: 'coordinator' } })
    expect(await guard(d, 'write', { path: `${fx}/repo/link/../x.txt` }, child('task'))).toContain('no writes outside')
    expect(await guard(d, 'write', { path: `${fx}/repo/src/../x.txt` }, child('task'))).toBeUndefined()
  })
  test('plain paths are unchanged: an existing file, a new file in an existing folder, a link', () => {
    expect(realOf(join(fx, 'repo', 'a.txt'))).toBe(join(fx, 'repo', 'a.txt'))
    expect(realOf(join(fx, 'repo', 'src', 'new', 'b.txt'))).toBe(join(fx, 'repo', 'src', 'new', 'b.txt'))
    expect(realOf(join(fx, 'repo', 'link', 'f.txt'))).toBe(join(fx, 'outside', 'f.txt'))
  })
  test('.. below a folder that does not exist cannot be resolved', () => {
    expect(realOf(`${fx}/repo/nope/../x.txt`)).toBeUndefined()
  })
  test('a dangling link as the final component is unresolvable, directly and through another link', () => {
    expect(realOf(`${fx}/repo/dl`)).toBeUndefined()
    expect(realOf(`${fx}/repo/ll`)).toBeUndefined()
    expect(realOf(`${fx}/repo/dl/../x`)).toBeUndefined()
  })
  test('a guard over the real file system denies a child write to a dangling link', async () => {
    const d = deps({ cwd: join(fx, 'repo'), worktree: async () => join(fx, 'repo'), real: async (p: string) => realOf(p), env: { SEAT_MODS_ROLE: 'coordinator' } })
    expect(await guard(d, 'write', { path: `${fx}/repo/dl` }, child('task'))).toContain('no writes outside')
    expect(await guard(d, 'write', { path: 'll' }, child('task'))).toContain('no writes outside')
  })
  test('a relative path with a .. component is unresolvable (no lexical collapse)', () => {
    expect(realOf('repo/link/../x.txt')).toBeUndefined()
    expect(realOf('../x.txt')).toBeUndefined()
  })
})

describe('edit destinations (fix wave 1)', () => {
  test('the target set is the union of path, paths, rename, edits[].path, edits[].rename and every hashline MV line', () => {
    expect(writeTargets('edit', { path: 'a.ts', edits: [{ path: '/o/b.ts', rename: '/o/c.ts' }, 'junk'], rename: '/o/d.ts', input: '[a.ts]\n  MV /o/e.ts \nnot MV /o/f.ts\n' }))
      .toEqual(['a.ts', '/o/d.ts', '/o/b.ts', '/o/c.ts', '/o/e.ts'])
    expect(writeTargets('write', { path: 'a.ts', rename: '/o/x' })).toEqual(['a.ts'])
  })
  test("apply_patch input names its files in `*** Add/Update/Delete File:` and `*** Move to:` lines", () => {
    const input = '*** Begin Patch\n*** Update File: src/a.py\n*** Move to: /o/b.py\n@@\n-x\n+y\n*** Add File: /o/c.py\n+z\n*** Delete File: /o/d.py\n*** End Patch'
    expect(writeTargets('edit', { input })).toEqual(['src/a.py', '/o/b.py', '/o/c.py', '/o/d.py'])
  })
  test('an implementer child cannot MV out of the worktree, nor rename through edits[]', async () => {
    expect(await guard(deps(), 'edit', { paths: ['src/a.ts'], input: '[src/a.ts]\nMV /outside/a.ts' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { path: 'a.ts', edits: [{ path: '/outside/b.ts' }] }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { path: 'a.ts', edits: [{ path: 'a.ts', rename: '/outside/c.ts' }] }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { path: 'a.ts', input: '[a.ts]\nMV b.ts' }, child('implementer'))).toBeUndefined()
  })
  test('a reviewer with a header in SEAT_MODS_ALLOW cannot MV into the worktree', async () => {
    expect(await guard(deps(), 'edit', { paths: ['/tmp/allow/r.md'], input: '[/tmp/allow/r.md]\nMV src/r.md' }, child('reviewer'))).toContain('no edits in the worktree')
  })
})

describe('bash cwd (fix wave 2)', () => {
  const norm = (over = {}) => deps({ real: async (p: string) => (p.includes('/link') ? resolve(p).replace('/repo/wt/link', '/outside/dir') : resolve(p)), ...over })
  test('rm resolves against the call cwd, not the session cwd', async () => {
    expect(await guard(norm(), 'bash', { command: 'rm -rf build', cwd: '/outside' }, child('implementer'))).toContain('no rm outside')
    expect(await guard(norm(), 'bash', { command: 'rm -rf build', cwd: '/repo/wt/sub' }, child('implementer'))).toBeUndefined()
    expect(await guard(norm(), 'bash', { command: 'rm ../../x', cwd: 'sub' }, child('implementer'))).toContain('no rm outside')
  })
  test('a cwd that is a link out of the worktree is followed', async () => {
    expect(await guard(norm(), 'bash', { command: 'rm x', cwd: 'link' }, child('implementer'))).toContain('no rm outside')
  })
  test('a commit message file is read against the call cwd', async () => {
    const seen: string[] = []
    const d = norm({ readFile: async (f: string) => { seen.push(f); return '' } })
    await guard(d, 'bash', { command: 'git commit -F msg.txt', cwd: '/other' }, child('implementer'))
    expect(seen).toEqual(['/other/msg.txt'])
  })
})

describe('spawn through eval agent() and workpool (fix wave 3)', () => {
  test('a child spawning is blocked with the spawn text; the main session is not; a missing agent is a child', () => {
    expect(spawnDecision({ kind: 'sub', name: 'implementer' })).toEqual({ block: true, reason: 'seat-mods (verifier): no subagents — this seat may not spawn; report it instead.' })
    expect(spawnDecision({ kind: 'sub', name: 'reviewer' })).toMatchObject({ block: true, reason: expect.stringContaining('seat-mods (reviewer)') })
    expect(spawnDecision(undefined)).toMatchObject({ block: true })
    expect(spawnDecision({ kind: 'main' })).toBeUndefined()
  })
})

describe('mutating tools (fix wave 5)', () => {
  test('github pr_create and pr_push are denied for verifier and reviewer children, pr_push is free for an implementer main', async () => {
    expect(await guard(deps(), 'github', { op: 'pr_create', title: 't' }, child('task'))).toContain('no gh pr create')
    expect(await guard(deps(), 'github', { op: 'pr_push' }, child('task'))).toContain('no git push')
    expect(await guard(deps(), 'github', { op: 'pr_push' }, child('reviewer'))).toContain('seat-mods (reviewer)')
    expect(await guard(deps({ env: { SEAT_MODS_ROLE: 'implementer' } }), 'github', { op: 'pr_push' }, { kind: 'main' })).toBeUndefined()
    expect(await guard(deps(), 'github', { op: 'search_prs', query: 'x' }, child('task'))).toBeUndefined()
  })
  test('forceWithLease is denied for every guarded role, and free for a coordinator', async () => {
    const call = { op: 'pr_push', forceWithLease: true }
    expect(await guard(deps({ env: { SEAT_MODS_ROLE: 'implementer' } }), 'github', call, { kind: 'main' })).toContain('no force-push')
    expect(await guard(deps(), 'github', call, child('task'))).toBeDefined()
    expect(await guard(deps(), 'github', call, { kind: 'main' })).toBeUndefined()
  })
  test('lsp write operations are denied under reviewer rails; reads are not; other roles are untouched', async () => {
    for (const action of ['rename', 'rename_file', 'code_actions', 'request'])
      expect(await guard(deps(), 'lsp', { action, file: 'a.ts' }, child('reviewer'))).toContain('no edits in the worktree')
    for (const action of ['hover', 'definition', 'references', 'diagnostics', 'symbols'])
      expect(await guard(deps(), 'lsp', { action, file: 'a.ts' }, child('reviewer'))).toBeUndefined()
    expect(await guard(deps(), 'lsp', { action: 'rename', file: 'a.ts' }, { kind: 'main' })).toBeUndefined() // coordinator
  })
})

describe('narrow fix: omp spellings of MV, headers and cwd', () => {
  test("MV destinations are read as omp's AXo does: a trailing #hhhh is cut, then one pair of matching quotes", () => {
    const mv = (dest: string) => writeTargets('edit', { input: `[a.ts]\nMV ${dest}` })
    expect(mv('"../out/m.txt"')).toEqual(['a.ts', '../out/m.txt'])
    expect(mv("'/outside/m.txt'")).toEqual(['a.ts', '/outside/m.txt'])
    expect(mv('/outside/m.txt#abcd')).toEqual(['a.ts', '/outside/m.txt'])
    expect(mv('"/outside/m.txt"#AB12')).toEqual(['a.ts', '/outside/m.txt'])
    expect(mv('"half')).toEqual(['a.ts', '"half'])
    expect(mv('x#abc')).toEqual(['a.ts', 'x#abc'])
  })
  test('an implementer child cannot MV out through a quoted or hashed destination', async () => {
    for (const dest of ['"../out/m.txt"', "'/outside/m.txt'", '/outside/m.txt#abcd'])
      expect(await guard(deps({ real: async (p: string) => resolve(p) }), 'edit', { path: 'a.ts', input: `[a.ts]\nMV ${dest}` }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { path: 'a.ts', input: '[a.ts]\nMV "b.ts"#abcd' }, child('implementer'))).toBeUndefined()
  })
  test('hashline [file] and ¶file headers and sloppy *** Edit File: headers are write targets', async () => {
    expect(writeTargets('edit', { input: '[/o/h.ts]\n 1ab|x\n¶ "/o/p.ts"#abcd\n' })).toEqual(['/o/h.ts', '/o/p.ts'])
    expect(writeTargets('edit', { input: '*** Edit File: /o/s.ts\n*** Find\nx\n*** Replace\ny' })).toEqual(['/o/s.ts'])
    expect(await guard(deps(), 'edit', { input: '[/outside/h.ts]\nx' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { input: '*** Edit File: /outside/s.ts\n*** Find\nx' }, child('implementer'))).toContain('no writes outside')
  })
  test('a bash cwd is read as omp reads it: ~, ~user, @/abs, file://, a leading :, and / for the session cwd', async () => {
    const d = () => deps({ real: async (p: string) => resolve(p) })
    for (const cwd of ['~', '~/x', '~user', '@/outside', 'file:///outside', ':/outside', '/outside'])
      expect(await guard(d(), 'bash', { command: 'rm -rf x', cwd }, child('implementer'))).toContain('no rm outside')
    expect(await guard(d(), 'bash', { command: 'rm -rf x', cwd: '/' }, child('implementer'))).toBeUndefined()
    expect(await guard(d(), 'bash', { command: 'rm -rf x', cwd: 'sub/../..' }, child('implementer'))).toContain('no rm outside')
    expect(await guard(d(), 'bash', { command: 'rm -rf x', cwd: 'sub' }, child('implementer'))).toBeUndefined()
  })
  test('a cwd that needs HOME fails closed when HOME is missing', async () => {
    expect(await guard(deps({ env: { SEAT_MODS_ROLE: 'coordinator' } }), 'bash', { command: 'rm -rf x', cwd: '~' }, child('implementer'))).toContain('could not be checked')
  })
  test('a commit message file is read against the normalised cwd', async () => {
    const seen: string[] = []
    const d = deps({ readFile: async (f: string) => { seen.push(f); return '' } })
    for (const cwd of ['file:///other', '@/other', ':/other', '~/m']) await guard(d, 'bash', { command: 'git commit -F msg.txt', cwd }, child('implementer'))
    expect(seen).toEqual(['/other/msg.txt', '/other/msg.txt', '/other/msg.txt', '/home/u/m/msg.txt'])
  })
})

describe('last fix: omp\'s lenient header detection', () => {
  test('headers match omp case-insensitively with any spacing, and a leading BOM is dropped', async () => {
    for (const input of ['*** edit file: /outside/x\n*** Find\nx', '***  Edit  File: /outside/x\n*** Find\nx', '*** Update File: a.ts\n*** move to: /outside/y',
      '*** UPDATE FILE:/outside/x', '\uFEFF[/outside/x]\nbody'])
      expect(await guard(deps(), 'edit', { input }, child('implementer'))).toContain('no writes outside')
    expect(writeTargets('edit', { input: '***\tEdit\tFile:\t/o/t.ts' })).toEqual(['/o/t.ts'])
    expect(writeTargets('edit', { input: '\uFEFF[/o/b.ts]' })).toEqual(['/o/b.ts'])
  })
  test('a lower-case header inside the worktree is still allowed', async () => {
    expect(await guard(deps(), 'edit', { input: '*** edit file: src/a.ts\n*** Find\nx' }, child('implementer'))).toBeUndefined()
    expect(await guard(deps(), 'edit', { input: '\uFEFF[src/a.ts]\nbody' }, child('implementer'))).toBeUndefined()
  })
})

describe('PR 762 round 1: URL-scheme write targets', () => {
  // omp redirects local:// (and vault://, ssh://, cfg://, ...) to backing files outside the worktree, so a scheme
  // target must never be read as the synthetic path `<cwd>/local:/x` (inside the tree).
  test('an implementer child cannot write through local://, whichever tool carries it', async () => {
    expect(await guard(deps(), 'write', { path: 'local://report.md', content: 'x' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { path: 'local://x' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'ast_edit', { path: 'local://x', pattern: 'a', rewrite: 'b' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { path: 'a.ts', input: '[a.ts]\nMV local://x' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { input: '*** Update File: a.ts\n*** Move to: local://x' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { input: '*** Add File: local://x\n+z' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { input: '[local://x]\nbody' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { path: 'a.ts', edits: [{ path: 'a.ts', rename: 'local://x' }] }, child('implementer'))).toContain('no writes outside')
  })
  test('every omp writable scheme is outside, and so are the spellings omp normalises to one', async () => {
    for (const path of ['vault://n.md', 'ssh://host/x', 'cfg://k', 'conflict://1', 'agent://a', 'proc://p', 'xd://bash', 'xd://report_issue', 'xd://propose',
      'LOCAL://x', 'local:/x', 'sub/local://x', './local://x', '@local://x', ' local://x', 'xd://resolve/x', 'xd://resolve2', 'xd://Resolve'])
      expect(await guard(deps(), 'write', { path, content: 'x' }, child('implementer'))).toContain('no writes outside')
  })
  test('xd://resolve and xd://reject only confirm or discard a preview a guarded call already staged, so the write tool may carry them', async () => {
    for (const path of ['xd://resolve', 'xd://reject', ' xd://resolve '])
      expect(await guard(deps(), 'write', { path, content: 'apply the preview' }, child('implementer'))).toBeUndefined()
    // adjacent control: the same confirm is not a way to name a file through any other tool or field
    expect(await guard(deps(), 'edit', { path: 'xd://resolve' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { path: 'a.ts', input: '[a.ts]\nMV xd://resolve' }, child('implementer'))).toContain('no writes outside')
    // the confirm names no file: a reviewer whose preview was staged in SEAT_MODS_ALLOW can apply or clear it (PR 762 round 5)
    for (const path of ['xd://resolve', 'xd://reject'])
      expect(await guard(deps(), 'write', { path, content: 'x' }, child('reviewer'))).toBeUndefined()
    expect(await guard(deps(), 'write', { path: 'xd://bash', content: '{}' }, child('reviewer'))).toContain('no writes outside')
    expect(await guard(deps(), 'write', { path: 'xd://propose', content: 'x' }, child('reviewer'))).toBeDefined()
  })
  test('an ordinary in-worktree write is still allowed, and a coordinator is free to use local://', async () => {
    expect(await guard(deps(), 'write', { path: 'src/a.ts', content: 'x' }, child('implementer'))).toBeUndefined()
    expect(await guard(deps(), 'write', { path: '/repo/wt/src/a.ts', content: 'x' }, child('implementer'))).toBeUndefined()
    expect(await guard(deps(), 'write', { path: 'local://x', content: 'x' }, { kind: 'main' })).toBeUndefined()
    expect(await guard(deps(), 'edit', { path: 'local://x' }, { kind: 'main' })).toBeUndefined()
  })
  test('an implementer main session (default rails) is guarded the same way', async () => {
    const env = { HOME: '/home/u' } as Record<string, string | undefined>
    expect(await guard(deps({ env }), 'write', { path: 'local://x', content: 'x' }, { kind: 'main' })).toContain('no writes outside')
  })
})

describe('PR 762 round 2: an allow list of omp tools, and one omp path normaliser', () => {
  const coord = { kind: 'main' } // deps() sets SEAT_MODS_ROLE=coordinator
  const implMain = deps({ env: { SEAT_MODS_ROLE: 'implementer', HOME: '/home/u' } })
  test('finding 1: a write target is read as omp reads it: hashline [path#hash] unwrapped, ~, @/, :/ and file:// expanded', async () => {
    for (const path of ['[/outside/x#ABCD]', '[/tmp/out]', '~/x', '~', '~user/x', '@/outside/x', ':/outside/x', 'file:///outside/x', ' [/outside/x#abcd] '])
      for (const tool of ['write', 'edit', 'ast_edit'])
        expect(await guard(deps(), tool, { path, content: 'x' }, child('task'))).toContain('no writes outside')
    // adjacent controls: the same spellings inside the worktree still pass
    for (const path of ['[src/a.ts#ABCD]', '[src/a.ts]', '@src/a.ts', 'src/a.ts', ':./src/a.ts', 'file:///repo/wt/src/a.ts'])
      expect(await guard(deps(), 'write', { path, content: 'x' }, child('task'))).toBeUndefined()
  })
  test('finding 1: a hashline header or MV destination spelled with ~, @/ or :/ is outside', async () => {
    expect(await guard(deps(), 'edit', { input: '[~/x.ts]\nbody' }, child('task'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { input: '[a.ts]\nMV @/outside/m.ts' }, child('task'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { input: '*** Add File: :/outside/x\n+z' }, child('task'))).toContain('no writes outside')
  })
  test('finding 2: lsp passes only omp\'s read-only actions under guarded rails, verifier included', async () => {
    for (const action of ['rename_file', 'rename', 'code_actions', 'request', 'reload', 'RENAME_FILE', 'made_up'])
      for (const who of [child('task'), child('implementer'), child('reviewer')])
        expect(await guard(deps(), 'lsp', { action, file: 'src/a', new_name: '/tmp/a' }, who)).toBeDefined()
    for (const action of ['diagnostics', 'definition', 'type_definition', 'implementation', 'references', 'hover', 'symbols', 'status', 'capabilities', 'Hover'])
      expect(await guard(deps(), 'lsp', { action, file: 'src/a.ts' }, child('task'))).toBeUndefined()
  })
  test('finding 3: github pr_checkout and any op outside omp\'s read-only set is denied; reads pass', async () => {
    expect(await guard(deps(), 'github', { op: 'pr_checkout', pr: '1', force: true }, child('task'))).toContain('no writes outside')
    expect(await guard(implMain, 'github', { op: 'pr_checkout', pr: '1' }, { kind: 'main' })).toContain('no writes outside')
    expect(await guard(deps(), 'github', { op: 'issue_close' }, child('task'))).toContain('not allowed for this seat')
    for (const op of ['repo_view', 'file_read', 'search_issues', 'search_prs', 'search_code', 'search_commits', 'search_repos', 'run_watch'])
      expect(await guard(deps(), 'github', { op }, child('task'))).toBeUndefined()
    expect(await guard(deps(), 'github', { op: 'search_prs', forceWithLease: true }, child('task'))).toContain('no force-push')
  })
  test('finding 4: apply_patch is the edit tool under its wire name, and is placed the same way', async () => {
    expect(await guard(deps(), 'apply_patch', { input: '*** Begin Patch\n*** Add File: /outside/x\n+z\n*** End Patch' }, child('task'))).toContain('no writes outside')
    expect(await guard(deps(), 'apply_patch', { input: '*** Begin Patch\n*** Update File: src/a.ts\n*** Move to: /outside/b.ts\n*** End Patch' }, child('task'))).toContain('no writes outside')
    // `_input` / `_path` are the forwarded spellings omp's event normaliser reads; a valid `path` beside them keeps the target list non-empty
    expect(await guard(deps(), 'edit', { path: 'src/a.ts', _input: '*** Begin Patch\n*** Add File: /outside/x\n+z\n*** End Patch' }, child('task'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { path: 'src/a.ts', _path: '/outside/x' }, child('task'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { path: 'src/a.ts', _input: '*** Begin Patch\n*** Add File: src/b.ts\n+z' }, child('task'))).toBeUndefined()
    expect(await guard(deps(), 'apply_patch', { input: '*** Begin Patch\n*** Add File: src/new.ts\n+z\n*** End Patch' }, child('task'))).toBeUndefined()
    expect(await guard(deps(), 'apply_patch', { input: 'no headers' }, child('task'))).toContain('no writes outside')
  })
  test('finding 5: a bash cwd that is an omp URL is outside: rm in it is denied, a -F file in it cannot be read', async () => {
    for (const cwd of ['local://scratch', 'local:/scratch', 'vault://n', '@local://x'])
      expect(await guard(deps(), 'bash', { command: 'rm -rf x', cwd }, child('task'))).toContain('no rm outside')
    expect(await guard(deps(), 'bash', { command: 'git commit -F msg.txt', cwd: 'local://scratch' }, coord)).toBeUndefined() // control: a coordinator is free
    expect(await guard(implMain, 'bash', { command: 'git commit -F msg.txt', cwd: 'local://scratch' }, { kind: 'main' })).toContain('could not be checked')
    expect(await guard(deps(), 'bash', { command: 'ls', cwd: 'local://scratch' }, child('task'))).toBeUndefined()
  })
  test('ast_edit scopes are split and globbed as omp reads them', async () => {
    for (const paths of [['src/a.ts /outside/b.ts'], ['src/a.ts,/outside/b.ts'], ['{src,/outside}/*.ts'], ['src/*/../../../x/*.ts'], ['/outside/**/*.ts'], ['"/outside/b.ts"']])
      expect(await guard(deps(), 'ast_edit', { paths, pattern: 'a', rewrite: 'b' }, child('task'))).toContain('no writes outside')
    for (const paths of [['src/**/*.ts'], ['src/a.ts, src/b.ts'], ['{src,test}/*.ts'], ['*.ts']])
      expect(await guard(deps(), 'ast_edit', { paths, pattern: 'a', rewrite: 'b' }, child('task'))).toBeUndefined()
  })
  test('a tool name off the allow list is denied for a child and a guarded main; a coordinator is free', async () => {
    for (const name of ['browser', 'computer', 'notebook_edit', 'generate_image', 'tts', 'checkpoint', 'rewind', 'manage_skill', 'learn', 'retain',
      'memory_edit', 'security_scan', 'ida', 'vibe_spawn', 'mcp__srv_tool', 'made_up_tool', 'constructor', '__proto__', 'hasOwnProperty', 'Read']) {
      expect(await guard(deps(), name, {}, child('task'))).toContain('not allowed for this seat')
      expect(await guard(implMain, name, {}, { kind: 'main' })).toContain('not allowed for this seat')
      expect(await guard(deps(), name, {}, coord)).toBeUndefined()
    }
  })
  test('every allow-listed read tool passes for a child of either profile', async () => {
    for (const name of ['read', 'grep', 'glob', 'find', 'ast_grep', 'web_search', 'recall', 'todo', 'wait', 'yield', 'think', 'advise'])
      for (const who of [child('task'), child('reviewer')])
        expect(await guard(deps(), name, { path: '/anywhere' }, who)).toBeUndefined()
  })
  test('ask, goal and task are top-level only: a child is denied, a guarded main is not', async () => {
    for (const name of ['ask', 'goal']) {
      expect(await guard(deps(), name, {}, child('task'))).toContain('not allowed for this seat')
      expect(await guard(implMain, name, {}, { kind: 'main' })).toBeUndefined()
    }
    expect(await guard(implMain, 'task', { agent: 'implementer' }, { kind: 'main' })).toBeUndefined()
  })
  test('debug runs a program: denied under verifier rails; under implementer rails its launch is scanned like eval', async () => {
    expect(await guard(deps(), 'debug', { action: 'launch', program: 'node' }, child('task'))).toContain('may not run code')
    expect(await guard(implMain, 'debug', { action: 'launch', program: 'git', args: ['push', '--force'] }, { kind: 'main' })).toContain('no force-push')
    expect(await guard(implMain, 'debug', { action: 'launch', program: 'node', args: ['x.js'] }, { kind: 'main' })).toBeUndefined()
  })
  test('a coordinator is free for every surface above', async () => {
    expect(await guard(deps(), 'write', { path: '[/outside/x#ABCD]', content: 'x' }, coord)).toBeUndefined()
    expect(await guard(deps(), 'lsp', { action: 'rename_file', file: 'a', new_name: '/tmp/a' }, coord)).toBeUndefined()
    expect(await guard(deps(), 'github', { op: 'pr_checkout', force: true }, coord)).toBeUndefined()
    expect(await guard(deps(), 'apply_patch', { input: '*** Add File: /outside/x' }, coord)).toBeUndefined()
    expect(await guard(deps(), 'bash', { command: 'rm -rf x', cwd: 'local://scratch' }, coord)).toBeUndefined()
    expect(await guard(deps(), 'ask', {}, coord)).toBeUndefined()
  })
  test('ordinary in-worktree work still passes for a child', async () => {
    expect(await guard(deps(), 'write', { path: 'src/a.ts', content: 'x' }, child('implementer'))).toBeUndefined()
    expect(await guard(deps(), 'edit', { path: 'src/a.ts', edits: [{ old_text: 'a', new_text: 'b' }] }, child('implementer'))).toBeUndefined()
    expect(await guard(deps(), 'edit', { input: '[src/a.ts#ABCD]\n 1ab|x' }, child('implementer'))).toBeUndefined()
    expect(await guard(deps(), 'bash', { command: 'bun test && rm -rf build', cwd: 'sub' }, child('implementer'))).toBeUndefined()
    expect(await guard(deps(), 'eval', { language: 'py', code: 'print(1)' }, child('implementer'))).toBeUndefined()
  })
})

describe('PR 762 round 3: every path from a tool input goes through the one omp reading', () => {
  const impl = (over = {}) => deps({ env: { SEAT_MODS_ROLE: 'implementer', HOME: '/home/u' }, ...over })
  test('an rm operand carrying a URL scheme is outside: omp\'s embedded coreutils route it to the backing file', async () => {
    for (const operand of ['local://x', 'vault://x', 'local://scratch/out', 'local:/x', 'sub/local://x', "'local://x'"]) {
      expect(await guard(deps(), 'bash', { command: `rm ${operand}` }, child('task'))).toContain('no rm outside')
      expect(await guard(impl(), 'bash', { command: `rm -rf ${operand}` }, { kind: 'main' })).toContain('no rm outside')
    }
    expect(await guard(deps(), 'bash', { command: 'rm build/out.txt' }, child('task'))).toBeUndefined() // control
  })
  test('git commit -F ~/msg reads $HOME/msg, so a trailer there is denied for an implementer main session', async () => {
    const files: Record<string, string> = { '/home/u/msg': 'x\n\nCo-Authored-By: bot <b@x>\n', '/repo/wt/msg': 'clean\n' }
    const d = impl({ readFile: async (f: string) => files[f] ?? Promise.reject(new Error('ENOENT')) })
    expect(await guard(d, 'bash', { command: 'git commit -F ~/msg' }, { kind: 'main' })).toContain('no AI trailers')
    expect(await guard(d, 'bash', { command: 'git commit --file=~/msg' }, { kind: 'main' })).toContain('no AI trailers')
    expect(await guard(d, 'bash', { command: 'git commit -F msg' }, { kind: 'main' })).toBeUndefined() // control: in-worktree file, clean
  })
  test('a quoted "~/msg" is read literally under the cwd (as well as against HOME, the strictest reading winning)', async () => {
    const seen: string[] = []
    const d = impl({ readFile: async (f: string) => { seen.push(f); return '' } })
    expect(await guard(d, 'bash', { command: 'git commit -F "~/msg"' }, { kind: 'main' })).toBeUndefined()
    expect(seen).toContain('/repo/wt/~/msg')
  })
  test('a -F file with a URL scheme, or a ~ file without HOME, cannot be checked', async () => {
    expect(await guard(impl(), 'bash', { command: 'git commit -F local://msg' }, { kind: 'main' })).toContain('could not be checked')
    expect(await guard(deps({ env: { SEAT_MODS_ROLE: 'implementer' } }), 'bash', { command: 'git commit -F ~/msg' }, { kind: 'main' })).toContain('could not be checked')
    expect(await guard(impl(), 'bash', { command: 'git commit -F ~bob/msg' }, { kind: 'main' })).toContain('could not be checked') // another user's home is not known here
  })
  test('debug resolves its cwd as omp does, so a launch scanned for rm is placed there', async () => {
    expect(await guard(impl(), 'debug', { action: 'launch', program: 'rm', args: ['-rf', 'x'], cwd: 'local://s' }, { kind: 'main' })).toContain('no rm outside')
    expect(await guard(impl(), 'debug', { action: 'launch', program: 'rm', args: ['-rf', 'x'], cwd: '~/w' }, { kind: 'main' })).toContain('no rm outside')
    expect(await guard(impl(), 'debug', { action: 'launch', program: 'rm', args: ['-rf', 'x'], cwd: 'sub' }, { kind: 'main' })).toBeUndefined()
  })
  test('rm / is not read as the session cwd (omp\'s `/` rule is for its own path arguments, not shell operands)', async () => {
    expect(await guard(deps(), 'bash', { command: 'rm -rf /' }, child('task'))).toContain('no rm outside')
  })
})

describe('PR 762 round 5: a glob scope at the filesystem root is the root, not the session cwd', () => {
  test('an ast_edit scope whose glob starts at / is outside for a task child', async () => {
    for (const scope of ['/*.ts', '/{etc,home}/**/*.conf', '/*/u/proj/*.ts', '@/*.ts', ':/*.ts'])
      expect(await guard(deps(), 'ast_edit', { paths: [scope], pattern: 'a', rewrite: 'b' }, child('task'))).toContain('no writes outside')
    expect(await guard(deps(), 'ast_edit', { paths: ['src/**/*.ts'], pattern: 'a', rewrite: 'b' }, child('task'))).toBeUndefined()
  })
})
