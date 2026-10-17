#!/usr/bin/env bun
// Dispatcher-only file contract. The trusted operator selects input/source paths, never a worker/model.
import { constants, closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { captureLaunchBinding, freeze } from '../hooks/authority'
import type { LaunchBinding } from '../hooks/authority'
import { canonicalTarget, checkOutside, placementFacts, PinnedAuthority, sha256, validateIssuance } from '../omp/authority-store'

export function launchWorkerRoots(env: Readonly<Record<string, string | undefined>>, cwd: string, extra: readonly string[] = []): readonly string[] {
  const roots = [placementFacts(cwd).worktree, ...extra]
  for (const value of (env.SEAT_MODS_ALLOW ?? '').split(':')) if (value !== '') roots.push(canonicalTarget(value))
  for (const name of ['REPORT_PATH', 'MOLT_STATUS_PATH', 'AUTONOMIC_PAIN_PATH', 'AUTONOMIC_LEDGER']) {
    const value = env[name]
    if (value) roots.push(dirname(canonicalTarget(value)))
  }
  if (env.SCRATCH_DIR) roots.push(canonicalTarget(env.SCRATCH_DIR))
  return freeze([...new Set(roots.map(canonicalTarget))])
}
export function issueAuthority(inputPath: string, authorityRoot: string, workerRoots: readonly string[]): LaunchBinding {
  if (workerRoots.length === 0) throw new Error('complete worker allowance required')
  const roots = workerRoots.map(canonicalTarget), root = canonicalTarget(authorityRoot)
  checkOutside(root, roots)
  const issued = validateIssuance(inputPath, roots)
  if (!roots.includes(issued.snapshot.placement.worktree)) throw new Error('assignment worktree omitted from launch allowance')
  const directory = join(root, encodeURIComponent(issued.snapshot.seat.launchId))
  checkOutside(directory, roots)
  // No overwrite or same-launch upgrade. A material new assignment always needs a new launch ID/process.
  mkdirSync(root, { recursive: true, mode: 0o700 }); canonicalTarget(root)
  mkdirSync(directory, { mode: 0o700 }); canonicalTarget(directory)
  const write = (path: string, bytes: Uint8Array | string): void => {
    checkOutside(path, roots); canonicalTarget(dirname(path))
    const temp = path + '.new', fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try { writeFileSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
    canonicalTarget(dirname(path)); renameSync(temp, path)
  }
  mkdirSync(join(directory, 'evidence'), { mode: 0o700 }); mkdirSync(join(directory, 'policy'), { mode: 0o700 })
  const written = new Set<string>()
  for (const material of issued.material) {
    const target = material.ref.id === issued.snapshot.policy.id ? join(directory, 'policy', issued.snapshot.policy.sha256 + '.json') : join(directory, 'evidence', material.ref.sha256)
    if (!written.has(target)) { write(target, material.text); written.add(target) }
  }
  write(join(directory, 'provenance.json'), JSON.stringify({ version: 1, inputPath: canonicalTarget(inputPath), inputSha256: sha256(issued.bytes), inputIdentity: issued.identity }))
  // Recheck independently selected source/input bytes immediately before publishing the launch snapshot.
  const final = validateIssuance(inputPath, roots)
  if (sha256(final.bytes) !== sha256(issued.bytes) || JSON.stringify(final.identity) !== JSON.stringify(issued.identity)) throw new Error('issuance changed before publication')
  const path = join(directory, 'snapshot.json')
  write(path, issued.snapshotBytes)
  for (const dir of [join(directory, 'evidence'), join(directory, 'policy'), directory, root]) {
    const fd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try { fsyncSync(fd) } finally { closeSync(fd) }
  }
  return freeze({ path, sha256: sha256(issued.snapshotBytes), assignmentId: issued.snapshot.assignmentId, generation: issued.snapshot.generation, launchId: issued.snapshot.seat.launchId })
}
function main(args: string[]): void {
  const [mode, ...rest] = args
  if (mode !== 'issue' && mode !== 'validate-launch') throw new Error('expected issue or validate-launch')
  const values: Record<string, string> = {}, roots: string[] = []
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i], value = rest[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error('flag requires value')
    if (flag === '--worker-root') roots.push(canonicalTarget(value))
    else if (mode === 'issue' && (flag === '--input' || flag === '--authority-root') && !Object.hasOwn(values, flag)) values[flag] = value
    else throw new Error('unknown or duplicate scalar flag')
  }
  if (mode === 'issue') {
    if (!values['--input'] || !values['--authority-root']) throw new Error('issue requires trusted input and authority root')
    console.log(JSON.stringify(issueAuthority(values['--input'], values['--authority-root'], roots)))
  } else {
    const binding = captureLaunchBinding(process.env)
    if (!binding) throw new Error('validate-launch requires a trusted startup binding')
    const allowance = launchWorkerRoots(process.env, process.cwd(), roots)
    const authority = new PinnedAuthority(binding, allowance)
    const lease = authority.lease('launch-preflight', placementFacts(process.cwd()))
    if (!lease.fresh()) throw new Error('authority changed during preflight')
    console.log(JSON.stringify({ valid: true, assignmentId: binding.assignmentId, generation: binding.generation, launchId: binding.launchId }))
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(process.argv.slice(2)) } catch { console.error('autonomic authority: invalid or unavailable trusted authority; fresh trusted launch required'); process.exitCode = 2 }
}
