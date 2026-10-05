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
    expect(thresholdsFor(DEFAULTS)).toEqual({ soft: 50, hard: 65, fallback: 70 })
  })
  test('a seeded session gets minRoom points above its start, gaps kept', () => {
    expect(thresholdsFor(DEFAULTS, 45)).toEqual({ soft: 60, hard: 75, fallback: 80 })
  })
  test('a seeded session that started high keeps fallback inside the window', () => {
    expect(thresholdsFor(DEFAULTS, 80)).toEqual({ soft: 79, hard: 94, fallback: 99 })
  })
  test('a seeded session that started small keeps the plain thresholds', () => {
    expect(thresholdsFor(DEFAULTS, 10)).toEqual({ soft: 50, hard: 65, fallback: 70 })
  })
})

describe('stageOf', () => {
  const t = { soft: 50, hard: 65, fallback: 70 }
  test('each boundary is inclusive', () => {
    expect(stageOf(49.9, t)).toBe('below')
    expect(stageOf(50, t)).toBe('soft')
    expect(stageOf(65, t)).toBe('hard')
    expect(stageOf(70, t)).toBe('fallback')
  })
  test('atLeast orders the stages', () => {
    expect(atLeast('hard', 'soft')).toBe(true)
    expect(atLeast('soft', 'hard')).toBe(false)
    expect(atLeast('below', 'below')).toBe(true)
  })
})
