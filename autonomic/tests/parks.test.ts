import { describe, test, expect } from 'claude-code/testing'
import { PARKS_DIR_MARK, approve, consume, matches, parkId, parkText, parksDir, parsePark, serializePark } from '../hooks/parks'
import type { Park } from '../hooks/parks'

// The park store (slice 2 plan, Task 3). The fixtures are closed input: one full park, one
// approval, one call. Review Focus 3 lives in "an approval that almost matches": each near-miss
// must park again, and the exact call inside 72 hours must release.
const AT = '2026-10-19T00:00:00.000Z'
const EXPIRED = '2026-10-22T00:00:00.000Z'
const CWD = '/repo'
const call = { tool: 'Bash', command: 'git push origin main', cwd: CWD }

const parked = (over: Partial<Park> = {}): Park => ({
  id: 'ab12cd34ef56',
  session: 's1',
  host: 'claude-code',
  tool: 'Bash',
  command: 'git push origin main',
  cwd: CWD,
  source: 'floor',
  redLine: 1,
  reason: 'a direct push to the default branch',
  parkedAt: AT,
  approval: null,
  ...over,
})

describe('the park store and the operator approval (0.10.0 Task 3)', () => {
  test('a park round-trips through serializePark and parsePark', () => {
    const p = parked()
    expect(parsePark(serializePark(p))).toEqual(p)
    const approved = approve(parked({ host: 'omp', source: 'judge', redLine: 6, reason: 'spending money' }), AT)
    expect(parsePark(serializePark(approved))).toEqual(approved)
    expect(parsePark(serializePark(parked({ redLine: null, source: 'judge' })))).toEqual(parked({ redLine: null, source: 'judge' }))
  })
  test('parsePark is strict about the shape it reads back', () => {
    const p = parked()
    const { reason: _reason, ...missing } = p
    expect(() => parsePark(JSON.stringify({ ...p, extra: 1 }))).toThrow()
    expect(() => parsePark(JSON.stringify(missing))).toThrow()
    expect(() => parsePark('null')).toThrow()
    expect(() => parsePark(JSON.stringify({ ...p, host: 'codex' }))).toThrow()
    expect(() => parsePark(JSON.stringify({ ...p, source: 'x' }))).toThrow()
    expect(() => parsePark(JSON.stringify({ ...p, redLine: 7 }))).toThrow()
    expect(() => parsePark(JSON.stringify({ ...p, id: 'AB12cd34ef56' }))).toThrow()
    expect(() => parsePark(JSON.stringify({ ...p, parkedAt: 'yesterday' }))).toThrow()
    expect(() => parsePark(JSON.stringify({ ...p, parkedAt: '2026-13-45T99:99:99.000Z' }))).toThrow()
    expect(() => parsePark(JSON.stringify({ ...p, approval: { by: 'operator', at: AT } }))).toThrow()
    expect(() => parsePark(JSON.stringify({ ...p, approval: { by: 'someone', at: AT, expiresAt: AT, usedAt: null } }))).toThrow()
    expect(() => parsePark(JSON.stringify({ ...p, approval: { by: 'operator', at: AT, expiresAt: AT, usedAt: 5 } }))).toThrow()
    expect(() => parsePark(serializePark(p).replace('"redLine": 1,', '"redLine": 1,\n  "redLine": 1,'))).toThrow()
  })
  test('parkId is the first 12 hex of the sha256 over the call tuple', () => {
    const tuple = { session: 's1', tool: 'Bash', command: 'git push origin main', cwd: CWD, parkedAt: AT }
    // Offline vectors (coreutils sha256sum, never this implementation): the canonical JSONs run
    // 115, 95, 119, 120 and 345 bytes, covering the length field inside the block, padding at
    // the block edge, padding that spills into a new block, and six blocks.
    expect(parkId(tuple)).toBe('6f369d06dfb3')
    expect(parkId({ ...tuple, command: '' })).toBe('e8825a19f44d')
    expect(parkId({ ...tuple, command: 'x'.repeat(24) })).toBe('6c3ce5b6f1e2')
    expect(parkId({ ...tuple, command: 'x'.repeat(25) })).toBe('e29b1886a6dd')
    expect(parkId({ ...tuple, command: 'x'.repeat(250) })).toBe('1263196fdbc5')
    expect(parkId(tuple)).toBe(parkId({ ...tuple }))
    expect(parkId({ ...tuple, parkedAt: '2026-10-19T00:00:00.001Z' })).not.toBe('6f369d06dfb3')
  })
  test('matches is the whole approval rule: the exact call, approved, unused, inside 72 hours', () => {
    const p = approve(parked(), AT)
    expect(matches(p, call, AT)).toBe(true)
    expect(matches(p, call, '2026-10-21T23:59:59.999Z')).toBe(true)
    expect(matches(p, call, EXPIRED)).toBe(false)
    expect(matches(p, call, '2026-10-22T00:00:00.001Z')).toBe(false)
  })
  test('an approval that almost matches parks again (Review Focus 3)', () => {
    const p = approve(parked(), AT)
    expect(matches(parked(), call, AT)).toBe(false)
    expect(matches(consume(p, AT), call, AT)).toBe(false)
    expect(matches(p, { ...call, cwd: `${CWD}/` }, AT)).toBe(false)
    expect(matches(p, { ...call, command: 'git push origin  main' }, AT)).toBe(false)
    expect(matches(p, { ...call, tool: 'Write' }, AT)).toBe(false)
  })
  test('approve holds the operator yes for 72 hours and only once', () => {
    const a = approve(parked(), AT)
    expect(a.approval).toEqual({ by: 'operator', at: AT, expiresAt: EXPIRED, usedAt: null })
    expect(() => approve(a, AT)).toThrow()
    expect(parked().approval).toBe(null)
  })
  test('consume stamps the one use; an unapproved park cannot be consumed', () => {
    const used = consume(approve(parked(), AT), '2026-10-19T10:00:00.000Z')
    expect(used.approval?.usedAt).toBe('2026-10-19T10:00:00.000Z')
    expect(() => consume(parked(), AT)).toThrow()
  })
  test('parksDir honours AUTONOMIC_PARKS_DIR and defaults under the home', () => {
    expect(parksDir({ AUTONOMIC_PARKS_DIR: '/x/y' }, '/h')).toBe('/x/y')
    expect(parksDir({}, '/h')).toBe('/h/.local/state/autonomic/parks')
    expect(parksDir({ AUTONOMIC_PARKS_DIR: '  ' }, '/h')).toBe('/h/.local/state/autonomic/parks')
    expect(PARKS_DIR_MARK).toBe('autonomic/parks')
  })
  test('parkText names the red line, the judge or operator-only state, word for word', () => {
    const tail = 'Do not retry this call or an equivalent one. Record it as parked and continue the work that does not depend on it.'
    expect(parkText(parked())).toBe(`autonomic: parked for the operator (park ab12cd34ef56; red line 1): a direct push to the default branch. ${tail}`)
    expect(parkText(parked({ source: 'judge', redLine: 4 }))).toBe(`autonomic: parked for the operator (park ab12cd34ef56; red line 4): a direct push to the default branch. ${tail}`)
    expect(parkText(parked({ source: 'judge', redLine: null }))).toBe(`autonomic: parked for the operator (park ab12cd34ef56; the judge asked): a direct push to the default branch. ${tail}`)
    expect(parkText(parked({ source: 'integrity', redLine: null }))).toBe(`autonomic: parked for the operator (park ab12cd34ef56; operator-only state): a direct push to the default branch. ${tail}`)
  })
})
