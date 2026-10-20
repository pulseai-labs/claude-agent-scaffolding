import { describe, test, expect } from 'claude-code/testing'
import { parseStage } from '../hooks/floor'

describe('the stage file (0.1.1, #677 F12)', () => {
  test('parse', () => {
    expect(parseStage('{"stage":"command","command":65}')).toBe('command')
    expect(parseStage('{"stage":"off"}')).toBe('off')
    expect(parseStage('{"stage":"sideways"}')).toBeUndefined()
    expect(parseStage('not json')).toBeUndefined()
    expect(parseStage(undefined)).toBeUndefined()
  })
})
