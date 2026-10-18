import { beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MARKETPLACE } from '../../omp-roles/omp/bin-path'
import { checkExtensions, expandRole, pinWarning, planLaunch, versionWarning } from '../../omp-roles/omp/seat'

let root: string, ompRecord: string, claudeRecord: string

function install(name: string, withExt = true, version = ({ 'seat-mods': '0.4.1', molt: '0.3.0', autonomic: '0.6.0' } as Record<string, string>)[name] ?? '0.2.0'): string {
  const p = join(root, 'cache', name)
  mkdirSync(join(p, 'omp'), { recursive: true })
  mkdirSync(join(p, '.claude-plugin'), { recursive: true })
  writeFileSync(join(p, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version }))
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
    expect(launch('x')).toEqual({ error: 'omp-seat: unknown role "x" (known: worker, spine-driver, close, work-pr, orchestrator, crew-spine, crew-work-pr)' })
  })
  test('orchestrator appends its role file when seat-mods is 0.4.4, autonomic 0.7.0 and crew 0.3.0 or later', () => {
    const [s, m, a] = [install('seat-mods', true, '0.4.4'), install('molt'), install('autonomic', true, '0.7.0')]
    record(ompRecord, { 'seat-mods': s, molt: m, autonomic: a, 'crew': install('crew', false, '0.3.0') })
    const rolesDir = join(import.meta.dir, '../../omp-roles/roles')
    expect(planLaunch({ role: 'orchestrator', via: 'omp-glm', args: [], ompRecord, claudeRecord, roleEnv: 'orchestrator', rolesDir })).toMatchObject({
      argv: ['omp-glm', '-e', join(s, 'omp/extension.ts'), '-e', join(m, 'omp/extension.ts'), '-e', join(a, 'omp/extension.ts'),
        '--append-system-prompt', join(rolesDir, 'orchestrator.md')],
    })
  })
  test('orchestrator refuses seat-mods 0.4.3, naming the 0.4.4 minimum (no top without the #798 rail)', () => {
    record(ompRecord, { 'seat-mods': install('seat-mods', true, '0.4.3'), molt: install('molt'), autonomic: install('autonomic', true, '0.7.0'), 'crew': install('crew', false, '0.3.0') })
    const r = planLaunch({ role: 'orchestrator', via: 'omp-glm', args: [], ompRecord, claudeRecord, roleEnv: 'orchestrator', rolesDir: join(import.meta.dir, '../../omp-roles/roles') })
    expect(r).toEqual({ error: expect.stringContaining('seat-mods 0.4.3') })
    expect((r as { error: string }).error).toContain('0.4.4')
  })
  const orch = () => planLaunch({ role: 'orchestrator', via: 'omp-glm', args: [], ompRecord, claudeRecord, roleEnv: 'orchestrator', rolesDir: join(import.meta.dir, '../../omp-roles/roles') })
  const orchMods = (autonomic = '0.7.0') => ({ 'seat-mods': install('seat-mods', true, '0.4.4'), molt: install('molt'), autonomic: install('autonomic', true, autonomic) })
  test('orchestrator refuses autonomic 0.6.0, naming the 0.7.0 minimum (children inherit autopilot through the mode file)', () => {
    record(ompRecord, { ...orchMods('0.6.0'), 'crew': install('crew', false, '0.3.0') })
    const r = orch() as { error: string }
    expect(r.error).toContain('autonomic 0.6.0')
    expect(r.error).toContain('0.7.0')
  })
  test('orchestrator refuses a host with no crew, naming the plugin, the install command and the omp record', () => {
    record(ompRecord, orchMods())
    const r = orch() as { error: string }
    expect(r.error).toContain('orchestrator needs crew 0.3.0 or later installed for omp')
    expect(r.error).toContain('omp plugin install crew@claude-agent-scaffolding')
    expect(r.error).toContain(ompRecord)
  })
  // crew's first release is 0.3.0, so no below-minimum `crew` version can exist: the value
  // here is synthetic on purpose, and exists only to exercise the compare and its message.
  test('orchestrator refuses a crew record below 0.3.0 (no "Host: OMP")', () => {
    record(ompRecord, { ...orchMods(), 'crew': install('crew', false, '0.0.1') })
    expect((orch() as { error: string }).error).toContain('crew 0.0.1 is unsupported for orchestrator')
  })
  test("orchestrator refuses crew installed only for Claude Code (omp would not discover it)", () => {
    record(ompRecord, orchMods())
    record(claudeRecord, { 'crew': install('crew', false, '0.3.0') })
    expect((orch() as { error: string }).error).toContain('needs crew 0.3.0 or later installed for omp')
  })
  for (const env of [undefined, '', 'coordinator', 'implementer', ' orchestrator', 'orchestrator ']) {
    test(`orchestrator refuses SEAT_MODS_ROLE=${JSON.stringify(env)}: the #798 rail keys on "orchestrator"`, () => {
      record(ompRecord, { ...orchMods(), 'crew': install('crew', false, '0.3.0') })
      const r = planLaunch({ role: 'orchestrator', via: 'omp-glm', args: [], ompRecord, claudeRecord, rolesDir: join(import.meta.dir, '../../omp-roles/roles'), roleEnv: env })
      expect((r as { error: string }).error).toContain('needs SEAT_MODS_ROLE=orchestrator')
    })
  }
  test('control: worker launches with SEAT_MODS_ROLE unset', () => {
    record(ompRecord, { 'seat-mods': install('seat-mods'), molt: install('molt'), autonomic: install('autonomic') })
    expect(launch('worker')).toHaveProperty('argv')
  })
  test('control: worker needs neither crew nor autonomic 0.7.0', () => {
    record(ompRecord, { 'seat-mods': install('seat-mods'), molt: install('molt'), autonomic: install('autonomic') })
    expect(launch('worker')).toHaveProperty('argv')
  })
  test('control: worker still accepts seat-mods 0.4.1', () => {
    record(ompRecord, { 'seat-mods': install('seat-mods', true, '0.4.1'), molt: install('molt'), autonomic: install('autonomic') })
    expect(launch('worker')).toHaveProperty('argv')
  })
  for (const role of ['spine-driver', 'close', 'work-pr', 'crew-spine', 'crew-work-pr']) {
    test(`${role} appends its shipped role file after the extensions and before passthrough args`, () => {
      const [s, m, a] = ['seat-mods', 'molt', 'autonomic'].map((n) => install(n))
      record(ompRecord, { 'seat-mods': s, molt: m, autonomic: a })
      const rolesDir = join(import.meta.dir, '../../omp-roles/roles')
      expect(planLaunch({ role, via: 'omp-glm', args: ['--model', 'test model', 'Begin.'], ompRecord, claudeRecord, rolesDir })).toMatchObject({
        argv: ['omp-glm', '-e', join(s, 'omp/extension.ts'), '-e', join(m, 'omp/extension.ts'), '-e', join(a, 'omp/extension.ts'),
          '--append-system-prompt', join(rolesDir, `${role}.md`), '--model', 'test model', 'Begin.'],
        warnings: [],
      })
    })
    test(`${role} refuses a missing role file instead of launching without its procedure`, () => {
      record(ompRecord, { 'seat-mods': install('seat-mods'), molt: install('molt'), autonomic: install('autonomic') })
      const rolesDir = join(root, 'missing roles')
      expect(planLaunch({ role, via: 'omp-glm', args: [], ompRecord, claudeRecord, rolesDir })).toEqual({
        error: `omp-seat: role file ${join(rolesDir, `${role}.md`)} is missing`,
      })
    })
  }
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
    expect(r.error).toContain('0.4.1')
  })
  test('seat-mods 0.4.0 with an OMP extension is refused, naming the 0.4.1 minimum', () => {
    record(ompRecord, { 'seat-mods': install('seat-mods', true, '0.4.0'), molt: install('molt'), autonomic: install('autonomic') })
    expect(launch()).toEqual({ error: expect.stringContaining('seat-mods 0.4.0') })
    expect((launch() as { error: string }).error).toContain('0.4.1')
  })
  test('seat-mods 0.4.1 with an OMP extension is accepted', () => {
    record(ompRecord, { 'seat-mods': install('seat-mods', true, '0.4.1'), molt: install('molt'), autonomic: install('autonomic') })
    expect(launch()).toHaveProperty('argv')
    expect(launch()).not.toHaveProperty('error')
  })
  test('newer seat-mods is accepted without a lexicographic version comparison', () => {
    record(ompRecord, { 'seat-mods': install('seat-mods', true, '0.10.0'), molt: install('molt'), autonomic: install('autonomic') })
    expect(launch()).toHaveProperty('argv')
  })
  test('a mod with an unreadable or invalid version refuses instead of launching unguarded', () => {
    const s = install('seat-mods')
    record(ompRecord, { 'seat-mods': s, molt: install('molt'), autonomic: install('autonomic') })
    for (const content of ['{not json', JSON.stringify({ version: 'bad' }), JSON.stringify({})]) {
      writeFileSync(join(s, '.claude-plugin', 'plugin.json'), content)
      expect(launch()).toEqual({ error: expect.stringContaining('0.4.1') })
    }
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

describe('seat config overlay (#843)', () => {
  const shipped = join(import.meta.dir, '..', '..', 'omp-roles', 'seat-config.yml')
  test('the shipped overlay turns off omp\'s todo reminders and nothing else', () => {
    expect(Bun.YAML.parse(readFileSync(shipped, 'utf8'))).toEqual({ todo: { reminders: false } })
  })
  test('planLaunch passes the overlay right after the extensions, before the role file', () => {
    const [s, m, a] = ['seat-mods', 'molt', 'autonomic'].map((n) => install(n))
    record(ompRecord, { 'seat-mods': s, molt: m, autonomic: a })
    const rolesDir = join(import.meta.dir, '../../omp-roles/roles')
    expect(planLaunch({ role: 'close', via: 'omp-glm', args: ['Begin.'], ompRecord, claudeRecord, rolesDir, seatConfig: shipped })).toMatchObject({
      argv: ['omp-glm', '-e', join(s, 'omp/extension.ts'), '-e', join(m, 'omp/extension.ts'), '-e', join(a, 'omp/extension.ts'),
        `--config=${shipped}`, '--append-system-prompt', join(rolesDir, 'close.md'), 'Begin.'],
    })
  })
  test('a missing overlay stops the launch instead of starting a seat whose todo reminders block molt', () => {
    const [s, m, a] = ['seat-mods', 'molt', 'autonomic'].map((n) => install(n))
    record(ompRecord, { 'seat-mods': s, molt: m, autonomic: a })
    const gone = join(root, 'missing', 'seat-config.yml')
    expect(planLaunch({ role: 'worker', via: 'omp-glm', args: [], ompRecord, claudeRecord, seatConfig: gone })).toEqual({
      error: `omp-seat: seat config ${gone} is missing`,
    })
  })
  test('bin/omp-seat passes the shipped overlay to every launch', () => {
    const seat = join(import.meta.dir, '..', '..', 'omp-roles', 'bin', 'omp-seat')
    const home = mkdtempSync(join(tmpdir(), 'seat-home-'))
    const [s, m, a] = ['seat-mods', 'molt', 'autonomic'].map((n) => install(n))
    record(join(home, '.omp', 'plugins', 'installed_plugins.json'), { 'seat-mods': s, molt: m, autonomic: a })
    const out = join(home, 'argv.txt')
    const via = join(home, 'via.sh')
    writeFileSync(via, `#!/bin/sh\n[ "$1" = --version ] && exit 0\nprintf '%s\\n' "$@" > '${out}'\n`)
    chmodSync(via, 0o755)
    const r = spawnSync('bun', [seat, 'worker', '--via', via], { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 30_000 })
    expect(r.status).toBe(0)
    expect(readFileSync(out, 'utf8').split('\n')).toContain(`--config=${shipped}`)
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
  test('partial authority refuses before the via version probe or worker executes', () => {
    const home = join(root, 'home')
    const receipt = join(root, 'executed')
    const via = join(root, 'harmless-via')
    writeFileSync(via, `#!/bin/sh\nprintf executed >> '${receipt}'\n`)
    chmodSync(via, 0o700)
    const [s, m, a] = ['seat-mods', 'molt', 'autonomic'].map(n => install(n))
    record(join(home, '.omp/plugins/installed_plugins.json'), { 'seat-mods': s, molt: m, autonomic: a })
    const r = spawnSync('bun', [seat, 'worker', '--via', via], {
      env: { ...process.env, HOME: home, AUTONOMIC_AUTHORITY_PATH: join(root, 'missing-snapshot') },
      encoding: 'utf8', timeout: 30_000,
    })
    expect({ status: r.status, executed: existsSync(receipt) }).toEqual({ status: 2, executed: false })
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

describe('expandRole', () => {
  test('orc is the orchestrator on omp-glm, marked for the rail when SEAT_MODS_ROLE is unset or empty', () => {
    expect(expandRole('orc', undefined, undefined)).toEqual({ role: 'orchestrator', via: 'omp-glm', roleEnv: 'orchestrator' })
    expect(expandRole('orc', undefined, '')).toEqual({ role: 'orchestrator', via: 'omp-glm', roleEnv: 'orchestrator' })
  })
  test('orc keeps an explicit --via', () => {
    expect(expandRole('orc', 'omp-sol', undefined)).toEqual({ role: 'orchestrator', via: 'omp-sol', roleEnv: 'orchestrator' })
  })
  test('orc never overrides another SEAT_MODS_ROLE, so planLaunch still refuses it', () => {
    const e = expandRole('orc', undefined, 'coordinator')
    expect(e).toEqual({ role: 'orchestrator', via: 'omp-glm', roleEnv: 'coordinator' })
    expect(planLaunch({ ...e, args: [], ompRecord, claudeRecord })).toEqual({
      error: 'omp-seat: the orchestrator role needs SEAT_MODS_ROLE=orchestrator (got "coordinator"); seat-mods\' no-subagent rail keys on it' })
  })
  test('every other role is unchanged and defaults to plain omp', () => {
    expect(expandRole('orchestrator', undefined, undefined)).toEqual({ role: 'orchestrator', via: 'omp', roleEnv: undefined })
    expect(expandRole('worker', 'omp-glm', 'implementer')).toEqual({ role: 'worker', via: 'omp-glm', roleEnv: 'implementer' })
  })
})

describe('the orchestrator role states the status block (#867)', () => {
  // The role file is prose, wrapped: read as one logical line so a phrase broken
  // by a wrap still counts.
  const role = readFileSync(join(import.meta.dir, '..', '..', 'omp-roles', 'roles', 'orchestrator.md'), 'utf8').replace(/\s+/g, ' ')
  const labels = ['**What I ruled:**', '**What the PR(s) will carry:**', '**Next steps:**', '**Waiting on (seats live):**', '**Operator decision pending:**']

  test('carries the five labels, once each, in order', () => {
    let prev = -1
    for (const label of labels) {
      const first = role.indexOf(label)
      expect(first).toBeGreaterThan(prev)
      expect(role.indexOf(label, first + 1)).toBe(-1)
      prev = first
    }
  })
  test('states the rule with crew SKILL.md wording', () => {
    expect(role).toContain('your reply is only the status block')
    expect(role).toContain('exactly five lines, one field per line')
    expect(role).toContain('(`none` is content)')
    expect(role).toContain('A turn the operator typed is free and takes any shape.')
  })
})
