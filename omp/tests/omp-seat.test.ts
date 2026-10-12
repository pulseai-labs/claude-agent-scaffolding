import { beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MARKETPLACE } from '../../omp-roles/omp/bin-path'
import { checkExtensions, pinWarning, planLaunch, versionWarning } from '../../omp-roles/omp/seat'

let root: string, ompRecord: string, claudeRecord: string

function install(name: string, withExt = true): string {
  const p = join(root, 'cache', name)
  mkdirSync(join(p, 'omp'), { recursive: true })
  if (withExt) writeFileSync(join(p, 'omp', 'extension.ts'), 'export default function () {}')
  return p
}
function record(path: string, paths: Record<string, string>) {
  mkdirSync(join(path, '..'), { recursive: true })
  const plugins: Record<string, unknown[]> = {}
  for (const [n, p] of Object.entries(paths)) plugins[`${n}@${MARKETPLACE}`] = [{ scope: 'user', installPath: p }]
  writeFileSync(path, JSON.stringify({ version: 2, plugins }))
}
const launch = (role = 'worker', args: string[] = ['--x']) =>
  planLaunch({ role, via: 'omp-glm', args, ompRecord, claudeRecord })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'seat-'))
  ompRecord = join(root, 'omp', 'plugins', 'installed_plugins.json')
  claudeRecord = join(root, 'claude', 'plugins', 'installed_plugins.json')
})

describe('planLaunch', () => {
  test('worker pins the three extensions in order, then the caller args, with no system prompt', () => {
    const [s, m, a] = ['seat-mods', 'molt', 'autonomic'].map((n) => install(n))
    record(ompRecord, { 'seat-mods': s, molt: m, autonomic: a, 'omp-roles': install('omp-roles', false) })
    expect(launch()).toMatchObject({
      argv: ['omp-glm', '-e', join(s, 'omp/extension.ts'), '-e', join(m, 'omp/extension.ts'), '-e', join(a, 'omp/extension.ts'), '--x'],
      warnings: [],
    })
  })
  test('a name from the prototype chain is not a role', () => {
    expect(launch('toString')).toEqual({ error: expect.stringContaining('unknown role "toString"') })
    expect(launch('__proto__')).toHaveProperty('error')
  })
  test('an unknown role is an error', () => {
    expect(launch('x')).toEqual({ error: 'omp-seat: unknown role "x" (known: worker)' })
  })
  test('a mod missing from both records names the mod and both records', () => {
    record(ompRecord, { 'seat-mods': install('seat-mods'), molt: install('molt') })
    const r = launch()
    expect(r).toHaveProperty('error')
    const e = (r as { error: string }).error
    expect(e).toContain('autonomic')
    expect(e).toContain(ompRecord)
    expect(e).toContain(claudeRecord)
  })
  test('with no record at all every mod is missing, and that is an error', () => {
    expect(launch()).toHaveProperty('error')
  })
  test("a mod present only in Claude Code's record uses that install path", () => {
    const [s, m, a] = ['seat-mods', 'molt', 'autonomic'].map((n) => install(n))
    record(ompRecord, { 'seat-mods': s, molt: m })
    record(claudeRecord, { autonomic: a })
    expect(launch()).toMatchObject({
      argv: ['omp-glm', '-e', join(s, 'omp/extension.ts'), '-e', join(m, 'omp/extension.ts'), '-e', join(a, 'omp/extension.ts'), '--x'],
      warnings: [],
    })
  })
  test('an install without omp/extension.ts is an error naming the file', () => {
    const old = install('seat-mods', false)
    record(ompRecord, { 'seat-mods': old, molt: install('molt'), autonomic: install('autonomic') })
    const r = launch() as { error: string }
    expect(r.error).toContain(join(old, 'omp', 'extension.ts'))
    expect(r.error).toContain('0.4.0')
  })
  test('an unreadable record fails loud, naming the record, and execs nothing', () => {
    mkdirSync(join(ompRecord, '..'), { recursive: true })
    writeFileSync(ompRecord, '{not json')
    const r = launch() as { error: string }
    expect(r.error).toContain(ompRecord)
    expect(r.error).toContain('unreadable')
  })
  test('an unreadable Claude record fails loud too', () => {
    record(ompRecord, { 'seat-mods': install('seat-mods'), molt: install('molt'), autonomic: install('autonomic') })
    mkdirSync(join(claudeRecord, '..'), { recursive: true })
    writeFileSync(claudeRecord, '{not json')
    expect((launch() as { error: string }).error).toContain(claudeRecord)
  })
})

describe('pinWarning', () => {
  test('a different omp version warns', () => {
    expect(pinWarning('omp/18.9.0', '18.8.9')).toBe(
      'omp-seat: omp 18.9.0 is not the tested 18.8.9; running anyway — an upgrade is a PR (omp-roles README)',
    )
  })
  test('the tested version, with trailing newline, does not', () => {
    expect(pinWarning('omp/18.8.9\n', '18.8.9')).toBeUndefined()
  })
})

describe('versionWarning', () => {
  test('a via that cannot run says nothing about the version', () => {
    expect(versionWarning({ error: new Error('ENOENT'), status: null, stdout: null }, '18.8.9')).toBeUndefined()
    expect(versionWarning({ status: 1, stdout: '' }, '18.8.9')).toBeUndefined()
  })
  test('a via that runs is held to the tested version', () => {
    expect(versionWarning({ status: 0, stdout: 'omp/18.9.0\n' }, '18.8.9')).toContain('18.9.0')
    expect(versionWarning({ status: 0, stdout: 'omp/18.8.9\n' }, '18.8.9')).toBeUndefined()
  })
})

describe('bin/omp-seat with a via that cannot run', () => {
  const seat = join(import.meta.dir, '..', '..', 'omp-roles', 'bin', 'omp-seat')
  function run(via: string) {
    const home = mkdtempSync(join(tmpdir(), 'seat-home-'))
    const [s, m, a] = ['seat-mods', 'molt', 'autonomic'].map((n) => install(n))
    record(join(home, '.omp', 'plugins', 'installed_plugins.json'), { 'seat-mods': s, molt: m, autonomic: a })
    return spawnSync('bun', [seat, 'worker', '--via', via], { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 30_000 })
  }
  test('an extension that fails to load stops the launch before any omp starts', () => {
    const home = mkdtempSync(join(tmpdir(), 'seat-home-'))
    const [s, m, a] = ['seat-mods', 'molt', 'autonomic'].map((n) => install(n))
    writeFileSync(join(m, 'omp', 'extension.ts'), 'throw new Error("boom")')
    record(join(home, '.omp', 'plugins', 'installed_plugins.json'), { 'seat-mods': s, molt: m, autonomic: a })
    const r = spawnSync('bun', [seat, 'worker', '--via', 'true'], { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 30_000 })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain(`omp-seat: ${join(m, 'omp', 'extension.ts')} did not load: boom`)
  })
  test('a missing command is named and exits 2, with no pin warning', () => {
    const r = run('/nonexistent/omp-via')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('omp-seat: cannot run /nonexistent/omp-via:')
    expect(r.stderr).not.toContain('not the tested')
  })
  test('a command that exits non-zero on --version gets no pin warning and keeps its own status', () => {
    const r = run('false')
    expect(r.status).toBe(1)
    expect(r.stderr).not.toContain('not the tested')
  })
})

describe('checkExtensions (fix wave 4)', () => {
  const mod = (name: string, src: string) => { const f = join(root, name); writeFileSync(f, src); return f }
  test('modules whose default export is a function load', async () => {
    expect(await checkExtensions([mod('a.ts', 'export default function () {}'), mod('b.ts', 'export default () => {}')])).toBeUndefined()
  })
  test('a module that throws on import is named with its error', async () => {
    const bad = mod('bad.ts', 'throw new Error("boom")')
    expect(await checkExtensions([bad])).toBe(`omp-seat: ${bad} did not load: boom`)
  })
  test('a syntax error, a missing file and a default export that is not a function all fail', async () => {
    for (const f of [mod('syn.ts', 'export default function ('), join(root, 'missing.ts'), mod('obj.ts', 'export default {}')]) {
      const e = await checkExtensions([join(root, 'ok.ts') && mod('ok.ts', 'export default () => {}'), f])
      expect(e).toContain(`omp-seat: ${f} did not load:`)
    }
  })
  test('planLaunch lists the three extension paths it pinned', () => {
    const [s, m, a] = ['seat-mods', 'molt', 'autonomic'].map((n) => install(n))
    record(ompRecord, { 'seat-mods': s, molt: m, autonomic: a })
    expect((launch() as { extensions: string[] }).extensions).toEqual([s, m, a].map((p) => join(p, 'omp/extension.ts')))
  })
})
