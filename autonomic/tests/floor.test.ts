import { describe, test, expect } from 'claude-code/testing'
import { hasMoltMarker, statusYields } from '../hooks/floor'

describe('the molt floor (amendment A2)', () => {
  test('a MOLT-HANDOFF line, as molt reads it', () => {
    expect(hasMoltMarker('done\nMOLT-HANDOFF: /h.md')).toBe(true)
    expect(hasMoltMarker('  MOLT-HANDOFF:   `/h.md`  ')).toBe(true)
    expect(hasMoltMarker('see the MOLT-HANDOFF: line in the doc')).toBe(false)
    expect(hasMoltMarker('MOLT-HANDOFF:')).toBe(false)
  })
  test("the status file's last line", () => {
    expect(statusYields('T warned 40\nT handoff required\n')).toBe(true)
    expect(statusYields('T handed-off /r.md.molt.md\n')).toBe(true)
    expect(statusYields('T warned 40\nT warned 50\n')).toBe(false)
    expect(statusYields('')).toBe(false)
    expect(statusYields(undefined)).toBe(false)
  })
})

import { parseStage, stageYields } from '../hooks/floor'
describe('the stage file (0.1.1, #677 F12)', () => {
  test('parse', () => {
    expect(parseStage('{"stage":"command","command":65}')).toBe('command')
    expect(parseStage('{"stage":"off"}')).toBe('off')
    expect(parseStage('{"stage":"sideways"}')).toBeUndefined()
    expect(parseStage('not json')).toBeUndefined()
    expect(parseStage(undefined)).toBeUndefined()
  })
  test('command, block and fallback yield; the rest do not', () => {
    for (const s of ['command', 'block', 'fallback']) expect(stageYields(s)).toBe(true)
    for (const s of ['below', 'warn', 'warnAgain', 'off', undefined]) expect(stageYields(s)).toBe(false)
  })
})
