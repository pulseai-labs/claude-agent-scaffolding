// omp-seat's logic: where the three extensions are installed, and the omp command line for a role.
import { existsSync, readFileSync } from 'node:fs'
import { semver } from 'bun'
import { join } from 'node:path'
import { installPaths } from './bin-path'

export const MODS = ['seat-mods', 'molt', 'autonomic'] as const
// Minimum supported versions: seat-mods must map seat-reviewer to the reviewer profile;
// molt and autonomic must ship their OMP extensions.
const MIN_VERSION: Record<(typeof MODS)[number], string> = { 'seat-mods': '0.4.1', molt: '0.3.0', autonomic: '0.6.0' }
export const ROLES: Record<string, string | undefined> = {
  worker: undefined, 'spine-driver': 'spine-driver.md', close: 'close.md', 'work-pr': 'work-pr.md',
  orchestrator: 'orchestrator.md',
}   // role → roles/<file>.md
// A role that relies on a newer mod than the floor: the orchestrator needs seat-mods' no-subagent rail (#798) and
// autonomic's live mode file, so the herdr seats it launches inherit autopilot.
const ROLE_MIN: Record<string, Partial<Record<(typeof MODS)[number], string>>> = { orchestrator: { 'seat-mods': '0.4.4', autonomic: '0.7.0' } }
// A role whose procedure is another plugin's skill: the orchestrator follows herdr-crew's orchestrate skill, whose
// "Host: OMP" section ships in 0.2.19. Only omp's own record counts: omp does not discover a Claude Code user-scope
// plugin unless its claude-plugins provider is enabled.
const ROLE_SKILL: Record<string, { plugin: string; min: string }> = { orchestrator: { plugin: 'herdr-crew', min: '0.2.19' } }

export function pinWarning(installed: string, tested: string): string | undefined {
  const v = installed.replace(/^omp\//, '').trim()
  return v === tested ? undefined
    : `omp-seat: omp ${v} is not the tested ${tested}; running anyway — an upgrade is a PR (omp-roles README)`
}

// The `<via> --version` result → a pin warning. A via that cannot run (spawn error, timeout, non-zero exit)
// says nothing about the version, so it gets no warning; the launch reports its own failure.
export function versionWarning(v: { error?: Error; status: number | null; stdout?: string | null }, tested: string): string | undefined {
  if (v.error !== undefined || v.status !== 0) return undefined
  return pinWarning(v.stdout ?? '', tested)
}

export function planLaunch(o: { role: string; via: string; args: string[]; ompRecord: string; claudeRecord: string; rolesDir?: string; roleEnv?: string }):
  { argv: string[]; warnings: string[]; extensions: string[] } | { error: string } {
  if (!Object.hasOwn(ROLES, o.role)) return { error: `omp-seat: unknown role "${o.role}" (known: ${Object.keys(ROLES).join(', ')})` }
  // seat-mods' no-subagent rail (#798) keys on the session's SEAT_MODS_ROLE, which the launcher sets: refuse a top
  // the rail would not cover.
  if (o.role === 'orchestrator' && o.roleEnv !== 'orchestrator')
    return { error: `omp-seat: the orchestrator role needs SEAT_MODS_ROLE=orchestrator (got "${o.roleEnv ?? ''}"); seat-mods' no-subagent rail keys on it` }
  // A record that exists but cannot be read must stop the launch: guessing would start an unguarded seat.
  const read = (record: string): Map<string, string> | { error: string } => {
    try { return installPaths(record) } catch (e) {
      return { error: `omp-seat: unreadable install record ${record} (${(e as Error).message})` }
    }
  }
  const omp = read(o.ompRecord)
  if ('error' in omp) return omp
  const claude = read(o.claudeRecord)
  if ('error' in claude) return claude
  const argv = [o.via]
  const extensions: string[] = []
  for (const mod of MODS) {
    const root = omp.get(mod) ?? claude.get(mod)
    if (root === undefined) return { error: `omp-seat: ${mod} is not installed (looked in ${o.ompRecord} and ${o.claudeRecord})` }
    const min = (Object.hasOwn(ROLE_MIN, o.role) ? ROLE_MIN[o.role][mod] : undefined) ?? MIN_VERSION[mod]
    const ext = join(root, 'omp', 'extension.ts')
    if (!existsSync(ext)) return { error: `omp-seat: ${ext} is missing — install ${mod} ${min} or later` }
    const manifest = join(root, '.claude-plugin', 'plugin.json')
    let version: unknown
    try { version = JSON.parse(readFileSync(manifest, 'utf8')).version } catch (e) {
      return { error: `omp-seat: unreadable version at ${manifest} (${(e as Error).message}) — install ${mod} ${min} or later` }
    }
    if (typeof version !== 'string' || !semver.satisfies(version, `>=${min}`)) {
      return { error: `omp-seat: ${mod} ${version ?? '[unset]'} is unsupported — install ${mod} ${min} or later` }
    }
    argv.push('-e', ext)
    extensions.push(ext)
  }
  const file = ROLES[o.role]
  if (file !== undefined) {
    const path = join(o.rolesDir ?? '', file)
    if (!existsSync(path)) return { error: `omp-seat: role file ${path} is missing` }
    argv.push('--append-system-prompt', path)
  }
  if (Object.hasOwn(ROLE_SKILL, o.role)) {
    const { plugin, min } = ROLE_SKILL[o.role]
    const root = omp.get(plugin)
    if (root === undefined) return { error: `omp-seat: ${o.role} needs ${plugin} ${min} or later installed for omp (omp plugin install ${plugin}@claude-agent-scaffolding); looked in ${o.ompRecord}` }
    const manifest = join(root, '.claude-plugin', 'plugin.json')
    let version: unknown
    try { version = JSON.parse(readFileSync(manifest, 'utf8')).version } catch (e) {
      return { error: `omp-seat: unreadable version at ${manifest} (${(e as Error).message}) — install ${plugin} ${min} or later` }
    }
    if (typeof version !== 'string' || !semver.satisfies(version, `>=${min}`)) {
      return { error: `omp-seat: ${plugin} ${version ?? '[unset]'} is unsupported for ${o.role} — install ${plugin} ${min} or later` }
    }
  }
  return { argv: [...argv, ...o.args], warnings: [], extensions }
}

export function testedVersion(pkgJson: string): string {
  return String(JSON.parse(readFileSync(pkgJson, 'utf8')).ompTested ?? '')
}

// omp captures an extension's import or factory failure per path and starts anyway (doc 017, failure handling),
// which would leave this seat unguarded. Import each pinned extension here first, as omp would.
export async function checkExtensions(paths: string[]): Promise<string | undefined> {
  for (const path of paths) {
    try {
      const mod = await import(path)
      if (typeof mod.default !== 'function') throw new Error('default export is not a function')
    } catch (e) {
      return `omp-seat: ${path} did not load: ${(e as Error).message}`
    }
  }
  return undefined
}
