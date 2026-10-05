import { describe, test, expect } from 'claude-code/testing'
import { DEFAULTS } from '../hooks/config'
import { atLeast, projectedPercent, stageOf, thresholdsFor } from '../hooks/measure'

describe('projectedPercent', () => {
  test('tokens plus unmeasured output over the window', () => {
    expect(projectedPercent({ tokens: 400_000, window: 1_000_000 }, 100_000)).toBe(50)
  })
  test('percent alone is used when tokens are absent', () => {
    expect(projectedPercent({ percent: 30, window: 200_000 }, 20_000)).toBe(40)
  })
  test('no figure: undefined (review focus 1)', () => {
    expect(projectedPercent({ window: 1_000_000 }, 5)).toBeUndefined()
    expect(projectedPercent({ tokens: 10, window: 0 }, 0)).toBeUndefined()
  })
  test('a negative unmeasured count is never subtracted', () => {
    expect(projectedPercent({ tokens: 500_000, window: 1_000_000 }, -100_000)).toBe(50)
  })
})

describe('thresholdsFor', () => {
  test('a fresh session uses the settings', () => {
    expect(thresholdsFor(DEFAULTS)).toEqual({ warn: 40, warnAgain: 50, command: 65, block: 75, fallback: 80 })
  })
  test('a seeded session gets minRoom points above its start before the first warning, gaps kept', () => {
    expect(thresholdsFor(DEFAULTS, 30)).toEqual({ warn: 45, warnAgain: 55, command: 70, block: 80, fallback: 85 })
  })
  test('a seeded session that started high keeps fallback inside the window', () => {
    expect(thresholdsFor(DEFAULTS, 80)).toEqual({ warn: 59, warnAgain: 69, command: 84, block: 94, fallback: 99 })
  })
  test('a seeded session that started small keeps the plain thresholds', () => {
    expect(thresholdsFor(DEFAULTS, 10)).toEqual({ warn: 40, warnAgain: 50, command: 65, block: 75, fallback: 80 })
  })
})

describe('stageOf', () => {
  const t = { warn: 40, warnAgain: 50, command: 65, block: 75, fallback: 80 }
  test('each boundary is inclusive', () => {
    expect(stageOf(39.9, t)).toBe('below')
    expect(stageOf(40, t)).toBe('warn')
    expect(stageOf(50, t)).toBe('warnAgain')
    expect(stageOf(65, t)).toBe('command')
    expect(stageOf(75, t)).toBe('block')
    expect(stageOf(80, t)).toBe('fallback')
  })
  test('atLeast orders the stages', () => {
    expect(atLeast('block', 'command')).toBe(true)
    expect(atLeast('warnAgain', 'command')).toBe(false)
    expect(atLeast('warn', 'below')).toBe(true)
  })
})
