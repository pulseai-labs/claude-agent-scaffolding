// seat-mods' OMP status entry (seat-mods/omp/status-extension.ts): the turn record over input,
// before_agent_start and session_stop, and the checks it reuses from hooks/status.ts. The event
// sequences are the ones the 2026-10-19 probe observed on omp 18.11.3 (AI workspace
// docs/superpowers/reports/2026-10-19-omp-status-port-probe.md).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import statusExtension, { createStatusCheck, replyText } from '../../seat-mods/omp/status-extension'
import { IDLE_REASON, STATUS_CONTEXT, STATUS_LABELS, STATUS_WARNING, rewriteReason } from '../../seat-mods/hooks/status'

const BAD = 'narration'
const block = (fields: string[]) => STATUS_LABELS.map((label, i) => `**${label}** ${fields[i]}`).join('\n')
const GOOD = block(['x', 'x', 'x', 'x', 'x'])
const IDLE = block(['x', 'x', 'merge #1', 'none', 'none'])
const ACTION = block(['x', 'x', 'merge #1', 'none', 'action: run /clear'])
const NOTHING = { block: undefined, warning: undefined }

let c: ReturnType<typeof createStatusCheck>
beforeEach(() => { c = createStatusCheck(() => 'orchestrator') })

describe('the stop check', () => {
  test('a tagged input then a bad reply: one block with the rewrite reason', () => {
    c.onInput('[crew report reviewer] done', true)
    expect(c.onSessionStop({ last_assistant_message: BAD }).block?.reason).toBe(rewriteReason('Text comes before **What I ruled:**'))
  })
  test('a valid block ends the turn and clears the record', () => {
    c.onInput('[crew report reviewer] done', true)
    expect(c.onSessionStop({ last_assistant_message: GOOD })).toEqual(NOTHING)
    expect(c.turn()).toBeUndefined()
  })
  test('two failing stops in one turn give exactly one block, then the warning', () => {
    c.onInput('[crew report reviewer] done', true)
    expect(c.onSessionStop({ last_assistant_message: BAD }).block).toBeDefined()
    const second = c.onSessionStop({ last_assistant_message: BAD, stop_hook_active: true })
    expect(second).toEqual({ block: undefined, warning: STATUS_WARNING })
    expect(c.turn()).toBeUndefined()
  })
  test("an untagged input is the operator's: no check", () => {
    c.onInput('fix the bug', true)
    expect(c.onSessionStop({ last_assistant_message: BAD })).toEqual(NOTHING)
    expect(c.turn()).toBeUndefined()
  })
  test('resume prefixes are status', () => {
    for (const t of ['skill://handoff-resume /h.md', '/ossify:handoff-resume /h.md']) {
      const k = createStatusCheck(() => 'orchestrator')
      k.onInput(t, true)
      expect(k.turn()?.status).toBe(true)
    }
  })
  test('a stop with no input before it is a status turn', () => {
    expect(c.onSessionStop({ last_assistant_message: BAD, stop_hook_active: false }).block).toBeDefined()
  })
  test("a continuation after another extension's block keeps the record", () => {
    c.onInput('[crew report reviewer] done', true) // molt blocked this stop; seat-mods never ran
    expect(c.onSessionStop({ last_assistant_message: BAD, stop_hook_active: true }).block).toBeDefined()
  })
  test('a stray continuation with no record does not block', () => {
    expect(c.onSessionStop({ last_assistant_message: BAD, stop_hook_active: true })).toEqual(NOTHING)
  })
  test('operator input mid-turn frees the turn', () => {
    c.onInput('[crew report reviewer] done', true)
    c.onInput('stop and look at X', false)
    expect(c.onSessionStop({ last_assistant_message: BAD })).toEqual(NOTHING)
  })
  test('a tagged input mid-turn leaves the turn status', () => {
    c.onInput('[crew report reviewer] done', true)
    c.onInput('[crew report verifier] done', false)
    expect(c.onSessionStop({ last_assistant_message: BAD }).block).toBeDefined()
  })
  test('the idle block', () => {
    c.onInput('[crew message x] go', true)
    expect(c.onSessionStop({ last_assistant_message: IDLE }).block?.reason).toBe(IDLE_REASON)
  })
  test('an operator action is a wait', () => {
    c.onInput('[crew message x] go', true)
    expect(c.onSessionStop({ last_assistant_message: ACTION })).toEqual(NOTHING)
  })
  test('a molt handoff line ends the turn unchecked', () => {
    c.onInput('[crew message x] go', true)
    expect(c.onSessionStop({ last_assistant_message: 'notes\nMOLT-HANDOFF: /h.md' })).toEqual(NOTHING)
    expect(c.turn()).toBeUndefined()
  })
  test('an aborted turn leaves no stale block', () => {
    c.onInput('[crew message x] go', true)
    c.onSessionStop({ last_assistant_message: BAD })   // blocked; then the operator aborts: no further stop
    c.onInput('[crew message x] again', true)          // idle again: a new record
    expect(c.turn()).toEqual({ status: true, blocked: false, warning: undefined })
  })
  test('the reply may be a message object', () => {
    c.onInput('[crew message x] go', true)
    expect(c.onSessionStop({ last_assistant_message: { role: 'assistant', content: [{ type: 'text', text: GOOD }] } })).toEqual(NOTHING)
  })
})

describe('STATUS_CONTEXT', () => {
  test('rides the prompt that starts a status turn, once', () => {
    c.onInput('[crew message x] go', true)
    expect(c.onBeforeAgentStart('[crew message x] go')?.message).toEqual({ customType: 'seat-mods-status', content: STATUS_CONTEXT, display: false })
    expect(c.onBeforeAgentStart('seat-mods (orchestrator): …')).toBeUndefined() // the hidden turn after a block
  })
  test('a slash command whose prompt arrives expanded still gets it', () => {
    c.onInput('/ossify:handoff-resume /h.md', true)
    expect(c.onBeforeAgentStart('Handoff to resume, if one was named: /h.md')?.message.content).toBe(STATUS_CONTEXT)
  })
  test('never on an operator prompt', () => {
    c.onInput('fix the bug', true)
    expect(c.onBeforeAgentStart('fix the bug')).toBeUndefined()
    const k = createStatusCheck(() => 'orchestrator')
    k.onInput('[crew message x] go', true)
    k.onBeforeAgentStart('[crew message x] go')
    k.onInput('look at X', false) // queued operator follow-up
    expect(k.onBeforeAgentStart('look at X')).toBeUndefined()
  })
  test('a tagged prompt queued into a status turn gets it', () => {
    c.onInput('[crew message x] go', true)
    c.onBeforeAgentStart('[crew message x] go')
    c.onInput('[crew report y] done', false)
    expect(c.onBeforeAgentStart('[crew report y] done')?.message.content).toBe(STATUS_CONTEXT)
  })
})

describe('scope', () => {
  test('non-orchestrator roles: every method is a no-op', () => {
    for (const r of [undefined, 'coordinator', 'implementer', 'bogus']) {
      const k = createStatusCheck(() => r)
      k.onInput('[crew message x] go', true)
      expect(k.turn()).toBeUndefined()
      expect(k.onBeforeAgentStart('[crew message x] go')).toBeUndefined()
      expect(k.onSessionStop({ last_assistant_message: BAD })).toEqual(NOTHING)
    }
  })
  test('replyText reads a string, a content array, and junk', () => {
    expect(replyText('a')).toBe('a')
    expect(replyText({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] })).toBe('a\nb')
    expect(replyText(42)).toBe('')
    expect(replyText(undefined)).toBe('')
  })
})

describe('wiring', () => {
  const ambient = process.env.SEAT_MODS_ROLE
  afterEach(() => { if (ambient === undefined) delete process.env.SEAT_MODS_ROLE; else process.env.SEAT_MODS_ROLE = ambient })
  const load = () => {
    const handlers = new Map<string, (e: unknown, c: unknown) => unknown>()
    statusExtension({ on: (n: string, fn: (e: unknown, c: unknown) => unknown) => { handlers.set(n, fn) } })
    return handlers
  }
  test('a main orchestrator session: one block, then the warning notification', async () => {
    process.env.SEAT_MODS_ROLE = 'orchestrator'
    const h = load()
    const notes: unknown[][] = []
    const ctx = { agent: { kind: 'main' }, isIdle: () => true, ui: { notify: (...a: unknown[]) => { notes.push(a) } } }
    await h.get('input')!({ text: '[crew report reviewer] done', source: 'interactive' }, ctx)
    expect(await h.get('before_agent_start')!({ prompt: '[crew report reviewer] done' }, ctx)).toEqual({ message: { customType: 'seat-mods-status', content: STATUS_CONTEXT, display: false } })
    expect(await h.get('session_stop')!({ last_assistant_message: BAD, stop_hook_active: false }, ctx)).toEqual({ decision: 'block', reason: rewriteReason('Text comes before **What I ruled:**') })
    expect(await h.get('session_stop')!({ last_assistant_message: BAD, stop_hook_active: true }, ctx)).toBeUndefined()
    expect(notes).toEqual([[STATUS_WARNING, 'warning']])
  })
  test('a sub-agent context gets nothing from any handler', async () => {
    process.env.SEAT_MODS_ROLE = 'orchestrator'
    const h = load()
    const ctx = { agent: { kind: 'sub' }, isIdle: () => true, ui: { notify: () => { throw new Error('no notify') } } }
    expect(await h.get('input')!({ text: '[crew report reviewer] done' }, ctx)).toBeUndefined()
    expect(await h.get('before_agent_start')!({ prompt: '[crew report reviewer] done' }, ctx)).toBeUndefined()
    expect(await h.get('session_stop')!({ last_assistant_message: BAD }, ctx)).toBeUndefined()
  })
})
