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
  // seat-mods batch 5 (Task 5): an operand after a literal cd or variable arrives absolute; the call cwd is not joined to it
  test('rm after a literal cd or variable is placed where Bash removes it', async () => {
    const bash = (command: string, cwd?: string) => guard(norm(), 'bash', cwd === undefined ? { command } : { command, cwd }, child('implementer'))
    for (const [command, cwd] of [['cd /repo/wt/sub && rm -rf build'], ['WT=/repo/wt; rm -rf "$WT/build"'], ['cd /repo/wt && rm -rf build', '/outside'],
      ['cd /repo/wt/sub && rm -rf ../build']] as const)
      expect(await bash(command, cwd)).toBeUndefined()
    for (const [command, cwd] of [['cd /etc && rm -rf x'], ['WT=/etc; rm -rf "$WT/x"'], ['cd /repo/wt/sub && rm -rf ../../x'], ['cd /etc && rm -rf x', '/repo/wt']] as const)
      expect(await bash(command, cwd)).toContain('no rm outside')
    expect(await bash('cd /repo/wt || true; rm -rf build')).toContain('cannot resolve')
  })
  // seat-mods Ruling 21: the bare operand of a cd that may fail is joined to the call's folder, here the worktree
  test('reviewer: a cd before `;` that may fail is refused; the same removal behind && is allowed', async () => {
    const bash = (command: string) => guard(norm(), 'bash', { command }, child('reviewer'))
    for (const command of ['cd /tmp/typo; rm -rf build', 'cd /tmp/x; rm -rf *']) expect(await bash(command)).toContain('no rm outside')
    for (const command of ['cd /tmp/typo && rm -rf build', 'cd /tmp/x && rm -rf *']) expect(await bash(command)).toBeUndefined()
  })
  // seat-mods fix round 1 (finding 3): omp reads a leading `~`, `@` or `:` in a path, so a relative cd arrives as `./…`
  test('reviewer: a relative cd to "~", "@" or ":~" is placed in the call folder, not in HOME or the root', async () => {
    const d = () => deps({ env: { SEAT_MODS_ROLE: 'coordinator', SEAT_MODS_ALLOW: '/home/u/scratch:/tmp/allow', HOME: '/home/u' } })
    const bash = (command: string) => guard(d(), 'bash', { command }, child('reviewer'))
    for (const command of ['cd "~" && rm -rf scratch/x', 'cd "~/scratch" && rm -rf x', 'cd @ && rm -rf tmp/allow/x', 'cd ":~" && rm -rf scratch/x'])
      expect(await bash(command)).toContain('no rm outside')
    for (const command of ['rm -rf ~/scratch/x', 'rm -rf /tmp/allow/x']) expect(await bash(command)).toBeUndefined()
  })
  // seat-mods fix round 2 (Ruling 24): a bare operand built from a variable arrives as `./…`; a redirection-only command may fail
  test('reviewer: "$S/…" with S=@ or S=: is placed in the call folder; an assignment behind </missing && is not read', async () => {
    const d = () => deps({ env: { SEAT_MODS_ROLE: 'coordinator', SEAT_MODS_ALLOW: '/home/u/scratch:/tmp/allow', HOME: '/home/u' } })
    const bash = (command: string, who = 'reviewer') => guard(d(), 'bash', { command }, child(who))
    for (const command of ['S=@; rm -rf "$S/tmp/allow/x"', 'S=:; rm -rf "$S~/scratch/x"']) expect(await bash(command)).toContain('no rm outside')
    for (const who of ['reviewer', 'implementer'])
      for (const command of ['</nonexistent && S=/tmp/allow; rm -rf "$S/x"', '>/nonexistent/d/f && S=/tmp/allow; rm -rf "$S/x"'])
        expect(await bash(command, who)).toContain('cannot resolve')
    for (const command of ['S=/tmp/allow; rm -rf "$S/x"', 'S=/tmp/allow && rm -rf "$S/x"']) expect(await bash(command)).toBeUndefined()
  })
  // seat-mods fix round 3: an rm's prefix value or a wrapper's operand expands in this shell and may write the next rm's variable
  test('an rm whose prefix writes a variable leaves it unread; a literal prefix keeps it', async () => {
    const bash = (command: string, who: string) => guard(deps(), 'bash', { command }, child(who))
    expect(await bash('S=/tmp/allow; X="$[S=5]" rm -f /tmp/allow/a; rm -rf "$S/x"', 'reviewer')).toContain('cannot resolve')
    expect(await bash('Z=S=5; S=/tmp/allow; X="$((Z))" rm -f /tmp/allow/a; rm -rf "$S/x"', 'reviewer')).toContain('cannot resolve')
    expect(await bash('S=/tmp/allow; X="$[S=5]" rm -f /tmp/allow/a; cd /etc; rm -rf "$S/x"', 'implementer')).toContain('cannot resolve')
    expect(await bash('S=/tmp/allow; X=1 rm -f /tmp/allow/a; rm -rf "$S/x"', 'reviewer')).toBeUndefined()
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
  // #844: the write tool's own `local://<name>` is session scratch omp confines, so it is allowed (see the #844 block).
  test('an implementer child cannot write through local:// with any other tool', async () => {
    expect(await guard(deps(), 'edit', { path: 'local://x' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'ast_edit', { path: 'local://x', pattern: 'a', rewrite: 'b' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { path: 'a.ts', input: '[a.ts]\nMV local://x' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { input: '*** Update File: a.ts\n*** Move to: local://x' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { input: '*** Add File: local://x\n+z' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { input: '[local://x]\nbody' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { path: 'a.ts', edits: [{ path: 'a.ts', rename: 'local://x' }] }, child('implementer'))).toContain('no writes outside')
  })
  test('every omp writable scheme is outside, and so are the spellings omp normalises to one', async () => {
    for (const path of ['vault://n.md', 'ssh://host/x', 'cfg://k', 'conflict://1', 'agent://a', 'proc://p', 'xd://report_issue', 'xd://propose',
      'LOCAL://x', 'local:/x', 'sub/local://x', './local://x', '@local://x', ' local://x', 'xd://resolve/x'])
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
    // #780: bash stays outside placement through xd://; only the three devices re-dispatch.
    expect(await guard(deps(), 'write', { path: 'xd://bash', content: '{"command":"git push"}' }, child('reviewer'))).toContain('no writes outside')
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
    expect(await guard(deps({ env }), 'edit', { path: 'local://x' }, { kind: 'main' })).toContain('no writes outside')
  })
})

describe('PR 762 round 2: an allow list of omp tools, and one omp path normaliser', () => {
  const coord = { kind: 'main' } // deps() sets SEAT_MODS_ROLE=coordinator
  const implMain = deps({ env: { SEAT_MODS_ROLE: 'implementer', HOME: '/home/u' } })
  test('finding 1: a write target is read as omp reads it: hashline [path#hash] unwrapped, ~, @/, :/ and file:// expanded', async () => {
    for (const path of ['[/outside/x#ABCD]', '[/etc/out]', '~/x', '~', '~user/x', '@/outside/x', ':/outside/x', 'file:///outside/x', ' [/outside/x#abcd] '])
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

describe('review C1 raw transported args (#780)', () => {
  const main = { kind: 'main' }
  const d = deps({ env: { SEAT_MODS_ROLE: 'implementer' } })
  const via = (name: string, args: Record<string, unknown>) =>
    guard(d, 'write', { path: `xd://${name}`, content: JSON.stringify(args) }, main)
  for (const value of [1, 'yes', 'TRUE']) {
    test(`github forceWithLease ${JSON.stringify(value)} hits force-push`, async () => {
      expect(await via('github', { op: 'pr_push', forceWithLease: value })).toContain('no force-push')
    })
  }
  for (const [name, args] of [
    ['edit', { path: 'src/a.ts', 'edits[0].path': '/etc/x' }],
    ['ast_edit', { path: 'src', 'paths[0]': '/etc/x' }],
    ['ast_edit', { path: 'src', paths: '["/etc/x"]' }],
    ['bash', { command: 'echo hi' }],
  ] as const) {
    test(`${name} ${JSON.stringify(args)} stays outside placement`, async () => {
      expect(await via(name, args)).toContain('no writes outside')
    })
  }
  test('lsp rejects nested dotted keys before dispatch', async () => {
    expect(await via('lsp', { action: 'hover', a: { 'b.c': 1 } })).toContain('no xd://lsp')
  })
})

describe('write xd:// transport (#780)', () => {
  const main = { kind: 'main' }
  for (const role of ['implementer', 'reviewer']) {
    const d = deps({ env: { SEAT_MODS_ROLE: role, SEAT_MODS_ALLOW: '/tmp/allow' } })
    const via = (name: string, args: Record<string, unknown>, agent = main) =>
      guard(d, 'write', { path: `xd://${name}`, content: JSON.stringify(args) }, agent)
    test(`${role}: device reads pass, mutations retain their own rails`, async () => {
      for (const [name, args] of [
        ['lsp', { action: 'hover' }], ['ast_grep', { pattern: 'x' }], ['github', { op: 'repo_view' }],
      ] as const) expect(await via(name, args)).toBeUndefined()
      for (const [name, args, deny] of [
        ['lsp', { action: 'rename' }, role === 'reviewer' ? 'no edits in the worktree' : 'no xd://lsp rename'],
        ['github', { op: 'pr_create' }, role === 'reviewer' ? 'no gh pr create' : undefined],
      ] as const) {
        const result = await via(name, args)
        const direct = await guard(d, name, args, main)
        expect(result).toBe(direct?.replace(`no ${name}`, `no xd://${name}`))
        if (deny === undefined) expect(result).toBeUndefined()
        else expect(result).toContain(deny)
      }
      for (const name of ['bash', 'edit', 'ast_edit', 'eval', 'task', 'ask', 'write', 'read',
        'made_up_tool', 'LSP', 'AST_GREP', 'Github', 'resolve2', 'Resolve']) {
        for (const content of ['{}', '?', 'help', '', 'not json'])
          expect(await guard(d, 'write', { path: `xd://${name}`, content }, main)).toContain('no writes outside')
      }
      expect(await via('edit', { path: '/tmp/allow/report.md' })).toContain('no writes outside')
      expect(await via('task', {}, child(role))).toContain('no writes outside')

    })
    test(`${role}: URL parsing, docs, special names and malformed payloads fail closed`, async () => {
      for (const path of ['XD://lsp', '  xD://lsp  '])
        expect(await guard(d, 'write', { path, content: '{"action":"hover"}' }, main)).toBeUndefined()
      for (const name of ['lsp', 'ast_grep', 'github'])
        for (const content of ['?', ' help ', 'HeLP', '', '  \n '])
          expect(await guard(d, 'write', { path: `xd://${name}`, content }, main)).toBeUndefined()
      for (const name of ['lsp', 'ast_grep', 'github'])
        for (const content of ['not json', 'null', '[]', '42', '"help"', 'true', undefined, { command: 'ls' }])
          expect(await guard(d, 'write', { path: `xd://${name}`, content }, main)).toContain(`no xd://${name} — this tool is not allowed`)
      for (const name of ['lsp/x', 'lsp?x', 'lsp#x', 'report_issue', 'propose', ''])
        for (const content of ['{}', '?'])
          expect(await guard(d, 'write', { path: `xd://${name}`, content }, main)).toContain('no writes outside')
      expect(await via('github', { op: 'issue_close' })).toContain('no xd://github issue_close')
      for (const name of ['resolve', 'reject'])
        expect(await guard(d, 'write', { path: `xd://${name}`, content: 'reason' }, main)).toBeUndefined()
      expect(await guard(d, 'write', { path: 'XD://resolve', content: 'reason' }, main)).toContain('no writes outside')
      expect(await guard(d, 'write', { path: 'src/a.ts', content: '?' }, main))
        .toBe(role === 'implementer' ? undefined : await guard(d, 'edit', { path: 'src/a.ts' }, main))
    })
  }
  test('transport force flags deny every present value except JSON false; direct calls stay unchanged', async () => {
    const d = deps({ env: { SEAT_MODS_ROLE: 'implementer' } })
    for (const flag of ['forceWithLease', 'force']) {
      for (const value of [true, 1, 'yes', 'TRUE', 'true', 0, null, '', 'false', 'no', [], {}]) {
        const args = { op: 'pr_push', [flag]: value }
        expect(await guard(d, 'write', { path: 'xd://github', content: JSON.stringify(args) }, main)).toContain('no force-push')
        const direct = await guard(d, 'github', args, main)
        if (flag === 'forceWithLease' && (value === true || value === 'true')) expect(direct).toContain('no force-push')
        else expect(direct).toBeUndefined()
      }
      expect(await guard(d, 'write', { path: 'xd://github', content: JSON.stringify({ op: 'pr_push', [flag]: false }) }, main)).toBeUndefined()
    }
    expect(await guard(d, 'write', { path: 'xd://github', content: '{"op":"pr_push"}' }, main)).toBeUndefined()
  })
  test('all three devices reject expandable keys inside objects and arrays, while key characters in values pass', async () => {
    const d = deps({ env: { SEAT_MODS_ROLE: 'implementer' } })
    for (const [name, args] of [['lsp', { action: 'hover' }], ['ast_grep', { pattern: 'x' }], ['github', { op: 'repo_view' }]] as const) {
      for (const extra of [{ 'a.b': 1 }, { 'a[0]': 1 }, { a: [{ b: { 'c.d': 1 } }] }, { a: { 'b[0]': 1 } }])
        expect(await guard(d, 'write', { path: `xd://${name}`, content: JSON.stringify({ ...args, ...extra }) }, main)).toContain(`no xd://${name}`)
      expect(await guard(d, 'write', { path: `xd://${name}`, content: JSON.stringify({ ...args, a: [{ b: 'x[y].z' }] }) }, main)).toBeUndefined()
    }
  })
  test('transport tool-deny labels truncate once and preserve shared rule texts', async () => {
    const d = deps({ env: { SEAT_MODS_ROLE: 'implementer' } })
    const action = 'x'.repeat(100)
    expect(await guard(d, 'write', { path: 'xd://lsp', content: JSON.stringify({ action }) }, main))
      .toBe(`seat-mods (implementer): no ${('xd://lsp ' + action).slice(0, 80)} — this tool is not allowed for this seat; report it instead.`)
    expect(await guard(d, 'write', { path: 'xd://github', content: '{"op":"pr_push","force":true}' }, main))
      .toBe(await guard(d, 'github', { op: 'pr_push', forceWithLease: true }, main))
  })
  test('free main roles bypass even malformed and nested device writes; implementer and task children get the verifier profile', async () => {
    for (const role of ['coordinator', 'orchestrator']) {
      const d = deps({ env: { SEAT_MODS_ROLE: role } })
      for (const path of ['xd://bash', 'xd://write', 'xd://report_issue'])
        expect(await guard(d, 'write', { path, content: 'not json' }, main)).toBeUndefined()
      expect(await guard(d, 'write', { path: 'xd://lsp', content: '{"action":"hover"}' }, child('implementer'))).toBeUndefined()
      expect(await guard(d, 'write', { path: 'xd://bash', content: '{"command":"git push"}' }, child('task'))).toContain('no writes outside')
    }
  })
})

describe('orchestrator: no subagents (#798)', () => {
  const orch = () => deps({ env: { SEAT_MODS_ROLE: 'orchestrator' } })
  test('the task tool is blocked for an orchestrator main session, naming #798', async () => {
    const r = await guard(orch(), 'task', { agent: 'task' }, { kind: 'main' })
    expect(r).toContain('seat-mods (orchestrator): no subagents — dispatch a crew seat instead (crew orchestrate; #798).')
    expect(r).toContain('#798')
  })
  test('every other tool stays free for the orchestrator', async () => {
    expect(await guard(orch(), 'bash', { command: 'gh pr merge 1' }, { kind: 'main' })).toBeUndefined()
    expect(await guard(orch(), 'write', { path: '/var/x' }, { kind: 'main' })).toBeUndefined()
  })
  test('control: a coordinator main session still spawns', async () => {
    expect(await guard(deps(), 'task', { agent: 'implementer' }, { kind: 'main' })).toBeUndefined()
    expect(spawnDecision({ kind: 'main' }, 'coordinator')).toBeUndefined()
  })
  test('eval agent() and workpool spawns from an orchestrator are blocked too', () => {
    expect(spawnDecision({ kind: 'main' }, 'orchestrator')).toMatchObject({ block: true, reason: expect.stringContaining('#798') })
  })
  test('control: an unset role and a one-argument call keep their behaviour', () => {
    expect(spawnDecision({ kind: 'main' }, undefined)).toBeUndefined()
    expect(spawnDecision({ kind: 'main' })).toBeUndefined()
    expect(spawnDecision({ kind: 'sub', name: 'implementer' })).toMatchObject({ block: true })
  })
})

// #844: guarded seats lost a turn on each scratch write. omp's `local://` is per-session scratch that omp itself confines
// (absolute paths and `..` refused, real-path containment under the session's local root), so the write tool may use it.
// An absolute path outside the allowed places and xd://report_issue (an outward report to omp's maintainers) stay denied; the deny texts say where to go instead.
// (/tmp joined the allowed places in batch 5: see 'scratch directories' below.)
describe('scratch sinks (#844)', () => {
  test('every guarded role may write a local://<name> file with the write tool', async () => {
    for (const role of ['implementer', 'reviewer', 'task'])
      for (const path of ['local://pr861-commit-message.txt', 'local://notes/round-1.md', 'local://a_b-c.d'])
        expect(await guard(deps(), 'write', { path, content: 'x' }, child(role))).toBeUndefined()
    const env = { HOME: '/home/u' } as Record<string, string | undefined>
    expect(await guard(deps({ env }), 'write', { path: 'local://msg.txt', content: 'x' }, { kind: 'main' })).toBeUndefined()
  })
  test('adjacent controls: other local:// shapes, other tools, an outside path and report_issue still deny', async () => {
    for (const path of ['local://', 'local://../x', 'local://a/../../x', 'local://%2e%2e/x', 'local://a b', 'local://x#abcd', 'local:///etc/x',
      'LOCAL://x', 'local:/x', ' local://x', 'sub/local://x', '/etc/x.txt', 'xd://report_issue'])
      expect(await guard(deps(), 'write', { path, content: 'x' }, child('implementer'))).toBeDefined()
    expect(await guard(deps(), 'edit', { path: 'local://x' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'ast_edit', { path: 'local://x', pattern: 'a', rewrite: 'b' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { input: '*** Add File: local://x\n+z' }, child('implementer'))).toContain('no writes outside')
    expect(await guard(deps(), 'edit', { paths: ['local://x'] }, child('implementer'))).toContain('no writes outside')
    // one allowed target never carries another: the second write target is still placed
    expect(await guard(deps(), 'write', { path: 'local://x', paths: ['/etc/x'], content: 'x' }, child('implementer'))).toContain('no writes outside')
  })
  // PR #862 round 1: every outside-write deny on OMP carries the hint, including the two that place no target.
  test('a write with no target, and a github pr_checkout, also name the scratch folders', async () => {
    for (const [tool, input] of [['write', { content: 'x' }], ['edit', { input: 'no headers' }], ['github', { op: 'pr_checkout', pr: 1 }]] as const) {
      const deny = await guard(deps(), tool, input as Record<string, unknown>, child('implementer'))
      expect(deny).toContain('no writes outside')
      expect(deny).toContain('go in /tmp/allow, /tmp.')
    }
  })
  test('a write denied outside names the SEAT_MODS_ALLOW folders as the place for scratch files', async () => {
    const deny = await guard(deps(), 'write', { path: '/var/pr861-commit-message.txt', content: 'x' }, child('implementer'))
    expect(deny).toContain('no writes outside')
    expect(deny).toContain('/tmp/allow')
  })
  test('an rm operand the guard cannot resolve says to spell the path literally; one outside keeps its own text', async () => {
    const unresolved = await guard(deps(), 'bash', { command: 'rm -rf "$S/shallow"' }, child('implementer'))
    expect(unresolved).toContain('no rm')
    expect(unresolved).toContain('literal')
    const outside = await guard(deps(), 'bash', { command: 'rm -rf /etc/x' }, child('implementer'))
    expect(outside).toContain('no rm outside')
    expect(outside).not.toContain('literal')
    // control: the same removal spelled literally, in the allow folder, runs
    expect(await guard(deps(), 'bash', { command: 'rm -rf /tmp/allow/shallow' }, child('implementer'))).toBeUndefined()
    // batch 5: so does one through a literal assignment, which places it outside when it names outside
    expect(await guard(deps(), 'bash', { command: 'S=/tmp/allow; rm -rf "$S/shallow"' }, child('implementer'))).toBeUndefined()
    expect(await guard(deps(), 'bash', { command: 'S=/etc; rm -rf "$S/shallow"' }, child('implementer'))).toContain('no rm outside')
  })
})

// Batch 5, Task 4: /tmp and $TMPDIR are writable places for every guarded role, read from the same env as SEAT_MODS_ALLOW.
// A worker may write and remove their DESCENDANTS; the directory itself and its ancestors stay protected from rm, and a
// path outside every allowed place stays refused. The accepted cost: a worker can remove another session's file in /tmp.
describe('scratch directories: /tmp and $TMPDIR (batch 5)', () => {
  // a realpath that drops trailing slashes and `.` segments, as realpath does (the shared deps().real is the identity)
  const plain = async (p: string) => `/${p.split('/').filter(part => part !== '' && part !== '.').join('/')}`
  // macOS: /tmp is a link to /private/tmp
  const mac = async (p: string) => {
    const path = await plain(p)
    return path === '/tmp' || path.startsWith('/tmp/') ? `/private${path}` : path
  }
  const seat = (role: string, env: Record<string, string> = {}, real: (p: string) => Promise<string | undefined> = plain) =>
    deps({ env: { SEAT_MODS_ROLE: role, HOME: '/home/u', ...env }, real })
  const main = { kind: 'main' }
  const writes = (d: ReturnType<typeof seat>, path: string) => guard(d, 'write', { path, content: 'x' }, main)
  const runs = (d: ReturnType<typeof seat>, command: string) => guard(d, 'bash', { command }, main)

  for (const role of ['implementer', 'verifier', 'reviewer']) {
    test(`${role}: a write inside /tmp passes; a write outside every allowed place is still refused`, async () => {
      const d = seat(role)
      for (const path of ['/tmp/r3s2w3-redgate.sh', '/tmp/x', '/tmp/new/dir/y']) expect(await writes(d, path)).toBeUndefined()
      expect(await guard(d, 'edit', { path: '/tmp/x', old_text: 'a', new_text: 'b' }, main)).toBeUndefined()
      for (const path of ['/etc/x', '/tmpfoo/x', '/var/tmp/x']) expect(await writes(d, path)).toContain('no writes outside')
    })
    test(`${role}: rm inside /tmp passes; /tmp itself and its ancestors are refused (Review Focus 3)`, async () => {
      const d = seat(role)
      for (const command of ['rm /tmp/status.py.bak', 'rm -f /tmp/r3s2w3-redgate.sh', 'rm -rf /tmp/x/y', 'rm -rf /tmp/*'])
        expect(await runs(d, command)).toBeUndefined()
      for (const command of ['rm -rf /tmp', 'rm -rf /tmp/', 'rm -rf /tmp/.', 'rm -rf /', 'rm -rf /*'])
        expect(await runs(d, command)).toContain('roots or ancestors')
      for (const command of ['rm /etc/x', 'rm /tmpfoo/x', 'rm -rf /var/tmp/x', 'rm /tmp/x /etc/x'])
        expect(await runs(d, command)).toContain('no rm outside')
    })
    test(`${role}: $TMPDIR, read from the same env as SEAT_MODS_ALLOW, is a scratch place too`, async () => {
      const d = seat(role, { TMPDIR: '/var/tmp/x/' })
      for (const path of ['/var/tmp/x/f', '/var/tmp/x/new/g', '/tmp/f']) expect(await writes(d, path)).toBeUndefined()
      for (const command of ['rm /var/tmp/x/f', 'rm -rf /var/tmp/x/*']) expect(await runs(d, command)).toBeUndefined()
      for (const command of ['rm -rf /var/tmp/x', 'rm -rf /var/tmp/x/', 'rm -rf /var/tmp', 'rm -rf /var'])
        expect(await runs(d, command)).toContain('roots or ancestors')
      for (const path of ['/var/tmp/y', '/var/y', '/etc/x']) expect(await writes(d, path)).toContain('no writes outside')
      // the process env is not the source: only deps.env counts
      const saved = process.env.TMPDIR
      process.env.TMPDIR = '/var/tmp/z'
      try { expect(await writes(seat(role), '/var/tmp/z/f')).toContain('no writes outside') } finally {
        if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved
      }
    })
    for (const TMPDIR of ['/', '//', 'scratch', '']) {
      test(`${role}: TMPDIR=${JSON.stringify(TMPDIR)} opens nothing beyond /tmp`, async () => {
        const d = seat(role, { TMPDIR })
        for (const path of ['/etc/x', '/scratch/x', '/var/x']) expect(await writes(d, path)).toContain('no writes outside')
        for (const command of ['rm /etc/x', 'rm /scratch/x']) expect(await runs(d, command)).toContain('no rm outside')
        expect(await writes(d, '/tmp/x')).toBeUndefined()
      })
    }
  }
  test('a task child gets /tmp too, and keeps the same refusals', async () => {
    for (const name of ['seat-reviewer', 'reviewer', 'implementer', 'task']) {
      const d = seat('coordinator') // a child ignores the inherited env's role
      expect(await guard(d, 'write', { path: '/tmp/x', content: 'x' }, child(name))).toBeUndefined()
      expect(await guard(d, 'bash', { command: 'rm /tmp/x' }, child(name))).toBeUndefined()
      expect(await guard(d, 'bash', { command: 'rm -rf /tmp' }, child(name))).toContain('roots or ancestors')
      expect(await guard(d, 'write', { path: '/etc/x', content: 'x' }, child(name))).toContain('no writes outside')
    }
  })
  test('a symlinked /tmp (macOS: /tmp -> /private/tmp): the resolved path and the given one are both inside (Review Focus 4)', async () => {
    const d = seat('implementer', {}, mac)
    for (const path of ['/private/tmp/x', '/tmp/x', '/private/tmp/new/y']) expect(await writes(d, path)).toBeUndefined()
    for (const command of ['rm /private/tmp/x', 'rm /tmp/x', 'rm -rf /private/tmp/*', 'rm -rf /tmp/*']) expect(await runs(d, command)).toBeUndefined()
    for (const command of ['rm -rf /private/tmp', 'rm -rf /private/tmp/', 'rm -rf /tmp', 'rm -rf /tmp/', 'rm -rf /private'])
      expect(await runs(d, command)).toContain('roots or ancestors')
    for (const path of ['/private/etc/x', '/etc/x']) expect(await writes(d, path)).toContain('no writes outside')
    expect(await runs(d, 'rm /private/etc/x')).toContain('no rm outside')
    // the deny names both spellings
    expect(await writes(d, '/etc/x')).toContain('go in /tmp, /private/tmp.')
  })
  test('the deny names the scratch places after the SEAT_MODS_ALLOW ones, each once', async () => {
    const d = seat('implementer', { SEAT_MODS_ALLOW: '/tmp/allow:/tmp', TMPDIR: '/var/tmp/x' })
    expect(await writes(d, '/etc/x')).toContain('go in /tmp/allow, /tmp, /var/tmp/x.')
  })
  // placeOf lets an allow directory outrank the worktree, so a /tmp that held the worktree would hand a reviewer its edits
  test('a worktree under /tmp: /tmp adds no place, so the reviewer still cannot edit it and the rest of /tmp stays refused', async () => {
    const tree = { cwd: '/tmp/wt', worktree: async () => '/tmp/wt' }
    const reviewer = deps({ env: { SEAT_MODS_ROLE: 'reviewer', HOME: '/home/u' }, real: plain, ...tree })
    expect(await writes(reviewer, '/tmp/wt/a.ts')).toContain('no edits in the worktree')
    expect(await runs(reviewer, 'rm /tmp/wt/a.ts')).toContain('no rm outside')
    expect(await writes(reviewer, '/tmp/other')).toContain('no writes outside')
    expect(await runs(reviewer, 'rm /tmp/other')).toContain('no rm outside')
    // the pr_checkout deny names no /tmp for it (control: a worktree elsewhere does)
    expect(await guard(reviewer, 'github', { op: 'pr_checkout', pr: 1 }, main)).not.toContain('go in')
    expect(await guard(seat('reviewer'), 'github', { op: 'pr_checkout', pr: 1 }, main)).toContain('go in /tmp.')
    const implementer = deps({ env: { SEAT_MODS_ROLE: 'implementer', HOME: '/home/u' }, real: plain, ...tree })
    expect(await writes(implementer, '/tmp/wt/a.ts')).toBeUndefined()
    expect(await runs(implementer, 'rm /tmp/wt/a.ts')).toBeUndefined()
    expect(await writes(implementer, '/tmp/other')).toContain('no writes outside')
    expect(await runs(implementer, 'rm -rf /tmp/wt')).toContain('roots or ancestors')
    // the same, with /tmp a link to /private/tmp and the worktree reached by its resolved path
    const onLink = deps({ env: { SEAT_MODS_ROLE: 'reviewer', HOME: '/home/u' }, cwd: '/private/tmp/wt', worktree: async () => '/private/tmp/wt', real: mac })
    expect(await writes(onLink, '/private/tmp/wt/a.ts')).toContain('no edits in the worktree')
    expect(await writes(onLink, '/tmp/other')).toContain('no writes outside')
  })
  test('a TMPDIR that does not resolve is dropped, as given or resolved', async () => {
    const d = seat('reviewer', { TMPDIR: '/dangling' }, async p => (p.startsWith('/dangling') ? undefined : plain(p)))
    expect(await writes(d, '/dangling/x')).toContain('go in /tmp.')
  })
})
