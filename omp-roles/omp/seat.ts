// omp-seat's logic: where the three extensions are installed, and the omp command line for a role.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { installPaths } from './bin-path'

export const MODS = ['seat-mods', 'molt', 'autonomic'] as const
// The first version of each mod that ships omp/extension.ts.
const FIRST_OMP: Record<(typeof MODS)[number], string> = { 'seat-mods': '0.4.0', molt: '0.3.0', autonomic: '0.6.0' }
export const ROLES: Record<string, string | undefined> = { worker: undefined }   // role → roles/<file>.md

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

export function planLaunch(o: { role: string; via: string; args: string[]; ompRecord: string; claudeRecord: string; rolesDir?: string }):
  { argv: string[]; warnings: string[]; extensions: string[] } | { error: string } {
  if (!Object.hasOwn(ROLES, o.role)) return { error: `omp-seat: unknown role "${o.role}" (known: ${Object.keys(ROLES).join(', ')})` }
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
    const ext = join(root, 'omp', 'extension.ts')
    if (!existsSync(ext)) return { error: `omp-seat: ${ext} is missing — install ${mod} ${FIRST_OMP[mod]} or later` }
    argv.push('-e', ext)
    extensions.push(ext)
  }
  const file = ROLES[o.role]
  if (file !== undefined) {
    const path = join(o.rolesDir ?? '', file)
    if (!existsSync(path)) return { error: `omp-seat: role file ${path} is missing` }
    argv.push('--append-system-prompt', path)
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
