import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ompExtension, { createAutonomic } from '../../autonomic/omp/extension'
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

// A fake AutonomicIO: an in-memory file system, a scripted isolated side turn, and a record of every side effect.
// `sideTurn` receives the exact `{ tools: false, isolated: true, … promptText }` options the adapter passes; its
// replyText is parsed by the shared parser. No `sideTurn` means the host exposes no turn and every judged call parks.
const HANG: Promise<never> = Promise.withResolvers<never>().promise
type SideTurn = (opts: { promptText?: string }) => { replyText?: string } | undefined | Promise<{ replyText?: string } | undefined>
function world(over: { env?: Record<string, string>; files?: Record<string, string>; noPolicy?: boolean; budgetMs?: number; sideTurn?: SideTurn; failAppend?: RegExp; failTouch?: boolean; failWrite?: RegExp; failRename?: boolean; failRemove?: boolean } = {}) {
  const files = new Map<string, string>([...(over.noPolicy ? [] : [[POLICY, 'TEST POLICY\n'] as [string, string]]), ...Object.entries(over.files ?? {})])
  const w = {
    id: 'S1',
    percent: undefined as number | undefined,
    system: undefined as string | string[] | undefined,
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
    // Task 6: the park store lists directory entries and writes files (0700/0600 on the real io).
    readDir: async p => {
      const prefix = `${p.replace(/\/+$/, '')}/`
      return [...files.keys()].filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map(k => k.slice(prefix.length))
    },
    writePark: async (p, t) => { if (over.failWrite?.test(p)) throw new Error('read-only'); files.set(p, t) },
    claimPark: async p => { if (files.has(p)) return false; files.set(p, ''); return true },
    captureHost: () => ({
      sessionId: w.id, cwd: '/repo', sessionFile: undefined, judge: undefined,
      generate: over.sideTurn === undefined ? undefined : async (opts: unknown) => {
        const o = opts as { promptText?: string }
        w.prompts.push(o.promptText ?? '')
        return await over.sideTurn!(o)
      },
      asyncJobs: () => null,
    }) as never,
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
      const { a, files, io } = world()
      await a.onCommand('on')
      expect(files.get(MODE_FILE)).toBe('autopilot')
      if (reason === 'no policy') files.delete(POLICY)
      if (reason === 'ledger not writable') io.appendLine = async () => false
      if (reason === 'record not writable') io.writeText = async () => { throw new Error('read-only') }
      if (reason === 'record not writable') await a.onCommand('on')
      // `ledger not writable` is a real ledger write: the unenrolled floor still records a
      // permission row, so it exercises the same fall the conversational classifier used to.
      else if (reason === 'ledger not writable') await a.onToolCall({ toolName: 'bash', input: { command: 'git push --force origin main' } })
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

  test('/autopilot off publishes manual even when the mode write and notice fail', async () => {
    const { a, files, env, io } = world()
    await a.onCommand('on')
    expect(env.AUTONOMIC_EFFECTIVE_MODE).toBe('autopilot')
    expect(files.get(MODE_FILE)).toBe('autopilot')
    io.writeMode = () => { throw new Error('write denied') }
    io.notify = () => { throw new Error('notify failed') }
    const result = await a.onCommand('off')
    expect(env.AUTONOMIC_EFFECTIVE_MODE).toBe('manual')
    expect(files.has(MODE_FILE)).toBe(false)
    expect(result).toContain('autopilot is off')
  })

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
    const { w, a, files } = world()
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
  test('autopilot with no decision service: the whole ask stays with the operator and is on the record', async () => {
    const { w, a, files } = world({ files: autopilot() })
    expect(await a.onToolCall(ask(Q))).toBeUndefined()
    expect(w.prompts).toEqual([])
    expect(w.notes[0]).toContain('question for you')
    expect(w.notes[0]).toContain('no decision service is enrolled')
    expect(ledger({ files })[0]).toContain(' · pain · Q: Which plan? · A: ask the operator')
  })

  test('a question with no options is free text: the operator owns it and it is on the record', async () => {
    const { w, a } = world({ files: autopilot() })
    expect(await a.onToolCall(ask([{ id: 'q', question: 'Which token?' }]))).toBeUndefined()
    expect(w.prompts).toEqual([])
    expect(w.notes[0]).toContain('Which token?')
    expect(w.notes[0]).toContain('no decision service is enrolled')
  })

  test('manual mode passes without a ledger line or a generation', async () => {
    const { w, a, files } = world()
    expect(await a.onToolCall(ask(Q))).toBeUndefined()
    expect(w.notes).toEqual([])
    expect(files.has(LEDGER)).toBe(false)
  })
})

describe('the turn-end reflex', () => {
  test('autopilot with no decision service: the stop passes, no continuation, no ledger row', async () => {
    const { w, a, files } = world({ files: autopilot() })
    expect(await a.onSessionStop({ last_assistant_message: 'Step complete.' })).toBeUndefined()
    expect(w.notes).toEqual([])
    // The ledger path is touched when the session turns autopilot, but no row is written.
    expect(ledger(w)).toEqual([])
  })

  test('the bounded reply is read from a message object too', async () => {
    const { w, a } = world({ files: autopilot() })
    expect(await a.onSessionStop({ last_assistant_message: { content: [{ type: 'text', text: 'FROM-BLOCKS' }] } })).toBeUndefined()
    expect(ledger(w)).toEqual([])
  })
})

describe('yielding to molt', () => {
  test('a stage file at command passes without a fork, with a molt ledger line', async () => {
    const { w, a } = world({ files: { ...autopilot(), [stagePath(HOME, 'S1')]: JSON.stringify({ stage: 'command', command: 65 }) } })
    expect(await a.onSessionStop({ last_assistant_message: 'working' })).toBeUndefined()
    expect(ledger(w)[0]).toContain(' · molt · ')
  })

  test('the fallback stage and the block stage yield too', async () => {
    for (const stage of ['block', 'fallback']) {
      const { w, a } = world({ files: { ...autopilot(), [stagePath(HOME, 'S1')]: JSON.stringify({ stage }) } })
      expect(await a.onSessionStop({ last_assistant_message: 'working' })).toBeUndefined()
      expect(ledger(w)[0]).toContain(' · molt · ')
    }
  })

  test('a below stage does not yield, but a live fill past the file\'s command does', async () => {
    const files = { ...autopilot(), [stagePath(HOME, 'S1')]: JSON.stringify({ stage: 'below', command: 50 }) }
    // Below the file's command the turn end is not molt's: without a decision service it is still
    // operator-owned, but molt writes no row.
    const low = world({ files })
    low.w.percent = 49
    expect(await low.a.onSessionStop({ last_assistant_message: 'x' })).toBeUndefined()
    expect(ledger(low.w)).toEqual([])
    const high = world({ files })
    high.w.percent = 50
    expect(await high.a.onSessionStop({ last_assistant_message: 'x' })).toBeUndefined()
    expect(ledger(high.w)[0]).toContain(' · molt · ')
  })

  test('with no stage file, yieldAtPercent (65) is the fallback; a stage of off never yields on fill', async () => {
    const none = world({ files: autopilot() })
    none.w.percent = 66
    expect(await none.a.onSessionStop({ last_assistant_message: 'x' })).toBeUndefined()
    expect(ledger(none.w)[0]).toContain(' · molt · ')
    // A stage of off never yields on fill: no molt row is written.
    const off = world({ files: { ...autopilot(), [stagePath(HOME, 'S1')]: JSON.stringify({ stage: 'off' }) } })
    off.w.percent = 99
    expect(await off.a.onSessionStop({ last_assistant_message: 'x' })).toBeUndefined()
    expect(ledger(off.w)).toEqual([])
  })

  test('the handoff marker in the reply and a child\'s handoff status line yield', async () => {
    const marker = world({ files: autopilot() })
    expect(await marker.a.onSessionStop({ last_assistant_message: 'done\nMOLT-HANDOFF: /tmp/h.md' })).toBeUndefined()
    expect(ledger(marker.w)[0]).toContain(' · molt · ')
    const status = world({ files: { ...autopilot(), '/st.log': '2026-10-13T00:00:00Z handoff required\n' }, env: { MOLT_STATUS_PATH: '/st.log' } })
    expect(await status.a.onSessionStop({ last_assistant_message: 'x' })).toBeUndefined()
    expect(ledger(status.w)[0]).toContain(' · molt · ')
  })
})

describe('the never-approve floor', () => {
  const bash = (command: string) => ({ toolName: 'bash', input: { command } })
  const PARKS = `${HOME}/.local/state/autonomic/parks`
  const allow = JSON.stringify({ decision: 'allow', red_line: null, reason: 'within the task' })
  const sideAllow: SideTurn = () => ({ replyText: allow })
  const parksIn = (w: { files: Map<string, string> }) => [...w.files.keys()].filter(p => p.startsWith(`${PARKS}/`)).sort()
  const parkOf = (w: { files: Map<string, string> }) => JSON.parse(w.files.get(parksIn(w)[0]!)!) as Record<string, unknown>
  const idOf = (reason: string | undefined): string => {
    const m = /\(park ([a-f0-9]{12});/.exec(reason ?? '')
    if (m === null) throw new Error(`no park id in ${String(reason)}`)
    return m[1]!
  }

  test('autopilot: a force push to main parks with the park text, one row and a pain signal', async () => {
    const { w, a } = world({ files: autopilot() })
    const r = await a.onToolCall(bash('git push --force origin main'))
    expect(r?.block).toBe(true)
    expect(r?.reason).toMatch(/^autonomic: parked for the operator \(park [a-f0-9]{12}; red line 2\): never-approve: force-push, default-branch-push\. Do not retry this call or an equivalent one\./)
    expect(ledger(w)[0]).toContain(' · permission · Q: Bash: ')
    expect(ledger(w)[0]).toContain(' · A: parked for the operator · why: never-approve: force-push, default-branch-push · src: floor')
    expect(w.notes[0]).toContain('autopilot: parked')
    expect(w.prompts).toEqual([])                       // a floor park never reaches the judge
    expect(parksIn(w)).toHaveLength(1)                  // and it lands in the park store
  })

  test('the park file is the call itself: the exact tool, command and cwd, no approval yet', async () => {
    const { w, a } = world({ files: autopilot() })
    await a.onToolCall(bash('git push --force origin main'))
    expect(parkOf(w)).toMatchObject({ session: 'S1', host: 'omp', tool: 'bash',
      command: 'git push --force origin main', cwd: '/repo', source: 'floor', redLine: 2,
      reason: 'never-approve: force-push, default-branch-push', approval: null })
  })

  test('the pain text and the ledger carry the shape, never the value', async () => {
    const { w, a } = world({ files: autopilot() })
    await a.onToolCall(bash('git push --force https://user:hunter2@example.com/x.git main'))
    expect(w.notes.join('\n') + ledger(w).join('\n')).not.toContain('hunter2')
  })

  test('a safe command and a non-bash tool pass untouched', async () => {
    const { w, a } = world({ files: autopilot(), sideTurn: sideAllow })
    expect(await a.onToolCall(bash('ls -la'))).toBeUndefined()
    expect(await a.onToolCall({ toolName: 'bash', input: {} })).toBeUndefined()
    expect(await a.onToolCall({ toolName: 'write', input: { path: '/x', content: 'hello' } })).toBeUndefined()
    expect(w.prompts).toEqual([])                        // nothing routed, so no judge ran
    expect(w.notes).toEqual([])
    expect(parksIn(w)).toEqual([])
  })

  test('a routed call the floor does not hold reaches the isolated side turn, and its allow runs it', async () => {
    const { w, a } = world({ files: autopilot(), sideTurn: sideAllow })
    // A push of the session's own non-default branch: not a floor case (0.10.0), so it is judged.
    expect(await a.onToolCall(bash('git push origin feat/x'))).toBeUndefined()
    expect(w.prompts).toHaveLength(1)
    expect(parksIn(w)).toEqual([])
  })

  test('the judge\'s ask parks the call, and no reply parks it too (fail closed)', async () => {
    const ask: SideTurn = () => ({ replyText: JSON.stringify({ decision: 'ask', red_line: null, reason: 'not my call' }) })
    const { w, a } = world({ files: autopilot(), sideTurn: ask })
    const r = await a.onToolCall(bash('git push origin feat/x'))
    expect(r?.reason).toContain('the judge asked): not my call')
    expect(parkOf(w)).toMatchObject({ source: 'judge', redLine: null, reason: 'not my call' })
    // No side turn at all: the host cannot decide, so the call stays with the operator, parked.
    const { w: w2, a: a2 } = world({ files: autopilot() })
    expect((await a2.onToolCall(bash('git push origin feat/x')))?.reason).toContain('the judge did not answer')
    expect(parkOf(w2)).toMatchObject({ source: 'judge', reason: 'the judge did not answer' })
  })

  test('a judge reply that names a red line and says allow still parks (Review Focus 4)', async () => {
    const bad: SideTurn = () => ({ replyText: JSON.stringify({ decision: 'allow', red_line: 5, reason: 'it is cheap' }) })
    const { a } = world({ files: autopilot(), sideTurn: bad })
    const r = await a.onToolCall(bash('git push origin feat/x'))
    expect(r?.block).toBe(true)
    expect(r?.reason).toContain('red line 5')
  })

  test('a call whose input names the park store parks without a side turn (call 3)', async () => {
    const { w, a } = world({ files: autopilot(), sideTurn: sideAllow })
    const r = await a.onToolCall(bash(`echo '{"approval": "x"}' > ${PARKS}/abc.json`))
    expect(r?.reason).toContain('operator-only state): the call names the park store')
    expect(w.prompts).toEqual([])
    expect(parkOf(w)).toMatchObject({ source: 'integrity', redLine: null })
  })

  test('a routed write with no command text is judged through the same side turn', async () => {
    const { w, a } = world({ files: autopilot(), sideTurn: sideAllow })
    const write = { toolName: 'write', input: { path: '/repo/x', content: 'git push --force' } }
    expect(await a.onToolCall(write)).toBeUndefined()
    expect(w.prompts).toHaveLength(1)                    // the file tool was judged, not floored
  })

  // omp's bash tool takes its own `cwd`; the floor judges the command where it will run (final review I2).
  describe('the bash call\'s own cwd', () => {
    const at = (command: string, cwd: string) => ({ toolName: 'bash', input: { command, cwd } })
    const MAIN = { top: '/other', branch: 'main', originHead: 'origin/main' }

    test('git push with a cwd on main parks on red line 1; the session branch and a feature cwd are judged', async () => {
      const { w, a } = world({ files: autopilot(), sideTurn: sideAllow })
      w.gitBy['/other'] = MAIN
      w.gitBy['/feat'] = { top: '/feat', branch: 'feat/y', originHead: 'origin/main' }
      const r = await a.onToolCall(at('git push', '/other'))
      expect(r?.reason).toMatch(/^autonomic: parked for the operator \(park [a-f0-9]{12}; red line 1\): never-approve: default-branch-push\./)
      expect(ledger(w)[0]).toContain(' · permission · ')
      expect(await a.onToolCall(bash('git push'))).toBeUndefined()
      expect(await a.onToolCall(at('git push', '/feat'))).toBeUndefined()
    })

    test('rm is judged now (0.10.0: the floor holds 1-3 only); its cwd no longer matters', async () => {
      const { w, a } = world({ files: autopilot(), sideTurn: sideAllow })
      w.gitBy['/elsewhere'] = { top: '/elsewhere', branch: 'feat/z', originHead: 'origin/main' }
      expect(await a.onToolCall(at('rm -rf /repo/x', '/elsewhere'))).toBeUndefined()
      expect(await a.onToolCall(bash('rm -rf /repo/x'))).toBeUndefined()
      expect(await a.onToolCall(at('rm -rf /elsewhere/x', '/elsewhere'))).toBeUndefined()
      expect(w.prompts).toHaveLength(3)      // every one reached the judge, none the floor
      expect(w.notes).toEqual([])
    })

    test('a relative cwd is read against the session folder, ~ against HOME, and an empty one is no cwd', async () => {
      const { w, a } = world({ files: autopilot(), sideTurn: sideAllow })
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

    test('forceWithLease off the session branch parks on red line 2; the own-branch force is judged (0.10.0)', async () => {
      const { w, a } = world({ files: autopilot(), sideTurn: sideAllow })
      const r = await a.onToolCall(push({ branch: 'feat/y', forceWithLease: true }))
      expect(r?.reason).toMatch(/^autonomic: parked for the operator \(park [a-f0-9]{12}; red line 2\): never-approve: force-push\./)
      expect(ledger(w)[0]).toContain(' · permission · Q: github pr_push: ')
      expect(w.notes[0]).toContain('autopilot: parked')
      expect(await a.onToolCall(push({ branch: 'feat/x', forceWithLease: true }))).toBeUndefined()
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

  test('a retired name in autonomic.json enables nothing, with no problem, and the status names it (0.10.0; call 7)', async () => {
    const files = { ...autopilot(), [`${HOME}/.omp/agent/autonomic.json`]: JSON.stringify({ neverApprove: 'branch-delete' }) }
    const judged = world({ files, sideTurn: sideAllow })
    expect(await judged.a.onToolCall(bash('git push --force origin main'))).toBeUndefined()
    expect(judged.w.prompts).toHaveLength(1)      // judged by the side turn, never floored
    expect(await judged.a.onToolCall(bash('git push origin --delete old-branch'))).toBeUndefined()
    const s = await judged.a.onCommand('status')
    expect(s).toContain('retired in 0.10.0, now judged: branch-delete')
    expect(s).not.toContain('settings:')
    // Adjacent control: the same call under the default list parks on the floor.
    const floored = world({ files: autopilot() })
    expect((await floored.a.onToolCall(bash('git push --force origin main')))?.reason).toContain('parked for the operator')
  })

  test('a 0.9.x neverApprove value loads end to end: the live rule parks, the retired name is judged (Review Focus 2)', async () => {
    const files = { ...autopilot(), [`${HOME}/.omp/agent/autonomic.json`]: JSON.stringify({ neverApprove: 'force-push branch-delete rm-outside' }) }
    const { w, a } = world({ files, sideTurn: sideAllow })
    const r = await a.onToolCall(bash('git push --force origin main'))
    expect(r?.reason).toContain('(park ')
    expect(r?.reason).toContain('never-approve: force-push')     // the enabled live rule still holds
    // branch-delete is retired: the same delete reaches the judge instead of parking on its name.
    await a.onToolCall(bash('git push origin --delete old-branch'))
    expect(w.prompts).toHaveLength(1)
    const s = await a.onCommand('status')
    expect(s).toContain('retired in 0.10.0, now judged: branch-delete rm-outside')
    expect(s).not.toContain('settings:')
    expect(s.split('\n')[0]).toContain('autopilot')
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

  test('a bash call whose cwd is the park store parks: the pre-check reads the cwd (R1)', async () => {
    const { w, a } = world({ files: autopilot() })
    const r = await a.onToolCall({ toolName: 'bash', input: { command: 'cat > deadbeef0001.json', cwd: PARKS } })
    expect(r?.block).toBe(true)
    expect(r?.reason).toContain('operator-only state')
    expect(parksIn(w)).toHaveLength(1)
  })

  test("a relative parks/… call from the store's parent parks (R1)", async () => {
    const { w, a } = world({ files: autopilot() })
    const r = await a.onToolCall({ toolName: 'bash', input: { command: 'cat > parks/deadbeef0001.json', cwd: `${HOME}/.local/state/autonomic` } })
    expect(r?.block).toBe(true)
    expect(r?.reason).toContain('operator-only state')
    expect(parksIn(w)).toHaveLength(1)
  })

  test('equivalent spellings of the park store park: //, /./ and quote splitting (R2)', async () => {
    const { w, a } = world({ files: autopilot() })
    for (const path of [
      `${PARKS.replace('/parks', '//parks')}/ab12cd34ef56.json`,
      `${PARKS.replace('/parks', '/./parks')}/ab12cd34ef56.json`,
      `${PARKS.replace('/parks', '/par""ks')}/ab12cd34ef56.json`,
    ]) {
      const r = await a.onToolCall({ toolName: 'write', input: { path, content: '{}' } })
      expect([path, r?.block]).toEqual([path, true])
      expect(r?.reason).toContain('operator-only state')
    }
    expect(parksIn(w)).toHaveLength(3)
  })

  test('near misses do not park: parkside and autonomic/parks-notes.md (R2 controls)', async () => {
    const { w, a } = world({ files: autopilot(), sideTurn: sideAllow })
    expect(await a.onToolCall({ toolName: 'write', input: { path: '/repo/parkside', content: '{}' } })).toBeUndefined()
    expect(await a.onToolCall({ toolName: 'write', input: { path: '/repo/autonomic/parks-notes.md', content: '{}' } })).toBeUndefined()
    expect(parksIn(w)).toHaveLength(0)
    expect(w.prompts).toEqual([])
  })

  test('a non-lane tool naming the store parks as integrity, and nothing else is routed (R3)', async () => {
    const { w, a } = world({ files: autopilot(), sideTurn: sideAllow })
    const r = await a.onToolCall({ toolName: 'apply_patch', input: { patch: '*** Begin Patch\n*** Update File: /home/u/.local/state/autonomic/parks/ab12cd34ef56.json\n@@\n-x\n+y\n*** End Patch' } })
    expect(r?.block).toBe(true)
    expect(r?.reason).toContain('operator-only state')
    expect(w.prompts).toEqual([])                 // integrity only: no side turn
    expect(parksIn(w)).toHaveLength(1)
  })

  test('an unrouted tool whose input says git push but names no store stays untouched (R3 control)', async () => {
    const { w, a } = world({ files: autopilot(), sideTurn: sideAllow })
    expect(await a.onToolCall({ toolName: 'apply_patch', input: { patch: '*** Begin Patch\n*** Update File: /repo/x\n@@\n-git push origin main\n+git status\n*** End Patch' } })).toBeUndefined()
    expect(w.prompts).toEqual([])
    expect(parksIn(w)).toHaveLength(0)
  })

  test('manual: the same store-naming calls are untouched (autopilot off)', async () => {
    const { w, a } = world()
    expect(await a.onToolCall({ toolName: 'bash', input: { command: 'cat > deadbeef0001.json', cwd: PARKS } })).toBeUndefined()
    expect(await a.onToolCall({ toolName: 'apply_patch', input: { patch: '/home/u/.local/state/autonomic/parks/ab12cd34ef56.json' } })).toBeUndefined()
    expect(parksIn(w)).toHaveLength(0)
  })
})

describe('the park store, the approval and the command surface (calls 2-3, #815)', () => {
  const bash = (command: string) => ({ toolName: 'bash', input: { command } })
  const PARKS = `${HOME}/.local/state/autonomic/parks`
  const allow = JSON.stringify({ decision: 'allow', red_line: null, reason: 'within the task' })
  const sideAllow: SideTurn = () => ({ replyText: allow })
  const parksIn = (w: { files: Map<string, string> }) => [...w.files.keys()].filter(p => p.startsWith(`${PARKS}/`)).sort()
  const parkIdOf = (reason: string | undefined): string => {
    const m = /\(park ([a-f0-9]{12});/.exec(reason ?? '')
    if (m === null) throw new Error(`no park id in ${String(reason)}`)
    return m[1]!
  }

  test('approve releases the exact call once; the second run parks again (#815)', async () => {
    const { w, a } = world({ files: autopilot(), sideTurn: sideAllow })
    const first = await a.onToolCall(bash('git push --force origin main'))
    const id = parkIdOf(first?.reason)
    expect(parksIn(w)).toEqual([`${PARKS}/${id}.json`])
    expect(await a.onCommand(`approve ${id}`)).toBe(`park ${id} approved for one use.`)
    expect(JSON.parse(w.files.get(`${PARKS}/${id}.json`)!).approval).toMatchObject({ by: 'operator', usedAt: null })
    expect(await a.onToolCall(bash('git push --force origin main'))).toBeUndefined()
    expect(JSON.parse(w.files.get(`${PARKS}/${id}.json`)!).approval.usedAt).not.toBeNull()
    expect(ledger(w)[1]).toContain(`· Q: park ${id} · A: approved for one use · why: `)
    expect(ledger(w)[1]).toContain('· src: operator')
    expect(ledger(w)[2]).toContain("· A: released by the operator's approved park · why: ")
    expect(ledger(w)[2]).toContain('· src: operator')
    const again = await a.onToolCall(bash('git push --force origin main'))
    expect(again?.block).toBe(true)
    // A fresh park, never the released one: an id that repeats in the same millisecond still
    // holds an unapproved park (the used file is replaced, and the call stays with the operator).
    expect(JSON.parse(w.files.get(`${PARKS}/${parkIdOf(again?.reason)}.json`)!).approval).toBeNull()
  })

  test('a park almost matching another cwd stays parked (Review Focus 3)', async () => {
    const { w, a } = world({ files: autopilot(), sideTurn: sideAllow })
    const first = await a.onToolCall(bash('git push --force origin main'))
    const id = parkIdOf(first?.reason)
    await a.onCommand(`approve ${id}`)
    // A different cwd is not the approved call: it parks again, and the approval stays unused.
    const other = await a.onToolCall({ toolName: 'bash', input: { command: 'git push --force origin main', cwd: '/feat' } })
    expect(other?.block).toBe(true)
    expect(JSON.parse(w.files.get(`${PARKS}/${id}.json`)!).approval.usedAt).toBeNull()
  })

  test('drop removes a park; an unknown or malformed id is no park', async () => {
    const { w, a } = world({ files: autopilot(), sideTurn: sideAllow })
    const first = await a.onToolCall(bash('git push --force origin main'))
    const id = parkIdOf(first?.reason)
    expect(await a.onCommand('drop deadbeef0000')).toBe('no park deadbeef0000')
    // A malformed id never becomes a path: the store's own id grammar is the gate.
    expect(await a.onCommand('drop ../../whatever')).toBe('no park ../../whatever')
    expect(await a.onCommand(`drop ${id}`)).toBe(`park ${id} dropped.`)
    expect(w.files.has(`${PARKS}/${id}.json`)).toBe(false)
    expect(ledger(w).at(-1)).toContain(`· Q: park ${id} · A: dropped · why: `)
  })

  test('/autopilot parks lists the open parks and says none when the store is empty', async () => {
    const { a } = world({ files: autopilot(), sideTurn: sideAllow })
    expect(await a.onCommand('parks')).toBe('parks: none')
    const first = await a.onToolCall(bash('git push --force origin main'))
    const id = parkIdOf(first?.reason)
    expect(await a.onCommand('parks')).toBe(`parks:\n${id} · red line 2 · Bash: git push --force origin main · /repo`)
    await a.onCommand(`approve ${id}`)
    expect(await a.onCommand('parks')).toContain(`${id} · red line 2 · Bash: git push --force origin main · /repo · approved`)   // approved, not yet used: still open
    expect(await a.onToolCall(bash('git push --force origin main'))).toBeUndefined()
    expect(await a.onCommand('parks')).toBe('parks: none')
  })

  test('an unparseable park file is ignored and logged, never matched', async () => {
    const { w, a } = world({ files: autopilot(), sideTurn: sideAllow })
    w.files.set(`${PARKS}/aabbccddeeff.json`, '{not json')
    expect(await a.onCommand('parks')).toBe('parks: none')
    expect(w.files.get(`${HOME}/.claude/state/autonomic/autonomic.log`)).toContain('park aabbccddeeff.json ignored:')
    expect(await a.onToolCall(bash('git push --force origin main'))).toHaveProperty('block', true)
    expect(w.notes[0]).toContain('autopilot: parked')
  })

  test('decidingModel is a Claude Code setting on OMP: a status line when set, never a config problem, and the mode does not change (ruling 2)', async () => {
    const files = { ...autopilot(), [`${HOME}/.omp/agent/autonomic.json`]: JSON.stringify({ decidingModel: 'claude-opus-4-1' }) }
    const { w, a } = world({ files })
    const s = await a.onCommand('status')
    expect(s.split('\n')[0]).toContain('autopilot')
    expect(s).toContain('decidingModel applies on Claude Code only; OMP decides on the session model')
    expect(s).not.toContain('settings:')
    expect((await a.onToolCall(bash('git push --force origin main')))?.block).toBe(true)
    expect(w.prompts).toEqual([])
  })

  test('the usage text names the parks and approval surface', async () => {
    const { a } = world()
    expect(await a.onCommand('nonsense')).toBe('usage: /autopilot on [scope doc …] | off | status | parks | approve <park> | drop <park>')
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
    const { w, a, files } = world({ env: { AUTONOMIC_MODE: 'autopilot' } })
    expect(await a.onSessionStop({ last_assistant_message: 'x' })).toBeUndefined()
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
    expect(await a.onCommand('')).toBe('usage: /autopilot on [scope doc …] | off | status | parks | approve <park> | drop <park>')
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
    expect(s).toContain('never-approve: force-push default-branch-push no-verify ai-trailer')
    expect(s).toContain('molt stage: warn')
    expect(s).toContain(`ledger: ${LEDGER}`)
    expect(s).toContain('pushes in a row with no change: 0 of 3')
  })

  test('a retired name in the stored list is shown as judged, and the live list keeps its rules (0.10.0; call 7)', async () => {
    const { a } = world({ files: { ...autopilot(), [`${HOME}/.omp/agent/autonomic.json`]: JSON.stringify({ neverApprove: 'force-push branch-delete' }) } })
    const s = await a.onCommand('status')
    expect(s).toContain('retired in 0.10.0, now judged: branch-delete')
    expect(s).toContain('never-approve: force-push')
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

  function boot(opts: { env?: Record<string, string | undefined>; mode?: 'autopilot'; staleMode?: boolean } = {}) {
    const home = mkdtempSync(join(tmp, 'h-'))
    const ledgerFile = join(home, 'ledger.md')
    const saved: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries({ HOME: home, AUTONOMIC_MODE: opts.mode, AUTONOMIC_LEDGER: ledgerFile, AUTONOMIC_BELL: undefined, AUTONOMIC_PAIN_PATH: undefined, AUTONOMIC_EFFECTIVE_MODE: undefined, AUTONOMIC_MODE_FILE: undefined, AUTONOMIC_PARKS_DIR: undefined, MOLT_STATUS_PATH: undefined, ...opts.env })) {
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

  for (const event of ['session_tree', 'session_compact', 'rewind']) {
    test(`round 3 ${event} preserves the operator's mode and scope`, async () => {
      const b = boot({ mode: 'autopilot' })
      try {
        const c = b.ctxFor()
        const scope = join(b.home, 'scope.md')
        writeFileSync(scope, 'scope')
        await b.commands.get('autopilot')!.handler(`on ${scope}`, c)
        if (event === 'rewind') await b.handlers.get('tool_result')!({ toolName: 'rewind', input: { report: 'findings' }, content: [{ type: 'text', text: 'Rewind requested.' }], details: { report: 'findings', rewound: true }, isError: false }, c)
        else await b.handlers.get(event)?.({}, c)
        const rec = JSON.parse(readFileSync(sessionPath(b.home, 'W1'), 'utf8'))
        expect(rec.mode).toBe('autopilot')
        expect(rec.scope).toEqual([scope])
      } finally { b.restore() }
    })
  }

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
      expect(b.state.notices).toEqual([])
      expect(existsSync(b.ledgerFile)).toBe(false)
      expect(existsSync(sessionPath(b.home, 'W1'))).toBe(false)
    } finally { b.restore() }
  })

  test('the main session in autopilot: the floor blocks and the turn end is operator-owned', async () => {
    const b = boot({ mode: 'autopilot' })
    try {
      await b.handlers.get('session_start')!({}, b.ctxFor())
      expect(process.env.AUTONOMIC_EFFECTIVE_MODE).toBe('autopilot')
      const blocked = await b.handlers.get('tool_call')!({ toolName: 'bash', input: { command: 'git push --force origin main' } }, b.ctxFor())
      expect(blocked?.block).toBe(true)
      expect(b.state.notices.at(-1)?.[1]).toBe('warning')
      expect(readFileSync(b.ledgerFile, 'utf8')).toContain(' · permission · ')
      // No decision service is enrolled here, so the turn end is operator-owned: the stop passes
      // with no continuation and nothing is written for it.
      expect(await b.handlers.get('session_stop')!({ last_assistant_message: 'Step 2 done.' }, b.ctxFor())).toBeUndefined()
      expect(await b.handlers.get('before_agent_start')!({ systemPrompt: 'BASE' }, b.ctxFor())).toEqual({ systemPrompt: ['BASE', 'WIRING POLICY'] })
    } finally { b.restore() }
  })

  test('the ask reflex through the wiring leaves the ask with the operator; a molt stage yields the stop', async () => {
    const b = boot({ mode: 'autopilot' })
    try {
      // No decision service: the whole ask stays with the operator and rings.
      expect(await b.handlers.get('tool_call')!(ask(Q), b.ctxFor())).toBeUndefined()
      expect(b.state.notices.join('\n')).toContain('question for you')
      // A stage file written by molt's glue yields the stop: molt owns the turn end.
      mkdirSync(join(b.home, '.claude/state/molt/stage'), { recursive: true })
      writeFileSync(stagePath(b.home, 'W1'), JSON.stringify({ stage: 'command', command: 65 }))
      expect(await b.handlers.get('session_stop')!({ last_assistant_message: 'x' }, b.ctxFor())).toBeUndefined()
      expect(readFileSync(b.ledgerFile, 'utf8')).toContain(' · molt · ')
    } finally { b.restore() }
  })

  test('a pain with a bell runs sh -c through pi.exec with the message as $1 and a 30 s timeout', async () => {
    const b = boot({ mode: 'autopilot', env: { AUTONOMIC_BELL: 'echo ring' } })
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

  test('/autopilot reports through ctx.ui.notify; a turn end is operator-owned', async () => {
    const b = boot({ mode: 'autopilot' })
    try {
      await b.commands.get('autopilot')!.handler('status', b.ctxFor())
      expect(b.state.notices.at(-1)![0]).toContain('autopilot (source: env)')
      expect(await b.handlers.get('session_stop')!({ last_assistant_message: 'x' }, b.ctxFor())).toBeUndefined()
    } finally { b.restore() }
  })
})

describe('round 2 autonomic parity', () => {
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
