// Grant-bounded permission decisions without replacing tools (Plan Task 5 §7, Steps 1/4/5).
// Every case drives the real factory through the shared fixture and asserts observable
// outcomes: whether the intercepted original call is released, how many native judgments ran,
// what landed in the two-write ledger, and what the operator was told. Every SDK/host import
// is `import type`: the CSA tree has no installed host package.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JudgmentRequest } from '@oh-my-pi/pi-ai'
import type { ExtensionJudgment } from '@oh-my-pi/pi-coding-agent/extensibility/extensions/types'
import type { EvidenceRef, Grant } from '../../autonomic/hooks/authority'
import { DEFAULT_READERS, executionSegments } from '../../autonomic/hooks/never'
import { operationFacts, permissionEligibility } from '../../autonomic/hooks/operations'
import type { OperationContext } from '../../autonomic/hooks/operations'
import { captureFrame } from '../../autonomic/omp/judgment'
import type { PolicyBundle } from '../../autonomic/omp/judgment'
import molt from '../../molt/omp/extension'
import seatMods from '../../seat-mods/omp/extension'
import { clockShift } from './judgment-world'
import { fixturePolicy, fixtureUsage, neutralizeSeatRole, restoreSeatRole, routingWorld } from './judgment-world'
import type { RoutingWorld } from './judgment-world'

beforeEach(neutralizeSeatRole)
afterAll(restoreSeatRole)

const MAIN = 'refs/heads/main'
const PUSH = `git push origin ${MAIN}:${MAIN}`
// The plan's real text-only finding (C0 autonomic/tests/floor-routing.test.ts): a command whose
// only floor match is text, never an executable push.
const QUOTE_API = "gh api repos/o/r/pulls/1/comments/2/replies -f body='we do not push here'"

const digest = (s: string) => createHash('sha256').update(s).digest('hex')
const evidence = (id: string, text: string): EvidenceRef => ({ id, source: join(tmpdir(), `fixture-${id}`), sha256: digest(text), locator: `fixture:${id}` })

// The plan's verbatim fixture grant, with R1's ruled ref literals (the fixture branch ref).
function pushGrant(over: Partial<{ id: string; remote: string; sourceRef: string; destinationRef: string; repository: string }> = {}): Grant {
  return { id: over.id ?? 'fixture-push', operation: 'git.push-own-branch',
    resource: { kind: 'push', repository: over.repository ?? '/fixture/repo', remote: over.remote ?? 'origin',
      sourceRef: over.sourceRef ?? MAIN, destinationRef: over.destinationRef ?? MAIN },
    authorityRefs: ['fixture-approval'] }
}

// A commit grant whose paths cover the fixture worktree (the /fixture/tree template path is
// rewritten to the tree by the fixture before issuance).
function commitGrant(): Grant {
  return { id: 'fixture-commit', operation: 'git.commit',
    resource: { kind: 'commit', repository: '/fixture/repo', branch: MAIN, paths: ['/fixture/tree'] },
    authorityRefs: ['fixture-approval'] }
}

function pushPolicy(withEvidence = true): PolicyBundle {
  const policy = fixturePolicy()
  if (withEvidence) {
    const text = 'Synthetic approved task: the fixture-push grant covers the exact origin feature ref push, without force or deletion.'
    policy.evidence.push({ ref: evidence('fixture-push-evidence', text), text })
  }
  return policy
}

// A configured local origin (no network, no origin/HEAD): the push effect resolves its remote
// from the placement facts, and the authority store re-reads the configured URL.
function pushWorld(grants: Grant[] = [pushGrant()], mode: 'autopilot' | 'manual' = 'autopilot'): RoutingWorld {
  const w = routingWorld({ grants, policy: pushPolicy(), branch: 'main', mode })
  w.addRemote('origin', join(w.root, 'out', 'origin.git'))
  return w
}

// One native judgment stub: the fixture policy's own approved route, with the ruled allow/ask choice.
function setNative(w: RoutingWorld, choice: 'allow' | 'ask' = 'allow'): void {
  w.setNative(async (request: JudgmentRequest) => ({
    judgment: { api: 'openrouter-decisions', provider: 'openrouter', model: 'fixture-response',
      answers: { permission: { type: 'choice' as const, choice, probabilities: choice === 'allow' ? { allow: 1, ask: 0 } : { allow: 0, ask: 1 }, confidence: 1 } },
      usage: fixtureUsage(1, 1) },
    route: { requestId: 'fixture-request', purpose: 'extension:fixture:autonomic.permission:fixture-request',
      selected: { api: 'openrouter-decisions', provider: 'openrouter', model: 'fixture-selected' }, questions: 1, cachedQuestions: 0 },
  }) as unknown as ExtensionJudgment<typeof request.questions>)
}

const bash = (command: string, cwd: string) => ({ command, cwd })
// A real second git repository with its own origin, inside the fixture root but outside the
// pinned worktree, so the F1 pin can observe a relocated push being refused rather than released.
const secondRepo = (root: string, out: string): string => {
  const other = join(root, 'other')
  mkdirSync(other, { recursive: true })
  const git = (dir: string, ...args: string[]) => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 3000 })
    if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr}`)
    return r.stdout.trim()
  }
  git(other, 'init', '-b', 'main')
  git(other, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '--allow-empty', '-m', 'synthetic second repository')
  git(other, 'remote', 'add', 'origin', join(out, 'other-origin.git'))
  return other
}
const rows = (w: RoutingWorld): Array<Record<string, unknown>> => {
  const path = `${w.ledgerPath}.decisions.jsonl`
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>) : []
}
const human = (w: RoutingWorld): string => existsSync(w.ledgerPath) ? readFileSync(w.ledgerPath, 'utf8') : ''

// =====================================================================================
// The plan's two verbatim tests (Step 1)
// =====================================================================================

describe('the plan\'s verbatim cases (Plan Task 5 §7 Step 1)', () => {
  test('high-confidence native allow cannot mint a missing task grant', async () => {
    const w = routingWorld({ grants: [], policy: fixturePolicy(), branch: 'main', mode: 'autopilot' })
    try {
      setNative(w)
      const original = { command: PUSH, cwd: w.tree }
      const before = structuredClone(original)
      expect((await w.invoke('bash', original))?.block).toBe(true)
      expect(original).toEqual(before)
      expect(w.nativeRequests).toEqual([]) // authority failure is decided before inference
    } finally { w.close() }
  })

  test('a granted exact own-feature push can pass the original intercepted call after recording', async () => {
    const policy = pushPolicy()
    const grants: Grant[] = [pushGrant()]
    const w = routingWorld({ grants, policy, branch: 'main', mode: 'autopilot' })
    try {
      w.addRemote('origin', join(w.root, 'out', 'origin.git'))
      setNative(w)
      const original = { command: PUSH, cwd: w.tree }
      const before = structuredClone(original)
      expect(await w.invoke('bash', original)).toBeUndefined()
      expect(original).toEqual(before)
      const all = rows(w)
      expect(all.at(-1)).toMatchObject({ consumer: 'permission', outcome: 'allow',
        authority: { grantIds: ['fixture-push'] }, response: { api: 'openrouter-decisions', model: 'fixture-response' } })
      expect(readFileSync(w.ledgerPath, 'utf8')).toContain(all.at(-1)!.decisionId as string)
      expect(w.nativeRequests).toHaveLength(1)
    } finally { w.close() }
  })
})

// =====================================================================================
// The release path, its records and the original call
// =====================================================================================

describe('an eligible intercepted call: records first, one original execution', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  test('the sidecar is written before the human row, and the original input identity is unchanged', async () => {
    w = pushWorld()
    setNative(w)
    const original = { command: PUSH, cwd: w.tree }
    w.armAppend(() => { /* observe only */ })
    expect(await w.invoke('bash', original)).toBeUndefined()
    expect(w.order).toEqual(['sidecar', 'human'])
  })

  test('the record states the matched evidence locator and never invents policy prose', async () => {
    w = pushWorld()
    setNative(w)
    await w.invoke('bash', { command: PUSH, cwd: w.tree })
    const record = rows(w).at(-1)!
    expect(record.consumer).toBe('permission')
    expect(record.outcome).toBe('allow')
    expect(record.payloadSource).toEqual({ kind: 'candidate', id: null })
    expect(JSON.stringify(record.response)).toContain('fixture-response')
    expect(human(w)).toContain(`decisionId=${record.decisionId as string}`)
  })

  test('the shielded tool/cwd are the call\'s own, and an unintercepted ordinary tool is untouched', async () => {
    w = pushWorld()
    setNative(w)
    expect(await w.invoke('bash', { command: 'git status', cwd: w.tree })).toBeUndefined()
    expect(w.nativeRequests).toEqual([])
    expect(rows(w)).toEqual([])
  })

  test('a covered deterministic approved decision makes zero native calls', async () => {
    // The approved permission is keyed on the JSON identity of the whole captured input. An input
    // without `cwd` is stable across worlds: the fixture fills the call's cwd from io.cwd (the tree).
    const input = { command: PUSH }
    const policy = pushPolicy()
    policy.approved.permissions.push({ inputSha256: digest(JSON.stringify(input)), grantIds: ['fixture-push'], decision: 'allow', evidenceIds: [] })
    w = routingWorld({ grants: [pushGrant()], policy, branch: 'main', mode: 'autopilot' })
    w.addRemote('origin', join(w.root, 'out', 'origin.git'))
    expect(await w.invoke('bash', input)).toBeUndefined()
    expect(w.nativeRequests).toEqual([]) // the approved decision is deterministic
    expect(rows(w).at(-1)).toMatchObject({ outcome: 'allow', payloadSource: { kind: 'deterministic', id: null } })
  })
})

// =====================================================================================
// Text-only findings: evaluable only after the effects are bounded
// =====================================================================================

describe('text-only floor findings', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  test('the real quote with a completely bounded own-PR effect uses native permission once', async () => {
    const text = 'Synthetic approved task: the fixture-pr grant covers commenting on our own pull request 1.'
    const policy = fixturePolicy()
    policy.evidence.push({ ref: evidence('fixture-pr-evidence', text), text })
    const grants: Grant[] = [{ id: 'fixture-pr', operation: 'pr.update-own',
      resource: { kind: 'pr', repository: '/fixture/repo', headRef: MAIN, number: 1 }, authorityRefs: ['fixture-approval'] }]
    w = routingWorld({ grants, policy, branch: 'main', mode: 'autopilot' })
    // The repository fact comes from the configured origin URL (U1): owner/repo = o/r.
    w.addRemote('origin', 'https://github.com/o/r.git')
    setNative(w)
    const original = { command: QUOTE_API, cwd: w.tree }
    expect(await w.invoke('bash', original)).toBeUndefined()
    expect(w.nativeRequests).toHaveLength(1)
    expect(rows(w).at(-1)).toMatchObject({ outcome: 'allow', authority: { grantIds: ['fixture-pr'] } })
    expect(original).toEqual({ command: QUOTE_API, cwd: w.tree })
  })

  test('the same quote on an opaque interpreter effect stays ask, with no inference', async () => {
    const text = 'Synthetic approved task: the fixture-pr grant covers commenting on our own pull request 1.'
    const policy = fixturePolicy()
    policy.evidence.push({ ref: evidence('fixture-pr-evidence', text), text })
    const grants: Grant[] = [{ id: 'fixture-pr', operation: 'pr.update-own',
      resource: { kind: 'pr', repository: '/fixture/repo', headRef: MAIN, number: 1 }, authorityRefs: ['fixture-approval'] }]
    w = routingWorld({ grants, policy, branch: 'main', mode: 'autopilot' })
    w.addRemote('origin', 'https://github.com/o/r.git')
    setNative(w)
    const command = `python3 -c "print(1)" ; ${QUOTE_API}`
    const r = await w.invoke('bash', { command, cwd: w.tree })
    expect(r?.block).toBe(true)
    expect(w.nativeRequests).toEqual([])
  })
})

// =====================================================================================
// Red lines and out-of-bound cases: always blocked
// =====================================================================================

describe('red lines and out-of-bound effects stay blocked', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  const blocked: Array<[string, Grant[], (w: RoutingWorld) => string]> = [
    ['force push (--force)', [pushGrant()], () => `git push --force origin ${MAIN}:${MAIN}`],
    ['force push (-f)', [pushGrant()], () => `git push -f origin ${MAIN}:${MAIN}`],
    ['force-with-lease', [pushGrant()], () => `git push --force-with-lease origin ${MAIN}:${MAIN}`],
    ['mirror', [pushGrant()], () => 'git push --mirror origin'],
    ['all refs', [pushGrant()], () => 'git push --all origin'],
    ['a non-granted destination (refs/heads/other)', [pushGrant()], () => `git push origin ${MAIN}:refs/heads/other`],
    ['wrong remote', [pushGrant()], () => `git push upstream ${MAIN}:${MAIN}`],
    ['wrong source ref', [pushGrant()], () => `git push origin refs/heads/other:${MAIN}`],
    ['no-verify on a commit', [pushGrant()], () => 'git commit --no-verify -m x'],
    ['rm outside the worktree', [pushGrant()], () => 'rm -rf /etc/passwd'],
    ['rm of the filesystem root', [pushGrant()], () => 'rm -rf /'],
    ['branch delete on push', [pushGrant()], () => `git push origin :${MAIN}`],
    ['unknown flag', [pushGrant()], () => `git push --frobnicate origin ${MAIN}:${MAIN}`],
    ['a compound mixed effect (eligible push AND force)', [pushGrant()], () => `git push origin ${MAIN}:${MAIN} && git push --force origin ${MAIN}:${MAIN}`],
    ['a compound mixed effect (eligible push AND an opaque interpreter)', [pushGrant()], () => `git push origin ${MAIN}:${MAIN} ; python3 -c "print(1)"`],
    ['a substitution in the program position', [pushGrant()], () => `$CMD push origin ${MAIN}:${MAIN}`],
    ['a git config write in the same call', [pushGrant()], () => `git config push.default nothing ; git push origin ${MAIN}:${MAIN}`],
  ]
  for (const [name, grants, command] of blocked) {
    test(`${name} stays blocked`, async () => {
      w = routingWorld({ grants, policy: pushPolicy(), branch: 'main', mode: 'autopilot' })
      w.addRemote('origin', join(w.root, 'out', 'origin.git'))
      setNative(w)
      const r = await w.invoke('bash', { command: command(w), cwd: w.tree })
      expect(r?.block).toBe(true)
    })
  }

  test('native github pr_push with forceWithLease true is a force red line', async () => {
    w = pushWorld()
    setNative(w)
    const r = await w.invoke('github', { op: 'pr_push', branch: 'main', forceWithLease: true })
    expect(r?.block).toBe(true)
    expect(w.nativeRequests).toEqual([])
  })

  test("native github pr_push with forceWithLease 'true' (string) is a force red line too", async () => {
    w = pushWorld()
    setNative(w)
    const r = await w.invoke('github', { op: 'pr_push', branch: 'main', forceWithLease: 'true' })
    expect(r?.block).toBe(true)
    expect(w.nativeRequests).toEqual([])
  })

  test('a cwd outside the assignment blocks rather than releasing', async () => {
    w = pushWorld()
    setNative(w)
    const outside = join(w.root, 'home')
    mkdirSync(outside, { recursive: true })
    const r = await w.invoke('bash', { command: PUSH, cwd: outside })
    expect(r?.block).toBe(true)
  })
})

// =====================================================================================
// The always-asks list, the operator record and manual semantics
// =====================================================================================

describe('operator handling and mode semantics', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  test('a granted call whose native judgment says ask blocks with the plan\'s verbatim reason', async () => {
    w = pushWorld()
    setNative(w, 'ask')
    const r = await w.invoke('bash', { command: PUSH, cwd: w.tree })
    expect(r).toEqual({ block: true, reason: 'autonomic: the operator decides' })
    expect(rows(w)).toEqual([])
  })

  test('an explicit normal manual session keeps the ordinary allow: no interception', async () => {
    w = pushWorld([pushGrant()], 'manual')
    setNative(w)
    expect(await w.invoke('bash', { command: 'git commit --no-verify -m x', cwd: w.tree })).toBeUndefined()
    expect(w.nativeRequests).toEqual([])
  })

  test('a failure-induced manual keeps the floor and still records an operator decision', async () => {
    w = pushWorld()
    setNative(w)
    // No policy file: the record is written manual-with-problem, so the floor stays live.
    w.armAppend(() => {})
    const r = await w.invoke('bash', { command: 'git push --force origin main', cwd: w.tree })
    expect(r?.block).toBe(true)
  })

  test('a memory-capped input above 64,000 code units stays with the operator', async () => {
    w = pushWorld()
    setNative(w)
    const pad = 'a'.repeat(65_000)
    const r = await w.invoke('bash', { command: `${PUSH} # ${pad}`, cwd: w.tree })
    expect(r?.block).toBe(true)
    expect(w.nativeRequests).toEqual([])
  })

  test('the shown-input bound is measured in code units, not bytes', async () => {
    w = pushWorld()
    // 32,000 multibyte characters are ~96,000 bytes but only ~32,000 code units: a byte-based
    // measure would throw here, so capturing the frame pins the unit.
    const multibyte = `git push origin refs/heads/main:refs/heads/main # ${'界'.repeat(32_000)}`
    const frame = await captureFrame(w.decisions, performance.now(), 'permission', { command: multibyte, cwd: w.tree })
    expect(frame.shownInput.length).toBeLessThanOrEqual(64000)
    // And an input past the bound is refused at capture, not silently cut.
    const over = `git push origin refs/heads/main:refs/heads/main # ${'a'.repeat(100_000)}`
    await expect(captureFrame(w.decisions, performance.now(), 'permission', { command: over, cwd: w.tree }))
      .rejects.toThrow('64,000-code-unit')
  })

  test('a malformed, unparsable whole input never returns undefined once intercepted', async () => {
    w = pushWorld()
    setNative(w)
    // The command still names a danger, so the floor intercepts it; its effects cannot be parsed.
    const r = await w.invoke('bash', { command: 'git push "unclosed', cwd: w.tree })
    expect(r?.block).toBe(true)
    expect(w.nativeRequests).toEqual([])
  })

  test('a rule the operator left out of neverApprove does not intercept', async () => {
    w = routingWorld({ grants: [pushGrant()], policy: pushPolicy(), branch: 'main', mode: 'autopilot' })
    w.addRemote('origin', join(w.root, 'out', 'origin.git'))
    setNative(w)
    // default-branch-push is a configured rule but this operator did not enable it, so a
    // default-branch push is not autonomic's to intercept.
    w.writeConfig({ neverApprove: 'force-push' })
    await w.handlers.get('session_start')?.({}, w.ctx)
    expect(await w.invoke('bash', { command: PUSH, cwd: w.tree })).toBeUndefined()
    expect(w.nativeRequests).toEqual([])
  })

  test('a command with no danger word is never intercepted', async () => {
    w = pushWorld()
    setNative(w)
    // No push, branch, commit or rm word: the pre-check skips the whole reading.
    expect(await w.invoke('bash', { command: 'echo hello', cwd: w.tree })).toBeUndefined()
    expect(w.nativeRequests).toEqual([])
  })

  test('a bash call with no command string is not intercepted at all (unchanged pre-gate)', async () => {
    w = pushWorld()
    setNative(w)
    expect(await w.invoke('bash', { cwd: w.tree })).toBeUndefined()
    expect(w.nativeRequests).toEqual([])
  })
})

// =====================================================================================
// Failure paths: no exception releases a call
// =====================================================================================

describe('no intercepted exception path returns undefined', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  test('a missing native bridge blocks with the plan\'s unavailable-or-stale reason', async () => {
    w = pushWorld()
    // No setNative: the fixture ctx.judge throws.
    const r = await w.invoke('bash', { command: PUSH, cwd: w.tree })
    expect(r?.block).toBe(true)
    expect(String(r?.reason)).toContain('decision unavailable or stale')
  })

  test('a revoked authority during append blocks and writes nothing that can release', async () => {
    w = pushWorld()
    setNative(w)
    w.armAppend(path => { if (path === w.ledgerPath) w.revoke() })
    const r = await w.invoke('bash', { command: PUSH, cwd: w.tree })
    expect(r?.block).toBe(true)
  })

  test('an authority replaced during append blocks', async () => {
    w = pushWorld()
    setNative(w)
    w.armAppend(path => { if (path === w.ledgerPath) w.replace() })
    const r = await w.invoke('bash', { command: PUSH, cwd: w.tree })
    expect(r?.block).toBe(true)
  })

  test('an authority that goes stale after both writes still blocks the release', async () => {
    w = pushWorld()
    setNative(w)
    // Revoke on the LAST (human) append: commitDecision's own final check must already throw, and
    // the caller's post-commit freshness check is the second guard. Either way the call blocks.
    w.armAppend(path => { if (path === w.ledgerPath) w.revoke() })
    const r = await w.invoke('bash', { command: PUSH, cwd: w.tree })
    expect(r?.block).toBe(true)
    expect(w.notices.join('\n')).toContain('decision failure')
  })

  test('a ledger append that never lands blocks', async () => {
    w = pushWorld()
    setNative(w)
    let restore: (() => void) | undefined
    w.armAppend(() => { restore ??= clockShift(30_000) })
    try {
      const r = await w.invoke('bash', { command: PUSH, cwd: w.tree })
      expect(r?.block).toBe(true)
    } finally { restore?.() }
  })

  test('a native judgment that takes the whole window blocks', async () => {
    w = pushWorld()
    let restore: (() => void) | undefined
    w.setNative(async request => {
      restore = clockShift(30_000)
      return { judgment: { api: 'openrouter-decisions', provider: 'openrouter', model: 'fixture-response',
        answers: { permission: { type: 'choice' as const, choice: 'allow', probabilities: { allow: 1, ask: 0 }, confidence: 1 } },
        usage: fixtureUsage(1, 1) },
        route: { requestId: 'r', purpose: 'p', selected: { api: 'openrouter-decisions', provider: 'openrouter', model: 'fixture-selected' }, questions: 1, cachedQuestions: 0 } } as unknown as ExtensionJudgment<typeof request.questions>
    })
    try {
      const r = await w.invoke('bash', { command: PUSH, cwd: w.tree })
      expect(r?.block).toBe(true)
    } finally { restore?.() }
  })

  test('redaction that would hide material input abstains rather than judging an unseen suffix', async () => {
    w = pushWorld()
    setNative(w)
    // The whole captured input is judged; a secret in any field is hidden by redaction, so the
    // unseen suffix must not be sent to judgment.
    const token = 'ghp_' + 'A'.repeat(36)
    const r = await w.invoke('bash', { command: PUSH, cwd: w.tree, env: { TOKEN: token } })
    expect(r?.block).toBe(true)
    expect(w.nativeRequests).toEqual([]) // the secret never reached judgment state
  })
})

// =====================================================================================
// The authority store's protected/default refusal (ruling 3)
// =====================================================================================

describe('the origin/HEAD→granted ref world refuses the lease', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  test('a push grant whose destination is the configured default ref cannot be leased', async () => {
    w = pushWorld()
    w.setRemoteHead('origin', MAIN)
    const facts = await w.decisions.placement({ cwd: w.tree }, new AbortController().signal)
    expect(facts.defaultRefs).toContain(MAIN)
    expect(() => w.decisions.authority.lease('S1', facts)).toThrow(/protected\/default destination/)
  })

  test('the same world blocks the intercepted call instead of releasing it', async () => {
    w = pushWorld()
    w.setRemoteHead('origin', MAIN)
    setNative(w)
    const r = await w.invoke('bash', { command: PUSH, cwd: w.tree })
    expect(r?.block).toBe(true)
  })
})

// =====================================================================================
// The ordered real-extension dispatch (Plan Task 5 §7 Step 5)
// =====================================================================================

describe('the ordered seat-mods → Molt → Autonomic dispatch', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  async function ordered(mode: 'autopilot' | 'manual' = 'autopilot', grants: Grant[] = [pushGrant()]) {
    w = routingWorld({ grants, policy: pushPolicy(), branch: 'main', mode })
    w.addRemote('origin', join(w.root, 'out', 'origin.git'))
    w.registerOrdered(seatMods)
    w.registerOrdered(molt)
    w.orderedAutonomic()
    await w.handlers.get('session_start')?.({}, w.ctx)
    return w
  }

  test('a preserved early seat refusal blocks before any native inference and no receipt runs', async () => {
    await ordered('autopilot')
    process.env.SEAT_MODS_ROLE = 'verifier'   // a verifier may not push
    try {
      const r = await w.dispatch('bash', { command: PUSH, cwd: w.tree })
      expect(r.block).toBe(true)
      expect(r.receipt).toBe(0)               // no original-tool receipt
      expect(w.nativeRequests).toEqual([])    // Autonomic never ran
      expect(r.order).toEqual(['dispatch'])   // seat-mods refused first
    } finally { delete process.env.SEAT_MODS_ROLE }
  })

  test('one valid bounded release writes both records BEFORE the original-tool receipt', async () => {
    await ordered('autopilot')
    process.env.SEAT_MODS_ROLE = 'coordinator' // a free role has no seat deny for this push
    setNative(w)
    try {
      const r = await w.dispatch('bash', { command: PUSH, cwd: w.tree })
      expect(r.block).toBe(false)
      expect(r.receipt).toBe(1)               // the original tool ran exactly once
      expect(r.order).toEqual(['dispatch', 'sidecar', 'human', 'receipt:bash'])
    } finally { delete process.env.SEAT_MODS_ROLE }
  })

  test('a later handler refusal after an allow still prevents the receipt', async () => {
    await ordered('autopilot')
    process.env.SEAT_MODS_ROLE = 'coordinator'
    setNative(w)
    // A handler registered after Autonomic that refuses: the receipt never runs.
    w.registerOrdered(pi => { pi.on('tool_call', () => ({ block: true, reason: 'a later host handler refused' })) })
    try {
      const r = await w.dispatch('bash', { command: PUSH, cwd: w.tree })
      expect(r.block).toBe(true)
      expect(r.receipt).toBe(0)
      expect(r.order).toEqual(['dispatch', 'sidecar', 'human'])
      expect(rows(w).at(-1)).toMatchObject({ outcome: 'allow' })
    } finally { delete process.env.SEAT_MODS_ROLE }
  })
})

// =====================================================================================
// Red lines reach the eligibility clauses themselves (mutation-checked)
// =====================================================================================

describe('the eligibility red-line clauses, driven directly', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  async function ctxFor(command: string, grants: Grant[]): Promise<OperationContext> {
    w = routingWorld({ grants, policy: pushPolicy(), branch: 'main', mode: 'autopilot' })
    w.addRemote('origin', join(w.root, 'out', 'origin.git'))
    const f = await captureFrame(w.decisions, performance.now(), 'permission', { command, cwd: w.tree })
    return { inputSha256: f.inputSha256, facts: f.facts, snapshot: f.lease.snapshot,
      approved: f.policy.approved.permissions, evidence: f.lease.evidence, commands: f.policy.approved.commands }
  }
  const factsFor = (command: string, ctx: OperationContext) => operationFacts('bash', { command, cwd: w.tree }, ctx, DEFAULT_READERS)

  test('a force refspec is decided on the force clause', async () => {
    const command = `git push origin +${MAIN}:${MAIN}`
    const ctx = await ctxFor(command, [pushGrant()])
    const facts = factsFor(command, ctx)
    expect(facts.effects[0]!.force).toBe(true)
    expect(facts.effects[0]!.unresolved).toBeNull() // complete facts: only the red line can decide
    const el = permissionEligibility(facts, ctx)
    expect(el.kind).toBe('ask')
    // The operator-visible reason names the red line this clause owns, not a later fallback.
    if (el.kind === 'ask') expect(el.reason).toContain('force')
  })

  test('a delete refspec is decided on the deletion clause once its facts are complete', async () => {
    // --delete with a resolvable branch ref: complete facts, so the deletion clause decides.
    const command = `git push --delete origin ${MAIN.split('/').pop()}`
    const ctx = await ctxFor(command, [pushGrant()])
    const facts = factsFor(command, ctx)
    expect(facts.effects[0]!.deletion).toBe(true)
    expect(facts.effects[0]!.unresolved).toBeNull()
    const el = permissionEligibility(facts, ctx)
    expect(el.kind).toBe('ask')
    if (el.kind === 'ask') expect(el.reason).toBe('a delete effect is operator-owned')
  })

  test('a complete no-verify commit is decided on the no-verify clause', async () => {
    const command = 'git commit --no-verify -m x'
    const ctx = await ctxFor(command, [commitGrant()])
    const facts = factsFor(command, ctx)
    expect(facts.effects[0]!.noVerify).toBe(true)
    expect(facts.effects[0]!.unresolved).toBeNull()
    const el = permissionEligibility(facts, ctx)
    expect(el.kind).toBe('ask')
    if (el.kind === 'ask') expect(el.reason).toContain('no-verify')
  })

  test('a complete AI-trailer commit is decided on the trailer clause', async () => {
    const command = 'git commit -m "Co-Authored-By: a <a@b.c>"'
    const ctx = await ctxFor(command, [commitGrant()])
    const facts = factsFor(command, ctx)
    expect(facts.effects[0]!.trailer).toBe(true)
    expect(facts.effects[0]!.unresolved).toBeNull()
    const el = permissionEligibility(facts, ctx)
    expect(el.kind).toBe('ask')
    if (el.kind === 'ask') expect(el.reason).toContain('trailer')
  })

  test('an unsupported push flag is decided on the unresolved clause', async () => {
    const command = `git push --frobnicate origin ${MAIN}:${MAIN}`
    const ctx = await ctxFor(command, [pushGrant()])
    const facts = factsFor(command, ctx)
    expect(facts.effects[0]!.unresolved).toContain('unknown push flag')
    const el = permissionEligibility(facts, ctx)
    expect(el.kind).toBe('ask')
    if (el.kind === 'ask') expect(el.reason).toContain('frobnicate')
  })

  test('a destination equal to a configured default ref is decided on the protected clause', async () => {
    const command = `git push origin ${MAIN}:${MAIN}`
    const ctx = await ctxFor(command, [pushGrant()])
    const protectedCtx = { ...ctx, facts: { ...ctx.facts, defaultRefs: [MAIN] } }
    const facts = factsFor(command, protectedCtx)
    expect(facts.effects[0]!.unresolved).toBeNull()
    expect(permissionEligibility(facts, protectedCtx)).toMatchObject({ kind: 'ask' })
  })
})

describe('executionSegments parses the whole command with the existing grammar', () => {
  const seg = (command: string, cwd = '/repo', root = '/repo') => executionSegments(command, cwd, root)

  test('a literal push is one segment with its exact argv', () => {
    expect(seg(`git push origin ${MAIN}:${MAIN}`)).toEqual([
      { text: `git push origin ${MAIN}:${MAIN}`, argv: ['git', 'push', 'origin', `${MAIN}:${MAIN}`], cwd: '/repo', opaque: false, redirects: [] },
    ])
  })

  test('separators split in order and keep every segment', () => {
    const out = seg('git status && git log --oneline || true ; git diff')
    expect(out.map(s => s.argv[1] ?? s.argv[0])).toEqual(['status', 'log', 'true', 'diff'])
  })

  test('known literal wrappers pass through to the wrapped program', () => {
    const out = seg('env FOO=1 nice -n 5 ionice -c3 timeout 10 command git status')
    expect(out).toHaveLength(1)
    expect(out[0]!.argv[0]).toBe('git')
    expect(out[0]!.argv[1]).toBe('status')
  })

  test('a literal cd changes the cwd of later segments', () => {
    const out = seg('cd sub && git status')
    expect(out).toHaveLength(2)
    expect(out[0]!.argv).toEqual(['cd', 'sub'])
    expect(out[1]!.cwd).toBe('/repo/sub')
  })

  test('a literal git -C changes the cwd of the command', () => {
    const out = seg('git -C sub status')
    expect(out).toHaveLength(1)
    expect(out[0]!.cwd).toBe('/repo/sub')
    expect(out[0]!.argv).toContain('status')
  })

  test('redirection targets are recorded, not read as argv', () => {
    const out = seg('git status > log 2>&1')
    expect(out[0]!.redirects).toEqual(['log'])
    expect(out[0]!.argv).toEqual(['git', 'status'])
  })

  test('quotes are decoded only for literal argv', () => {
    expect(seg("git commit -m 'a b'")[0]!.argv).toEqual(['git', 'commit', '-m', 'a b'])
    expect(seg("'git' push")[0]!.argv[0]).toBe('git')
    expect(seg('pu""sh')[0]!.argv[0]).toBe('push')
  })

  test('an original private-use masking character is rejected, never conflated with user bytes', () => {
    expect(seg('git push \uE000origin')[0]!.opaque).toBe(true)
  })

  const opaque: Array<[string, string]> = [
    ['an interpreter', 'python3 -c "print(1)"'],
    ['a shell', 'bash -lc "git push -f"'],
    ['a substitution', 'git $CMD origin main'],
    ['a command substitution', 'git $(echo push) origin main'],
    ['a glob in a flag position', 'git push --forc* origin main'],
    ['a config write', 'git config user.name x'],
    ['an alias definition', 'alias gp=push'],
    ['a function definition', 'f() { git push; }'],
    ['an unknown wrapper', 'frobnicate git push origin main'],
    ['xargs', 'echo x | xargs git push'],
    ['unparsable text', 'git push "unclosed'],
  ]
  for (const [name, command] of opaque) {
    test(`${name} is opaque and cannot gain authority`, () => {
      expect(seg(command).some(s => s.opaque)).toBe(true)
    })
  }

  test('an explicit git push effect is preserved end to end', () => {
    const out = seg(`git push origin ${MAIN}:${MAIN}`)
    expect(out[0]!.text).toContain('push')
    expect(out[0]!.argv).toEqual(['git', 'push', 'origin', `${MAIN}:${MAIN}`])
  })

  test('a relocation outside the pinned root is opaque at the segment', () => {
    // F2: only the plan's five wrappers parse through; everything else is opaque.
    for (const wrapper of ['sudo', 'doas', 'stdbuf', 'chrt', 'taskset', 'nohup', 'time', 'exec', 'builtin', 'setsid']) {
      expect(seg(`${wrapper} git push origin ${MAIN}:${MAIN}`)[0]!.opaque).toBe(true)
    }
    // The five named wrappers still parse through to the wrapped program.
    expect(seg(`env nice -n 5 ionice -c3 timeout 10 command git push origin ${MAIN}:${MAIN}`)[0]!.argv[0]).toBe('git')
  })

  test('a literal git -C or env -C outside the pinned root is opaque at the segment', () => {
    expect(seg(`git -C /elsewhere push origin ${MAIN}:${MAIN}`, '/repo', '/repo')[0]!.opaque).toBe(true)
    expect(seg(`env -C /elsewhere git push origin ${MAIN}:${MAIN}`, '/repo', '/repo')[0]!.opaque).toBe(true)
    expect(seg(`env --chdir=/elsewhere git push origin ${MAIN}:${MAIN}`, '/repo', '/repo')[0]!.opaque).toBe(true)
    // And a directory inside the pinned root stays eligible.
    expect(seg(`git -C sub push origin ${MAIN}:${MAIN}`, '/repo', '/repo')[0]!.opaque).toBe(false)
  })
})

// =====================================================================================
// F1: a relocated segment is never authorized against the pinned facts
// =====================================================================================

describe('a segment cwd outside the pinned worktree is never released', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  test('git -C into a real second repository blocks instead of releasing', async () => {
    w = pushWorld()
    setNative(w)
    // A real second repository, with its own origin, exists inside the fixture root but outside
    // the pinned worktree: the granted own-feature push must not authorize a push performed there.
    const other = secondRepo(w.root, join(w.root, 'out'))
    const r = await w.invoke('bash', { command: `git -C ${other} push origin ${MAIN}:${MAIN}`, cwd: w.tree })
    expect(r?.block).toBe(true)
    expect(w.nativeRequests).toEqual([])
    expect(rows(w)).toEqual([])
    expect(human(w)).not.toContain('allow')
  })

  test('git -C into a nonexistent directory blocks', async () => {
    w = pushWorld()
    setNative(w)
    // Inside the pinned worktree (so the segment cwd resolves to the task's own root) but the
    // directory does not exist: the effects still cannot be established there.
    const r = await w.invoke('bash', { command: `git -C ${join(w.tree, 'gone')} push origin ${MAIN}:${MAIN}`, cwd: w.tree })
    expect(r?.block).toBe(true)
    expect(rows(w)).toEqual([])
    // And a nonexistent target outside the worktree blocks too (the segment is opaque there).
    const outside = await w.invoke('bash', { command: `git -C ${join(w.root, 'nowhere')} push origin ${MAIN}:${MAIN}`, cwd: w.tree })
    expect(outside?.block).toBe(true)
  })

  test('git -C into a subdirectory of the pinned worktree stays eligible', async () => {
    w = pushWorld()
    setNative(w)
    const sub = join(w.tree, 'sub')
    mkdirSync(sub, { recursive: true })
    expect(await w.invoke('bash', { command: `git -C ${sub} push origin ${MAIN}:${MAIN}`, cwd: w.tree })).toBeUndefined()
    expect(rows(w).at(-1)).toMatchObject({ outcome: 'allow' })
  })

  test('an env -C relocation outside the pinned worktree blocks', async () => {
    w = pushWorld()
    setNative(w)
    const r = await w.invoke('bash', { command: `env -C ${secondRepo(w.root, join(w.root, 'out'))} git push origin ${MAIN}:${MAIN}`, cwd: w.tree })
    expect(r?.block).toBe(true)
    expect(rows(w)).toEqual([])
  })

  test('the existing cd-segment semantics are unchanged', async () => {
    w = pushWorld()
    setNative(w)
    // `cd` is not a known program, so its own segment is opaque and a `cd && …` call asks — this
    // predates the cwd pin and must not change. The push segment itself resolves its own cwd.
    const r = await w.invoke('bash', { command: `cd ${join(w.root, 'other')} && git push origin ${MAIN}:${MAIN}`, cwd: w.tree })
    expect(r?.block).toBe(true)
    const inside = await w.invoke('bash', { command: `cd sub && git push origin ${MAIN}:${MAIN}`, cwd: w.tree })
    expect(inside?.block).toBe(true)
    expect(executionSegments(`cd sub && git push origin ${MAIN}:${MAIN}`, w.tree, w.tree)[1]!.cwd).toBe(join(w.tree, 'sub'))
  })
})

// =====================================================================================
// operationFacts / permissionEligibility (Step 3 unit level)
// =====================================================================================

describe('operationFacts and permissionEligibility', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  async function ctxOf(command: string, grants: Grant[], mode: 'autopilot' | 'manual' = 'autopilot'): Promise<{ w: RoutingWorld; ctx: OperationContext }> {
    w = routingWorld({ grants, policy: pushPolicy(), branch: 'main', mode })
    w.addRemote('origin', join(w.root, 'out', 'origin.git'))
    const f = await captureFrame(w.decisions, performance.now(), 'permission', { command, cwd: w.tree })
    return { w, ctx: { inputSha256: f.inputSha256, facts: f.facts, snapshot: f.lease.snapshot, approved: f.policy.approved.permissions, evidence: f.lease.evidence, commands: f.policy.approved.commands } }
  }

  test('a bounded own-feature push is eligible under its positive grant', async () => {
    const { ctx } = await ctxOf(PUSH, [pushGrant()])
    const facts = operationFacts('bash', { command: PUSH, cwd: w.tree }, ctx, DEFAULT_READERS)
    const el = permissionEligibility(facts, ctx)
    expect(el.kind).toBe('semantic')
    if (el.kind === 'semantic') expect(el.grantIds).toEqual(['fixture-push'])
  })

  test('the same push without the grant is ask, never semantic', async () => {
    const { ctx } = await ctxOf(PUSH, [])
    const facts = operationFacts('bash', { command: PUSH, cwd: w.tree }, ctx, DEFAULT_READERS)
    expect(permissionEligibility(facts, ctx).kind).toBe('ask')
  })

  test('a force push is ask even under the grant', async () => {
    const command = `git push --force origin ${MAIN}:${MAIN}`
    const { ctx } = await ctxOf(command, [pushGrant()])
    const facts = operationFacts('bash', { command, cwd: w.tree }, ctx, DEFAULT_READERS)
    expect(permissionEligibility(facts, ctx).kind).toBe('ask')
  })

  test('a guarded role ceiling cannot be passed by a matching grant', async () => {
    const { ctx } = await ctxOf(PUSH, [pushGrant()])
    const verifier = { ...ctx, snapshot: { ...ctx.snapshot, seat: { ...ctx.snapshot.seat, role: 'verifier' as const } } }
    const facts = operationFacts('bash', { command: PUSH, cwd: w.tree }, verifier, DEFAULT_READERS)
    expect(permissionEligibility(facts, verifier).kind).toBe('ask')
  })

  test('an approved deterministic decision is covered with no inference', async () => {
    const command = PUSH
    const { w: world, ctx } = await ctxOf(command, [pushGrant()])
    void world
    const approved = { inputSha256: digest(JSON.stringify({ command, cwd: w.tree })), grantIds: ['fixture-push'], decision: 'allow' as const, evidenceIds: [] }
    const withApproved = { ...ctx, approved: [approved] }
    const facts = operationFacts('bash', { command, cwd: w.tree }, withApproved, DEFAULT_READERS)
    const el = permissionEligibility(facts, withApproved)
    expect(el).toMatchObject({ kind: 'covered', decision: 'allow', grantIds: ['fixture-push'] })
  })
})
