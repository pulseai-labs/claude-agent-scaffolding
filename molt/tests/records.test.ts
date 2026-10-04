import { describe, test, expect } from 'claude-code/testing'
import { activePath, autonomicPath, lineagePath, parseAutonomic, parseLineage, safeSessionId } from '../hooks/records'
import { DEFAULT_INSTRUCTIONS, DEFAULT_SEED, expandHome, fill } from '../hooks/templates'

describe('paths', () => {
  test('under ~/.claude/state', () => {
    expect(lineagePath('/h', 's1')).toBe('/h/.claude/state/molt/lineage/s1.json')
    expect(activePath('/h', 's1')).toBe('/h/.claude/state/molt/active/s1')
    expect(autonomicPath('/h', 's1')).toBe('/h/.claude/state/autonomic/sessions/s1.json')
  })
  test('a session id is a file name only when it is plain', () => {
    expect(safeSessionId('0b9e-4f_x')).toBe(true)
    expect(safeSessionId('../x')).toBe(false)
    expect(safeSessionId('')).toBe(false)
  })
})

describe('parseLineage', () => {
  test('a complete record', () => {
    expect(parseLineage('{"from":"a","chain":"a","depth":2,"handoff":"/h.md"}'))
      .toEqual({ from: 'a', chain: 'a', depth: 2, handoff: '/h.md' })
  })
  test('missing fields, bad JSON or nothing: undefined', () => {
    expect(parseLineage('{"from":"a"}')).toBeUndefined()
    expect(parseLineage('{')).toBeUndefined()
    expect(parseLineage(undefined)).toBeUndefined()
  })
})

describe('parseAutonomic: anything unreadable is manual', () => {
  test('autopilot with a bell', () => {
    expect(parseAutonomic('{"mode":"autopilot","bell":"ntfy x"}')).toEqual({ mode: 'autopilot', bell: 'ntfy x' })
  })
  test('other modes, bad JSON, nothing: manual', () => {
    expect(parseAutonomic('{"mode":"Autopilot"}')).toEqual({ mode: 'manual' })
    expect(parseAutonomic('not json')).toEqual({ mode: 'manual' })
    expect(parseAutonomic(undefined)).toEqual({ mode: 'manual' })
  })
})

describe('templates', () => {
  test('fill replaces known keys and leaves unknown ones', () => {
    expect(fill('{{path}} at {{percent}}% {{nope}}', { path: '/h.md', percent: 51 })).toBe('/h.md at 51% {{nope}}')
  })
  test('the defaults carry the marker line and the path slot', () => {
    expect(DEFAULT_INSTRUCTIONS).toContain('MOLT-HANDOFF: <absolute path')
    expect(DEFAULT_SEED).toContain('{{path}}')
  })
  test('expandHome', () => {
    expect(expandHome('~/.claude/molt/seed.md', '/h')).toBe('/h/.claude/molt/seed.md')
    expect(expandHome('/abs', '/h')).toBe('/abs')
  })
})
