import { describe, test, expect } from 'claude-code/testing'
import { DEFAULTS, parseConfig } from '../hooks/config'

describe('parseConfig', () => {
  test('no options: the defaults, no problems', () => {
    const c = parseConfig(undefined)
    expect([c.soft, c.hard, c.fallback, c.minRoom, c.manualMaxMolts]).toEqual([50, 65, 5, 15, 2])
    expect(c.instructionsTemplate).toBe('~/.claude/molt/instructions.md')
    expect(c.seedTemplate).toBe('~/.claude/molt/seed.md')
    expect(c.problems).toEqual([])
  })

  test('a valid set is taken as given', () => {
    const c = parseConfig({ softPercent: 40, hardPercent: 60, fallbackMargin: 10 })
    expect([c.soft, c.hard, c.fallback]).toEqual([40, 60, 10])
    expect(c.problems).toEqual([])
  })

  test('soft not below hard: the threshold defaults, and the problem is named', () => {
    const c = parseConfig({ softPercent: 70, hardPercent: 65 })
    expect([c.soft, c.hard, c.fallback]).toEqual([DEFAULTS.soft, DEFAULTS.hard, DEFAULTS.fallback])
    expect(c.problems[0]).toContain('soft=70 hard=65')
  })

  test('hard + fallback past 99: the threshold defaults', () => {
    const c = parseConfig({ softPercent: 80, hardPercent: 95, fallbackMargin: 5 })
    expect(c.hard).toBe(DEFAULTS.hard)
    expect(c.problems).toHaveLength(1)
  })

  test('the boundary hard + fallback = 99 is valid (control for the case above)', () => {
    const c = parseConfig({ softPercent: 80, hardPercent: 94, fallbackMargin: 5 })
    expect([c.soft, c.hard, c.fallback]).toEqual([80, 94, 5])
    expect(c.problems).toEqual([])
  })

  test('non-numbers and blank paths fall back field by field', () => {
    const c = parseConfig({ minRoomPercent: 'x', manualMaxMolts: 0, seedTemplate: '  ' })
    expect(c.minRoom).toBe(15)
    expect(c.manualMaxMolts).toBe(2)
    expect(c.seedTemplate).toBe('~/.claude/molt/seed.md')
  })
})
