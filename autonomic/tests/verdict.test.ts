import { describe, test, expect } from 'claude-code/testing'
import { parseAsk, parsePermission, parseTurn } from '../hooks/verdict'

const Q = [{ question: 'Which colour?', options: [{ label: 'Red' }, { label: 'Blue' }], multiSelect: false }]
const M = [{ question: 'Which parts?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true }]

describe('turn-end verdicts (spec §3.1)', () => {
  test('each case parses; fences and prose around the JSON are ignored', () => {
    expect(parseTurn('```json\n{"case":"covered","question":"Go?","answer":"yes, plan step 2","reason":"plan"}\n```')?.answer).toBe('yes, plan step 2')
    expect(parseTurn('{"case":"stalled","next_step":"run the suite","reason":"r"}')?.next_step).toBe('run the suite')
    for (const c of ['waiting', 'done', 'pain']) expect(parseTurn(`{"case":"${c}","reason":"r"}`)?.case).toBe(c)
  })
  test('covered needs an answer; stalled needs a next step; every case needs a reason', () => {
    expect(parseTurn('{"case":"covered","reason":"r"}')).toBeUndefined()
    expect(parseTurn('{"case":"stalled","reason":"r"}')).toBeUndefined()
    expect(parseTurn('{"case":"done"}')).toBeUndefined()
  })
  test('an unknown case or junk does not parse', () => {
    expect(parseTurn('{"case":"maybe","reason":"r"}')).toBeUndefined()
    expect(parseTurn('no json here')).toBeUndefined()
    expect(parseTurn('{"case": broken')).toBeUndefined()
  })
})

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
  test('a multi-select label that holds a comma is one label (PR #672 round 1)', () => {
    const C = [{ question: 'Order?', options: [{ label: 'API, then UI' }, { label: 'UI' }], multiSelect: true }]
    expect(parseAsk('{"covered":true,"answers":{"Order?":"API, then UI"},"reason":"r"}', C)?.covered).toBe(true)
    expect(parseAsk('{"covered":true,"answers":{"Order?":"API, then UI, UI"},"reason":"r"}', C)?.covered).toBe(false)
  })
  test('not covered is an answer; junk is not', () => {
    expect(parseAsk('{"covered":false,"reason":"open product question"}', Q)).toEqual({ covered: false, reason: 'open product question' })
    expect(parseAsk('{"covered":"yes"}', Q)).toBeUndefined()
    expect(parseAsk('nothing', Q)).toBeUndefined()
  })
})

describe('permission verdicts (spec §3.3)', () => {
  test('allow and ask parse; a deny becomes ask; junk does not parse', () => {
    expect(parsePermission('{"decision":"allow","reason":"own branch push"}')).toEqual({ decision: 'allow', reason: 'own branch push' })
    expect(parsePermission('{"decision":"ask","reason":"r"}')?.decision).toBe('ask')
    expect(parsePermission('{"decision":"deny","reason":"r"}')?.decision).toBe('ask')
    expect(parsePermission('{"decision":"allow"}')).toBeUndefined()
    expect(parsePermission('{"decision":"yes","reason":"r"}')).toBeUndefined()
  })
})
