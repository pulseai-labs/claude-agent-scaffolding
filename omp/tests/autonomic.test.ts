import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ompExtension, { createAutonomic, questionsOf } from '../../autonomic/omp/extension'
import type { AutonomicIO } from '../../autonomic/omp/extension'
import { DEFAULT_POLICY } from '../../autonomic/hooks/policy'
import { modeFilePath, sessionPath, stagePath } from '../../autonomic/hooks/records'

const HOME = '/home/u'
const POLICY = `${HOME}/.claude/autonomic/policy.md`
const LEDGER = '/repo/.autonomic/ledger.md'
const MODE_FILE = `${HOME}/.claude/state/autonomic/mode/42`
const REC = (id = 'S1') => sessionPath(HOME, id)

const turn = (v: object) => JSON.stringify(v)
const STALLED = turn({ case: 'stalled', next_step: 'run the tests', reason: 'plan step 3' })
const COVERED = turn({ case: 'covered', question: 'Shall I proceed?', answer: 'Proceed with the plan.', reason: 'the plan decides' })

// A fake AutonomicIO: an in-memory file system, scripted side-turn replies, and a record of every side effect.
// A reply that is an Error is thrown; undefined means the host has no ephemeral turn; HANG never settles (a host that
// ignores the abort signal).
const HANG: Promise<never> = new Promise(() => {})
function world(over: { env?: Record<string, string>; files?: Record<string, string>; noPolicy?: boolean; budgetMs?: number; replies?: Array<string | Error | undefined | Promise<never>>; failAppend?: RegExp; failTouch?: boolean; failWrite?: RegExp; failRename?: boolean; failRemove?: boolean } = {}) {
  const files = new Map<string, string>([...(over.noPolicy ? [] : [[POLICY, 'TEST POLICY\n'] as [string, string]]), ...Object.entries(over.files ?? {})])
  const w = {
    id: 'S1',
    percent: undefined as number | undefined,
    system: undefined as string | string[] | undefined,
    replies: [...(over.replies ?? [])],
    prompts: [] as string[],
    budgets: [] as number[],
    notes: [] as string[],
    statuses: [] as string[],
    bells: [] as Array<[string, string]>,
    runs: [] as string[][],
    envSets: [] as Array<[string, string | undefined]>,
    files,
    git: { top: '/repo', branch: 'feat/x', originHead: 'origin/main' },
    // a folder that is its own checkout (git -C <dir>): the floor asks about the bash call's cwd
    gitBy: {} as Record<string, { top: string; branch: string; originHead: string }>,
  }
  const env: Record<string, string | undefined> = { HOME, ...over.env }
  const io: AutonomicIO = {
    pid: 42,
    remove: p => { if (over.failRemove) throw new Error('remove denied'); files.delete(p) },
    writeMode: (p, t) => { if (over.failWrite?.test(p)) throw new Error('read-only'); files.set(p, t) },
    rename: (from, to) => { if (over.failRename) throw new Error('rename denied'); files.set(to, files.get(from)!); files.delete(from) },
    sessionId: () => w.id,
    cwd: '/repo',
    env,
    setEnv: (n, v) => { w.envSets.push([n, v]); if (v === undefined) delete env[n]; else env[n] = v },
    readText: async p => files.get(p),
    exists: async p => files.has(p),
    writeText: async (p, t) => { if (over.failWrite?.test(p)) throw new Error('read-only'); files.set(p, t) },
    appendLine: async (p, l) => {
      if (over.failAppend?.test(p)) return false
      files.set(p, `${files.get(p) ?? ''}${l}\n`)
      return true
    },
    touch: async p => { if (over.failTouch) return false; if (!files.has(p)) files.set(p, ''); return true },
    run: async argv => {
      w.runs.push(argv)
      const a = argv.join(' ')
      const g = w.gitBy[argv[2] ?? ''] ?? w.git
      if (a.endsWith('rev-parse --show-toplevel')) return { exitCode: 0, stdout: `${g.top}\n` }
      if (a.endsWith('rev-parse --abbrev-ref HEAD')) return { exitCode: 0, stdout: `${g.branch}\n` }
      if (a.endsWith('symbolic-ref --short refs/remotes/origin/HEAD')) return { exitCode: 0, stdout: `${g.originHead}\n` }
      return { exitCode: 1, stdout: '' }
    },
    ephemeral: async (prompt, ms) => {
      w.prompts.push(prompt)
      w.budgets.push(ms)
      const r = w.replies.shift()
      if (r instanceof Error) throw r
      return r
    },
    usage: () => w.percent,
    systemPrompt: () => w.system,
    notify: t => { w.notes.push(t) },
    status: t => { w.statuses.push(t) },
    bell: async (c, m) => { w.bells.push([c, m]) },
  }
  const a = createAutonomic(io, over.budgetMs)
  return { w, a, files, env, io }
}

const autopilot = (id = 'S1') => ({ [REC(id)]: JSON.stringify({ mode: 'autopilot', scope: [], source: 'command' }) })
const ledger = (w: { files: Map<string, string> }) => (w.files.get(LEDGER) ?? '').split('\n').filter(Boolean)
const ask = (questions: unknown) => ({ toolName: 'ask', input: { questions } })
const OPTS = [{ label: 'Plan A' }, { label: 'Plan B' }]
const Q = [{ id: 'q1', question: 'Which plan?', options: OPTS }]
const answered = (a: Record<string, string>) => turn({ covered: true, answers: a, reason: 'the plan names Plan A' })

describe('OMP live mode file', () => {
  test('load sets the absolute process path and removes a reused pid file synchronously', () => {
    const { files, env } = world({ files: { [MODE_FILE]: 'autopilot' } })
    expect(env.AUTONOMIC_MODE_FILE).toBe(MODE_FILE)
    expect(modeFilePath(HOME, 42)).toBe(MODE_FILE)
    expect(files.has(MODE_FILE)).toBe(false)
  })

  test('on and off atomically publish the live mode', async () => {
    const { a, files, env, io } = world()
    const renames: Array<[string, string, string | undefined]> = []
    const rename = io.rename
    io.rename = (from, to) => {
      renames.push([from, to, files.get(from)])
      expect(from).not.toBe(to)
      expect(join(from, '..')).toBe(join(to, '..'))
      rename(from, to)
    }
    await a.onCommand('on')
    expect(files.get(MODE_FILE)).toBe('autopilot')
    expect(env.AUTONOMIC_EFFECTIVE_MODE).toBe('autopilot')
    await a.onCommand('off')
    expect(files.get(MODE_FILE)).toBe('manual')
    expect(env.AUTONOMIC_EFFECTIVE_MODE).toBe('manual')
    expect(renames.map(r => r[2])).toContain('autopilot')
    expect(renames.at(-1)?.[2]).toBe('manual')
    expect([...files.keys()].filter(p => p.startsWith(MODE_FILE) && p !== MODE_FILE)).toEqual([])
  })

  for (const reason of ['no policy', 'ledger not writable', 'record not writable']) {
    test(`a fall to manual publishes manual: ${reason}`, async () => {
      const { a, files, io } = world({ replies: [STALLED] })
      await a.onCommand('on')
      expect(files.get(MODE_FILE)).toBe('autopilot')
      if (reason === 'no policy') files.delete(POLICY)
      if (reason === 'ledger not writable') io.appendLine = async () => false
      if (reason === 'record not writable') io.writeText = async () => { throw new Error('read-only') }
      if (reason === 'record not writable') await a.onCommand('on')
      else await a.onSessionStop({ last_assistant_message: 'x' })
      expect(files.get(MODE_FILE)).toBe('manual')
    })
  }

  for (const operation of ['write', 'rename']) {
    for (const removalFails of [false, true]) {
      test(`failed ${operation}, removal fails=${removalFails}: warns and fails toward manual`, async () => {
        const { a, files, io, w } = world()
        await a.onCommand('on')
        expect(files.get(MODE_FILE)).toBe('autopilot')
        if (operation === 'write') io.writeMode = () => { throw new Error('write denied') }
        else io.rename = () => { throw new Error('rename denied') }
        if (removalFails) io.remove = () => { throw new Error('remove denied') }
        await a.onCommand('off')
        expect(files.get(MODE_FILE)).toBe(removalFails ? 'autopilot' : undefined)
        if (removalFails) expect(w.notes).toContain(`autonomic: the mode file ${MODE_FILE} could not be updated to manual or removed; do not let a launcher trust it in this session.`)
        else expect(w.notes).toContain(`autonomic: the mode file ${MODE_FILE} could not be updated to manual; it was removed, so a launcher reads manual.`)
      })
    }
  }

  test('a throwing removal notice does not falsely report a failed removal', async () => {
    const { a, files, io, w } = world()
    await a.onCommand('on')
    expect(files.get(MODE_FILE)).toBe('autopilot')
    io.writeMode = () => { throw new Error('write denied') }
    io.notify = text => {
      w.notes.push(text)
      if (text.includes('it was removed')) throw new Error('notify failed')
    }
    await a.onSessionStart()
    expect(files.has(MODE_FILE)).toBe(false)
    expect(w.notes).toHaveLength(1)
    expect(w.notes[0]).toContain('it was removed, so a launcher reads manual')
    expect(w.notes.join('\n')).not.toContain('or removed; do not let a launcher trust it')
  })

  test('shutdown removes the file silently, even when removal fails', async () => {
    const { a, files, io, w } = world()
    await a.onCommand('on')
    a.onSessionShutdown()
    expect(files.has(MODE_FILE)).toBe(false)
    await a.onCommand('on')
    io.remove = () => { throw new Error('remove denied') }
    expect(() => a.onSessionShutdown()).not.toThrow()
    expect(files.get(MODE_FILE)).toBe('autopilot')
    expect(w.notes).toEqual([])
  })
})

describe('manual mode', () => {
  test('ask and session_stop pass, no ledger line, no fork, no pain', async () => {
    const { w, a, files } = world({ replies: [COVERED] })
    expect(await a.onToolCall(ask(Q))).toBeUndefined()
    expect(await a.onSessionStop({ last_assistant_message: 'Shall I proceed?' })).toBeUndefined()
    expect(w.prompts).toEqual([])
    expect(w.notes).toEqual([])
    expect(files.has(LEDGER)).toBe(false)
  })

  test('a force push is not touched in manual mode', async () => {
    const { a } = world()
    expect(await a.onToolCall({ toolName: 'bash', input: { command: 'git push --force origin main' } })).toBeUndefined()
  })
})

describe('the ask reflex', () => {
  test('autopilot: a covered ask is blocked with the answer, and one ledger line is written', async () => {
    const { w, a } = world({ files: autopilot(), replies: [answered({ 'Which plan?': 'Plan A' })] })
    const r = await a.onToolCall(ask(Q))
    expect(r).toEqual({ block: true, reason: expect.stringMatching(/^autonomic answered: \{"Which plan\?":"Plan A"\} — autonomic answered in the operator's place/) })
    const lines = ledger(w)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(' · ask · Q: Which plan? · A: Plan A · why: the plan names Plan A')
    expect(w.notes).toEqual([])
    expect(w.prompts[0]).toContain('autonomic question check')
    expect(w.prompts[0]).toContain('TEST POLICY')
  })

  test('autopilot: a fork that fails twice (a throw, then an empty reply) passes the ask, raises pain and writes a pain ledger line', async () => {
    const { w, a } = world({ files: autopilot(), replies: [new Error('boom'), ''] })
    expect(await a.onToolCall(ask(Q))).toBeUndefined()
    expect(w.prompts).toHaveLength(2)
    expect(w.notes).toHaveLength(1)
    expect(w.notes[0]).toContain('autopilot: question for you')
    expect(w.notes[0]).toContain('Which plan?')
    expect(w.notes[0]).toContain('the fork failed twice')
    // Review Focus 5: the pass is on the record, not only on the screen.
    expect(ledger(w).join('\n')).toContain(' · pain · ')
  })

  test('a reply that does not parse twice is the same failure', async () => {
    const { w, a } = world({ files: autopilot(), replies: ['not json', '{"covered": maybe}'] })
    expect(await a.onToolCall(ask(Q))).toBeUndefined()
    expect(w.notes[0]).toContain('the fork failed twice, or its reply did not parse')
  })

  test('a not-covered verdict passes with pain naming its reason', async () => {
    const { w, a } = world({ files: autopilot(), replies: [turn({ covered: false, reason: 'tradeoff the scope does not settle' })] })
    expect(await a.onToolCall(ask(Q))).toBeUndefined()
    expect(w.notes[0]).toContain('tradeoff the scope does not settle')
  })

  test('a question with no options is free text: pain, no fork', async () => {
    const { w, a } = world({ files: autopilot() })
    expect(await a.onToolCall(ask([{ id: 'q', question: 'Which token?' }]))).toBeUndefined()
    expect(w.prompts).toEqual([])
    expect(w.notes[0]).toContain('(free text)')
    expect(ledger(w)[0]).toContain(' · pain · Q: Which token? · A: ask the operator · why: free text')
  })

  test('a ledger that cannot be written passes the ask: the decision is not taken', async () => {
    const { w, a } = world({ files: autopilot(), replies: [answered({ 'Which plan?': 'Plan A' })], failAppend: /ledger/ })
    expect(await a.onToolCall(ask(Q))).toBeUndefined()
    expect(w.notes.join('\n')).toContain('ledger is not writable')
  })

  test('both attempts share one deadline inside the 30 s handler budget', async () => {
    const { w, a } = world({ files: autopilot(), replies: ['x', 'y'] })
    await a.onToolCall(ask(Q))
    expect(w.budgets).toHaveLength(2)
    expect(w.budgets[0]!).toBeLessThanOrEqual(25_000)
    expect(w.budgets[1]!).toBeLessThanOrEqual(w.budgets[0]!)
  })

  test('a hung ephemeral turn (a host that ignores the abort signal) is a failed attempt: the ask passes with pain and a pain ledger line', async () => {
    const { w, a } = world({ files: autopilot(), replies: [HANG], budgetMs: 1_000 })
    const t0 = Date.now()
    expect(await a.onToolCall(ask(Q))).toBeUndefined()
    expect(Date.now() - t0).toBeLessThan(5_000)  // the deadline, not omp's 30 s
    expect(w.prompts).toHaveLength(1)
    expect(w.notes).toHaveLength(1)
    expect(w.notes[0]).toContain('question for you')
    expect(w.notes[0]).toContain('the fork failed twice')
    expect(ledger(w).join('\n')).toContain(' · pain · ')
  })

  test('a reply inside the deadline is still taken (control for the hung-turn race)', async () => {
    const { a } = world({ files: autopilot(), replies: [answered({ 'Which plan?': 'Plan A' })], budgetMs: 60 })
    expect((await a.onToolCall(ask(Q)))?.reason).toContain('autonomic answered')
  })

  test('a hung turn at the turn end is the same failed attempt: the stop passes with pain', async () => {
    const { w, a } = world({ files: autopilot(), replies: [HANG], budgetMs: 1_000 })
    expect(await a.onSessionStop({ last_assistant_message: 'Shall I proceed?' })).toBeUndefined()
    expect(w.notes.join('\n')).toContain('autopilot:')
  })

  test('a host with no ephemeral turn has nothing to judge with: the ask passes with pain', async () => {
    const { w, a } = world({ files: autopilot(), replies: [undefined] })
    expect(await a.onToolCall(ask(Q))).toBeUndefined()
    expect(w.notes[0]).toContain('nothing to judge yet')
  })

  test('questionsOf maps omp\'s ask input: id/question/options/multi, string options, the legacy single form', () => {
    expect(questionsOf({ questions: [{ id: 'a', question: 'Q1?', header: 'H', options: [{ label: 'x', description: 'd' }, 'y'], multi: true, recommended: 0 }] }))
      .toEqual([{ question: 'Q1?', header: 'H', options: [{ label: 'x' }, { label: 'y' }], multiSelect: true }])
    expect(questionsOf({ question: 'Solo?', options: [{ label: 'x' }] })).toEqual([{ question: 'Solo?', options: [{ label: 'x' }] }])
    expect(questionsOf({ questions: [{ id: 'a' }, null, 'junk'] })).toEqual([])
    expect(questionsOf(undefined)).toEqual([])
  })

  test('a multi-select answer is read back as joined labels', async () => {
    const { a } = world({ files: autopilot(), replies: [answered({ 'Which?': 'Plan A, Plan B' })] })
    const r = await a.onToolCall(ask([{ id: 'q', question: 'Which?', options: OPTS, multi: true }]))
    expect(r?.reason).toContain('"Which?":"Plan A, Plan B"')
  })
})

describe('the turn-end reflex', () => {
  test('autopilot: stalled with next step "run the tests" blocks with Autopilot: continue — run the tests.', async () => {
    const { w, a } = world({ files: autopilot(), replies: [STALLED] })
    expect(await a.onSessionStop({ last_assistant_message: 'Step 2 is done.' })).toEqual({ decision: 'block', reason: 'Autopilot: continue — run the tests.' })
    expect(ledger(w)[0]).toContain(' · stalled · ')
    expect(w.prompts[0]).toContain('autonomic turn-end check')
    expect(w.prompts[0]).toContain('Step 2 is done.')
  })

  test('covered blocks with the answer', async () => {
    const { a } = world({ files: autopilot(), replies: [COVERED] })
    expect(await a.onSessionStop({ last_assistant_message: 'Shall I proceed?' })).toEqual({ decision: 'block', reason: 'Autopilot: Proceed with the plan. Proceed.' })
  })

  test('autopilot: pain passes the stop and raises the pain signal with the question and its options', async () => {
    const reply = turn({ case: 'pain', question: 'Merge to main?', reason: 'one-way door', options: [{ label: 'Merge', text: 'Merge it.', recommended: false }, { label: 'Hold', text: 'Do not merge.', recommended: true }] })
    const { w, a, files } = world({ files: autopilot(), replies: [reply], env: { AUTONOMIC_PAIN_PATH: '/pain.txt' } })
    expect(await a.onSessionStop({ last_assistant_message: 'Merge to main?' })).toBeUndefined()
    expect(w.notes).toHaveLength(1)
    expect(w.notes[0]).toContain('autopilot: pain — Merge to main?')
    // The recommended option leads, and the options are listed in the notice and the pain file (no band buttons on OMP).
    expect(w.notes[0]).toContain('options: 1) Hold (Recommended) 2) Merge')
    expect(files.get('/pain.txt')).toContain('pain autopilot: pain — Merge to main?')
    expect(ledger({ files })[0]).toContain(' · pain · Q: Merge to main?')
  })

  test('a credential request is its own plain-text line', async () => {
    const reply = turn({ case: 'pain', question: 'Need the key', reason: 'credential', credential: 'paste the deploy key in plain text' })
    const { w, a } = world({ files: autopilot(), replies: [reply] })
    await a.onSessionStop({ last_assistant_message: 'Need the key' })
    expect(w.notes[0]).toContain('in plain text: paste the deploy key in plain text')
  })

  test('the bell rings with the pain text when the record carries one', async () => {
    const reply = turn({ case: 'pain', question: 'Merge to main?', reason: 'one-way door' })
    const { w, a } = world({ files: { [REC()]: JSON.stringify({ mode: 'autopilot', scope: [], source: 'command', bell: 'say hi' }) }, replies: [reply] })
    await a.onSessionStop({ last_assistant_message: 'Merge to main?' })
    expect(w.bells).toHaveLength(1)
    expect(w.bells[0]![0]).toBe('say hi')
    expect(w.bells[0]![1]).toContain('autopilot: pain')
  })

  test('waiting and done pass; done writes a ledger line and tells the operator', async () => {
    const waiting = world({ files: autopilot(), replies: [turn({ case: 'waiting', reason: 'a build is running' })] })
    expect(await waiting.a.onSessionStop({ last_assistant_message: 'Waiting for CI.' })).toBeUndefined()
    expect(waiting.w.notes).toEqual([])
    const done = world({ files: autopilot(), replies: [turn({ case: 'done', reason: 'the plan is complete' })] })
    expect(await done.a.onSessionStop({ last_assistant_message: 'All done.' })).toBeUndefined()
    expect(ledger(done.w)[0]).toContain(' · done · ')
    expect(done.w.notes[0]).toContain('autopilot: done — the plan is complete')
  })

  test('a fork that fails twice passes the stop with a fork-failed pain and a pain ledger line', async () => {
    const { w, a } = world({ files: autopilot(), replies: [new Error('x'), new Error('y')] })
    expect(await a.onSessionStop({ last_assistant_message: 'ok' })).toBeUndefined()
    expect(w.notes[0]).toContain('autopilot: fork failed')
    expect(ledger(w)[0]).toContain(' · pain · ')
  })

  test('the answer comes from a message object too; a missing one is an empty tail', async () => {
    const { w, a } = world({ files: autopilot(), replies: [turn({ case: 'waiting', reason: 'r' }), turn({ case: 'waiting', reason: 'r' })] })
    await a.onSessionStop({ last_assistant_message: { content: [{ type: 'text', text: 'FROM-BLOCKS' }] } })
    await a.onSessionStop({})
    expect(w.prompts[0]).toContain('FROM-BLOCKS')
    expect(w.prompts).toHaveLength(2)
  })
})

describe('yielding to molt', () => {
  test('a stage file at command passes without a fork, with a molt ledger line', async () => {
    const { w, a } = world({ files: { ...autopilot(), [stagePath(HOME, 'S1')]: JSON.stringify({ stage: 'command', command: 65 }) }, replies: [STALLED] })
    expect(await a.onSessionStop({ last_assistant_message: 'working' })).toBeUndefined()
    expect(w.prompts).toEqual([])
    expect(ledger(w)[0]).toContain(' · molt · ')
  })

  test('the fallback stage and the block stage yield too', async () => {
    for (const stage of ['block', 'fallback']) {
      const { w, a } = world({ files: { ...autopilot(), [stagePath(HOME, 'S1')]: JSON.stringify({ stage }) }, replies: [STALLED] })
      expect(await a.onSessionStop({ last_assistant_message: 'working' })).toBeUndefined()
      expect(w.prompts).toEqual([])
    }
  })

  test('a below stage does not yield, but a live fill past the file\'s command does', async () => {
    const files = { ...autopilot(), [stagePath(HOME, 'S1')]: JSON.stringify({ stage: 'below', command: 50 }) }
    const low = world({ files, replies: [STALLED] })
    low.w.percent = 49
    expect((await low.a.onSessionStop({ last_assistant_message: 'x' }))?.decision).toBe('block')
    const high = world({ files, replies: [STALLED] })
    high.w.percent = 50
    expect(await high.a.onSessionStop({ last_assistant_message: 'x' })).toBeUndefined()
    expect(high.w.prompts).toEqual([])
  })

  test('with no stage file, yieldAtPercent (65) is the fallback; a stage of off never yields on fill', async () => {
    const none = world({ files: autopilot(), replies: [STALLED] })
    none.w.percent = 66
    expect(await none.a.onSessionStop({ last_assistant_message: 'x' })).toBeUndefined()
    const off = world({ files: { ...autopilot(), [stagePath(HOME, 'S1')]: JSON.stringify({ stage: 'off' }) }, replies: [STALLED] })
    off.w.percent = 99
    expect((await off.a.onSessionStop({ last_assistant_message: 'x' }))?.decision).toBe('block')
  })

  test('the handoff marker in the reply and a child\'s handoff status line yield', async () => {
    const marker = world({ files: autopilot(), replies: [STALLED] })
    expect(await marker.a.onSessionStop({ last_assistant_message: 'done\nMOLT-HANDOFF: /tmp/h.md' })).toBeUndefined()
    expect(marker.w.prompts).toEqual([])
    const status = world({ files: { ...autopilot(), '/st.log': '2026-10-13T00:00:00Z handoff required\n' }, env: { MOLT_STATUS_PATH: '/st.log' }, replies: [STALLED] })
    expect(await status.a.onSessionStop({ last_assistant_message: 'x' })).toBeUndefined()
    expect(status.w.prompts).toEqual([])
  })
})

describe('the loop guard', () => {
  test('a context rebuild restarts the no-change loop count before a covered turn end', async () => {
    const { w, a } = world({ files: autopilot(), replies: [COVERED, COVERED, COVERED, COVERED] })
    for (let i = 0; i < 2; i++) expect((await a.onSessionStop({ last_assistant_message: 'x' }))?.decision).toBe('block')
    a.onContextRebuild()
    expect((await a.onSessionStop({ last_assistant_message: 'x' }))?.decision).toBe('block')
    expect(w.prompts).toHaveLength(3)
    expect(ledger(w).at(-1)).toContain('covered')
    expect(w.notes).toEqual([])
    expect((await a.onSessionStop({ last_assistant_message: 'x' }))?.decision).toBe('block')
    expect(w.notes).toEqual([])
    expect(await a.onCommand('status')).toContain('pushes in a row with no change: 2 of 3')
  })

  test('loopMax pushes with no change: the next turn end passes with an autopilot loop pain', async () => {
    const { w, a } = world({ files: autopilot(), replies: [STALLED, STALLED, STALLED, STALLED] })
    for (let i = 0; i < 3; i++) expect((await a.onSessionStop({ last_assistant_message: 'x' }))?.decision).toBe('block')
    expect(await a.onSessionStop({ last_assistant_message: 'x' })).toBeUndefined()
    expect(w.prompts).toHaveLength(3)
    expect(w.notes).toHaveLength(1)
    expect(w.notes[0]).toContain('autopilot: autopilot loop — 3 turn ends pushed on with no change made')
    expect(ledger(w).at(-1)).toContain('autopilot loop: 3 pushes with no change')
  })

  test('a change between turn ends resets the count; a read-only turn does not', async () => {
    const { w, a } = world({ files: autopilot(), replies: Array(8).fill(STALLED) })
    for (let i = 0; i < 2; i++) await a.onSessionStop({ last_assistant_message: 'x' })
    await a.onToolResult({ toolName: 'read', input: { path: 'a' }, isError: false })
    await a.onToolResult({ toolName: 'grep', input: {}, isError: false })
    await a.onSessionStop({ last_assistant_message: 'x' })
    expect(await a.onSessionStop({ last_assistant_message: 'x' })).toBeUndefined()
    expect(w.notes[0]).toContain('autopilot loop')
    await a.onToolResult({ toolName: 'edit', input: { path: 'a' }, isError: false })
    expect((await a.onSessionStop({ last_assistant_message: 'x' }))?.decision).toBe('block')
    expect(w.notes).toHaveLength(1)
  })
})

describe('changed tracking', () => {
  // A stop after one tool result: changed resets the loop count, so three stops in a row stay blocking.
  async function changes(tool: string, isError = false): Promise<boolean> {
    const { a } = world({ files: autopilot(), replies: Array(8).fill(STALLED) })
    for (let i = 0; i < 3; i++) await a.onSessionStop({ last_assistant_message: 'x' })
    await a.onToolResult({ toolName: tool, input: {}, isError })
    return (await a.onSessionStop({ last_assistant_message: 'x' }))?.decision === 'block'
  }

  test('the read-only set does not count as a change', async () => {
    for (const t of ['read', 'grep', 'glob', 'find', 'ast_grep', 'lsp', 'web_search', 'fetch', 'ls', 'ask', 'todo', 'wait', 'think', 'recall', 'reflect'])
      expect([t, await changes(t)]).toEqual([t, false])
  })

  test('every other tool, and an unknown one, counts as a change', async () => {
    for (const t of ['bash', 'write', 'edit', 'eval', 'task', 'github', 'notebook', 'memory_edit', 'some_new_tool', 'mcp__x__y'])
      expect([t, await changes(t)]).toEqual([t, true])
  })

  test('a failed call is not a change', async () => {
    expect(await changes('bash', true)).toBe(false)
  })

  // After three pushes with no change, one more stop blocks only if the call in between counted as a change.
  async function changesBy(...results: Array<{ toolName: string; input: unknown; isError?: boolean }>): Promise<boolean> {
    const { a } = world({ files: autopilot(), replies: Array(8).fill(STALLED) })
    for (let i = 0; i < 3; i++) await a.onSessionStop({ last_assistant_message: 'x' })
    for (const r of results) await a.onToolResult({ isError: false, ...r })
    return (await a.onSessionStop({ last_assistant_message: 'x' }))?.decision === 'block'
  }
  const AST = { toolName: 'ast_edit', input: { ops: [{ pat: 'a', out: 'b' }], paths: ['src/a.ts'] } }
  const RESOLVE = { toolName: 'write', input: { path: 'xd://resolve', content: 'the preview is right' } }
  const REJECT = { toolName: 'write', input: { path: 'xd://reject', content: 'wrong files' } }

  test('an ast_edit result is a preview: a change only once it is resolved', async () => {
    expect(await changesBy(AST)).toBe(false)
    expect(await changesBy(AST, REJECT)).toBe(false)
    expect(await changesBy(AST, RESOLVE)).toBe(true)
    expect(await changesBy(AST, { ...RESOLVE, isError: true })).toBe(false)
    expect(await changesBy(AST, { toolName: 'resolve', input: { action: 'apply', reason: 'ok' } })).toBe(true)
    expect(await changesBy(AST, { toolName: 'resolve', input: { action: 'discard', reason: 'no' } })).toBe(false)
    expect(await changesBy(AST, { toolName: 'reject', input: { reason: 'no' } })).toBe(false)
    expect(await changesBy({ toolName: 'write', input: { path: 'xd://propose', content: 'my-plan' } })).toBe(false)
  })

  test('lsp: a rename or rename_file applies by default and is a change; apply:false is a preview; code_actions apply only on apply:true', async () => {
    const lsp = (input: Record<string, unknown>) => ({ toolName: 'lsp', input })
    expect(await changesBy(lsp({ action: 'rename', file: 'a.ts', new_name: 'b' }))).toBe(true)
    expect(await changesBy(lsp({ action: 'rename_file', file: 'a.ts', new_name: 'b.ts' }))).toBe(true)
    expect(await changesBy(lsp({ action: 'rename', file: 'a.ts', new_name: 'b', apply: false }))).toBe(false)
    expect(await changesBy(lsp({ action: 'code_actions', file: 'a.ts', query: 'fix', apply: true }))).toBe(true)
    expect(await changesBy(lsp({ action: 'code_actions', file: 'a.ts' }))).toBe(false)
    for (const action of ['diagnostics', 'definition', 'references', 'hover', 'symbols', 'reload', 'status'])
      expect([action, await changesBy(lsp({ action, file: 'a.ts' }))]).toEqual([action, false])
  })
})

describe('a session_stop whose session a molt already replaced', () => {
  // omp runs session_stop handlers in extension order (seat-mods, molt, autonomic); molt's newSession() has already
  // made the live id the successor's when this handler runs. The event carries its own session_id.
  test('the event names another session than the live one: no ledger line, no fork, no state change, no block', async () => {
    const { w, a, files } = world({ files: autopilot('S2'), replies: [STALLED, STALLED] })
    w.id = 'S2'                       // the successor, as io.sessionId() reads it after molt's newSession()
    expect(await a.onSessionStop({ session_id: 'S1', last_assistant_message: 'working' } as any)).toBeUndefined()
    expect(w.prompts).toEqual([])
    expect(files.has(LEDGER)).toBe(false)
    expect(w.notes).toEqual([])
    // no loop-count change: the successor's count is still zero, so its first real stop is judged and blocked
    expect((await a.onSessionStop({ session_id: 'S2', last_assistant_message: 'working' } as any))?.decision).toBe('block')
    expect(w.prompts).toHaveLength(1)
  })

  test('a stale stop leaves the successor\'s change mark and its judge budget alone', async () => {
    const { w, a } = world({ files: autopilot('S2'), replies: Array(8).fill(STALLED) })
    w.id = 'S2'
    for (let i = 0; i < 3; i++) await a.onSessionStop({ session_id: 'S2', last_assistant_message: 'x' })
    await a.onToolResult({ toolName: 'write', input: { path: 'a' }, isError: false })
    expect(await a.onSessionStop({ session_id: 'S1', last_assistant_message: 'x' } as any)).toBeUndefined()
    expect(w.prompts).toHaveLength(3)
    // the successor's `changed` mark is still there: this stop resets its count to zero, not to three
    expect((await a.onSessionStop({ session_id: 'S2', last_assistant_message: 'x' }))?.decision).toBe('block')
    expect(w.notes).toEqual([])
  })

  test('the event\'s own session: handled as before', async () => {
    const { w, a } = world({ files: autopilot(), replies: [STALLED] })
    expect((await a.onSessionStop({ session_id: 'S1', last_assistant_message: 'x' }))?.decision).toBe('block')
    expect(w.prompts).toHaveLength(1)
  })
})

describe('the never-approve floor', () => {
  const bash = (command: string) => ({ toolName: 'bash', input: { command } })

  test('autopilot: a force push to main is blocked with never-approve, a ledger line and a pain signal', async () => {
    const { w, a } = world({ files: autopilot() })
    const r = await a.onToolCall(bash('git push --force origin main'))
    expect(r?.block).toBe(true)
    expect(r?.reason).toMatch(/^autonomic: never-approve — .*force-push.*; the operator decides$/)
    expect(ledger(w)[0]).toContain(' · permission · Q: Bash: ')
    expect(ledger(w)[0]).toContain('never-approve: ')
    expect(w.notes[0]).toContain('autopilot: never-approve')
    expect(w.prompts).toEqual([])
  })

  test('the pain text and the ledger carry the shape, never the value', async () => {
    const { w, a } = world({ files: autopilot() })
    await a.onToolCall(bash('git push --force https://user:hunter2@example.com/x.git main'))
    expect(w.notes.join('\n') + ledger(w).join('\n')).not.toContain('hunter2')
  })

  test('a safe command, a push of the session\'s own branch and a non-bash tool pass', async () => {
    const { w, a } = world({ files: autopilot() })
    expect(await a.onToolCall(bash('ls -la'))).toBeUndefined()
    expect(await a.onToolCall(bash('git push origin feat/x'))).toBeUndefined()
    expect(await a.onToolCall({ toolName: 'write', input: { path: '/x', content: 'git push --force' } })).toBeUndefined()
    expect(await a.onToolCall({ toolName: 'bash', input: {} })).toBeUndefined()
    expect(w.notes).toEqual([])
  })

  // omp's bash tool takes its own `cwd`; the floor judges the command where it will run (final review I2).
  describe('the bash call\'s own cwd', () => {
    const at = (command: string, cwd: string) => ({ toolName: 'bash', input: { command, cwd } })
    const MAIN = { top: '/other', branch: 'main', originHead: 'origin/main' }

    test('git push with a cwd on main is flagged; with no cwd (the session is on feat/x) and with a cwd on a feature branch it is not', async () => {
      const { w, a } = world({ files: autopilot() })
      w.gitBy['/other'] = MAIN
      w.gitBy['/feat'] = { top: '/feat', branch: 'feat/y', originHead: 'origin/main' }
      const r = await a.onToolCall(at('git push', '/other'))
      expect(r?.reason).toMatch(/^autonomic: never-approve — .*default-branch-push/)
      expect(ledger(w)[0]).toContain(' · permission · ')
      expect(await a.onToolCall(bash('git push'))).toBeUndefined()
      expect(await a.onToolCall(at('git push', '/feat'))).toBeUndefined()
    })

    test('rm -rf is judged against the folder it runs in, not the session\'s worktree', async () => {
      const { w, a } = world({ files: autopilot() })
      w.gitBy['/elsewhere'] = { top: '/elsewhere', branch: 'feat/z', originHead: 'origin/main' }
      expect((await a.onToolCall(at('rm -rf /repo/x', '/elsewhere')))?.reason).toContain('rm-outside')
      expect(await a.onToolCall(bash('rm -rf /repo/x'))).toBeUndefined()
      expect(await a.onToolCall(at('rm -rf /elsewhere/x', '/elsewhere'))).toBeUndefined()
    })

    test('a relative cwd is read against the session folder, ~ against HOME, and an empty one is no cwd', async () => {
      const { w, a } = world({ files: autopilot() })
      w.gitBy['/repo/sub'] = MAIN
      w.gitBy[`${HOME}/co`] = MAIN
      expect((await a.onToolCall(at('git push', 'sub')))?.block).toBe(true)
      expect((await a.onToolCall(at('git push', '/repo/sub')))?.block).toBe(true)
      expect((await a.onToolCall(at('git push', '~/co')))?.block).toBe(true)
      expect((await a.onToolCall(at('git push', `file://${HOME}/co`)))?.block).toBe(true)
      expect(await a.onToolCall(at('git push', ''))).toBeUndefined()
    })

    test('a cwd the floor cannot place (an omp URL) keeps a dangerous command blocked and lets a safe one through', async () => {
      const { a } = world({ files: autopilot() })
      expect((await a.onToolCall(at('git push', 'sftp://host/x')))?.reason).toBe('autonomic: the never-approve check failed; this call stays with the operator')
      expect(await a.onToolCall(at('ls', 'sftp://host/x'))).toBeUndefined()
    })
  })

  // omp's own push tool (final review I3): github pr_push with forceWithLease is a force push.
  describe('github pr_push', () => {
    const push = (input: Record<string, unknown>) => ({ toolName: 'github', input: { op: 'pr_push', ...input } })

    test('forceWithLease is blocked as a force push, with a permission ledger line and a pain signal', async () => {
      const { w, a } = world({ files: autopilot() })
      const r = await a.onToolCall(push({ branch: 'feat/x', forceWithLease: true }))
      expect(r?.reason).toMatch(/^autonomic: never-approve — .*force-push.*; the operator decides$/)
      expect(ledger(w)[0]).toContain(' · permission · Q: github pr_push: ')
      expect(w.notes[0]).toContain('autopilot: never-approve')
      expect((await a.onToolCall(push({ forceWithLease: 'true' })))?.block).toBe(true)
    })

    test('the push target the call names counts: a forced push of main is also a default-branch push', async () => {
      const { a } = world({ files: autopilot() })
      expect((await a.onToolCall(push({ branch: 'main', forceWithLease: true })))?.reason).toContain('default-branch-push')
    })

    test('a plain pr_push, forceWithLease false, other github ops and manual mode pass (controls)', async () => {
      const { a } = world({ files: autopilot() })
      expect(await a.onToolCall(push({ branch: 'feat/x' }))).toBeUndefined()
      expect(await a.onToolCall(push({ branch: 'feat/x', forceWithLease: false }))).toBeUndefined()
      expect(await a.onToolCall({ toolName: 'github', input: { op: 'pr_view', forceWithLease: true } })).toBeUndefined()
      expect(await world().a.onToolCall(push({ forceWithLease: true }))).toBeUndefined()
    })

    test('a branch name is never read as shell: a hostile one still gets the force-push block and nothing else runs', async () => {
      const { w, a } = world({ files: autopilot() })
      expect((await a.onToolCall(push({ branch: 'x; rm -rf /', forceWithLease: true })))?.reason).toContain('force-push')
      expect(w.runs.every(r => r[0] === 'git')).toBe(true)
    })
  })

  test('a rule the operator switched off in autonomic.json passes', async () => {
    const { a } = world({ files: { ...autopilot(), [`${HOME}/.omp/agent/autonomic.json`]: JSON.stringify({ neverApprove: 'branch-delete' }) } })
    expect(await a.onToolCall(bash('git push --force origin main'))).toBeUndefined()
    expect((await a.onToolCall(bash('git push origin --delete old-branch')))?.block).toBe(true)
  })

  test('a session that left autopilot through a failure keeps the floor', async () => {
    const { w, a } = world({ files: autopilot(), failTouch: true })
    // The ledger cannot be touched, so autopilot refuses at the first read of the mode: manual with a problem.
    const r = await a.onToolCall(bash('git push --force origin main'))
    expect(r?.block).toBe(true)
    expect(w.statuses.at(-1)).toContain('ledger not writable')
  })

  test('/autopilot off clears the floor', async () => {
    const { a } = world({ files: autopilot() })
    expect((await a.onToolCall(bash('git push --force origin main')))?.block).toBe(true)
    expect(await a.onCommand('off')).toContain('autopilot is off')
    expect(await a.onToolCall(bash('git push --force origin main'))).toBeUndefined()
  })
})

describe('before_agent_start', () => {
  test('autopilot appends the policy to the system prompt; manual returns nothing', async () => {
    const on = world({ files: autopilot() })
    // omp 18.8.9 hands the event the prompt as a list of blocks (a string would be wrapped into one block): the policy
    // is one more block, and omp's own blocks stay byte for byte as they were.
    expect(await on.a.onBeforeAgentStart({ systemPrompt: ['BASE A', 'BASE B'] })).toEqual({ systemPrompt: ['BASE A', 'BASE B', 'TEST POLICY'] })
    expect(await world().a.onBeforeAgentStart({ systemPrompt: ['BASE A', 'BASE B'] })).toBeUndefined()
  })

  test('a string prompt is read as one block', async () => {
    const on = world({ files: autopilot() })
    expect(await on.a.onBeforeAgentStart({ systemPrompt: 'BASE' })).toEqual({ systemPrompt: ['BASE', 'TEST POLICY'] })
  })

  test('the blocks are never joined into a string (the comma bug)', async () => {
    const r = await world({ files: autopilot() }).a.onBeforeAgentStart({ systemPrompt: ['You are omp.', '# Tools'] })
    expect(Array.isArray(r?.systemPrompt)).toBe(true)
    expect(r?.systemPrompt).toHaveLength(3)
  })

  test('a prompt that already holds the policy is not stacked', async () => {
    const { a } = world({ files: autopilot() })
    expect(await a.onBeforeAgentStart({ systemPrompt: ['BASE', 'TEST POLICY'] })).toBeUndefined()
    // in any block, even one that carries other text
    expect(await a.onBeforeAgentStart({ systemPrompt: ['BASE', 'x\n\nTEST POLICY'] })).toBeUndefined()
    expect(await a.onBeforeAgentStart({ systemPrompt: 'BASE\n\nTEST POLICY' })).toBeUndefined()
    // a control: a block that merely resembles it does not stand in for it
    expect(await a.onBeforeAgentStart({ systemPrompt: ['BASE', 'TEST POLIC'] })).toEqual({ systemPrompt: ['BASE', 'TEST POLIC', 'TEST POLICY'] })
  })

  test('without a system prompt on the event it falls back to ctx.getSystemPrompt, and without that adds nothing', async () => {
    const { w, a } = world({ files: autopilot() })
    w.system = ['FROM-CTX A', 'FROM-CTX B']
    expect(await a.onBeforeAgentStart({})).toEqual({ systemPrompt: ['FROM-CTX A', 'FROM-CTX B', 'TEST POLICY'] })
    w.system = 'FROM-CTX'
    expect(await a.onBeforeAgentStart({})).toEqual({ systemPrompt: ['FROM-CTX', 'TEST POLICY'] })
    const none = world({ files: autopilot() })
    expect(await none.a.onBeforeAgentStart({})).toBeUndefined()
  })

  test('a molt successor in autopilot announces its carried scope once', async () => {
    const files = { [REC('P1')]: JSON.stringify({ mode: 'autopilot', scope: ['/spec.md'], source: 'command' }), [`${HOME}/.claude/state/molt/lineage/S1.json`]: JSON.stringify({ from: 'P1' }) }
    const { a, files: fs } = world({ files })
    const first = await a.onBeforeAgentStart({ systemPrompt: ['BASE'] })
    // the scope notice is a block of its own, after the policy
    expect(first?.systemPrompt).toHaveLength(3)
    expect(first?.systemPrompt[0]).toBe('BASE')
    expect(first?.systemPrompt[1]).toBe('TEST POLICY')
    expect(first?.systemPrompt[2]).toContain('autonomic: autopilot is on. Read these documents now')
    expect(first?.systemPrompt[2]).toContain('- /spec.md')
    expect(JSON.parse(fs.get(REC('S1'))!).source).toBe('lineage')
    a.onAgentStart()
    expect((await a.onBeforeAgentStart({ systemPrompt: ['BASE'] }))?.systemPrompt).toEqual(['BASE', 'TEST POLICY'])
  })

  test('a context rebuild re-announces a committed scope at the next agent start', async () => {
    const { a } = world({ files: { [REC()]: JSON.stringify({ mode: 'autopilot', scope: ['/spec.md'], source: 'command' }) } })
    const prepare = () => a.onBeforeAgentStart({ systemPrompt: ['BASE'] })
    expect((await prepare())?.systemPrompt[2]).toContain('- /spec.md')
    a.onAgentStart()
    expect((await prepare())?.systemPrompt).toEqual(['BASE', 'TEST POLICY'])
    a.onContextRebuild()
    expect((await prepare())?.systemPrompt[2]).toContain('- /spec.md')
    a.onAgentStart()
    expect((await prepare())?.systemPrompt).toEqual(['BASE', 'TEST POLICY'])
  })

  test('autopilot with no policy on disk refuses: manual, no policy added', async () => {
    const { w, a } = world({ files: autopilot(), noPolicy: true })
    expect(await a.onBeforeAgentStart({ systemPrompt: 'BASE' })).toBeUndefined()
    expect(w.notes.join('\n')).toContain('autopilot refused')
  })
})

describe('mode, record and command', () => {
  test('AUTONOMIC_MODE=autopilot starts the session in autopilot and publishes the live mode', async () => {
    const { w, a, files } = world({ env: { AUTONOMIC_MODE: 'autopilot' }, replies: [STALLED] })
    expect((await a.onSessionStop({ last_assistant_message: 'x' }))?.decision).toBe('block')
    expect(w.envSets.at(-1)).toEqual(['AUTONOMIC_EFFECTIVE_MODE', 'autopilot'])
    expect(JSON.parse(files.get(REC())!)).toMatchObject({ mode: 'autopilot', source: 'env' })
    expect(w.statuses.at(-1)).toBe('autopilot')
  })

  test('an unknown AUTONOMIC_MODE is manual and says so', async () => {
    const { w, a } = world({ env: { AUTONOMIC_MODE: 'turbo' } })
    expect(await a.onCommand('status')).toContain('AUTONOMIC_MODE="turbo" is not a mode')
    expect(w.envSets.at(-1)).toEqual(['AUTONOMIC_EFFECTIVE_MODE', 'manual'])
  })

  test('session_start writes the default policy once and never overwrites it', async () => {
    const fresh = world({ noPolicy: true })
    await fresh.a.onSessionStart()
    expect(fresh.files.get(POLICY)).toBe(DEFAULT_POLICY)
    const edited = world({ files: { [POLICY]: 'MINE\n' } })
    await edited.a.onSessionStart()
    expect(edited.files.get(POLICY)).toBe('MINE\n')
    expect(edited.w.envSets.at(-1)).toEqual(['AUTONOMIC_EFFECTIVE_MODE', 'manual'])
  })

  test('/autopilot on, status, off, usage', async () => {
    const { w, a, files } = world()
    expect(await a.onCommand('')).toBe('usage: /autopilot on [scope doc …] | off | status')
    expect(await a.onCommand('on')).toBe('autopilot is on. The scope is what this session has already read.')
    expect(JSON.parse(files.get(REC())!)).toMatchObject({ mode: 'autopilot', source: 'command' })
    expect(w.envSets.at(-1)).toEqual(['AUTONOMIC_EFFECTIVE_MODE', 'autopilot'])
    expect(await a.onCommand('status')).toContain('autopilot (source: command)')
    expect(await a.onCommand('off')).toBe('autopilot is off for this session: every ask reaches you.')
    expect(JSON.parse(files.get(REC())!).mode).toBe('manual')
  })

  test('/autopilot on with a scope document resolves it and carries it to the next prompt; a missing one refuses', async () => {
    const { a, files } = world({ files: { '/repo/spec.md': 'spec' } })
    expect(await a.onCommand('on spec.md')).toBe('autopilot is on. The next prompt you send carries the scope.')
    expect(JSON.parse(files.get(REC())!).scope).toEqual(['/repo/spec.md'])
    expect((await a.onBeforeAgentStart({ systemPrompt: ['B'] }))?.systemPrompt.join('\n')).toContain('- /repo/spec.md')
    expect(await world().a.onCommand('on nope.md')).toBe('autopilot stays manual: cannot read /repo/nope.md.')
  })

  test('/autopilot on refuses without a policy or a writable ledger', async () => {
    expect(await world({ noPolicy: true }).a.onCommand('on')).toContain('autopilot refused: no policy. Write /home/u/.claude/autonomic/policy.md.')
    expect(await world({ failTouch: true }).a.onCommand('on')).toContain('autopilot refused: ledger not writable.')
  })

  test('a record that cannot be written ends autopilot and says so; the floor stays', async () => {
    const { w, a } = world({ env: { AUTONOMIC_MODE: 'autopilot' }, failWrite: /sessions/ })
    expect(await a.onSessionStop({ last_assistant_message: 'x' })).toBeUndefined()
    expect(w.notes.join('\n')).toContain('the session record could not be saved')
    expect(w.envSets.at(-1)).toEqual(['AUTONOMIC_EFFECTIVE_MODE', 'manual'])
    expect(w.prompts).toEqual([])
    expect((await a.onToolCall({ toolName: 'bash', input: { command: 'git push --force origin main' } }))?.block).toBe(true)
  })

  test('status reports the policy, never-approve list, molt stage and loop count', async () => {
    const { a } = world({ files: { ...autopilot(), [stagePath(HOME, 'S1')]: JSON.stringify({ stage: 'warn' }) } })
    const s = await a.onCommand('status')
    expect(s).toContain('policy: edited (/home/u/.claude/autonomic/policy.md)')
    expect(s).toContain('never-approve: force-push default-branch-push branch-delete rm-outside no-verify unreadable')
    expect(s).toContain('molt stage: warn')
    expect(s).toContain(`ledger: ${LEDGER}`)
    expect(s).toContain('pushes in a row with no change: 0 of 3')
  })

  test('an invalid autonomic.json means the defaults plus a stated problem', async () => {
    const { w, a } = world({ files: { [`${HOME}/.omp/agent/autonomic.json`]: '{nope' } })
    await a.onSessionStart()
    expect(w.notes.join('\n')).toContain('.omp/agent/autonomic.json is not valid JSON')
    expect(await a.onCommand('status')).toContain('settings: ')
  })
})

// The default export against fakes of omp's pi and ctx, with a real HOME under a temp dir.
describe('the omp wiring', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'autonomic-omp-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  function boot(opts: { env?: Record<string, string | undefined>; reply?: string | Error; mode?: 'autopilot'; staleMode?: boolean } = {}) {
    const home = mkdtempSync(join(tmp, 'h-'))
    const ledgerFile = join(home, 'ledger.md')
    const saved: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries({ HOME: home, AUTONOMIC_MODE: opts.mode, AUTONOMIC_LEDGER: ledgerFile, AUTONOMIC_BELL: undefined, AUTONOMIC_PAIN_PATH: undefined, AUTONOMIC_EFFECTIVE_MODE: undefined, AUTONOMIC_MODE_FILE: undefined, MOLT_STATUS_PATH: undefined, ...opts.env })) {
      saved[k] = process.env[k]
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    mkdirSync(join(home, '.claude/autonomic'), { recursive: true })
    writeFileSync(join(home, '.claude/autonomic/policy.md'), 'WIRING POLICY\n')
    const handlers = new Map<string, (e: any, c: any) => any>()
    const commands = new Map<string, { handler: (args: string, c: any) => any }>()
    const execs: Array<{ cmd: string; args: string[]; options: any }> = []
    const pi = {
      on: (name: string, fn: any) => handlers.set(name, fn),
      registerCommand: (name: string, def: any) => commands.set(name, def),
      exec: async (cmd: string, args: string[], options: any) => { execs.push({ cmd, args, options }); return { code: 0 } },
    }
    const state = { id: 'W1', notices: [] as Array<[string, string]>, statuses: [] as string[], ephemerals: [] as any[], percent: undefined as number | undefined }
    const ctxFor = (kind = 'main') => ({
      agent: { kind, id: 'x', name: kind },
      cwd: home,
      getContextUsage: () => ({ tokens: 1, contextWindow: 100, percent: state.percent ?? null }),
      getSystemPrompt: () => 'CTX-BASE',
      sessionManager: { getSessionId: () => state.id },
      ui: { notify: (t: string, tone: string) => state.notices.push([t, tone]), setStatus: (_k: string, t: string) => state.statuses.push(t) },
      runEphemeralTurn: async (o: any) => {
        state.ephemerals.push(o)
        if (opts.reply instanceof Error) throw opts.reply
        return { replyText: opts.reply ?? STALLED }
      },
    })
    const modeFile = join(home, '.claude/state/autonomic/mode', String(process.pid))
    if (opts.staleMode) { mkdirSync(join(modeFile, '..'), { recursive: true }); writeFileSync(modeFile, 'autopilot') }
    ompExtension(pi)
    const restore = () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } }
    return { home, ledgerFile, handlers, commands, execs, state, ctxFor, restore, pi }
  }

  test('factory publishes the path and removes a stale file before a session event; shutdown is wired', async () => {
    const b = boot({ staleMode: true, mode: 'autopilot' })
    try {
      const path = join(b.home, '.claude/state/autonomic/mode', String(process.pid))
      expect(process.env.AUTONOMIC_MODE_FILE).toBe(path)
      expect(existsSync(path)).toBe(false)
      await b.handlers.get('session_start')!({}, b.ctxFor())
      expect(readFileSync(path, 'utf8')).toBe('autopilot')
      await b.handlers.get('session_shutdown')?.({}, b.ctxFor())
      expect(existsSync(path)).toBe(false)
    } finally { b.restore() }
  })

  test('a task child factory rebind preserves the main session live mode file', async () => {
    const b = boot()
    try {
      const path = join(b.home, '.claude/state/autonomic/mode', String(process.pid))
      await b.handlers.get('session_start')!({}, b.ctxFor())
      await b.commands.get('autopilot')!.handler('on', b.ctxFor())
      expect(readFileSync(path, 'utf8')).toBe('autopilot')
      ompExtension(b.pi)
      expect(readFileSync(path, 'utf8')).toBe('autopilot')
      await b.handlers.get('session_start')!({}, b.ctxFor('sub'))
      expect(readFileSync(path, 'utf8')).toBe('autopilot')
    } finally { b.restore() }
  })

  test('session_switch from autopilot to a known manual session publishes manual', async () => {
    const b = boot()
    try {
      const path = join(b.home, '.claude/state/autonomic/mode', String(process.pid))
      await b.handlers.get('session_start')!({}, b.ctxFor())
      expect(readFileSync(path, 'utf8')).toBe('manual')
      b.state.id = 'W2'
      await b.handlers.get('session_switch')!({}, b.ctxFor())
      await b.commands.get('autopilot')!.handler('on', b.ctxFor())
      expect(readFileSync(path, 'utf8')).toBe('autopilot')
      b.state.id = 'W1'
      await b.handlers.get('session_switch')!({}, b.ctxFor())
      expect(readFileSync(path, 'utf8')).toBe('manual')
    } finally { b.restore() }
  })

  test('input wiring resets only the current main session on operator input', async () => {
    const b = boot({ mode: 'autopilot' })
    try {
      const stop = () => b.handlers.get('session_stop')!({ last_assistant_message: 'x' }, b.ctxFor())
      for (let i = 0; i < 3; i++) await stop()
      await b.handlers.get('input')?.({ source: 'extension' }, b.ctxFor())
      await b.handlers.get('input')?.({ source: 'user' }, b.ctxFor('task'))
      expect(await stop()).toBeUndefined()
      for (let i = 0; i < 3; i++) await stop()
      await b.handlers.get('input')?.({ source: 'user' }, b.ctxFor())
      expect((await stop())?.decision).toBe('block')
    } finally { b.restore() }
  })

  for (const event of ['session_tree', 'session_compact', 'rewind']) {
    test(`round 3 ${event} clears branch A digest and changed flag, preserves mode and scope`, async () => {
      const b = boot({ mode: 'autopilot' })
      try {
        const c = b.ctxFor()
        const scope = join(b.home, 'scope.md')
        writeFileSync(scope, 'scope')
        await b.commands.get('autopilot')!.handler(`on ${scope}`, c)
        const stop = () => b.handlers.get('session_stop')!({ last_assistant_message: 'x' }, c)
        for (let i = 0; i < 3; i++) await stop()
        await b.handlers.get('tool_result')!({ toolName: 'write', input: { path: '/branch-a.txt' }, content: [{ type: 'text', text: 'SECRET-A' }], isError: false }, c)
        if (event === 'rewind') await b.handlers.get('tool_result')!({ toolName: 'rewind', input: { report: 'kept findings' }, content: [{ type: 'text', text: 'Rewind requested.' }], details: { report: 'kept findings', rewound: true }, isError: false }, c)
        else await b.handlers.get(event)?.({}, c)
        for (let i = 0; i < 3; i++) expect((await stop())?.decision).toBe('block')
        expect(await stop()).toBeUndefined() // no branch A change may reset the new loop
        const rec = JSON.parse(readFileSync(sessionPath(b.home, 'W1'), 'utf8'))
        expect(rec.mode).toBe('autopilot')
        expect(rec.scope).toEqual([scope])
        await b.handlers.get('tool_result')!({ toolName: 'read', input: { path: '/branch-b.txt' }, content: [{ type: 'text', text: 'FACT-B' }], isError: false }, c)
        await b.handlers.get('tool_call')!(ask(Q), c)
        const prompt = b.state.ephemerals.at(-1).promptText
        expect(prompt).toContain('FACT-B')
        expect(prompt).not.toContain('SECRET-A')
        expect(prompt).not.toContain('/branch-a.txt')
      } finally { b.restore() }
    })
  }

  test('checkpoint, failed rewind, child rewind and another session rewind preserve digest and changed', async () => {
    const b = boot({ mode: 'autopilot' })
    try {
      const c = b.ctxFor()
      const stop = () => b.handlers.get('session_stop')!({ last_assistant_message: 'x' }, c)
      for (let i = 0; i < 3; i++) await stop()
      await b.handlers.get('tool_result')!({ toolName: 'write', input: { path: '/kept.txt' }, content: [{ type: 'text', text: 'KEPT-FACT' }], isError: false }, c)
      const tool = (name: string, isError = false, ctx = c) => b.handlers.get('tool_result')!({ toolName: name, input: { report: 'findings' }, content: [{ type: 'text', text: 'checkpoint result' }], isError }, ctx)
      await tool('checkpoint')
      await tool('rewind', true)
      await tool('rewind', false, b.ctxFor('task'))
      b.state.id = 'W2'
      await tool('rewind')
      b.state.id = 'W1'
      await b.handlers.get('tool_call')!(ask(Q), c)
      expect(b.state.ephemerals.at(-1).promptText).toContain('KEPT-FACT')
      expect((await stop())?.decision).toBe('block') // retained change resets the exhausted loop
    } finally { b.restore() }
  })

  test('successful rewind keeps subsequent retained changes for the stop loop guard', async () => {
    const b = boot({ mode: 'autopilot' })
    try {
      const c = b.ctxFor()
      const stop = () => b.handlers.get('session_stop')!({ last_assistant_message: 'x' }, c)
      for (let i = 0; i < 3; i++) await stop()
      await b.handlers.get('tool_result')!({ toolName: 'rewind', input: { report: 'findings' }, content: [{ type: 'text', text: 'Rewind requested.' }], isError: false }, c)
      await b.handlers.get('tool_result')!({ toolName: 'write', input: { path: '/kept.txt' }, content: [{ type: 'text', text: 'KEPT-CHANGE' }], isError: false }, c)
      expect((await stop())?.decision).toBe('block')
    } finally { b.restore() }
  })

  test('round 3 discarded prompt repeats scope until main agent_start accepts it', async () => {
    const b = boot({ mode: 'autopilot' })
    try {
      const c = b.ctxFor()
      const scope = join(b.home, 'scope.md')
      writeFileSync(scope, 'scope')
      await b.commands.get('autopilot')!.handler(`on ${scope}`, c)
      const prepare = () => b.handlers.get('before_agent_start')!({ systemPrompt: ['BASE'] }, c)
      expect((await prepare()).systemPrompt.join('\n')).toContain(`- ${scope}`)
      await b.handlers.get('agent_start')?.({}, b.ctxFor('task'))
      expect((await prepare()).systemPrompt.join('\n')).toContain(`- ${scope}`)
      await b.handlers.get('agent_start')?.({}, c)
      expect((await prepare()).systemPrompt).toEqual(['BASE', 'WIRING POLICY'])
    } finally { b.restore() }
  })

  test('round 3 agent_start without a prepared scope does not consume it', async () => {
    const { a } = world({ files: { [REC()]: JSON.stringify({ mode: 'autopilot', scope: ['/spec.md'], source: 'command' }) } })
    a.onAgentStart()
    expect((await a.onBeforeAgentStart({ systemPrompt: ['BASE'] }))?.systemPrompt.join('\n')).toContain('- /spec.md')
  })

  test('the default export is a function and imports under plain bun', () => {
    expect(typeof ompExtension).toBe('function')
    const path = join(import.meta.dir, '../../autonomic/omp/extension.ts')
    const r = Bun.spawnSync(['bun', '-e', `const m = await import(${JSON.stringify(path)}); process.exit(typeof m.default === 'function' ? 0 : 3)`], { stdout: 'pipe', stderr: 'pipe' })
    expect(r.stderr.toString()).toBe('')
    expect(r.exitCode).toBe(0)
  })

  test('the extension imports only autonomic\'s hooks, node: builtins and relative modules (Ruling 10)', () => {
    const src = readFileSync(join(import.meta.dir, '../../autonomic/omp/extension.ts'), 'utf8')
    const specs = [...src.matchAll(/^import(?: type)?[^'"]*from\s+['"]([^'"]+)['"]/gm)].map(m => m[1]!)
    expect(specs.length).toBeGreaterThan(10)
    for (const s of specs) expect(s.startsWith('node:') || /^\.\.\/hooks\/(?!register|io)[a-z]+$/.test(s)).toBe(true)
    expect(src).not.toMatch(/@oh-my-pi|@sinclair|claude-code/)
  })

  test('registers /autopilot and the event handlers', () => {
    const b = boot()
    try {
      expect([...b.commands.keys()]).toEqual(['autopilot'])
      expect([...b.handlers.keys()].sort()).toEqual(['agent_start', 'before_agent_start', 'input', 'session_compact', 'session_shutdown', 'session_start', 'session_stop', 'session_switch', 'session_tree', 'tool_call', 'tool_result'])
    } finally { b.restore() }
  })

  test('a child agent (task, advisor, /tan clone): no handler does anything', async () => {
    const b = boot({ mode: 'autopilot' })
    try {
      const sub = b.ctxFor('sub')
      expect(await b.handlers.get('tool_call')!({ toolName: 'bash', input: { command: 'git push --force origin main' } }, sub)).toBeUndefined()
      expect(await b.handlers.get('tool_call')!(ask(Q), sub)).toBeUndefined()
      expect(await b.handlers.get('session_stop')!({ last_assistant_message: 'x' }, sub)).toBeUndefined()
      expect(await b.handlers.get('before_agent_start')!({ systemPrompt: 'B' }, sub)).toBeUndefined()
      await b.handlers.get('tool_result')!({ toolName: 'bash', input: {}, isError: false }, sub)
      await b.handlers.get('session_start')!({}, sub)
      await b.commands.get('autopilot')!.handler('status', sub)
      expect(b.state.ephemerals).toEqual([])
      expect(b.state.notices).toEqual([])
      expect(existsSync(b.ledgerFile)).toBe(false)
      expect(existsSync(sessionPath(b.home, 'W1'))).toBe(false)
    } finally { b.restore() }
  })

  test('the main session in autopilot: the floor blocks, session_stop blocks, the ephemeral turn is tools:false with a timeout signal', async () => {
    const b = boot({ mode: 'autopilot' })
    try {
      await b.handlers.get('session_start')!({}, b.ctxFor())
      expect(process.env.AUTONOMIC_EFFECTIVE_MODE).toBe('autopilot')
      const blocked = await b.handlers.get('tool_call')!({ toolName: 'bash', input: { command: 'git push --force origin main' } }, b.ctxFor())
      expect(blocked?.block).toBe(true)
      expect(b.state.notices.at(-1)?.[1]).toBe('warning')
      expect(readFileSync(b.ledgerFile, 'utf8')).toContain(' · permission · ')
      const stop = await b.handlers.get('session_stop')!({ last_assistant_message: 'Step 2 done.' }, b.ctxFor())
      expect(stop).toEqual({ decision: 'block', reason: 'Autopilot: continue — run the tests.' })
      expect(b.state.ephemerals[0]).toMatchObject({ tools: false })
      expect(b.state.ephemerals[0].promptText).toContain('autonomic turn-end check')
      expect(b.state.ephemerals[0].signal).toBeInstanceOf(AbortSignal)
      expect(await b.handlers.get('before_agent_start')!({ systemPrompt: 'BASE' }, b.ctxFor())).toEqual({ systemPrompt: ['BASE', 'WIRING POLICY'] })
    } finally { b.restore() }
  })

  test('the ask reflex through the wiring, and a stage file written by molt\'s glue yields the stop', async () => {
    const b = boot({ mode: 'autopilot', reply: answered({ 'Which plan?': 'Plan A' }) })
    try {
      const r = await b.handlers.get('tool_call')!(ask(Q), b.ctxFor())
      expect(r?.reason).toContain('autonomic answered: {"Which plan?":"Plan A"}')
      mkdirSync(join(b.home, '.claude/state/molt/stage'), { recursive: true })
      writeFileSync(stagePath(b.home, 'W1'), JSON.stringify({ stage: 'command', command: 65 }))
      const before = b.state.ephemerals.length
      expect(await b.handlers.get('session_stop')!({ last_assistant_message: 'x' }, b.ctxFor())).toBeUndefined()
      expect(b.state.ephemerals.length).toBe(before)
    } finally { b.restore() }
  })

  test('a pain with a bell runs sh -c through pi.exec with the message as $1 and a 30 s timeout', async () => {
    const b = boot({ mode: 'autopilot', reply: new Error('down'), env: { AUTONOMIC_BELL: 'echo ring' } })
    try {
      await b.handlers.get('tool_call')!(ask(Q), b.ctxFor())
      expect(b.execs).toHaveLength(1)
      expect(b.execs[0]!.cmd).toBe('sh')
      expect(b.execs[0]!.args[0]).toBe('-c')
      expect(b.execs[0]!.args[1]).toContain('echo ring')
      expect(b.execs[0]!.args.at(-1)).toContain('autopilot: question for you')
      expect(b.execs[0]!.options).toEqual({ timeout: 30_000 })
    } finally { b.restore() }
  })

  test('/autopilot reports through ctx.ui.notify; a context with no runEphemeralTurn passes the stop', async () => {
    const b = boot({ mode: 'autopilot' })
    try {
      await b.commands.get('autopilot')!.handler('status', b.ctxFor())
      expect(b.state.notices.at(-1)![0]).toContain('autopilot (source: env)')
      const bare = { ...b.ctxFor(), runEphemeralTurn: undefined }
      expect(await b.handlers.get('session_stop')!({ last_assistant_message: 'x' }, bare)).toBeUndefined()
    } finally { b.restore() }
  })
})

describe('round 2 autonomic parity', () => {
  test('operator input resets exhausted continuations; extension input does not', async () => {
    const { w, a } = world({ files: autopilot(), replies: Array(7).fill(STALLED) })
    for (let i = 0; i < 3; i++) await a.onSessionStop({ last_assistant_message: 'x' })
    await a.onInput({ source: 'extension' })
    expect(await a.onSessionStop({ last_assistant_message: 'x' })).toBeUndefined()
    expect(w.notes.at(-1)).toContain('autopilot loop')
    for (let i = 0; i < 3; i++) await a.onSessionStop({ last_assistant_message: 'x' })
    await a.onInput({ source: 'user' })
    expect((await a.onSessionStop({ last_assistant_message: 'new request' }))?.decision).toBe('block')
    expect(w.prompts).toHaveLength(7)
  })

  test('repeated off preserves the unwritable record warning and stale disk mode', async () => {
    const { w, a } = world({ files: autopilot(), failWrite: /sessions/ })
    await a.onSessionStart()
    for (let i = 0; i < 2; i++) {
      expect(await a.onCommand('off')).toContain('record could not be saved')
      expect(await a.onCommand('status')).toContain('record not writable')
    }
    expect(JSON.parse(w.files.get(REC())!).mode).toBe('autopilot')
    expect(w.notes.filter(n => n.includes('session record could not be saved'))).toHaveLength(3)
  })

  test('a bell that never resolves does not hold an ask pain open', async () => {
    const { w, a, io } = world({ files: { [REC()]: JSON.stringify({ mode: 'autopilot', scope: [], source: 'command', bell: 'ring' }) } })
    io.bell = () => HANG
    const outcome = await Promise.race([
      a.onToolCall(ask([{ question: 'Your text?' }])).then(() => 'returned'),
      new Promise(resolve => setTimeout(() => resolve('blocked'), 50)),
    ])
    expect(outcome).toBe('returned')
    expect([...w.files.values()].join('')).toContain('pain session=S1')
  })

  test('a rejected bell is logged without losing the pain record', async () => {
    const { w, a, io } = world({ files: { [REC()]: JSON.stringify({ mode: 'autopilot', scope: [], source: 'command', bell: 'ring' }) } })
    io.bell = async () => { throw new Error('bell broken') }
    await a.onToolCall(ask([{ question: 'Your text?' }]))
    expect([...w.files.values()].join('')).toContain('bell failed Error: bell broken')
    expect([...w.files.values()].join('')).toContain('pain session=S1')
  })
})
