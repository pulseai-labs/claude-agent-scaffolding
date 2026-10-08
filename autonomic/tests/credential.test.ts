import { describe, test, expect } from 'claude-code/testing'
import { turnEndPrompt } from '../hooks/prompts'
import { parseTurn } from '../hooks/verdict'
import { ledgerLines, world } from './world'

// 0.4.1: a credential is asked on its own line, in plain text; the other decisions bundled
// with it keep their options (a prod freeze and a token, PulseTrader 2026-10-08).
const AP = { AUTONOMIC_MODE: 'autopilot' }
const STOP = (msg = 'Will you write the freeze, and how is the token issued?') => ({ stop_hook_active: false, last_assistant_message: msg, session_id: 's1' }) as never
const fork = (o: object) => ({ isAnswered: true as const, text: JSON.stringify(o) })
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} } } as const
const SURFACES = ['terminal', 'desktop'] as const
const CRED = 'Put the campaign agent token in a 0600 file and tell me only its path.'
const OPTS = [
  { label: 'Write the freeze', text: 'I write the H = 6 freeze on prod now.', recommended: false },
  { label: 'Hold the freeze', text: 'Do not write the freeze yet; keep driving r4.s2.', recommended: false },
]
const PAIN = (o: object = {}) => fork({ case: 'pain', question: 'Will you write the H = 6 freeze on prod?', reason: 'one-way door; credential', options: OPTS, credential: CRED, ...o })

type El = { type: string; props: Record<string, unknown>; children?: unknown[] }
// An element with no props has no props key: give every element one.
const norm = (v: unknown): El => {
  const el = v as El
  return { ...el, props: el.props ?? {}, children: (el.children ?? []).map(c => (typeof c === 'object' && c !== null ? norm(c) : c)) }
}
const kids = (el: El): El[] => (el.children ?? []).filter((c): c is El => typeof c === 'object' && c !== null)
const all = (el: El): El[] => [el, ...kids(el).flatMap(all)]
const shown = (el: El): string => all(el).flatMap(e => (e.children ?? []).filter(c => typeof c === 'string')).join('')

describe('the credential field in the turn-end verdict (0.4.1)', () => {
  test('a pain keeps its credential request beside its options', () => {
    const v = parseTurn(PAIN().text)
    expect(v?.credential).toBe(CRED)
    expect(v?.options).toEqual(OPTS)
  })
  test('a credential alone is a pain with no options', () => {
    const v = parseTurn(fork({ case: 'pain', question: 'How is the token issued?', reason: 'credential', credential: CRED }).text)
    expect(v?.credential).toBe(CRED)
    expect(v?.options).toBeUndefined()
  })
  test('only a pain carries one; a blank or non-string one is dropped and the pain stands', () => {
    expect(parseTurn(fork({ case: 'done', reason: 'r', credential: CRED }).text)?.credential).toBeUndefined()
    for (const bad of ['  ', 7, { a: 1 }]) {
      const v = parseTurn(PAIN({ credential: bad }).text)
      expect(v?.case).toBe('pain')
      expect(v?.credential).toBeUndefined()
      expect(v?.options).toEqual(OPTS)
    }
  })
  test('the fork prompt asks a credential separately and keeps the other decisions\' options', () => {
    const p = turnEndPrompt('tail', 'POL')
    expect(p).toContain('"credential"')
    expect(p).toContain('never in an option')
    expect(p).toContain('the other decisions in the same pain still get their options')
    expect(p).not.toContain('For credentials or secrets, give no options')
  })
})

describe('the credential reaches the operator on its own line (0.4.1)', () => {
  test('the band: the question, the options, the plain-text line, then Dismiss', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(PAIN())
    await $.classic.Stop(STOP())
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'autonomic', surface, ...BAND })
      expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['Write the freeze', 'Hold the freeze', 'Dismiss'])
      const rows = kids(norm(await ui.drawn()))
      expect(rows.length).toBe(5)
      expect(shown(rows[3] as El)).toBe(`In plain text: ${CRED}`)
      expect(all(rows[3] as El).some(e => e.type === 'Button')).toBe(false)
      await ui.unmount()
    }
  })
  test('a credential with no options: the question line, the plain-text line, Dismiss', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(PAIN({ options: undefined, question: 'How is the token issued?' }))
    await $.classic.Stop(STOP())
    const ui = await $.ui.mount({ plugin: 'autonomic', surface: 'terminal', ...BAND })
    expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['Dismiss'])
    expect(shown(norm(await ui.drawn()))).toContain(`In plain text: ${CRED}`)
    await ui.unmount()
  })
  test('the pain file, the bell and the ledger carry it', async ($, on) => {
    const w = world(on, { env: { ...AP, AUTONOMIC_BELL: 'ring-it', AUTONOMIC_PAIN_PATH: '/run/p' } })
    w.forks.push(PAIN())
    await $.classic.Stop(STOP())
    const tail = ` · in plain text: ${CRED}`
    expect(w.files.get('/run/p') ?? '').toContain('· options: 1) Write the freeze 2) Hold the freeze' + tail)
    expect(w.runs.find(r => r[0] === 'sh' && (r[2] ?? '').includes('ring-it'))?.[4]).toContain(tail)
    expect(ledgerLines(w).at(-1)).toContain(`Q: Will you write the H = 6 freeze on prod?${tail} · A: ask the operator`)
  })
  test('the request is redacted like every pain text', async ($, on) => {
    const w = world(on, { env: { ...AP, AUTONOMIC_PAIN_PATH: '/run/p' } })
    w.forks.push(PAIN({ credential: 'Confirm GITHUB_TOKEN=ghp_abcdefghijklmnop is the one to rotate.' }))
    await $.classic.Stop(STOP())
    expect(w.files.get('/run/p') ?? '').not.toContain('ghp_')
    const ui = await $.ui.mount({ plugin: 'autonomic', surface: 'terminal', ...BAND })
    expect(shown(norm(await ui.drawn()))).not.toContain('ghp_')
    await ui.unmount()
  })
})
