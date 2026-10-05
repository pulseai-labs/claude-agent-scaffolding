import { describe, test, expect } from 'claude-code/testing'
import { MARK, world } from './world'

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as never
const RUN = (args: string) =>
  ({ command: 'molt', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as never

describe('the active marker (spec §7.1)', () => {
  test('session.start writes it; session.end removes it', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.files.has(MARK())).toBe(true)
    await $.session.end({ reason: 'exit', sessionId: 's1' } as never)
    expect(w.files.has(MARK())).toBe(false)
  })

  test('/molt off removes it and keeps it off; /molt on writes it again', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const r = await $.command.run(RUN('off'))
    expect(r.text).toContain('off')
    expect(w.files.has(MARK())).toBe(false)
    expect(w.statuses.at(-1)).toBe('molt: off')
    await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } } as never)
    expect(w.files.has(MARK())).toBe(false)
    await $.command.run(RUN('on'))
    expect(w.files.has(MARK())).toBe(true)
  })

  test('a prompt refreshes it', async ($, on) => {
    const w = world(on)
    await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } } as never)
    expect(w.files.has(MARK())).toBe(true)
  })

  test('a session id that is not a plain name writes no marker', async ($, on) => {
    const w = world(on)
    w.session.id = '../escape'
    await $.session.start(START)
    // The engine normalizes `..` before the write lands, so an escape shows up under
    // another name: no file at all may be written.
    expect([...w.files.keys()]).toEqual([])
  })
})

describe('templates on first start', () => {
  test('missing templates are written', async ($, on) => {
    const w = world(on)
    await $.classic.SessionStart({ source: 'startup', session_id: 's1' } as never)
    expect(w.files.get('/home/u/.claude/molt/instructions.md')).toContain('MOLT-HANDOFF:')
    expect(w.files.get('/home/u/.claude/molt/seed.md')).toContain('{{path}}')
  })
  test('an existing template is never overwritten', async ($, on) => {
    const w = world(on, { files: { '/home/u/.claude/molt/seed.md': 'mine {{path}}' } })
    await $.classic.SessionStart({ source: 'startup', session_id: 's1' } as never)
    expect(w.files.get('/home/u/.claude/molt/seed.md')).toBe('mine {{path}}')
  })
})

describe('/molt status', () => {
  test('warns when auto-compact sits below the hard threshold', async ($, on) => {
    const w = world(on)
    w.breakdown = { isAutoCompactEnabled: true, autoCompactThreshold: 600_000, rawMaxTokens: 1_000_000 }
    const r = await $.command.run(RUN('status'))
    expect(r.text).toContain('WARNING: auto-compact runs at 60%')
  })
  test('warns at exactly the hard threshold', async ($, on) => {
    const w = world(on)
    w.breakdown = { isAutoCompactEnabled: true, autoCompactThreshold: 650_000, rawMaxTokens: 1_000_000 }
    const r = await $.command.run(RUN('status'))
    expect(r.text).toContain('WARNING: auto-compact runs at 65%')
  })
  test('no warning when auto-compact is above hard (control)', async ($, on) => {
    const w = world(on)
    w.breakdown = { isAutoCompactEnabled: true, autoCompactThreshold: 900_000, rawMaxTokens: 1_000_000 }
    const r = await $.command.run(RUN('status'))
    expect(r.text).not.toContain('WARNING')
    expect(r.text).toContain('auto-compact at 90%')
  })
  test('an unknown argument prints the usage', async ($, on) => {
    world(on)
    const r = await $.command.run(RUN('frob'))
    expect(r.text).toContain('/molt now | off | on | status')
  })
})
