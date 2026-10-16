import { posix } from 'node:path'
import { parseUniqueJSON } from './strict-json'

export type GuardRole = 'implementer' | 'verifier' | 'reviewer' | 'coordinator' | 'orchestrator'
export type Operation = 'worktree.read' | 'worktree.build' | 'worktree.test' | 'worktree.lint' | 'worktree.edit' | 'git.commit' | 'git.push-own-branch' | 'pr.create-own' | 'pr.update-own' | 'task-output.write'
export type EvidenceRef = { id: string; source: string; sha256: string; locator: string }
export type Resource =
  | { kind: 'paths'; repository: string; roots: string[] }
  | { kind: 'commit'; repository: string; branch: string; paths: string[] }
  | { kind: 'push'; repository: string; remote: string; sourceRef: string; destinationRef: string }
  | { kind: 'pr'; repository: string; headRef: string; number: number | null }
export type Grant = { id: string; operation: Operation; resource: Resource; authorityRefs: string[] }
export type Snapshot = {
  version: 1; assignmentId: string; generation: number
  issuer: { kind: 'operator' | 'delegated-dispatcher'; id: string; approvalRef: string; delegationRef: string | null }
  seat: { id: string; host: 'omp'; role: GuardRole; launchId: string }
  placement: { repository: string; worktree: string; branch: string }
  task: { briefSha256: string; scopeRefs: EvidenceRef[]; instructionRefs: EvidenceRef[] }
  policy: { id: string; sha256: string; approvalRef: string }
  grants: Grant[]
  lifetime: { issuedAt: string; expiresAt: string | null; revoked: boolean }
}
export type LaunchBinding = Readonly<{ path: string; sha256: string; assignmentId: string; generation: number; launchId: string }>
export type EvidenceMaterial = { ref: EvidenceRef; text: string }
export type FileIdentity = Readonly<{ dev: string; ino: string; size: number; mtimeNs: string; ctimeNs: string }>
export type PlacementFacts = Readonly<{
  repository: string; worktree: string; cwd: string; branch: string | null
  sourceRefs: Readonly<Record<string, string>>; defaultRefs: readonly string[]; protectedRefs: readonly string[]
  remotes: Readonly<Record<string, string>>; targets: Readonly<Record<string, string>>
}>
export type AuthorityLease = Readonly<{
  snapshot: Snapshot; binding: LaunchBinding; identity: FileIdentity; sessionId: string; epoch: number
  evidence: readonly EvidenceMaterial[]; policyText: string; policyDigest: string; fresh: () => boolean
}>

// These decoders are also the closed-input boundary for the issuer's provenance records.
export function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object')
  const object = value as Record<string, unknown> // Object shape established above; individual members remain unknown.
  if (Object.keys(object).length !== keys.length || keys.some(k => !Object.hasOwn(object, k))) throw new Error('unknown or missing field')
  return object
}
export function opaque(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('invalid opaque string')
  return value
}
export function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('invalid SHA256')
  return value
}
export function absolutePath(value: unknown): string {
  const path = opaque(value)
  if (!path.startsWith('/') || /[\*?\[\]{}\\]/.test(path) || posix.normalize(path) !== path || path.includes('//')) throw new Error('path must be absolute, normalized and literal')
  return path
}
export function exactRef(value: unknown): string {
  const ref = opaque(value)
  if (!ref.startsWith('refs/') || !/^refs\/(?:[^\s~^:?*\[\\\x00-\x20]+\/)*[^\s~^:?*\[\\\x00-\x20]+$/.test(ref) || ref.includes('..') || ref.includes('@{') || ref.endsWith('.') || ref.split('/').some(p => p === '' || p.startsWith('.') || p.endsWith('.lock'))) throw new Error('invalid full exact ref')
  return ref
}
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('expected positive safe integer')
  return value
}
function list<T>(value: unknown, decode: (v: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error('expected finite list')
  return value.map(decode)
}
function strings(value: unknown, decode: (v: unknown) => string = opaque): string[] {
  const result = list(value, decode)
  if (new Set(result).size !== result.length) throw new Error('duplicate list value')
  return result
}
export function evidenceRef(value: unknown): EvidenceRef {
  const o = exactObject(value, ['id', 'source', 'sha256', 'locator'])
  return { id: opaque(o.id), source: absolutePath(o.source), sha256: hash(o.sha256), locator: opaque(o.locator) }
}
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value) }
  return value
}
function utc(value: unknown): string {
  const time = opaque(value)
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(time)) throw new Error('expected UTC RFC3339')
  const parsed = new Date(time)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== time.slice(0, 19)) throw new Error('invalid UTC calendar date')
  return time
}
const OPERATIONS: Record<Operation, Resource['kind']> = {
  'worktree.read': 'paths', 'worktree.build': 'paths', 'worktree.test': 'paths', 'worktree.lint': 'paths',
  'worktree.edit': 'paths', 'git.commit': 'commit', 'git.push-own-branch': 'push', 'pr.create-own': 'pr', 'pr.update-own': 'pr', 'task-output.write': 'paths',
}
const ROLES: Record<GuardRole, true> = { implementer: true, verifier: true, reviewer: true, coordinator: true, orchestrator: true }
function grant(value: unknown): Grant {
  const o = exactObject(value, ['id', 'operation', 'resource', 'authorityRefs']), op = opaque(o.operation)
  if (!Object.hasOwn(OPERATIONS, op)) throw new Error('unknown operation')
  const operation = op as Operation // Membership in the closed operation table established above.
  const r = o.resource
  if (r === null || typeof r !== 'object' || !('kind' in r) || r.kind !== OPERATIONS[operation]) throw new Error('operation/resource mismatch')
  let resource: Resource
  if (r.kind === 'paths') {
    const p = exactObject(r, ['kind', 'repository', 'roots'])
    resource = { kind: 'paths', repository: absolutePath(p.repository), roots: strings(p.roots, absolutePath) }
    if (resource.roots.length === 0) throw new Error('empty path resource')
  } else if (r.kind === 'commit') {
    const p = exactObject(r, ['kind', 'repository', 'branch', 'paths'])
    resource = { kind: 'commit', repository: absolutePath(p.repository), branch: exactRef(p.branch), paths: strings(p.paths, absolutePath) }
    if (resource.paths.length === 0) throw new Error('empty commit resource')
  } else if (r.kind === 'push') {
    const p = exactObject(r, ['kind', 'repository', 'remote', 'sourceRef', 'destinationRef'])
    const remote = opaque(p.remote)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) throw new Error('remote must be an exact configured name')
    resource = { kind: 'push', repository: absolutePath(p.repository), remote, sourceRef: exactRef(p.sourceRef), destinationRef: exactRef(p.destinationRef) }
  } else {
    const p = exactObject(r, ['kind', 'repository', 'headRef', 'number'])
    resource = { kind: 'pr', repository: absolutePath(p.repository), headRef: exactRef(p.headRef), number: operation === 'pr.create-own' && p.number === null ? null : positive(p.number) }
    if (operation === 'pr.create-own' && resource.number !== null) throw new Error('PR create requires null identity')
  }
  const authorityRefs = strings(o.authorityRefs)
  if (authorityRefs.length === 0) throw new Error('grant requires approval reference')
  return { id: opaque(o.id), operation, resource, authorityRefs }
}
export function parseSnapshot(bytes: Uint8Array): Snapshot {
  if (bytes.byteLength > 64000) throw new Error('snapshot exceeds byte limit')
  const o = exactObject(parseUniqueJSON(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), ['version', 'assignmentId', 'generation', 'issuer', 'seat', 'placement', 'task', 'policy', 'grants', 'lifetime'])
  if (o.version !== 1) throw new Error('unsupported authority version')
  const i = exactObject(o.issuer, ['kind', 'id', 'approvalRef', 'delegationRef'])
  if (i.kind !== 'operator' && i.kind !== 'delegated-dispatcher') throw new Error('invalid issuer')
  const delegationRef = i.delegationRef === null ? null : opaque(i.delegationRef)
  if ((i.kind === 'operator') !== (delegationRef === null)) throw new Error('issuer/delegation mismatch')
  const s = exactObject(o.seat, ['id', 'host', 'role', 'launchId']), role = opaque(s.role)
  if (s.host !== 'omp' || !Object.hasOwn(ROLES, role)) throw new Error('invalid seat')
  const p = exactObject(o.placement, ['repository', 'worktree', 'branch']), t = exactObject(o.task, ['briefSha256', 'scopeRefs', 'instructionRefs'])
  const policy = exactObject(o.policy, ['id', 'sha256', 'approvalRef']), l = exactObject(o.lifetime, ['issuedAt', 'expiresAt', 'revoked'])
  const issuedAt = utc(l.issuedAt), expiresAt = l.expiresAt === null ? null : utc(l.expiresAt), now = Date.now()
  if (l.revoked !== false || Date.parse(issuedAt) > now || (expiresAt !== null && (Date.parse(expiresAt) <= now || Date.parse(expiresAt) <= Date.parse(issuedAt)))) throw new Error('revoked or invalid lifetime')
  const snapshot: Snapshot = {
    version: 1, assignmentId: opaque(o.assignmentId), generation: positive(o.generation),
    issuer: { kind: i.kind, id: opaque(i.id), approvalRef: opaque(i.approvalRef), delegationRef },
    seat: { id: opaque(s.id), host: 'omp', role: role as GuardRole, launchId: opaque(s.launchId) }, // Closed role membership checked above.
    placement: { repository: absolutePath(p.repository), worktree: absolutePath(p.worktree), branch: exactRef(p.branch) },
    task: { briefSha256: hash(t.briefSha256), scopeRefs: list(t.scopeRefs, evidenceRef), instructionRefs: list(t.instructionRefs, evidenceRef) },
    policy: { id: opaque(policy.id), sha256: hash(policy.sha256), approvalRef: opaque(policy.approvalRef) },
    grants: list(o.grants, grant), lifetime: { issuedAt, expiresAt, revoked: false },
  }
  if (new Set(snapshot.grants.map(g => g.id)).size !== snapshot.grants.length) throw new Error('duplicate grant ID')
  const refs = new Map<string, EvidenceRef>()
  for (const group of [snapshot.task.scopeRefs, snapshot.task.instructionRefs]) {
    if (new Set(group.map(r => r.id)).size !== group.length) throw new Error('duplicate evidence ID')
    for (const r of group) {
      const prior = refs.get(r.id)
      if (prior && JSON.stringify(prior) !== JSON.stringify(r)) throw new Error('conflicting evidence ID')
      refs.set(r.id, r)
    }
  }
  return freeze(snapshot)
}
function within(path: string, root: string): boolean { return path === root || path.startsWith(root === '/' ? '/' : root + '/') }
export function rolePermits(role: GuardRole, operation: Operation): boolean {
  if (role === 'reviewer' && operation === 'worktree.edit') return false
  return !((role === 'reviewer' || role === 'verifier') && ['git.commit', 'git.push-own-branch', 'pr.create-own', 'pr.update-own'].includes(operation))
}
export function narrows(child: Snapshot, parent: Snapshot): boolean {
  // Assignment membership is resolved from the independent event before this pure resource check.
  if (child.policy.id !== parent.policy.id || child.policy.sha256 !== parent.policy.sha256 || child.placement.repository !== parent.placement.repository || !within(child.placement.worktree, parent.placement.worktree)) return false
  if (child.placement.branch !== parent.placement.branch) return false
  if (parent.lifetime.expiresAt !== null && (child.lifetime.expiresAt === null || Date.parse(child.lifetime.expiresAt) > Date.parse(parent.lifetime.expiresAt))) return false
  const parentRefs = [...parent.task.scopeRefs, ...parent.task.instructionRefs]
  if ([...child.task.scopeRefs, ...child.task.instructionRefs].some(r => !parentRefs.some(p => JSON.stringify(p) === JSON.stringify(r)))) return false
  return child.grants.every(g => rolePermits(child.seat.role, g.operation) && parent.grants.some(p => {
    if (!rolePermits(parent.seat.role, p.operation) || p.operation !== g.operation || p.resource.repository !== g.resource.repository) return false
    const a = g.resource, b = p.resource
    if (a.kind === 'paths' && b.kind === 'paths') return a.roots.every(path => b.roots.some(root => within(path, root)))
    if (a.kind === 'commit' && b.kind === 'commit') return a.branch === b.branch && a.paths.every(path => b.paths.some(root => within(path, root)))
    if (a.kind === 'push' && b.kind === 'push') return a.remote === b.remote && a.sourceRef === b.sourceRef && a.destinationRef === b.destinationRef
    return a.kind === 'pr' && b.kind === 'pr' && a.headRef === b.headRef && a.number === b.number
  }))
}
export function captureLaunchBinding(env: Readonly<Record<string, string | undefined>>): LaunchBinding | undefined {
  const names = ['AUTONOMIC_AUTHORITY_PATH', 'AUTONOMIC_AUTHORITY_SHA256', 'AUTONOMIC_ASSIGNMENT_ID', 'AUTONOMIC_ASSIGNMENT_GENERATION', 'AUTONOMIC_LAUNCH_ID'] as const
  const count = names.filter(n => env[n] !== undefined).length
  if (count === 0) return undefined
  if (count !== names.length || !/^[1-9]\d*$/.test(env.AUTONOMIC_ASSIGNMENT_GENERATION ?? '')) throw new Error('partial or invalid authority launch binding')
  return freeze({ path: absolutePath(env.AUTONOMIC_AUTHORITY_PATH), sha256: hash(env.AUTONOMIC_AUTHORITY_SHA256), assignmentId: opaque(env.AUTONOMIC_ASSIGNMENT_ID), generation: positive(Number(env.AUTONOMIC_ASSIGNMENT_GENERATION)), launchId: opaque(env.AUTONOMIC_LAUNCH_ID) })
}
