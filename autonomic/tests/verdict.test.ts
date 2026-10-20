import { describe, test, expect } from 'claude-code/testing'
import { parseAsk, parsePermission } from '../hooks/verdict'

const Q = [{ question: 'Which colour?', options: [{ label: 'Red' }, { label: 'Blue' }], multiSelect: false }]
const M = [{ question: 'Which parts?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true }]

describe('ask verdicts (spec §3.2, review focus 4)', () => {
  test('an exact label is an answer', () => {
    expect(parseAsk('{"covered":true,"answers":{"Which colour?":"Blue"},"reason":"spec §2"}', Q))
      .toEqual({ covered: true, answers: { 'Which colour?': 'Blue' }, reason: 'spec §2' })
  })
  test('a label that is not an option goes to the operator', () => {
    for (const bad of ['blue', 'Blue ', 'Green', 'Blue, Red'])
      expect(parseAsk(`{"covered":true,"answers":{"Which colour?":"${bad}"},"reason":"r"}`, Q)?.covered).toBe(false)
  })
  test('a missing question goes to the operator', () => {
    expect(parseAsk('{"covered":true,"answers":{},"reason":"r"}', Q)?.covered).toBe(false)
  })
  test('multi-select joins exact labels', () => {
    const v = parseAsk('{"covered":true,"answers":{"Which parts?":"A,B"},"reason":"r"}', M)
    expect(v).toEqual({ covered: true, answers: { 'Which parts?': 'A, B' }, reason: 'r' })
  })
  test('a multi-select question with a comma in a label goes to the operator (PR #672 round 3)', () => {
    const C = [{ question: 'Order?', options: [{ label: 'API, then UI' }, { label: 'Docs' }], multiSelect: true }]
    for (const a of ['API, then UI', 'API, then UI, Docs', 'Docs'])
      expect(parseAsk(`{"covered":true,"answers":{"Order?":"${a}"},"reason":"r"}`, C)?.covered).toBe(false)
    const S = [{ question: 'Order?', options: [{ label: 'API, then UI' }, { label: 'Docs' }], multiSelect: false }]
    expect(parseAsk('{"covered":true,"answers":{"Order?":"API, then UI"},"reason":"r"}', S)?.covered).toBe(true)
  })
  test('not covered is an answer; junk is not', () => {
    expect(parseAsk('{"covered":false,"reason":"open product question"}', Q)).toEqual({ covered: false, reason: 'open product question' })
    expect(parseAsk('{"covered":"yes"}', Q)).toBeUndefined()
    expect(parseAsk('nothing', Q)).toBeUndefined()
  })
})

describe('permission verdicts (spec §3.3)', () => {
  test('allow and ask parse; a deny becomes ask; junk does not parse', () => {
    expect(parsePermission('{"decision":"allow","reason":"own branch push"}')).toEqual({ decision: 'allow', red_line: null, reason: 'own branch push' })
    expect(parsePermission('{"decision":"ask","reason":"r"}')?.decision).toBe('ask')
    expect(parsePermission('{"decision":"deny","reason":"r"}')?.decision).toBe('ask')
    expect(parsePermission('{"decision":"allow"}')).toBeUndefined()
    expect(parsePermission('{"decision":"yes","reason":"r"}')).toBeUndefined()
  })
  test('the red line parses; missing and null both mean none (0.10.0 Task 4)', () => {
    expect(parsePermission('{"decision":"allow","red_line":null,"reason":"r"}')).toEqual({ decision: 'allow', red_line: null, reason: 'r' })
    expect(parsePermission('{"decision":"allow","reason":"r"}')?.red_line).toBeNull()
    expect(parsePermission('{"decision":"ask","red_line":4,"reason":"r"}')).toEqual({ decision: 'ask', red_line: 4, reason: 'r' })
  })
  test('a malformed red line does not parse, so the call parks (Review Focus 4)', () => {
    for (const bad of ['7', '0', '"4"', '2.5', 'true'])
      expect(parsePermission(`{"decision":"allow","red_line":${bad},"reason":"r"}`)).toBeUndefined()
  })
})
