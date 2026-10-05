import { describe, test, expect } from 'claude-code/testing'
import { DEFAULTS, parseConfig } from '../hooks/config'

// What register() receives on Claude Code 2.1.289: every declared key at its manifest
// default, or '' where it declares none, then the saved values over it. The ladder keys
// and the 0.1.0 names declare none, or a saved 0.1.0 value never reaches the rename;
// run-tests.sh checks that against plugin.json.
const HOST: Record<string, unknown> = {
  warnPercent: 40, warnAgainPercent: 50, commandPercent: '', blockPercent: '', fallbackMargin: 5,
  minRoomPercent: 15, manualMaxMolts: 2, softPercent: '', hardPercent: '',
  instructionsTemplate: '~/.claude/molt/instructions.md', warningTemplate: '~/.claude/molt/warning.md',
  seedTemplate: '~/.claude/molt/seed.md',
}
const ladder = (c: ReturnType<typeof parseConfig>) => [c.warn, c.warnAgain, c.command, c.block, c.fallback]
const hostOptions = (saved: Record<string, unknown>): Record<string, unknown> => ({ ...HOST, ...saved })

describe('parseConfig', () => {
  test('no options: the 0.2.0 defaults, no problems', () => {
    const c = parseConfig(undefined)
    expect([...ladder(c), c.minRoom, c.manualMaxMolts]).toEqual([40, 50, 65, 75, 5, 15, 2])
    expect(c.instructionsTemplate).toBe('~/.claude/molt/instructions.md')
    expect(c.warningTemplate).toBe('~/.claude/molt/warning.md')
    expect(c.seedTemplate).toBe('~/.claude/molt/seed.md')
    expect(c.problems).toEqual([])
  })
  test('a valid ladder is taken as given', () => {
    const c = parseConfig({ warnPercent: 30, warnAgainPercent: 45, commandPercent: 60, blockPercent: 70, fallbackMargin: 10 })
    expect(ladder(c)).toEqual([30, 45, 60, 70, 10])
    expect(c.problems).toEqual([])
  })
  test('out of order: every threshold defaults, and the problem is named', () => {
    const c = parseConfig({ warnPercent: 55, warnAgainPercent: 50 })
    expect(ladder(c)).toEqual([DEFAULTS.warn, DEFAULTS.warnAgain, DEFAULTS.command, DEFAULTS.block, DEFAULTS.fallback])
    expect(c.problems.join(' ')).toContain('warn=55 warnAgain=50')
  })
  test('block + fallback past 99: the defaults', () => {
    const c = parseConfig({ blockPercent: 95, fallbackMargin: 5 })
    expect(c.block).toBe(DEFAULTS.block)
    expect(c.problems).toHaveLength(1)
  })
  test('the boundary block + fallback = 99 is valid (control)', () => {
    const c = parseConfig({ blockPercent: 94, fallbackMargin: 5 })
    expect(ladder(c)).toEqual([40, 50, 65, 94, 5])
    expect(c.problems).toEqual([])
  })
  test('0.1.0 keys are read as the renamed ones and the rename is reported', () => {
    const c = parseConfig({ softPercent: 60, hardPercent: 70 })
    expect([c.command, c.block]).toEqual([60, 70])
    expect(c.problems.join(' ')).toContain('softPercent is now commandPercent (60)')
    expect(c.problems.join(' ')).toContain('hardPercent is now blockPercent (70)')
  })
  test('0.1.0 keys reach the ladder through the host-filled defaults (final review 1)', () => {
    const c = parseConfig(hostOptions({ softPercent: 60, hardPercent: 70 }))
    expect([c.command, c.block]).toEqual([60, 70])
    expect(c.problems.join(' ')).toContain('softPercent is now commandPercent (60)')
  })
  test('no saved values through the host: the defaults, no problems (control)', () => {
    const c = parseConfig(hostOptions({}))
    expect([...ladder(c), c.minRoom, c.manualMaxMolts]).toEqual([40, 50, 65, 75, 5, 15, 2])
    expect(c.problems).toEqual([])
  })
  test('a new key wins over its 0.1.0 name, with no rename reported (control)', () => {
    const c = parseConfig({ softPercent: 60, commandPercent: 66 })
    expect(c.command).toBe(66)
    expect(c.problems).toEqual([])
  })
  test('a saved 0.1.0 soft of 50 breaks the order: defaults, both problems named (review focus 1)', () => {
    const c = parseConfig({ softPercent: 50 })
    expect(ladder(c)).toEqual([40, 50, 65, 75, 5])
    expect(c.problems.join(' ')).toContain('softPercent is now commandPercent (50)')
    expect(c.problems.join(' ')).toContain('command=50')
  })
  test('non-numbers and blank paths fall back field by field', () => {
    const c = parseConfig({ minRoomPercent: 'x', manualMaxMolts: 0, seedTemplate: '  ', warningTemplate: '' })
    expect(c.minRoom).toBe(15)
    expect(c.manualMaxMolts).toBe(2)
    expect(c.seedTemplate).toBe('~/.claude/molt/seed.md')
    expect(c.warningTemplate).toBe('~/.claude/molt/warning.md')
  })
})
