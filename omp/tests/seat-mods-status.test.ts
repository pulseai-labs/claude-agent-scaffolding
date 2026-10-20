// seat-mods' OMP status entry (seat-mods/omp/status-extension.ts): the turn record over input,
// before_agent_start and session_stop, and the checks it reuses from hooks/status.ts. The event
// sequences are the ones the 2026-10-19 probe observed on omp 18.11.3 (AI workspace
// docs/superpowers/reports/2026-10-19-omp-status-port-probe.md).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import statusExtension, { createStatusCheck, replyText } from '../../seat-mods/omp/status-extension'
import { IDLE_REASON, STATUS_CONTEXT, STATUS_LABELS, STATUS_WARNING, rewriteReason } from '../../seat-mods/hooks/status'

const BAD = 'narration'
const block = (fields: string[]) => STATUS_LABELS.map((label, i) => `**${label}** ${fields[i]}`).join('\n')
const GOOD = block(['x', 'x', 'x', 'x', 'x'])
const IDLE = block(['x', 'x', 'merge #1', 'none', 'none'])
const ACTION = block(['x', 'x', 'merge #1', 'none', 'action: run /clear'])
const WAITING = block(['x', 'x', 'x', 'x', 'decision: merge #12 now?'])
const NOTICE = 'seat-mods: waiting on operator — decision: merge #12 now?'
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
  test("molt's first-prompt rewrite (/molt-arm <text>) is read through", () => {
    c.onInput('/molt-arm skill://handoff-resume /h.md', true) // molt loads first and arms its route on a new process
    expect(c.turn()?.status).toBe(true)
    expect(c.onBeforeAgentStart('skill://handoff-resume /h.md')?.message.content).toBe(STATUS_CONTEXT)
    const k = createStatusCheck(() => 'orchestrator')
    k.onInput('/molt-arm fix the bug', true)
    expect(k.turn()?.status).toBe(false)
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
  test('an operator follow-up queued mid-turn and run as its own turn is not checked', () => {
    c.onInput('[crew report reviewer] done', true)
    c.onInput('then look at X', false)                     // typed while the turn runs; OMP queues it
    expect(c.onSessionStop({ last_assistant_message: GOOD })).toEqual(NOTHING) // the running turn ends
    c.onBeforeAgentStart('then look at X')                 // the queued prompt starts its own run, no new input
    expect(c.onSessionStop({ last_assistant_message: BAD })).toEqual(NOTHING)
  })
  test('a tagged report queued mid-turn and run as its own turn is checked', () => {
    c.onInput('fix the bug', true)
    c.onInput('[crew report reviewer] done', false)
    expect(c.onSessionStop({ last_assistant_message: BAD })).toEqual(NOTHING)
    c.onBeforeAgentStart('[crew report reviewer] done')
    expect(c.onSessionStop({ last_assistant_message: BAD }).block).toBeDefined()
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
    expect(c.onSessionStop({ last_assistant_message: ACTION })).toEqual({ block: undefined, warning: undefined, notice: 'seat-mods: waiting on operator — action: run /clear' })
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

describe('the waiting-on-operator notice (#873)', () => {
  test('a decision on a passing block is a notice', () => {
    c.onInput('[crew report reviewer] done', true)
    expect(c.onSessionStop({ last_assistant_message: WAITING })).toEqual({ block: undefined, warning: undefined, notice: NOTICE })
  })
  test('an action on a passing block is a notice', () => {
    c.onInput('[crew report reviewer] done', true)
    expect(c.onSessionStop({ last_assistant_message: ACTION }).notice).toBe('seat-mods: waiting on operator — action: run /clear')
  })
  test('a reply let through after its rewrite still notices', () => {
    c.onInput('[crew report reviewer] done', true)
    expect(c.onSessionStop({ last_assistant_message: BAD }).block).toBeDefined()
    const second = c.onSessionStop({ last_assistant_message: 'Done.\nWaiting on operator: decision: merge #12 now?', stop_hook_active: true })
    expect(second).toEqual({ block: undefined, warning: STATUS_WARNING, notice: NOTICE })
  })
  test('quiet on none', () => {
    c.onInput('[crew report reviewer] done', true)
    expect(c.onSessionStop({ last_assistant_message: GOOD }).notice).toBeUndefined()
  })
  test('quiet on a molt handoff', () => {
    c.onInput('[crew report reviewer] done', true)
    expect(c.onSessionStop({ last_assistant_message: 'Waiting on operator: decision: go?\nMOLT-HANDOFF: /h.md' }).notice).toBeUndefined()
  })
  test('quiet for a non-orchestrator role', () => {
    const k = createStatusCheck(() => 'implementer')
    k.onInput('[crew report reviewer] done', true)
    expect(k.onSessionStop({ last_assistant_message: WAITING }).notice).toBeUndefined()
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

// The OMP half of #873: the handler shows the notice and runs the bell from autonomic's
// record. The bell is detached with a 30 s kill; a failure is logged and never blocks.
describe('the waiting-on-operator wiring (#873)', () => {
  type Handler = (e: unknown, c: unknown) => unknown
  const ambientRole = process.env.SEAT_MODS_ROLE
  const ambientHome = process.env.HOME
  const dirs: string[] = []
  afterEach(() => {
    if (ambientRole === undefined) delete process.env.SEAT_MODS_ROLE; else process.env.SEAT_MODS_ROLE = ambientRole
    if (ambientHome === undefined) delete process.env.HOME; else process.env.HOME = ambientHome
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  const recordHome = (record: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'seat-mods-873-'))
    dirs.push(dir)
    mkdirSync(join(dir, '.claude/state/autonomic/sessions'), { recursive: true })
    writeFileSync(join(dir, '.claude/state/autonomic/sessions/s1.json'), record)
    return dir
  }
  const load = (exec: (...args: unknown[]) => Promise<unknown>) => {
    const handlers = new Map<string, Handler>()
    statusExtension({ on: (name: string, fn: Handler) => { handlers.set(name, fn) }, exec }, { home: () => process.env.HOME ?? '' })
    return handlers
  }
  const mainCtx = (notes: unknown[][]) =>
    ({ agent: { kind: 'main' }, isIdle: () => true, sessionManager: { getSessionId: () => 's1' }, ui: { notify: (...a: unknown[]) => { notes.push(a) } } })
  const stop = async (handlers: Map<string, Handler>, ctx: unknown, reply: string): Promise<unknown> => {
    await handlers.get('input')!({ text: '[crew report reviewer] done', source: 'interactive' }, ctx)
    return handlers.get('session_stop')!({ last_assistant_message: reply, stop_hook_active: false }, ctx)
  }

  test('autopilot: the notice is shown and the bell runs once', async () => {
    process.env.SEAT_MODS_ROLE = 'orchestrator'
    process.env.HOME = recordHome('{"mode":"autopilot","bell":"notify-me"}')
    const execs: unknown[][] = []
    const handlers = load(async (...args: unknown[]) => { execs.push(args); return { exitCode: 0 } })
    const notes: unknown[][] = []
    expect(await stop(handlers, mainCtx(notes), WAITING)).toBeUndefined()
    expect(notes).toEqual([[NOTICE, 'info']])
    expect(execs.length).toBe(1)
    expect(execs[0]?.[0]).toBe('sh')
    const argv = execs[0]?.[1] as string[]
    expect(argv.at(-1)).toBe(NOTICE)
    expect(argv[1]).toContain('AUTONOMIC_MESSAGE')
    expect(execs[0]?.[2]).toEqual({ timeout: 30_000 })
  })

  test('autopilot without a bell still shows the notice', async () => {
    process.env.SEAT_MODS_ROLE = 'orchestrator'
    process.env.HOME = recordHome('{"mode":"autopilot"}')
    const execs: unknown[][] = []
    const handlers = load(async (...args: unknown[]) => { execs.push(args); return { exitCode: 0 } })
    const notes: unknown[][] = []
    expect(await stop(handlers, mainCtx(notes), WAITING)).toBeUndefined()
    expect(notes).toEqual([[NOTICE, 'info']])
    expect(execs).toEqual([])
  })

  test('manual mode, and no record at all: quiet', async () => {
    process.env.SEAT_MODS_ROLE = 'orchestrator'
    process.env.HOME = recordHome('{"mode":"manual","bell":"notify-me"}')
    const execs: unknown[][] = []
    const handlers = load(async (...args: unknown[]) => { execs.push(args); return { exitCode: 0 } })
    const notes: unknown[][] = []
    expect(await stop(handlers, mainCtx(notes), WAITING)).toBeUndefined()
    expect(notes).toEqual([])
    expect(execs).toEqual([])
    const empty = mkdtempSync(join(tmpdir(), 'seat-mods-873-'))
    dirs.push(empty)
    process.env.HOME = empty
    expect(await stop(handlers, mainCtx(notes), WAITING)).toBeUndefined()
    expect(notes).toEqual([])
    expect(execs).toEqual([])
  })

  test('a bell that exits non-zero is logged and does not block', async () => {
    process.env.SEAT_MODS_ROLE = 'orchestrator'
    process.env.HOME = recordHome('{"mode":"autopilot","bell":"exit 3"}')
    const errors: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => { errors.push(args) }
    try {
      const handlers = load(async () => ({ exitCode: 3 }))
      const notes: unknown[][] = []
      expect(await stop(handlers, mainCtx(notes), WAITING)).toBeUndefined()
      expect(notes).toEqual([[NOTICE, 'info']])
      await Promise.resolve()
      expect(errors.flat().join(' ')).toContain('bell failed exit=3')
    } finally {
      console.error = original
    }
  })

  test('a bell that rejects is logged and does not block', async () => {
    process.env.SEAT_MODS_ROLE = 'orchestrator'
    process.env.HOME = recordHome('{"mode":"autopilot","bell":"sleep 60"}')
    const errors: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => { errors.push(args) }
    try {
      const handlers = load(async () => { throw new Error('timed out after 30000ms') })
      const notes: unknown[][] = []
      expect(await stop(handlers, mainCtx(notes), WAITING)).toBeUndefined()
      expect(notes).toEqual([[NOTICE, 'info']])
      await Promise.resolve()
      expect(errors.flat().join(' ')).toContain('bell failed Error: timed out after 30000ms')
    } finally {
      console.error = original
    }
  })
})
