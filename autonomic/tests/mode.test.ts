import { describe, test, expect } from 'claude-code/testing'
import { parseCommand, parseEnvMode, resolveDoc, statusText } from '../hooks/mode'

describe('mode (spec §1)', () => {
  test('env values', () => {
    expect(parseEnvMode('autopilot')).toEqual({ mode: 'autopilot' })
    expect(parseEnvMode(' autopilot ')).toEqual({ mode: 'autopilot' })
    expect(parseEnvMode(undefined)).toEqual({ mode: 'manual' })
    expect(parseEnvMode('')).toEqual({ mode: 'manual' })
    expect(parseEnvMode('manual')).toEqual({ mode: 'manual' })
    expect(parseEnvMode('Autopilot')).toEqual({ mode: 'manual', invalid: 'Autopilot' })
    expect(parseEnvMode('1')).toEqual({ mode: 'manual', invalid: '1' })
  })
  test('the command', () => {
    expect(parseCommand('on')).toEqual({ kind: 'on', scope: [] })
    expect(parseCommand('  on  a.md  ~/b.md ')).toEqual({ kind: 'on', scope: ['a.md', '~/b.md'] })
    expect(parseCommand('off')).toEqual({ kind: 'off' })
    expect(parseCommand('status')).toEqual({ kind: 'status' })
    expect(parseCommand('')).toEqual({ kind: 'usage' })
    expect(parseCommand('onn')).toEqual({ kind: 'usage' })
    expect(parseCommand(`on "docs/release plan.md" 'a b.md' c\\ d.md e.md`)).toEqual({ kind: 'on', scope: ['docs/release plan.md', 'a b.md', 'c d.md', 'e.md'] })
  })
  test('scope docs resolve', () => {
    expect(resolveDoc('a.md', '/repo', '/h')).toBe('/repo/a.md')
    expect(resolveDoc('~/b.md', '/repo', '/h')).toBe('/h/b.md')
    expect(resolveDoc('/c.md', '/repo', '/h')).toBe('/c.md')
  })
  test('the status line names every state distinctly', () => {
    expect(statusText({ mode: 'autopilot' })).toBe('autopilot')
    expect(statusText({ mode: 'manual' })).toBe('manual')
    expect(statusText({ mode: 'manual', problem: 'no policy' })).toBe('autopilot: no policy')
    expect(statusText({ mode: 'manual', invalid: 'x' })).toBe('manual (AUTONOMIC_MODE="x" is not a mode)')
  })
})
