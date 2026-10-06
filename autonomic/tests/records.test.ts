import { describe, test, expect } from 'claude-code/testing'
import { lineagePath, parseLineageFrom, parseRecord, safeSessionId, serializeRecord, sessionPath } from '../hooks/records'

describe('the session record (spec §1, amendment A4)', () => {
  test('paths', () => {
    expect(sessionPath('/h', 's1')).toBe('/h/.claude/state/autonomic/sessions/s1.json')
    expect(lineagePath('/h', 's2')).toBe('/h/.claude/state/molt/lineage/s2.json')
  })
  test('a full record round-trips', () => {
    const r = { mode: 'autopilot' as const, bell: 'ring', scope: ['/a.md'], source: 'command' as const }
    expect(parseRecord(serializeRecord(r))).toEqual(r)
  })
  test('serialize writes only the contract fields', () => {
    const text = serializeRecord({ mode: 'manual', scope: [], source: 'env', problem: 'x' } as never)
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['mode', 'scope', 'source'])
  })
  test('anything but "autopilot" is manual; junk is no record', () => {
    expect(parseRecord('{"mode":"Autopilot"}')?.mode).toBe('manual')
    expect(parseRecord('not json')).toBeUndefined()
    expect(parseRecord(undefined)).toBeUndefined()
    expect(parseRecord('null')).toBeUndefined()
  })
  test('a blank bell and non-string scope entries are dropped', () => {
    expect(parseRecord('{"mode":"autopilot","bell":"  ","scope":["/a",3,""]}')).toEqual({ mode: 'autopilot', scope: ['/a'], source: 'env' })
  })
  test('lineage gives its from, or nothing', () => {
    expect(parseLineageFrom('{"from":"s0","chain":"s0","depth":1,"handoff":"/h.md"}')).toBe('s0')
    expect(parseLineageFrom('{"from":""}')).toBeUndefined()
    expect(parseLineageFrom('nope')).toBeUndefined()
  })
  test('session ids', () => {
    expect(safeSessionId('a-B_9')).toBe(true)
    expect(safeSessionId('../x')).toBe(false)
  })
})
