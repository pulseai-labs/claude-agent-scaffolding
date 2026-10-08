import { describe, test, expect } from 'claude-code/testing'
import { DIGEST_ENTRY_CHARS, DIGEST_MAX_ENTRIES, DIGEST_TOTAL_CHARS, originLabel, promptEntry, pushEntry, renderDigest, toolEntry } from '../hooks/digest'
import { ledgerLines, world } from './world'

describe('the turn digest (0.4.0 spec §3.2)', () => {
  test('origins are labelled', () => {
    expect(originLabel({ kind: 'composer' })).toBe('operator')
    expect(originLabel({ kind: 'bridge' })).toBe('operator')
    expect(originLabel({ kind: 'plugin', name: 'molt' })).toBe('plugin molt')
    expect(originLabel({ kind: 'sdk' })).toBe('sdk')
  })
  test('a prompt entry is one redacted line', () => {
    expect(promptEntry({ kind: 'composer' }, 'gate approved:\nuse UTC\nGITHUB_TOKEN=abc')).toBe('prompt (operator): gate approved: use UTC GITHUB_TOKEN=***')
  })
  test('a tool entry shows the input shape and the result tail, never the full input', () => {
    const e = toolEntry('Bash', { command: 'git commit -m "secret message here"' }, { text: 'x'.repeat(1000) + ' [pilot/greeting 9847ccd] Add greeting.txt' })
    expect(e.startsWith('tool Bash git commit -m (+1 args) → result: …')).toBe(true)
    expect(e).toContain('9847ccd')
    expect(e).not.toContain('secret message here')
    expect(e.length).toBeLessThanOrEqual(DIGEST_ENTRY_CHARS)
  })
  test('deny, error and no text are marked', () => {
    expect(toolEntry('Bash', { command: 'ls' }, { deny: 'seat guard' })).toBe('tool Bash ls → denied: seat guard')
    expect(toolEntry('Bash', { command: 'ls' }, { isError: true, text: 'no such file' })).toBe('tool Bash ls → error: no such file')
    expect(toolEntry('Edit', { file_path: '/a', old_string: 'x' }, {})).toBe('tool Edit {file_path, old_string} → result: (no text)')
  })
  test('a 1 MB result stays bounded, and a credential in it is redacted before the tail', () => {
    const e = toolEntry('Bash', { command: 'cat big' }, { text: `${'y'.repeat(1_000_000)} ghp_abcdefghijklmnop end` })
    expect(e.length).toBeLessThanOrEqual(DIGEST_ENTRY_CHARS)
    expect(e).not.toContain('ghp_')
  })
  test('a 1 MB prompt stays bounded, and a credential split by the bound is dropped, not shown', () => {
    const e = promptEntry({ kind: 'composer' }, `start ${'z'.repeat(1_000_000)}ghp_abcdefghijklmnop end`)
    expect(e.length).toBeLessThanOrEqual(DIGEST_ENTRY_CHARS)
    expect(e.startsWith('prompt (operator): start')).toBe(true)
    expect(e).not.toContain('ghp_')
  })
  test('a token split by the tail window is dropped, not shown in part', () => {
    const e = toolEntry('Bash', { command: 'cat big' }, { text: `ghp_${'q'.repeat(2000)} done` })
    expect(e).not.toContain('qqq')
    expect(e).toContain('done')
  })
  test('the tail is cut after redaction: a token whose prefix falls outside the tail is not shown in part', () => {
    const e = toolEntry('Bash', { command: 'cat t' }, { text: `ghp_${'a'.repeat(400)}` })
    expect(e).not.toContain('aaaaaaaaaa')
  })
  test('a result that is one long token says so, not a bare "result:" (final review M1)', () => {
    expect(toolEntry('Bash', { command: 'ls' }, { text: 'a'.repeat(5000) })).toBe('tool Bash ls → result: (one long token)')
  })
  test('the last 12 entries are kept, oldest dropped', () => {
    let d: string[] = []
    for (let i = 0; i < 20; i++) d = pushEntry(d, `e${i}`)
    expect(d.length).toBe(DIGEST_MAX_ENTRIES)
    expect(d[0]).toBe('e8')
  })
  test('the rendered block keeps the newest entries within 4,000 characters', () => {
    const d = Array.from({ length: 12 }, (_, i) => `${i}`.padEnd(390, '.'))
    const r = renderDigest(d)
    expect(r.length).toBeLessThanOrEqual(DIGEST_TOTAL_CHARS)
    expect(r.endsWith(d[11]!)).toBe(true)
    expect(r).not.toContain(d[0]!)
  })
})

const AP = { AUTONOMIC_MODE: 'autopilot' }
const allow = (o: object) => ({ isAnswered: true as const, text: JSON.stringify(o) })
const SUBMIT = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as never

describe('the digest reaches the forks, and nothing else (0.4.0 spec §3.2)', () => {
  test('a prompt and a tool result enter the permission fork prompt', async ($, on) => {
    const w = world(on, { env: AP })
    await $.prompt.submit(SUBMIT('Gate approved; use the UTC timestamp.'))
    w.toolResultText = '[pilot/greeting 9847ccd] Add greeting.txt'
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)
    w.forks.push(allow({ decision: 'allow', reason: 'own branch' }))
    await $.tool.check({ tool: 'Bash', input: { command: 'touch report.md' } } as never)
    const p = w.forkPrompts.at(-1) ?? ''
    expect(p).toContain('<recent>')
    expect(p).toContain('Gate approved; use the UTC timestamp.')
    expect(p).toContain('9847ccd')
  })
  test('a prompt and a tool result enter the ask fork prompt', async ($, on) => {
    const w = world(on, { env: AP })
    await $.prompt.submit(SUBMIT('Gate approved; use the UTC timestamp.'))
    w.toolResultText = '[pilot/greeting 9847ccd] Add greeting.txt'
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)
    w.forks.push(allow({ covered: true, answers: { 'Which colour?': 'Red' }, reason: 'r' }))
    await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Which colour?', header: 'Colour', options: [{ label: 'Red', description: '' }], multiSelect: false }] } as never)
    const p = w.forkPrompts.at(-1) ?? ''
    expect(p).toContain('<recent>')
    expect(p).toContain('Gate approved; use the UTC timestamp.')
    expect(p).toContain('9847ccd')
  })
  test("the operator's answer to a question enters the permission fork prompt (final review I1)", async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(allow({ covered: false, reason: 'open' }))
    await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Push now?', header: 'Push', options: [{ label: 'Push', description: '' }], multiSelect: false }] } as never)
    w.forks.push(allow({ decision: 'allow', reason: 'r' }))
    await $.tool.check({ tool: 'Bash', input: { command: 'git push' } } as never)
    expect(w.forkPrompts.at(-1) ?? '').toContain('tool AskUserQuestion {questions} → result: the operator answered')
  })
  test("autonomic's own answer to a question enters the permission fork prompt (final review I1)", async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(allow({ covered: true, answers: { 'Push now?': 'Push' }, reason: 'plan step 5' }))
    await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Push now?', header: 'Push', options: [{ label: 'Push', description: '' }], multiSelect: false }] } as never)
    w.forks.push(allow({ decision: 'allow', reason: 'r' }))
    await $.tool.check({ tool: 'Bash', input: { command: 'git push' } } as never)
    expect(w.forkPrompts.at(-1) ?? '').toContain('tool AskUserQuestion {questions} → result: autonomic answered: {"Push now?":"Push"}')
  })
  test('a dropped prompt and a subagent tool call do not enter', async ($, on) => {
    const w = world(on, { env: AP })
    w.dropPrompts = true
    await $.prompt.submit(SUBMIT('DROPPED-PROMPT'))
    w.dropPrompts = false
    w.toolResultText = 'SUBAGENT-RESULT'
    await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' } as never)
    w.forks.push(allow({ decision: 'allow', reason: 'r' }))
    await $.tool.check({ tool: 'Bash', input: { command: 'touch x' } } as never)
    const p = w.forkPrompts.at(-1) ?? ''
    expect(p).not.toContain('DROPPED-PROMPT')
    expect(p).not.toContain('prompt (')
    expect(p).not.toContain('SUBAGENT-RESULT')
  })
  test('a new session id starts empty', async ($, on) => {
    const w = world(on, { env: AP })
    await $.prompt.submit(SUBMIT('OLD-SESSION-PROMPT'))
    w.session.id = 's2'
    w.forks.push(allow({ decision: 'allow', reason: 'r' }))
    await $.tool.check({ tool: 'Bash', input: { command: 'touch x' } } as never)
    expect(w.forkPrompts.at(-1) ?? '').not.toContain('OLD-SESSION-PROMPT')
  })
  test('nothing from the digest reaches disk', async ($, on) => {
    const w = world(on, { env: { ...AP, AUTONOMIC_PAIN_PATH: '/run/p', AUTONOMIC_BELL: 'ring-it' } })
    await $.prompt.submit(SUBMIT('PLANTED-PROMPT-7731'))
    w.toolResultText = 'PLANTED-RESULT-8842'
    await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
    w.forks.push(allow({ decision: 'ask', reason: 'not covered' }))
    await $.tool.check({ tool: 'Bash', input: { command: 'touch x' } } as never)
    const disk = JSON.stringify([...w.files.values()]) + JSON.stringify(w.runs)
    expect(w.forkPrompts.at(-1) ?? '').toContain('PLANTED-RESULT-8842')
    expect(disk).not.toContain('PLANTED-PROMPT-7731')
    expect(disk).not.toContain('PLANTED-RESULT-8842')
    expect(ledgerLines(w).join('\n')).not.toContain('PLANTED')
  })
})
