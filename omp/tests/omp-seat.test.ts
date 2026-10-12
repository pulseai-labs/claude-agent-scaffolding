import { beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MARKETPLACE } from '../../omp-roles/omp/bin-path'
import { pinWarning, planLaunch } from '../../omp-roles/omp/seat'

let root: string, ompRecord: string, claudeRecord: string

function install(name: string, withExt = true): string {
  const p = join(root, 'cache', name)
  mkdirSync(join(p, 'omp'), { recursive: true })
  if (withExt) writeFileSync(join(p, 'omp', 'extension.ts'), '')
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
    expect(launch()).toEqual({
      argv: ['omp-glm', '-e', join(s, 'omp/extension.ts'), '-e', join(m, 'omp/extension.ts'), '-e', join(a, 'omp/extension.ts'), '--x'],
      warnings: [],
    })
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
    expect(launch()).toEqual({
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
