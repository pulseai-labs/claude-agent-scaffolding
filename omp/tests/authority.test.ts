// Synthetic operator records only. These fixtures never enroll a real worker.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { captureLaunchBinding, narrows, parseSnapshot } from '../../autonomic/hooks/authority'
import type { EvidenceMaterial, LaunchBinding, PlacementFacts, Snapshot } from '../../autonomic/hooks/authority'
import { canonicalTarget, PinnedAuthority, readCoherent } from '../../autonomic/omp/authority-store'
import { issueAuthority } from '../../autonomic/bin/authority'
import factory from '../../autonomic/omp/extension'

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))
const digest = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex')
const roots: string[] = []
// The suite is hermetic to the ambient seat role: PinnedAuthority reads
// SEAT_MODS_ROLE at construction while the fixtures pin seat.role to
// 'implementer', so an ambient guard role would fail every load case.
// Save the incoming value once, neutralize before each test, restore after all.
const ambientSeatRole = process.env.SEAT_MODS_ROLE
beforeEach(() => { delete process.env.SEAT_MODS_ROLE })
afterAll(() => { if (ambientSeatRole === undefined) delete process.env.SEAT_MODS_ROLE; else process.env.SEAT_MODS_ROLE = ambientSeatRole })
afterEach(() => { for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }) })
function snapshotForTest(): Snapshot {
  return {
    version: 1, assignmentId: 'fixture-assignment', generation: 1,
    issuer: { kind: 'operator', id: 'fixture-operator', approvalRef: 'fixture-approval', delegationRef: null },
    seat: { id: 'fixture-seat', host: 'omp', role: 'implementer', launchId: 'fixture-launch' },
    placement: { repository: '/fixture/repo', worktree: '/fixture/tree', branch: 'refs/heads/fixture' },
    task: { briefSha256: 'a'.repeat(64), scopeRefs: [], instructionRefs: [] },
    policy: { id: 'fixture-policy', sha256: 'b'.repeat(64), approvalRef: 'fixture-approval' },
    grants: [], lifetime: { issuedAt: '2026-10-01T00:00:00Z', expiresAt: null, revoked: false },
  }
}
function envFor(b: LaunchBinding) {
  return { AUTONOMIC_AUTHORITY_PATH: b.path, AUTONOMIC_AUTHORITY_SHA256: b.sha256,
    AUTONOMIC_ASSIGNMENT_ID: b.assignmentId, AUTONOMIC_ASSIGNMENT_GENERATION: String(b.generation), AUTONOMIC_LAUNCH_ID: b.launchId }
}
function git(tree: string, ...args: string[]) {
  const r = spawnSync('git', ['-C', tree, ...args], { encoding: 'utf8', timeout: 3000 })
  if (r.status !== 0) throw new Error(`fixture git ${args[0]} failed: ${r.stderr}`)
  return r.stdout.trim()
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'authority-')); roots.push(dir)
  const tree = join(dir, 'tree'), out = join(dir, 'out'), trusted = join(dir, 'trusted'), authority = join(dir, 'authority')
  for (const p of [tree, out, trusted]) mkdirSync(p)
  git(tree, 'init', '-b', 'fixture')
  git(tree, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '--allow-empty', '-m', 'synthetic fixture')
  const s = snapshotForTest()
  s.placement = { repository: tree, worktree: tree, branch: 'refs/heads/fixture' }
  function material(id: string, text: string): EvidenceMaterial {
    const source = join(trusted, id); writeFileSync(source, text)
    return { ref: { id, source, sha256: digest(text), locator: id }, text }
  }
  const brief = material('fixture-brief', 'Synthetic task: test the bounded fixture worktree. No publication.')
  const policy = material('fixture-policy', JSON.stringify({ version: 1, text: 'Synthetic policy; operator gates remain operator-owned.' }))
  s.task = { briefSha256: brief.ref.sha256, scopeRefs: [brief.ref], instructionRefs: [] }
  s.policy.sha256 = policy.ref.sha256
  s.grants = [{ id: 'test', operation: 'worktree.test', resource: { kind: 'paths', repository: tree, roots: [tree] }, authorityRefs: ['fixture-approval'] }]
  const input = join(trusted, 'issuance.json')
  const workerRoots = [tree, out]
  let delegation: EvidenceMaterial | null = null
  function prepare() {
    // Acyclic order: evidence -> snapshot -> external event -> trusted input.
    const approval = material('fixture-approval', JSON.stringify({ version: 1, kind: 'operator-approval',
      id: 'fixture-approval', operatorId: 'fixture-operator', snapshotSha256: digest(bytes(s)),
      delegationSha256: delegation?.ref.sha256 ?? null,
      assignments: [{ assignmentId: s.assignmentId, briefSha256: s.task.briefSha256 }] }))
    const value = { snapshot: s, material: [brief, policy], approval, delegation }
    writeFileSync(input, JSON.stringify(value)); return value
  }
  function issue() { prepare(); return issueAuthority(input, authority, workerRoots) }
  const facts: PlacementFacts = { repository: tree, worktree: tree, cwd: tree, branch: s.placement.branch,
    sourceRefs: { 'refs/heads/fixture': git(tree, 'rev-parse', 'HEAD') }, defaultRefs: [], protectedRefs: [], remotes: {}, targets: {} }
  return { dir, tree, out, trusted, authority, input, workerRoots, s, facts, brief, policy, material, prepare, issue,
    delegate(parent: Snapshot) { delegation = material('fixture-delegation', JSON.stringify(parent)); s.issuer = { kind: 'delegated-dispatcher', id: 'fixture-dispatcher', approvalRef: 'fixture-approval', delegationRef: delegation.ref.id } } }
}

describe('closed snapshot schema and finite narrowing', () => {
  test('nested duplicate keys cannot erase a restriction', () => {
    expect(() => parseSnapshot(new TextEncoder().encode(JSON.stringify(snapshotForTest()).replace('"revoked":false', '"revoked":true,"revoked":false')))).toThrow()
  })
  test('empty grant set grants no bounded operation; an explicit parent permits its subset only', () => {
    const parent = snapshotForTest(), child = structuredClone(parent)
    child.grants = [{ id: 'test', operation: 'worktree.test', resource: { kind: 'paths', repository: '/fixture/repo', roots: ['/fixture/tree/unit'] }, authorityRefs: ['fixture-approval'] }]
    expect(narrows(child, parent)).toBe(false)
    parent.grants = [{ ...child.grants[0], resource: { kind: 'paths', repository: '/fixture/repo', roots: ['/fixture/tree'] } }]
    expect(narrows(child, parent)).toBe(true)
    child.grants[0].resource = { kind: 'paths', repository: '/fixture/repo', roots: ['/fixture/tree-other'] }
    expect(narrows(child, parent)).toBe(false)
  })
  const invalid: Array<[string, (s: Snapshot) => unknown]> = [
    ['unknown nested field', s => ({ ...s, seat: { ...s.seat, extra: true } })],
    ['unsafe generation', s => ({ ...s, generation: 9007199254740992 })],
    ['invalid calendar', s => ({ ...s, lifetime: { ...s.lifetime, issuedAt: '2026-02-30T00:00:00Z' } })],
    ['future issue', s => ({ ...s, lifetime: { ...s.lifetime, issuedAt: '9999-01-01T00:00:00Z' } })],
    ['expired', s => ({ ...s, lifetime: { ...s.lifetime, expiresAt: '2026-10-01T00:00:01Z' } })],
    ['revoked', s => ({ ...s, lifetime: { ...s.lifetime, revoked: true } })],
    ['short hash', s => ({ ...s, task: { ...s.task, briefSha256: 'a' } })],
    ['relative path', s => ({ ...s, placement: { ...s.placement, worktree: 'tree' } })],
    ['glob path', s => ({ ...s, placement: { ...s.placement, worktree: '/fixture/*' } })],
    ['short ref', s => ({ ...s, placement: { ...s.placement, branch: 'fixture' } })],
    ['dispatcher without delegation', s => ({ ...s, issuer: { ...s.issuer, kind: 'delegated-dispatcher' } })],
    ['operation/resource mismatch', s => ({ ...s, grants: [{ id: 'bad', operation: 'git.commit', resource: { kind: 'paths', repository: '/fixture/repo', roots: ['/fixture/tree'] }, authorityRefs: ['fixture-approval'] }] })],
    ['duplicate grant ID', s => { const g = { id: 'bad', operation: 'worktree.read', resource: { kind: 'paths', repository: '/fixture/repo', roots: ['/fixture/tree'] }, authorityRefs: ['fixture-approval'] }; return { ...s, grants: [g, g] } }],
    ['unknown operation', s => ({ ...s, grants: [{ id: 'bad', operation: 'git.merge', resource: { kind: 'commit', repository: '/fixture/repo', branch: 'refs/heads/fixture', paths: ['/fixture/tree'] }, authorityRefs: ['fixture-approval'] }] })],
    ['PR update without identity', s => ({ ...s, grants: [{ id: 'bad', operation: 'pr.update-own', resource: { kind: 'pr', repository: '/fixture/repo', headRef: 'refs/heads/fixture', number: null }, authorityRefs: ['fixture-approval'] }] })],
  ]
  for (const [name, change] of invalid) test(`rejects ${name}`, () => { expect(() => parseSnapshot(bytes(change(snapshotForTest())))).toThrow() })
  test('bounds bytes before decoding, rejects invalid UTF8 and freezes validated nested data', () => {
    const s = snapshotForTest(); s.issuer.id = '界'.repeat(22000)
    expect(() => parseSnapshot(bytes(s))).toThrow()
    expect(() => parseSnapshot(new Uint8Array([0xff]))).toThrow()
    const good = parseSnapshot(bytes(snapshotForTest()))
    expect(Object.isFrozen(good.grants)).toBe(true)
  })
  test('guarded-role ceilings cannot be delegated away', () => {
    const p = snapshotForTest(); p.seat.role = 'coordinator'
    p.grants = [{ id: 'commit', operation: 'git.commit', resource: { kind: 'commit', repository: '/fixture/repo', branch: p.placement.branch, paths: ['/fixture/tree'] }, authorityRefs: ['fixture-approval'] }]
    for (const role of ['reviewer', 'verifier'] as const) { const c = structuredClone(p); c.seat.role = role; expect(narrows(c, p)).toBe(false) }
  })
  test('push narrowing requires exact remote/source/destination', () => {
    const p = snapshotForTest()
    p.grants = [{ id: 'push', operation: 'git.push-own-branch', resource: { kind: 'push', repository: '/fixture/repo', remote: 'origin', sourceRef: p.placement.branch, destinationRef: p.placement.branch }, authorityRefs: ['fixture-approval'] }]
    expect(narrows(p, p)).toBe(true)
    const c = structuredClone(p); if (c.grants[0].resource.kind === 'push') c.grants[0].resource.destinationRef = 'refs/heads/other'
    expect(narrows(c, p)).toBe(false)
  })
  test('narrowing cannot silently move branch-bound edit authority to another ref', () => {
    const parent = snapshotForTest()
    parent.grants = [{ id: 'edit', operation: 'worktree.edit', resource: { kind: 'paths', repository: '/fixture/repo', roots: ['/fixture/tree'] }, authorityRefs: ['fixture-approval'] }]
    const child = structuredClone(parent); child.placement.branch = 'refs/heads/unapproved'
    expect(narrows(child, parent)).toBe(false)
    child.placement.branch = parent.placement.branch
    expect(narrows(child, parent)).toBe(true)
  })
  test('calendar-valid RFC3339 fractional issuance remains valid without millisecond truncation', () => {
    const snapshot = snapshotForTest(); snapshot.lifetime.issuedAt = '2026-10-01T00:00:00.123456Z'
    const parsed = parseSnapshot(bytes(snapshot))
    expect(parsed.lifetime.issuedAt).toBe('2026-10-01T00:00:00.123456Z')
  })
})

describe('real trusted issuer and pinned reader', () => {
  test('acyclic external approval issues bounded authority, reader verifies real bytes, empty grants stay empty', () => {
    const f = fixture(), b = f.issue(), a = new PinnedAuthority(b, f.workerRoots)
    const lease = a.lease('S1', f.facts)
    expect({ operation: lease.snapshot.grants[0].operation, fresh: lease.fresh(), brief: lease.evidence.find(e => e.ref.id === 'fixture-brief')?.text }).toEqual({ operation: 'worktree.test', fresh: true, brief: f.brief.text })
    f.s.seat.launchId = 'empty-launch'; f.s.grants = []
    const empty = new PinnedAuthority(f.issue(), f.workerRoots).lease('S1', f.facts)
    expect(empty.snapshot.grants).toEqual([])
  })
  test('trusted input must be external; claimed text, forged event hash and circular evidence are refused', () => {
    const f = fixture(); const v = f.prepare()
    writeFileSync(f.input, JSON.stringify({ ...v, approval: { ...v.approval, text: v.approval.text.replace('fixture-operator', 'forged') } }))
    expect(() => issueAuthority(f.input, f.authority, f.workerRoots)).toThrow()
    f.prepare(); expect(() => issueAuthority(f.input, f.authority, [...f.workerRoots, f.trusted])).toThrow()
    // The snapshot may name the approval ID, but may not hash the approval source.
    f.s.task.instructionRefs = [v.approval.ref]; f.prepare()
    expect(() => issueAuthority(f.input, f.authority, f.workerRoots)).toThrow()
  })
  test('delegated issuance enforces parent finite bounds and separately recorded membership', () => {
    const f = fixture(); const parent = structuredClone(f.s); parent.seat.role = 'coordinator'; f.delegate(parent)
    const b = f.issue(); expect(new PinnedAuthority(b, f.workerRoots).lease('S1', f.facts).fresh()).toBe(true)
    f.s.seat.launchId = 'expanded-launch'; f.s.grants[0].resource = { kind: 'paths', repository: f.tree, roots: [f.dir] }
    expect(() => f.issue()).toThrow()
  })
  /** Apply one mutation of the issued record or of the world it was read against. */
  function mutate(f: { s: Snapshot; brief: EvidenceMaterial; trusted: string; tree: string }, b: LaunchBinding, mutation: string): void {
    if (mutation === 'replace') { writeFileSync(b.path + '.new', readFileSync(b.path)); renameSync(b.path + '.new', b.path) }
    if (mutation === 'delete') rmSync(b.path)
    if (mutation === 'tamper') writeFileSync(b.path, JSON.stringify({ ...f.s, generation: 2 }))
    if (mutation === 'revoke') writeFileSync(b.path, JSON.stringify({ ...f.s, lifetime: { ...f.s.lifetime, revoked: true } }))
    if (mutation === 'symlink') { renameSync(b.path, b.path + '.saved'); symlinkSync(b.path + '.saved', b.path) }
    if (mutation === 'policy') writeFileSync(join(dirname(b.path), 'policy', f.s.policy.sha256 + '.json'), '{}')
    if (mutation === 'brief') writeFileSync(f.brief.ref.source, 'changed task')
    if (mutation === 'approval') writeFileSync(join(f.trusted, 'fixture-approval'), '{}')
    if (mutation === 'branch') git(f.tree, 'checkout', '-b', 'other')
  }
  // The stored record itself. This is what a decision's own in-line freshness check reads, so the
  // change is seen at once: the lease is stale, the authority is invalidated and the next capture
  // refuses permanently.
  for (const mutation of ['replace', 'delete', 'tamper', 'revoke', 'symlink'] as const) {
    test(`${mutation} invalidates the original lease and aborts outstanding work permanently`, () => {
      const f = fixture(), b = f.issue(), a = new PinnedAuthority(b, f.workerRoots), lease = a.lease('S1', f.facts), signal = a.signal
      mutate(f, b, mutation)
      expect(lease.fresh()).toBe(false); expect(signal.aborted).toBe(true)
      expect(() => a.lease('S1', f.facts)).toThrow()
    })
  }
  // The world the record is read against: a materialized file, a material source, the recorded
  // approval event, the live branch. The in-line check deliberately does not re-run those reads —
  // that pipeline is what a capture pays for — so the change is caught when the next decision
  // captures, which still invalidates the authority permanently and leaves the earlier lease stale
  // by the same invalidation. No capture can release the mutated record either way.
  for (const mutation of ['policy', 'brief', 'approval', 'branch'] as const) {
    test(`${mutation} is refused at the next capture and invalidates the authority permanently`, () => {
      const f = fixture(), b = f.issue(), a = new PinnedAuthority(b, f.workerRoots), lease = a.lease('S1', f.facts), signal = a.signal
      mutate(f, b, mutation)
      expect(() => a.lease('S1', f.facts)).toThrow()
      expect(signal.aborted).toBe(true)
      expect(lease.fresh()).toBe(false)
      expect(() => a.lease('S1', f.facts)).toThrow()
    })
  }
  // F15(a): the in-line check is the stored record only. A git that answers nothing at all must not
  // reach it — re-running the capture pipeline here would throw, invalidate and stale the lease.
  test('the in-line freshness check spawns no git and re-reads no material', () => {
    const f = fixture(), b = f.issue(), a = new PinnedAuthority(b, f.workerRoots), lease = a.lease('S1', f.facts)
    const shim = join(f.dir, 'gitshim'); mkdirSync(shim)
    writeFileSync(join(shim, 'git'), '#!/bin/sh\nexit 42\n'); chmodSync(join(shim, 'git'), 0o700)
    const path = process.env.PATH
    process.env.PATH = `${shim}:${path}`
    try { expect(lease.fresh()).toBe(true) } finally { process.env.PATH = path }
    // The same check still sees a real change to that record.
    writeFileSync(b.path, JSON.stringify({ ...f.s, generation: 2 }))
    expect(lease.fresh()).toBe(false)
  })
  // F15(b): a spawn that never ran is not a statement about the authority. The decision in flight
  // blocks (fail-closed) and the next one proceeds; the pinned record is not suspended.
  test('a transient git failure stales one decision without suspending the authority', () => {
    const f = fixture(), b = f.issue(), a = new PinnedAuthority(b, f.workerRoots), lease = a.lease('S1', f.facts)
    const shim = join(f.dir, 'slowgit'); mkdirSync(shim)
    // A git that never answers inside the store's own 1000 ms bound.
    writeFileSync(join(shim, 'git'), '#!/bin/sh\n/bin/sleep 3\n'); chmodSync(join(shim, 'git'), 0o700)
    const path = process.env.PATH
    process.env.PATH = `${shim}:${path}`
    try {
      expect(() => a.lease('S1', f.facts)).toThrow()
      expect(lease.fresh()).toBe(false)      // the decision in flight is stale: it cannot release
      expect(a.signal.aborted).toBe(false)   // and the pinned authority is not suspended by it
      expect(() => a.lease('S1', f.facts)).toThrow()
    } finally { process.env.PATH = path }
    const next = a.lease('S1', f.facts)
    expect(next.fresh()).toBe(true)
    expect(lease.fresh()).toBe(false)        // the stale decision stays stale
  })
  test('worker overlap in either direction including coordinator worktrees is refused', () => {
    const f = fixture(), b = f.issue()
    for (const root of [dirname(b.path), b.path, f.dir, join(dirname(b.path), '.worktrees')]) {
      expect(() => new PinnedAuthority(b, [...f.workerRoots, root]).lease('S1', f.facts)).toThrow()
    }
  })
  test('symlinked ancestors and over-limit coherent files are refused; missing suffix is canonical', () => {
    const f = fixture(); symlinkSync(f.trusted, join(f.dir, 'link'))
    expect(() => canonicalTarget(join(f.dir, 'link', 'new'))).toThrow()
    expect(canonicalTarget(join(f.trusted, 'not-created', 'child'))).toBe(join(f.trusted, 'not-created', 'child'))
    writeFileSync(join(f.trusted, 'large'), 'é'.repeat(32001))
    expect(() => readCoherent(join(f.trusted, 'large'), 64000)).toThrow()
  })
  test('environment changes cannot rebind a captured generation; generic session switch stays suspended', () => {
    const f = fixture(), b = f.issue(), env = envFor(b), binding = captureLaunchBinding(env), a = new PinnedAuthority(binding, f.workerRoots)
    const old = a.lease('S1', f.facts); env.AUTONOMIC_ASSIGNMENT_GENERATION = '2'; env.AUTONOMIC_AUTHORITY_SHA256 = '0'.repeat(64)
    expect(old.fresh()).toBe(true)
    a.suspend(); expect(old.fresh()).toBe(false); expect(() => a.lease('S2', f.facts)).toThrow()
    expect(() => a.revalidateMolt({ reason: 'new', predecessor: 'S1', successor: 'S2', previousSessionFile: '/forged', predecessorSessionFile: '/forged', predecessorStage: '{}', lineageText: '{"from":"S1"}', successorStage: '{}' }, f.facts)).toThrow()
  })
  test('partial startup, wrong generation/launch/role and mismatched placement never load', () => {
    const f = fixture(), b = f.issue()
    expect(() => captureLaunchBinding({ AUTONOMIC_AUTHORITY_PATH: b.path })).toThrow()
    expect(captureLaunchBinding({})).toBeUndefined()
    for (const binding of [{ ...b, generation: 2 }, { ...b, launchId: 'other' }, { ...b, assignmentId: 'other' }]) expect(() => new PinnedAuthority(binding, f.workerRoots).lease('S1', f.facts)).toThrow()
    expect(() => new PinnedAuthority(b, f.workerRoots).lease('S1', { ...f.facts, branch: 'refs/heads/wrong' })).toThrow()
    const prior = process.env.SEAT_MODS_ROLE; process.env.SEAT_MODS_ROLE = 'reviewer'
    try { expect(() => new PinnedAuthority(b, f.workerRoots).lease('S1', f.facts)).toThrow() } finally { if (prior === undefined) delete process.env.SEAT_MODS_ROLE; else process.env.SEAT_MODS_ROLE = prior }
  })
  test('real CLI and launcher execute a harmless action once and refuse a changed binding before any via probe', () => {
    const f = fixture(); f.prepare()
    const cli = join(import.meta.dir, '../../autonomic/bin/authority.ts')
    const issued = spawnSync('bun', [cli, 'issue', '--input', f.input, '--authority-root', f.authority, ...f.workerRoots.flatMap(p => ['--worker-root', p])], { encoding: 'utf8', timeout: 30000 })
    expect(issued.status).toBe(0)
    const b = JSON.parse(issued.stdout) as LaunchBinding
    const home = join(f.dir, 'home'), receipt = join(f.out, 'action'), via = join(f.out, 'harmless-via')
    const plugins: Record<string, unknown> = {}
    for (const name of ['seat-mods', 'molt', 'autonomic']) plugins[name + '@claude-agent-scaffolding'] = [{ scope: 'user', installPath: join(import.meta.dir, '../..', name) }]
    mkdirSync(join(home, '.omp/plugins'), { recursive: true }); writeFileSync(join(home, '.omp/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins }))
    writeFileSync(via, `#!/bin/sh\nif [ "$1" = --version ]; then printf 'omp/18.8.9'; exit 0; fi\nprintf 'acted\\n' >> '${receipt}'\n`); chmodSync(via, 0o700)
    const env = { ...process.env, HOME: home, ...envFor(b), SEAT_MODS_ROLE: 'implementer', SEAT_MODS_ALLOW: f.out }
    const run = () => spawnSync('bun', [join(import.meta.dir, '../../omp-roles/bin/omp-seat'), 'worker', '--via', via], { cwd: f.tree, env, encoding: 'utf8', timeout: 30000 })
    const good = run(); expect(good.status).toBe(0); expect(readFileSync(receipt, 'utf8')).toBe('acted\n')
    env.AUTONOMIC_ASSIGNMENT_GENERATION = '2'; expect(run().status).toBe(2); expect(readFileSync(receipt, 'utf8')).toBe('acted\n')
    expect(new PinnedAuthority(b, f.workerRoots).lease('fresh-process-session', f.facts).fresh()).toBe(true)
  })
  test('real factory suspends before switch and lineage alone cannot activate a successor or hot-enroll a running factory', async () => {
    const f = fixture(), b = f.issue(), saved = { ...process.env }, cwd = process.cwd()
    type Context = { cwd: string; agent: { kind: string }; sessionManager: { getSessionId: () => string; getSessionFile: () => string }; ui: { notify: (text: string) => void; setStatus: () => void } }
    type Handler = (event: Record<string, unknown>, context: Context) => unknown
    const handlers = new Map<string, Handler>(), commands = new Map<string, { handler: (args: string, context: Context) => Promise<void> }>(), notices: string[] = []
    let id = 'S1'
    try {
      process.chdir(f.tree)
      Object.assign(process.env, envFor(b), { HOME: join(f.dir, 'home'), SEAT_MODS_ALLOW: f.out, SEAT_MODS_ROLE: 'implementer' })
      factory({ on: (n: string, fn: Handler) => handlers.set(n, fn), registerCommand: (n: string, c: { handler: (args: string, context: Context) => Promise<void> }) => commands.set(n, c) })
      const ctx = () => ({ cwd: f.tree, agent: { kind: 'main' }, sessionManager: { getSessionId: () => id, getSessionFile: () => join(f.out, id + '.jsonl') }, ui: { notify: (t: string) => notices.push(t), setStatus() {} } })
      await handlers.get('session_start')!({}, ctx())
      await handlers.get('session_before_switch')!({ reason: 'new' }, ctx())
      id = 'S2'
      await handlers.get('session_switch')!({ reason: 'new', previousSessionFile: join(f.out, 'S1.jsonl') }, ctx())
      await commands.get('autopilot')!.handler('status', ctx())
      expect(notices.some(text => text.includes('authority: suspended; fresh trusted launch'))).toBe(true)
    } finally {
      process.chdir(cwd)
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
      Object.assign(process.env, saved)
    }
  })
})
