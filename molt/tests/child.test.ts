import { describe, test, expect } from 'claude-code/testing'
import { world } from './world'

const at = (w: ReturnType<typeof world>, percent: number) => { w.usage = { tokens: percent * 10_000, window: 1_000_000 } }
const POST = { tool_name: 'Read', tool_input: {}, tool_response: {}, tool_use_id: 't1', session_id: 's1' } as never
const STOP = { stop_hook_active: false, last_assistant_message: 'done', session_id: 's1' } as never
const TURN = (answer: string) => ({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' }) as never
const S = '/run/rep.md.molt-status'
const CHILD = { MOLT_HANDOFF: 'parent', MOLT_STATUS_PATH: S }
const H = '/run/rep.md.molt.md'
const events = (w: ReturnType<typeof world>) =>
  (w.files.get(S) ?? '').split('\n').filter(Boolean).map(l => l.replace(/^\S+ /, ''))

describe('a child session', () => {
  test('the status file gets each event in order; the handoff never clears', async ($, on) => {
    const w = world(on, { env: CHILD, files: { [H]: '#' } })
    at(w, 42); await $.classic.PostToolUse(POST)
    at(w, 52); await $.classic.PostToolUse(POST)
    at(w, 67); await $.classic.PostToolUse(POST)
    await $.turn.complete(TURN(`done\nMOLT-HANDOFF: ${H}`))
    expect(events(w)).toEqual(['warned 40', 'warned 50', 'handoff required', `handed-off ${H}`])
    expect(w.clears).toBe(0)
    expect((w.files.get(S) ?? '').split('\n')[0]).toMatch(/^\d{4}-\d\d-\d\dT\S+Z warned 40$/)
  })
  test('after the handoff molt stops pushing; the block stays', async ($, on) => {
    const w = world(on, { env: CHILD, files: { [H]: '#' } })
    at(w, 67); await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect((await $.classic.Stop(STOP)).block).toBeUndefined()
    expect((await $.classic.PostToolUse(POST)).additionalContext).toBeUndefined()
    at(w, 76)
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeDefined()
  })
  test('past fallback with no handoff: the brief is handed off, not cleared', async ($, on) => {
    const w = world(on, { env: CHILD }); at(w, 85)
    await $.turn.complete(TURN('done'))
    expect(w.clears).toBe(0)
    expect(events(w).at(-1)).toMatch(/^handed-off \/home\/u\/\.claude\/state\/molt\/briefs\/s1\.md$/)
  })
  test('an unwritable status file: the warning still arrives, the failure is logged once (review focus 3)', async ($, on) => {
    const w = world(on, { env: CHILD }); w.failWrites = /molt-status$/
    at(w, 42)
    expect((await $.classic.PostToolUse(POST)).additionalContext?.join('\n')).toContain("molt's first warning")
    at(w, 52); await $.classic.PostToolUse(POST)
    const logged = w.runs.filter(r => r.join(' ').includes('status write failed'))
    expect(logged).toHaveLength(1)
  })
  test('a status file that exists but cannot be read keeps its lines; the warning still arrives (final review 2)', async ($, on) => {
    const w = world(on, { env: CHILD, files: { [S]: '2026-10-05T00:00:00.000Z earlier\n' } }); w.failReads = /molt-status$/
    at(w, 42)
    expect((await $.classic.PostToolUse(POST)).additionalContext?.join('\n')).toContain("molt's first warning")
    expect(w.files.get(S)).toBe('2026-10-05T00:00:00.000Z earlier\n')
    expect(w.runs.filter(r => r.join(' ').includes('status write failed'))).toHaveLength(1)
  })
  test('a readable status file gets the new line after its earlier ones (control)', async ($, on) => {
    const w = world(on, { env: CHILD, files: { [S]: '2026-10-05T00:00:00.000Z earlier\n' } })
    at(w, 42); await $.classic.PostToolUse(POST)
    expect(events(w)).toEqual(['earlier', 'warned 40'])
  })
  test('MOLT_HANDOFF=Parent is a root: it clears (review focus 4)', async ($, on) => {
    const w = world(on, { env: { MOLT_HANDOFF: 'Parent', MOLT_STATUS_PATH: S }, files: { [H]: '#' } })
    w.clearTo.push('s2'); at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(1)
    expect(w.files.has(S)).toBe(false)
  })
  test('MOLT_HANDOFF=1 is a root: it clears (review focus 4)', async ($, on) => {
    const w = world(on, { env: { MOLT_HANDOFF: '1', MOLT_STATUS_PATH: S }, files: { [H]: '#' } })
    w.clearTo.push('s2'); at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(1)
    expect(w.files.has(S)).toBe(false)
  })
  test('a root writes no status file even with MOLT_STATUS_PATH set (control)', async ($, on) => {
    const w = world(on, { env: { MOLT_STATUS_PATH: S } }); at(w, 42)
    await $.classic.PostToolUse(POST)
    expect(w.files.has(S)).toBe(false)
  })
})
