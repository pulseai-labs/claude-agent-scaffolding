import { describe, test, expect } from 'claude-code/testing'
import { world } from './world'

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as never
const RUN = (args: string) => ({ command: 'autopilot', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as never
const last = (w: { envSets: Array<[string, string | undefined]> }) =>
  w.envSets.filter(([n]) => n === 'AUTONOMIC_EFFECTIVE_MODE').at(-1)?.[1]

describe('AUTONOMIC_EFFECTIVE_MODE (0.4.0 spec §3.4)', () => {
  test('autopilot on, then off', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(last(w)).toBe('manual')
    await $.command.run(RUN('on'))
    expect(last(w)).toBe('autopilot')
    await $.command.run(RUN('off'))
    expect(last(w)).toBe('manual')
  })
  test('a record that cannot be written sets manual, though the file on disk still reads autopilot', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    await $.session.start(START)
    expect(last(w)).toBe('autopilot')
    w.failWrite = /sessions\/s1\.json$/
    await $.command.run(RUN('on'))
    expect(w.files.get('/home/u/.claude/state/autonomic/sessions/s1.json') ?? '').toContain('"autopilot"')
    expect(last(w)).toBe('manual')
  })
  test('autonomic never reads it: an env value of autopilot leaves a manual session manual', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_EFFECTIVE_MODE: 'autopilot' } })
    await $.session.start(START)
    expect(last(w)).toBe('manual')
  })
  test('a resumed session id gets its own mode back, cached or not (PR #694 F1)', async ($, on) => {
    const w = world(on)
    w.session.id = 'res-a'
    await $.session.start(START)
    await $.command.run(RUN('on'))
    w.session.id = 'res-b'
    await $.session.start(START)
    expect(last(w)).toBe('manual')
    w.session.id = 'res-a'
    await $.session.start(START)
    expect(last(w)).toBe('autopilot')
    w.session.id = 'res-b'
    await $.session.start(START)
    expect(last(w)).toBe('manual')
  })
  test('a resumed session id gets its mode back even when the command cannot be registered (PR #694 R3-A)', async ($, on) => {
    const w = world(on)
    w.session.id = 'reg-a'
    await $.session.start(START)
    await $.command.run(RUN('on'))
    w.session.id = 'reg-b'
    await $.session.start(START)
    w.session.id = 'reg-a'
    await $.session.start(START)
    expect(last(w)).toBe('autopilot')
    w.failRegister = true
    w.session.id = 'reg-b'
    await $.session.start(START)
    expect(last(w)).toBe('manual')
  })
  test('a mode that cannot be set unsets the variable and tells the operator (PR #694 R3-C)', async ($, on) => {
    const w = world(on)
    w.session.id = 'env-a'
    await $.session.start(START)
    await $.command.run(RUN('on'))
    expect(last(w)).toBe('autopilot')
    w.failEnvSet = v => v === 'manual'
    await $.command.run(RUN('off'))
    expect(last(w)).toBe(undefined)
    expect(w.toasts.join('\n')).toContain('AUTONOMIC_EFFECTIVE_MODE')
  })
  test('a host that refuses every set is reported as stale, never as unset (PR #694 R4)', async ($, on) => {
    const w = world(on)
    w.session.id = 'env-b'
    await $.session.start(START)
    await $.command.run(RUN('on'))
    w.failEnvSet = () => true
    await $.command.run(RUN('off'))
    expect(last(w)).toBe('autopilot')
    const t = w.toasts.join('\n')
    expect(t).toContain('may still read its previous value')
    expect(t).not.toContain('it is unset')
  })
  test('a new session id follows its own mode', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.command.run(RUN('on'))
    expect(last(w)).toBe('autopilot')
    w.session.id = 's2'
    await $.session.start(START)
    expect(last(w)).toBe('manual')
  })
})
