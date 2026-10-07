import { describe, test, expect } from 'claude-code/testing'
import { DEFAULT_POLICY } from '../hooks/policy'
import { turnEndPrompt } from '../hooks/prompts'
import { parseTurn } from '../hooks/verdict'
import { LEDGER, ledgerLines, world } from './world'

const AP = { AUTONOMIC_MODE: 'autopilot' }
const STOP = (msg = 'Which pricing model should I build?') => ({ stop_hook_active: false, last_assistant_message: msg, session_id: 's1' }) as never
const fork = (o: object) => ({ isAnswered: true as const, text: JSON.stringify(o) })
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} } } as const
const SURFACES = ['terminal', 'desktop'] as const

const OPTS = [
  { label: 'Flat fee', text: 'Build the flat-fee pricing model.', recommended: false },
  { label: 'Per seat', text: 'Build the per-seat pricing model.', recommended: true },
]
const PAIN = (options: unknown = OPTS) => fork({ case: 'pain', question: 'Which pricing model?', reason: 'product ambiguity', options })

describe('pain options in the turn-end verdict (0.3.0 spec §3.2.1)', () => {
  test('valid options are kept, in order', () => {
    expect(parseTurn(PAIN().text)?.options).toEqual(OPTS)
    expect(parseTurn(PAIN([{ label: 'A', text: 'do A' }]).text)?.options).toEqual([{ label: 'A', text: 'do A', recommended: false }])
  })
  test('each invalid shape drops all options; the pain stands', () => {
    const bad: unknown[] = [
      'do A',
      { label: 'A', text: 'do A' },
      [...OPTS, { label: 'C', text: 'do C' }, { label: 'D', text: 'do D' }],
      [{ label: '', text: 'do A' }],
      [{ label: 'A', text: '  ' }],
      [{ label: 'A' }],
      [{ label: 'A', text: 'do A', recommended: true }, { label: 'B', text: 'do B', recommended: true }],
      [{ label: 'A', text: 'do A', recommended: 'yes' }],
      ['A'],
    ]
    for (const options of bad) {
      const v = parseTurn(PAIN(options).text)
      expect(v?.case).toBe('pain')
      expect(v?.question).toBe('Which pricing model?')
      expect(v?.options).toBeUndefined()
    }
  })
  test('an empty array is no options', () => {
    expect(parseTurn(PAIN([]).text)?.options).toBeUndefined()
  })
  test('only a pain carries options', () => {
    expect(parseTurn(fork({ case: 'done', reason: 'r', options: OPTS }).text)?.options).toBeUndefined()
  })
  test('the fork prompt asks for options and names the three rules', () => {
    const p = turnEndPrompt('tail', 'POL')
    for (const s of ['"options"', 'at most one', 'never mark the irreversible one', 'credentials', '"recommended"'])
      expect(p).toContain(s)
  })
})

describe('the pain band with options (0.3.0 spec §3.2.2–3)', () => {
  test('one button per option, the recommended one first, then Dismiss', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(PAIN())
    await $.classic.Stop(STOP())
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'autonomic', surface, ...BAND })
      const labels = (await ui.findAll({ type: 'Button' })).map(b => b.props.label)
      expect(labels).toEqual(['Per seat (Recommended)', 'Flat fee', 'Dismiss'])
      expect(await ui.find({ type: 'Text', text: /Which pricing model\?/ })).toBeDefined()
      await ui.unmount()
    }
  })
  test('a pain with no options shows the question and Dismiss alone', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(PAIN([{ label: '', text: 'x' }]))
    await $.classic.Stop(STOP())
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'autonomic', surface, ...BAND })
      expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['Dismiss'])
      expect(await ui.find({ type: 'Text', text: /Which pricing model\?/ })).toBeDefined()
      await ui.unmount()
    }
  })
  test('a press clears the band, writes the operator line, then submits the option as the operator', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(PAIN())
    await $.classic.Stop(STOP())
    const ui = await $.ui.mount({ plugin: 'autonomic', surface: 'terminal', ...BAND })
    await ui.press({ key: 'option-0' })
    expect(w.notices.at(-1)).toBeNull()
    expect(ledgerLines(w).at(-1)).toMatch(/ · s1 · operator · Q: Which pricing model\? · A: Per seat · why: chosen on the pain band$/)
    expect(w.submits).toEqual([{ text: 'Build the per-seat pricing model.', origin: { kind: 'plugin', name: 'autonomic', asUser: true } }])
  })
  test('nothing runs without a press', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(PAIN())
    await $.classic.Stop(STOP())
    const ui = await $.ui.mount({ plugin: 'autonomic', surface: 'terminal', ...BAND })
    await ui.press({ key: 'dismiss' })
    expect(w.submits).toEqual([])
    expect(ledgerLines(w).some(l => l.includes(' · operator · '))).toBe(false)
  })
  test('a ledger that cannot be written submits nothing', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(PAIN())
    await $.classic.Stop(STOP())
    w.failAppend = new RegExp(LEDGER.replace(/[.]/g, '\\.'))
    const ui = await $.ui.mount({ plugin: 'autonomic', surface: 'terminal', ...BAND })
    await ui.press({ key: 'option-1' })
    expect(w.submits).toEqual([])
    expect(JSON.stringify(w.notices.at(-1))).toContain('ledger not writable')
  })
  test('a second press of the same band submits nothing more', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(PAIN())
    await $.classic.Stop(STOP())
    const ui = await $.ui.mount({ plugin: 'autonomic', surface: 'terminal', ...BAND })
    const first = ui.press({ key: 'option-0' })
    const second = ui.press({ key: 'option-1' }).catch(() => undefined)
    await first
    await second
    expect(w.submits.length).toBe(1)
    expect(ledgerLines(w).filter(l => l.includes(' · operator · ')).length).toBe(1)
  })
  test('labels and texts are redacted before the band, the ledger and the prompt', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(PAIN([{ label: 'Use ghp_abcdefghij', text: 'Run with GITHUB_TOKEN=s3cr3t now.', recommended: true }]))
    await $.classic.Stop(STOP())
    const ui = await $.ui.mount({ plugin: 'autonomic', surface: 'terminal', ...BAND })
    expect((await ui.find({ key: 'option-0' }))?.props.label).toBe('Use *** (Recommended)')
    await ui.press({ key: 'option-0' })
    expect(w.submits[0]?.text).toBe('Run with GITHUB_TOKEN=*** now.')
    expect(ledgerLines(w).join('\n')).not.toContain('ghp_abcdefghij')
    expect(JSON.stringify([...w.files.values()])).not.toContain('s3cr3t')
  })
})

describe('the default policy (0.3.0 spec §3.1)', () => {
  test('carries the pain-options standing order', () => {
    expect(DEFAULT_POLICY).toContain('- When you stop for a pain item, ask with `AskUserQuestion`: two or three options, the recommended one first and marked "(Recommended)"')
    expect(DEFAULT_POLICY).toContain('never mark the irreversible one recommended. For credentials, ask in plain text with no options.')
  })
})

describe('the pain file and bell list the options (0.3.0 spec §3.2.5)', () => {
  test('numbered, the recommended one first and marked', async ($, on) => {
    const w = world(on, { env: { ...AP, AUTONOMIC_BELL: 'ring-it', AUTONOMIC_PAIN_PATH: '/run/r.md.autonomic-pain' } })
    w.forks.push(PAIN())
    await $.classic.Stop(STOP())
    const listed = 'autopilot: pain — Which pricing model? · options: 1) Per seat (Recommended) 2) Flat fee'
    expect(w.files.get('/run/r.md.autonomic-pain')).toMatch(new RegExp(`^\\S+ pain ${listed.replace(/[?()]/g, '\\$&')}\\n$`))
    const bell = w.runs.find(r => r[0] === 'sh' && (r[2] ?? '').includes('ring-it'))
    expect(bell?.[4]).toBe(listed)
  })
  test('a code-written pain lists no options', async ($, on) => {
    const w = world(on, { env: { ...AP, AUTONOMIC_PAIN_PATH: '/run/p' } })
    w.forks.push({ isAnswered: false, reason: 'api-error' }, { isAnswered: false, reason: 'api-error' })
    await $.classic.Stop(STOP())
    expect(w.files.get('/run/p')).not.toContain('options:')
  })
})
