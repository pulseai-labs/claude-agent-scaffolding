// The OMP park store on disk (Plan Task 6 §4, calls 2-3): the park file the adapter writes, its
// mode and the store's, the ledger row with its source, the operator's listing/approval/drop
// through /autopilot, the one-use release, and the file-tool lane's exact JSON-key match. Real
// files under the fixture's temp root through the shared world; no mock echo, no source grep.
//
// Autopilot off must behave byte for byte as 0.9.1: the mode gate sits before every new step, so
// a manual session writes no park, no row and no notice.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Grant } from '../../autonomic/hooks/authority'
import { fixturePolicy, neutralizeSeatRole, restoreSeatRole, routingWorld } from './judgment-world'
import type { RoutingWorld } from './judgment-world'

beforeEach(neutralizeSeatRole)
afterAll(restoreSeatRole)

const FEAT = 'refs/heads/fixture'
const PUSH = `git push origin ${FEAT}:${FEAT}`
const FORCE_MAIN = 'git push --force origin main'

function pushGrant(): Grant {
  return { id: 'fixture-push', operation: 'git.push-own-branch',
    resource: { kind: 'push', repository: '/fixture/repo', remote: 'origin', sourceRef: FEAT, destinationRef: FEAT },
    authorityRefs: ['fixture-approval'] }
}

function world(mode: 'autopilot' | 'manual' = 'autopilot'): RoutingWorld {
  const w = routingWorld({ grants: [pushGrant()], policy: fixturePolicy(), branch: 'fixture', mode })
  w.addRemote('origin', join(w.root, 'out', 'origin.git'))
  return w
}

/** One isolated side turn that answers; with no stub at all the host exposes none and every judged call parks. */
function setGeneration(w: RoutingWorld, choice: 'allow' | 'ask' = 'allow'): void {
  w.setGeneration(async () => ({
    replyText: JSON.stringify({ decision: choice, red_line: null, reason: choice === 'allow' ? 'within the granted task' : 'outside the task' }),
  }) as never)
}

const parks = (w: RoutingWorld): string[] => existsSync(w.parksRoot) ? readdirSync(w.parksRoot) : []
const human = (w: RoutingWorld): string => existsSync(w.ledgerPath) ? readFileSync(w.ledgerPath, 'utf8') : ''
const logText = (w: RoutingWorld): string => {
  const path = join(w.root, 'home/.claude/state/autonomic/autonomic.log')
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}
const parkIdOf = (reason: string | undefined): string => {
  const m = /\(park ([a-f0-9]{12});/.exec(reason ?? '')
  if (m === null) throw new Error(`no park id in ${String(reason)}`)
  return m[1]!
}

describe('the park file the OMP adapter writes (Q2: our own state files)', () => {
  let w: RoutingWorld
  afterEach(() => { w.close() })

  test('a floor park lands at <parksDir>/<id>.json, mode 0600 in a 0700 store, and the row names its source', async () => {
    w = world()
    const r = await w.invoke('bash', { command: FORCE_MAIN, cwd: w.tree })
    expect(r?.block).toBe(true)
    const id = parkIdOf(r?.reason)
    const file = join(w.parksRoot, `${id}.json`)
    expect(parks(w)).toEqual([`${id}.json`])
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(statSync(w.parksRoot).mode & 0o777).toBe(0o700)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ id, host: 'omp', tool: 'bash',
      command: FORCE_MAIN, cwd: w.tree, source: 'floor', redLine: 2, approval: null })
    const row = human(w).split('\n').find(l => l.includes(' · permission · '))!
    expect(row).toContain('Q: Bash: git push --force (+2 args)')
    expect(row).toContain(' · A: parked for the operator · why: never-approve: force-push, default-branch-push · src: floor')
    expect(w.painLines().join('\n')).toContain('autopilot: parked')
  })

  test('the operator lists, approves and drops through /autopilot', async () => {
    w = world()
    expect(await w.onCommand('parks')).toBe('parks: none')
    const first = await w.invoke('bash', { command: FORCE_MAIN, cwd: w.tree })
    const id = parkIdOf(first?.reason)
    expect(await w.onCommand('parks')).toBe(`parks:\n${id} · red line 2 · Bash: ${FORCE_MAIN} · ${w.tree}`)
    expect(await w.onCommand(`approve ${id}`)).toBe(`park ${id} approved for one use.`)
    expect(JSON.parse(readFileSync(join(w.parksRoot, `${id}.json`), 'utf8')).approval)
      .toMatchObject({ by: 'operator', usedAt: null })
    expect(await w.onCommand(`approve ${id}`)).toBe(`park ${id} is already approved`)
    expect(await w.onCommand('approve 0123456789ab')).toBe('no park 0123456789ab')
    expect(await w.onCommand('drop deadbeef0000')).toBe('no park deadbeef0000')
    expect(await w.onCommand('drop ../../etc/passwd')).toBe('no park ../../etc/passwd')
    expect(await w.onCommand(`drop ${id}`)).toBe(`park ${id} dropped.`)
    expect(parks(w)).toEqual([])
    expect(human(w)).toContain(`· Q: park ${id} · A: dropped · why: `)
    expect(human(w)).toContain('· src: operator')
  })

  test('an approved park releases the exact call once; the same call parks again (#815)', async () => {
    w = world()
    const first = await w.invoke('bash', { command: FORCE_MAIN, cwd: w.tree })
    const id = parkIdOf(first?.reason)
    await w.onCommand(`approve ${id}`)
    expect(await w.invoke('bash', { command: FORCE_MAIN, cwd: w.tree })).toBeUndefined()
    expect(JSON.parse(readFileSync(join(w.parksRoot, `${id}.json`), 'utf8')).approval.usedAt).not.toBeNull()
    expect(human(w)).toContain("· A: released by the operator's approved park · why: ")
    expect(human(w)).toContain('· src: operator')
    const again = await w.invoke('bash', { command: FORCE_MAIN, cwd: w.tree })
    expect(again?.block).toBe(true)
    expect(parkIdOf(again?.reason)).not.toBe(id)
  })

  test('two overlapping releases of one approval: the lost claim parks the second (fix B2)', async () => {
    w = world()
    const first = await w.invoke('bash', { command: FORCE_MAIN, cwd: w.tree })
    const id = parkIdOf(first?.reason)
    const file = join(w.parksRoot, `${id}.json`)
    await w.onCommand(`approve ${id}`)
    const approved = readFileSync(file, 'utf8')
    expect(await w.invoke('bash', { command: FORCE_MAIN, cwd: w.tree })).toBeUndefined()
    expect(existsSync(join(w.parksRoot, `${id}.used`))).toBe(true)
    // The overlapping call read the store before the winner consumed it: put the unused approval back.
    writeFileSync(file, approved)
    const second = await w.invoke('bash', { command: FORCE_MAIN, cwd: w.tree })
    expect(second?.block).toBe(true)
    expect(parkIdOf(second?.reason)).not.toBe(id)
    expect(JSON.parse(readFileSync(file, 'utf8')).approval.usedAt).toBeNull()
    expect(readdirSync(w.parksRoot).filter(n => n.endsWith('.json'))).toHaveLength(2)
  })

  test('the listing is one line on both hosts: only open parks, approved marked (fix B5)', async () => {
    w = world()
    const first = await w.invoke('bash', { command: FORCE_MAIN, cwd: w.tree })
    const id = parkIdOf(first?.reason)
    const line = `${id} · red line 2 · Bash: ${FORCE_MAIN} · ${w.tree}`
    expect(await w.onCommand('parks')).toBe(`parks:\n${line}`)
    await w.onCommand(`approve ${id}`)
    expect(await w.onCommand('parks')).toBe(`parks:\n${line} · approved`)
    expect(await w.invoke('bash', { command: FORCE_MAIN, cwd: w.tree })).toBeUndefined()
    expect(await w.onCommand('parks')).toBe('parks: none')
  })

  test('an unparseable park file is ignored and logged, never matched', async () => {
    w = world()
    mkdirSync(w.parksRoot, { recursive: true, mode: 0o700 })
    writeFileSync(join(w.parksRoot, 'aabbccddeeff.json'), '{not a park', { mode: 0o600 })
    expect(await w.onCommand('parks')).toBe('parks: none')
    const r = await w.invoke('bash', { command: FORCE_MAIN, cwd: w.tree })
    expect(r?.block).toBe(true)
    expect(logText(w)).toContain('park aabbccddeeff.json ignored:')
  })

  test('a file-tool park releases only for the exact input JSON key', async () => {
    w = world()
    const write = { path: join(w.tree, 'x.txt'), content: 'note: git push --force origin main' }
    const first = await w.invoke('write', write)
    expect(first?.block).toBe(true)                    // routed by the word, judged, no side turn: parked
    const id = parkIdOf(first?.reason)
    expect(JSON.parse(readFileSync(join(w.parksRoot, `${id}.json`), 'utf8')).command).toBe(JSON.stringify(write))
    expect(await w.onCommand(`approve ${id}`)).toBe(`park ${id} approved for one use.`)
    const almost = await w.invoke('write', { ...write, content: `${write.content} ` })
    expect(almost?.block).toBe(true)                   // one extra byte is not the approved call
    expect(await w.invoke('write', write)).toBeUndefined()
  })

  test('a Read park releases only its exact input; a second Read of another path parks (Task 7a; verify-T5 3b)', async () => {
    w = world()
    const first = await w.invoke('read', { file_path: '/home/u/.ssh/id_rsa' })
    expect(first?.block).toBe(true)
    const id = parkIdOf(first?.reason)
    expect(JSON.parse(readFileSync(join(w.parksRoot, `${id}.json`), 'utf8')).command).toBe(JSON.stringify({ file_path: '/home/u/.ssh/id_rsa' }))
    expect(await w.onCommand(`approve ${id}`)).toBe(`park ${id} approved for one use.`)
    const second = await w.invoke('read', { file_path: '/home/u/.aws/credentials' })
    expect(second?.block).toBe(true)
    expect(parkIdOf(second?.reason)).not.toBe(id)
    expect(parks(w)).toHaveLength(2)
  })

  test('a word outside the twelve-hex grammar is no park: no read, no removal (Task 7a)', async () => {
    w = world()
    const outside = join(w.root, 'outside.json')
    const seeded = JSON.stringify({ id: 'aabbccddeeff', session: 'fixture', host: 'omp', tool: 'bash',
      command: 'git push origin main', cwd: w.tree, source: 'floor', redLine: 1,
      reason: 'seeded outside the store', parkedAt: '2026-10-19T00:00:00Z', approval: null }, null, 2) + '\n'
    writeFileSync(outside, seeded, { mode: 0o600 })
    expect(await w.onCommand('approve ../../x')).toBe('no park ../../x')
    expect(await w.onCommand('drop ../../x')).toBe('no park ../../x')
    // A single `..` would reach this file if the word were ever built into a path: it stays untouched.
    expect(await w.onCommand('approve ../outside')).toBe('no park ../outside')
    expect(await w.onCommand('drop ../outside')).toBe('no park ../outside')
    expect(readFileSync(outside, 'utf8')).toBe(seeded)
  })

  test('with autopilot off the call is untouched and no park is written (byte-for-byte 0.9.1)', async () => {
    w = world('manual')
    expect(await w.invoke('bash', { command: FORCE_MAIN, cwd: w.tree })).toBeUndefined()
    expect(existsSync(w.parksRoot)).toBe(false)
    expect(human(w)).toBe('')
    expect(await w.onCommand('parks')).toBe('parks: none')
  })

  test('an allowed judged call on the routed lane writes no park', async () => {
    w = world()
    setGeneration(w, 'allow')
    expect(await w.invoke('bash', { command: PUSH, cwd: w.tree })).toBeUndefined()
    expect(existsSync(w.parksRoot)).toBe(false)
    expect(human(w)).toContain(' · src: judge')
    expect(human(w)).toContain(' · A: allow original call · why: ')
  })

  // verify-T7a claim 5 (spec §4, "no ledger, no autopilot"): OMP ignored record()'s false
  // return, so a release consumed the park and ran, and a judge allow ran, with no row. The
  // fixture makes a real false return: a directory at the ledger path makes appendFileSync fail.
  test('a release whose ledger row cannot be written does not release and does not consume the park (fail-open fix)', async () => {
    w = world()
    const first = await w.invoke('bash', { command: FORCE_MAIN, cwd: w.tree })
    const id = parkIdOf(first?.reason)
    expect(await w.onCommand(`approve ${id}`)).toBe(`park ${id} approved for one use.`)
    rmSync(w.ledgerPath, { force: true })
    mkdirSync(w.ledgerPath, { recursive: true })
    const blocked = await w.invoke('bash', { command: FORCE_MAIN, cwd: w.tree })
    expect(blocked?.block).toBe(true)
    expect(blocked?.reason).toContain('the release could not be recorded')
    const park = JSON.parse(readFileSync(join(w.parksRoot, `${id}.json`), 'utf8'))
    expect(park.approval).toMatchObject({ by: 'operator', usedAt: null })
  })

  test('a judge allow whose ledger row cannot be written does not allow (fail-open fix)', async () => {
    w = world()
    setGeneration(w, 'allow')
    expect(await w.onCommand('status')).toContain('autopilot')   // the mode and its ledger are live first
    rmSync(w.ledgerPath, { force: true })
    mkdirSync(w.ledgerPath, { recursive: true })
    const blocked = await w.invoke('read', { file_path: '/home/u/.ssh/id_rsa' })
    expect(blocked?.block).toBe(true)
    expect(blocked?.reason).toContain('the allow could not be recorded')
    expect(parks(w)).toEqual([])
  })
})
