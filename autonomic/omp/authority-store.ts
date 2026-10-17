import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { absolutePath, captureLaunchBinding, evidenceRef, exactObject, exactRef, freeze, hash, narrows, opaque, parseSnapshot, rolePermits } from '../hooks/authority'
import type { AuthorityLease, EvidenceMaterial, FileIdentity, GuardRole, LaunchBinding, PlacementFacts, Snapshot } from '../hooks/authority'
import { parseUniqueJSON } from '../hooks/strict-json'

export type MoltTransition = { reason: 'new'; predecessor: string; successor: string; previousSessionFile: string; predecessorSessionFile: string; predecessorStage: string; lineageText: string; successorStage: string }
const MAX_MATERIAL = 64000
export function sha256(bytes: Uint8Array | string): string { return createHash('sha256').update(bytes).digest('hex') }
function sameIdentity(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs
}
export function canonicalTarget(path: string): string {
  absolutePath(path)
  let current = '/', missing = false
  for (const part of path.split('/').slice(1)) {
    if (part === '') continue
    current = join(current, part)
    if (missing) continue
    try {
      const stat = lstatSync(current)
      if (stat.isSymbolicLink() || realpathSync(current) !== current) throw new Error('symlink/redirect in protected path')
    } catch (err) {
      if (!(err instanceof Error) || !('code' in err) || err.code !== 'ENOENT') throw err
      missing = true
    }
  }
  return current
}
export function readCoherent(path: string, maxBytes: number): { bytes: Uint8Array; identity: FileIdentity } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('invalid read bound')
  canonicalTarget(path)
  const pathBefore = lstatSync(path, { bigint: true })
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = fstatSync(fd, { bigint: true })
    if (!before.isFile() || !pathBefore.isFile() || before.dev !== pathBefore.dev || before.ino !== pathBefore.ino || before.size > BigInt(maxBytes)) throw new Error('not a bounded coherent regular file')
    const buffer = Buffer.alloc(maxBytes + 1)
    let size = 0
    while (size < buffer.length) {
      const n = readSync(fd, buffer, size, buffer.length - size, null)
      if (n === 0) break
      size += n
    }
    const after = fstatSync(fd, { bigint: true }), pathAfter = lstatSync(path, { bigint: true })
    const identity: FileIdentity = { dev: String(before.dev), ino: String(before.ino), size: Number(before.size), mtimeNs: String(before.mtimeNs), ctimeNs: String(before.ctimeNs) }
    for (const stat of [pathBefore, after, pathAfter]) {
      const other: FileIdentity = { dev: String(stat.dev), ino: String(stat.ino), size: Number(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) }
      if (!stat.isFile() || !sameIdentity(identity, other)) throw new Error('file changed during coherent read')
    }
    canonicalTarget(path)
    if (size > maxBytes || size !== identity.size) throw new Error('over-limit or short coherent read')
    return { bytes: buffer.subarray(0, size), identity: freeze(identity) }
  } finally { closeSync(fd) }
}
export function checkOutside(path: string, workerRoots: readonly string[]): void {
  const target = canonicalTarget(path)
  for (const raw of workerRoots) {
    const root = canonicalTarget(raw)
    if (target === root || target.startsWith(root === '/' ? '/' : root + '/') || root.startsWith(target === '/' ? '/' : target + '/')) throw new Error('authority/provenance overlaps worker allowance')
  }
}
function json(bytes: Uint8Array): unknown { return parseUniqueJSON(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
function material(value: unknown): EvidenceMaterial {
  const o = exactObject(value, ['ref', 'text'])
  if (typeof o.text !== 'string' || Buffer.byteLength(o.text) > MAX_MATERIAL) throw new Error('invalid material text')
  return { ref: evidenceRef(o.ref), text: o.text }
}
export type Issuance = {
  snapshot: Snapshot; snapshotBytes: Uint8Array; material: EvidenceMaterial[]; approval: EvidenceMaterial; delegation: EvidenceMaterial | null
  bytes: Uint8Array; identity: FileIdentity
}
// The trusted dispatcher selects inputPath outside all worker roots. Self-asserted source paths are not trust.
export function validateIssuance(inputPath: string, workerRoots: readonly string[]): Issuance {
  checkOutside(inputPath, workerRoots); checkOutside(dirname(inputPath), workerRoots)
  const input = readCoherent(inputPath, 512000), o = exactObject(json(input.bytes), ['snapshot', 'material', 'approval', 'delegation'])
  const snapshotBytes = new TextEncoder().encode(JSON.stringify(o.snapshot)), snapshot = parseSnapshot(snapshotBytes)
  if (!Array.isArray(o.material)) throw new Error('material must be a finite list')
  const materials = o.material.map(material), approval = material(o.approval), delegation = o.delegation === null ? null : material(o.delegation)
  const seen = new Map<string, EvidenceMaterial>()
  for (const m of [...materials, approval, ...(delegation ? [delegation] : [])]) {
    if (seen.has(m.ref.id)) throw new Error('duplicate material ID')
    seen.set(m.ref.id, m)
    checkOutside(m.ref.source, workerRoots); checkOutside(dirname(m.ref.source), workerRoots)
    if (m.ref.source === inputPath) throw new Error('circular input source')
    const original = readCoherent(m.ref.source, MAX_MATERIAL)
    if (sha256(original.bytes) !== m.ref.sha256 || sha256(m.text) !== m.ref.sha256 || new TextDecoder('utf-8', { fatal: true }).decode(original.bytes) !== m.text) throw new Error('material source/digest mismatch')
  }
  const event = exactObject(parseUniqueJSON(approval.text), ['version', 'kind', 'id', 'operatorId', 'snapshotSha256', 'delegationSha256', 'assignments'])
  if (event.version !== 1 || event.kind !== 'operator-approval' || opaque(event.id) !== approval.ref.id || approval.ref.locator !== event.id || opaque(event.operatorId).trim() === '' || hash(event.snapshotSha256) !== sha256(snapshotBytes)) throw new Error('unapproved snapshot/event identity')
  if (!Array.isArray(event.assignments) || event.assignments.length === 0) throw new Error('missing explicit assignment membership')
  const assignments = new Set<string>()
  let member = false
  for (const value of event.assignments) {
    const a = exactObject(value, ['assignmentId', 'briefSha256']), id = opaque(a.assignmentId), brief = hash(a.briefSha256)
    if (assignments.has(id)) throw new Error('duplicate assignment membership')
    assignments.add(id)
    if (id === snapshot.assignmentId && brief === snapshot.task.briefSha256) member = true
  }
  if (!member || snapshot.issuer.approvalRef !== approval.ref.id || snapshot.policy.approvalRef !== approval.ref.id) throw new Error('unresolved task/policy approval')
  // Event bytes hash the snapshot. Snapshot references may never hash that event or the issuance document.
  const refs = [...snapshot.task.scopeRefs, ...snapshot.task.instructionRefs]
  if ([...refs, ...materials.map(m => m.ref)].some(r => r.id === approval.ref.id || r.source === approval.ref.source || r.sha256 === approval.ref.sha256 || r.source === inputPath) || snapshot.policy.sha256 === approval.ref.sha256 || snapshot.task.briefSha256 === approval.ref.sha256) throw new Error('circular approval provenance')
  for (const ref of refs) {
    const m = seen.get(ref.id)
    if (!m || JSON.stringify(m.ref) !== JSON.stringify(ref) || m === approval || m === delegation) throw new Error('unresolved bounded evidence')
  }
  if (!refs.some(r => r.sha256 === snapshot.task.briefSha256)) throw new Error('brief bytes are not pinned task evidence')
  const policy = seen.get(snapshot.policy.id)
  if (!policy || policy === approval || policy === delegation || policy.ref.sha256 !== snapshot.policy.sha256) throw new Error('missing pinned policy material')
  const allowedRefs = new Set([approval.ref.id, ...refs.map(r => r.id)])
  if (snapshot.issuer.kind === 'operator') {
    if (delegation !== null || event.delegationSha256 !== null || snapshot.issuer.id !== event.operatorId) throw new Error('forged direct operator issuance')
  } else {
    if (!delegation || snapshot.issuer.delegationRef !== delegation.ref.id || hash(event.delegationSha256) !== delegation.ref.sha256) throw new Error('missing recorded bounded delegation')
    const parent = parseSnapshot(new TextEncoder().encode(delegation.text))
    if (parent.issuer.kind !== 'operator' || parent.issuer.id !== event.operatorId || !narrows(snapshot, parent)) throw new Error('delegated grant expansion')
    allowedRefs.add(delegation.ref.id)
  }
  for (const g of snapshot.grants) {
    if (!rolePermits(snapshot.seat.role, g.operation) || g.authorityRefs.some(id => !allowedRefs.has(id)) || g.resource.repository !== snapshot.placement.repository) throw new Error('grant exceeds role/task approval')
    const r = g.resource
    if (r.kind === 'paths' && g.operation !== 'task-output.write' && r.roots.some(p => p !== snapshot.placement.worktree && !p.startsWith(snapshot.placement.worktree + '/'))) throw new Error('worktree resource escapes task')
    if (r.kind === 'paths' && g.operation === 'task-output.write' && r.roots.some(p => !workerRoots.some(root => p === root || p.startsWith(root + '/')))) throw new Error('output resource escapes allowance')
    if (r.kind === 'commit' && (r.branch !== snapshot.placement.branch || r.paths.some(p => p !== snapshot.placement.worktree && !p.startsWith(snapshot.placement.worktree + '/')))) throw new Error('commit escapes task')
    if (r.kind === 'push' && (r.sourceRef !== snapshot.placement.branch || r.destinationRef !== snapshot.placement.branch)) throw new Error('push is not exact own task branch')
    if (r.kind === 'pr' && r.headRef !== snapshot.placement.branch) throw new Error('PR escapes task branch')
    for (const p of r.kind === 'paths' ? r.roots : r.kind === 'commit' ? r.paths : []) canonicalTarget(p)
  }
  return { snapshot, snapshotBytes, material: materials, approval, delegation, bytes: input.bytes, identity: input.identity }
}

// A spawn that never ran — the 1000 ms timeout on a loaded host, EAGAIN, ENOMEM — says nothing
// about the authority: it is marked, so it stales only the decisions in flight instead of
// suspending the pinned authority for the life of the process.
class TransientGitFailure extends Error {}
// Reads only the named local git facts. No fetch/authentication/network; failure is unavailable authority.
function git(cwd: string, args: string[], optional = false): string {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 1000, maxBuffer: 256000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' } })
  if (result.error !== undefined) throw new TransientGitFailure(`the local authority placement check could not run: ${result.error.message}`)
  if (result.status !== 0) { if (optional && result.status === 1) return ''; throw new Error('local authority placement check failed') }
  return result.stdout.trim()
}
export function placementFacts(cwd: string): PlacementFacts {
  const worktree = canonicalTarget(git(cwd, ['rev-parse', '--show-toplevel']))
  const common = canonicalTarget(git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
  const branch = git(cwd, ['symbolic-ref', '-q', 'HEAD'], true) || null
  const sourceRefs: Record<string, string> = {}
  if (branch) sourceRefs[branch] = git(cwd, ['rev-parse', '--verify', branch])
  const defaultRef = git(cwd, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], true)
  // Configured remote URLs (Plan Task 5 §7 Step 3; U1): a bounded, read-only local query, so a
  // gh PR/API mutation can resolve its exact repository from the pinned facts. No network.
  const remotes: Record<string, string> = {}
  for (const line of git(cwd, ['config', '--get-regexp', '^remote\\..*\\.url$'], true).split('\n')) {
    const at = line.indexOf(' ')
    if (at < 0) continue
    const name = line.slice(0, at).replace(/^remote\./, '').replace(/\.url$/, '')
    if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) remotes[name] = line.slice(at + 1).trim()
  }
  return freeze({ repository: dirname(common), worktree, cwd: canonicalTarget(cwd), branch, sourceRefs, defaultRefs: defaultRef ? [defaultRef] : [], protectedRefs: [], remotes, targets: {} })
}
function checkPlacement(snapshot: Snapshot, facts: PlacementFacts): void {
  const live = placementFacts(facts.cwd)
  if (live.repository !== snapshot.placement.repository || live.worktree !== snapshot.placement.worktree || facts.repository !== live.repository || facts.worktree !== live.worktree || facts.branch !== live.branch || live.branch !== snapshot.placement.branch) throw new Error('authority placement/ref mismatch')
  for (const [ref, oid] of Object.entries(facts.sourceRefs)) {
    exactRef(ref)
    if (!/^[a-f0-9]{40,64}$/.test(oid) || git(facts.cwd, ['rev-parse', '--verify', ref]) !== oid) throw new Error('authority source ref changed')
  }
  if (!Object.hasOwn(facts.sourceRefs, snapshot.placement.branch)) throw new Error('missing task ref fact')
  for (const [remote, url] of Object.entries(facts.remotes)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote) || git(facts.cwd, ['config', '--get', `remote.${remote}.url`]) !== url) throw new Error('remote changed')
  }
  for (const [path, target] of Object.entries(facts.targets)) if (canonicalTarget(path) !== target) throw new Error('target changed')
  const forbidden = [...facts.defaultRefs, ...facts.protectedRefs, ...live.defaultRefs].map(exactRef)
  if (snapshot.grants.some(g => g.resource.kind === 'push' && forbidden.some(ref => ref === g.resource.destinationRef || ref.replace(/^refs\/remotes\/[^/]+\//, 'refs/heads/') === g.resource.destinationRef))) throw new Error('protected/default destination')
}

export class PinnedAuthority {
  private readonly binding: LaunchBinding | undefined
  private readonly roots: readonly string[]
  private readonly role: string
  private controller = new AbortController()
  private epoch = 0
  private session: string | undefined
  private invalid = false
  private suspended = false
  private identities = new Map<string, { identity: FileIdentity; digest: string }>()
  constructor(binding: LaunchBinding | undefined, workerRoots: readonly string[]) {
    this.binding = binding === undefined ? undefined : freeze({ ...binding })
    this.roots = freeze([...workerRoots])
    this.role = process.env.SEAT_MODS_ROLE || 'implementer'
  }
  get signal(): AbortSignal { return this.controller.signal }
  invalidate(): void { this.invalid = true; this.suspend() }
  suspend(): void { this.suspended = true; this.epoch++; this.controller.abort() }
  private read(path: string, limit: number): { bytes: Uint8Array; identity: FileIdentity } {
    checkOutside(path, this.roots); checkOutside(dirname(path), this.roots)
    const read = readCoherent(path, limit), digest = sha256(read.bytes), prior = this.identities.get(path)
    if (prior && (!sameIdentity(prior.identity, read.identity) || prior.digest !== digest)) throw new Error('pinned authority material replaced')
    this.identities.set(path, { identity: read.identity, digest })
    return read
  }
  private validate(facts: PlacementFacts): { snapshot: Snapshot; identity: FileIdentity; evidence: EvidenceMaterial[]; policyText: string } {
    const b = this.binding
    if (!b) throw new Error('no trusted startup authority')
    // Reuse the startup parser to reject manually constructed malformed bindings too.
    captureLaunchBinding({ AUTONOMIC_AUTHORITY_PATH: b.path, AUTONOMIC_AUTHORITY_SHA256: b.sha256, AUTONOMIC_ASSIGNMENT_ID: b.assignmentId, AUTONOMIC_ASSIGNMENT_GENERATION: String(b.generation), AUTONOMIC_LAUNCH_ID: b.launchId })
    const read = this.read(b.path, 64000), snapshot = parseSnapshot(read.bytes)
    if (sha256(read.bytes) !== b.sha256 || snapshot.assignmentId !== b.assignmentId || snapshot.generation !== b.generation || snapshot.seat.launchId !== b.launchId || snapshot.seat.role !== this.role) throw new Error('startup authority identity mismatch')
    if (!this.roots.includes(snapshot.placement.worktree)) throw new Error('launch omits assignment worktree allowance')
    checkPlacement(snapshot, facts)
    const receipt = exactObject(json(this.read(join(dirname(b.path), 'provenance.json'), 512000).bytes), ['version', 'inputPath', 'inputSha256', 'inputIdentity'])
    if (receipt.version !== 1) throw new Error('unsupported provenance receipt')
    const inputPath = absolutePath(receipt.inputPath), input = this.read(inputPath, 512000)
    const identity = exactObject(receipt.inputIdentity, ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'])
    if (receipt.inputSha256 !== sha256(input.bytes) || JSON.stringify(identity) !== JSON.stringify(input.identity)) throw new Error('trusted issuance input replaced')
    const issued = validateIssuance(inputPath, this.roots)
    if (sha256(issued.snapshotBytes) !== b.sha256) throw new Error('snapshot is not recorded approval')
    for (const m of [...issued.material, issued.approval, ...(issued.delegation ? [issued.delegation] : [])]) {
      if (sha256(this.read(m.ref.source, MAX_MATERIAL).bytes) !== m.ref.sha256) throw new Error('source changed')
    }
    for (const m of issued.material) {
      const target = m.ref.id === snapshot.policy.id ? join(dirname(b.path), 'policy', snapshot.policy.sha256 + '.json') : join(dirname(b.path), 'evidence', m.ref.sha256)
      if (sha256(this.read(target, MAX_MATERIAL).bytes) !== m.ref.sha256) throw new Error('materialized evidence changed')
    }
    return { snapshot, identity: read.identity, evidence: issued.material, policyText: issued.material.find(m => m.ref.id === snapshot.policy.id)!.text }
  }
  /**
   * The cheap freshness check a decision makes in line — and on every input event: one bounded read
   * of the stored authority record, checked against the launch binding's own digest and identity,
   * plus the revocation, expiry and assignment-generation facts that record carries (parseSnapshot
   * refuses a revoked, expired or malformed lifetime outright). The heavy pipeline — the provenance
   * receipt, the issuance input, every material source and the placement facts with their git
   * spawns — belongs to `validate()`, which is what a capture calls: re-running it here cost eight
   * sequential git spawns and megabytes of re-reads inside every decision, six or seven times over.
   * A detected change invalidates; only a spawn that never ran is transient.
   */
  private assertStoredRecord(): void {
    const b = this.binding
    if (b === undefined) throw new Error('no trusted startup authority')
    const record = this.read(b.path, 64000)
    if (sha256(record.bytes) !== b.sha256) throw new Error('stored authority record changed')
    const snapshot = parseSnapshot(record.bytes)
    if (snapshot.assignmentId !== b.assignmentId || snapshot.generation !== b.generation || snapshot.seat.launchId !== b.launchId) throw new Error('stored authority identity changed')
  }
  lease(sessionId: string, facts: PlacementFacts): AuthorityLease {
    if (this.invalid || this.suspended) throw new Error('authority suspended; fresh trusted launch required')
    try {
      opaque(sessionId)
      if (this.session !== undefined && this.session !== sessionId) throw new Error('session changed without explicit revalidation')
      const captured = freeze(structuredClone(facts)), current = this.validate(captured)
      this.session = sessionId
      const epoch = this.epoch, binding = this.binding!
      return freeze({ snapshot: current.snapshot, binding, identity: current.identity, evidence: current.evidence,
        policyText: current.policyText, policyDigest: current.snapshot.policy.sha256, sessionId, epoch,
        fresh: () => {
          if (this.invalid || this.suspended || this.session !== sessionId || this.epoch !== epoch) return false
          try { this.assertStoredRecord(); return true } catch (err) {
            // Fail-closed for this decision either way, but only a real change suspends the
            // authority: a transient failure moves the epoch, so every outstanding lease reads
            // stale and the next decision re-attempts the same pinned record.
            if (err instanceof TransientGitFailure) this.epoch++
            else this.invalidate()
            return false
          }
        } })
    } catch (err) {
      // Same rule at capture: a read that could not run stales the decisions in flight, while a
      // real mismatch invalidates permanently and needs a fresh trusted launch.
      if (err instanceof TransientGitFailure) this.epoch++
      else this.invalidate()
      throw err
    }
  }
  revalidateMolt(transition: MoltTransition, facts: PlacementFacts): AuthorityLease {
    this.suspend()
    if (this.invalid || transition.reason !== 'new' || transition.predecessor !== this.session || transition.successor === transition.predecessor || transition.previousSessionFile !== transition.predecessorSessionFile) throw new Error('unobserved Molt transition; fresh trusted launch required')
    // 18.8.9 exposes reason:new and mutable lineage/stage, but not Molt's private pending ownership.
    // Those facts cannot distinguish a generic /new plus copied lineage. Never manufacture that proof.
    this.validate(facts)
    throw new Error('public host evidence cannot authenticate Molt ownership; fresh trusted launch required')
  }
}
