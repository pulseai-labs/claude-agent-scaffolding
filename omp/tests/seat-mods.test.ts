import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { childRole, roleFor, writeTargets, guard, realOf } from '../../seat-mods/omp/extension'

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
})
