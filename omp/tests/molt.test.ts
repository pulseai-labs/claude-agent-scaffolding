import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ompExtension, { FALLBACK_BRIEF_MS, JOBS_CANCELLED, claudeShape, claudeShapes, createMolt, messagesOf } from '../../molt/omp/extension'
import type { ClearResult, MoltIO } from '../../molt/omp/extension'
import { activePath, autonomicPath, fallbackPath, lineagePath, stagePath } from '../../molt/hooks/records'
import { extractFacts } from '../../molt/hooks/handoff'
import { DEFAULT_SEED, fill } from '../../molt/hooks/templates'

const HOME = '/home/u'
const msg = (role: 'user' | 'assistant', text: string) => ({ type: 'message', message: { role, content: [{ type: 'text', text }] } })

// A fake MoltIO: scripted percent, an in-memory file system, and a record of every side effect.
function world(over: { env?: Record<string, string>; files?: Record<string, string>; briefMs?: number; hang?: boolean } = {}) {
  const files = new Map<string, string>(Object.entries(over.files ?? {}))
  const w = {
    percent: undefined as number | undefined,
    id: 'S1',
    branch: [] as unknown[],
    route: true,
    printMode: false,
    ephemeralReply: undefined as string | undefined,
    clearResult: 'cleared' as ClearResult,
    onClear: undefined as undefined | (() => Promise<void>),
    files,
    steers: [] as string[],
    warnNexts: [] as string[],
    notes: [] as string[],
    logs: [] as string[],
    ephemerals: [] as string[],
    seeds: [] as string[],
    asides: [] as string[],
    bells: [] as string[],
  }
  const io: MoltIO = {
    usage: () => w.percent,
    sessionId: () => w.id,
    isChild: over.env?.MOLT_HANDOFF === 'parent',
    env: { HOME, ...over.env },
    cwd: '/repo',
    readText: async p => files.get(p),
    exists: async p => files.has(p),
    writeText: async (p, t) => { files.set(p, t) },
    remove: async p => { files.delete(p) },
    appendLog: async l => { w.logs.push(l) },
    steer: t => { w.steers.push(t) },
    aside: t => { w.asides.push(t) },
    warnNext: t => { w.warnNexts.push(t) },
    status: () => {},
    notify: t => { w.notes.push(t) },
    bell: async (_c, m) => { w.bells.push(m) },
    ephemeral: async p => { w.ephemerals.push(p); return over.hang ? new Promise<string | undefined>(() => {}) : w.ephemeralReply },
    route: () => w.route,
    printMode: () => w.printMode,
    newSessionAndSeed: async seed => {
      if (!w.route) return 'no-route'
      w.seeds.push(seed)
      await w.onClear?.()
      return w.clearResult
    },
    branch: () => w.branch,
  }
  return { w, io, m: createMolt(io, over.briefMs) }
}

const result = (name: string, input: unknown = {}, isError = false) => ({ toolName: name, input, isError })
const marked = (path: string) => [msg('user', 'go'), msg('assistant', `done\nMOLT-HANDOFF: ${path}`)]
const unmarked = [msg('user', 'go'), msg('assistant', 'still working')]

describe('the ladder', () => {
  test('39% says nothing; 41% steers the first warning once; 45% is quiet; 51% steers the second', async () => {
    const { w, m } = world()
    w.percent = 39
    await m.onToolResult(result('read'))
    expect(w.steers).toEqual([])
    w.percent = 41
    await m.onToolResult(result('read'))
    expect(w.steers).toHaveLength(1)
    expect(w.steers[0]).toContain('first warning')
    w.percent = 45
    await m.onToolResult(result('read'))
    expect(w.steers).toHaveLength(1)
    w.percent = 51
    await m.onToolResult(result('read'))
    expect(w.steers).toHaveLength(2)
    expect(w.steers[1]).toContain('second warning')
  })

  test('a warning owed at prompt time goes out as a next-turn message, once', async () => {
    const { w, m } = world()
    w.percent = 42
    await m.onInput({ text: '/x', source: 'interactive' })
    await m.onInput({ text: '/x', source: 'interactive' })
    expect(w.warnNexts).toHaveLength(1)
    expect(w.warnNexts[0]).toContain('first warning')
    expect(w.steers).toEqual([])
  })

  test('66% at a tool result steers the handoff instruction once; the stop is blocked twice, then let through', async () => {
    const { w, m } = world()
    w.percent = 66
    w.branch = unmarked
    await m.onToolResult(result('read'))
    expect(w.steers).toHaveLength(1)
    expect(w.steers[0]).toContain('MOLT-HANDOFF: <absolute path')
    await m.onToolResult(result('read'))
    expect(w.steers).toHaveLength(1)
    const first = await m.onSessionStop()
    expect(first?.decision).toBe('block')
    expect(first?.reason).toContain('MOLT-HANDOFF: <absolute path')
    expect((await m.onSessionStop())?.decision).toBe('block')
    expect(await m.onSessionStop()).toBeUndefined()
  })

  test('a stop below the first warning is never blocked', async () => {
    const { w, m } = world()
    w.percent = 30
    w.branch = unmarked
    expect(await m.onSessionStop()).toBeUndefined()
    expect(w.seeds).toEqual([])
  })
})

describe('the gate past block', () => {
  test('76%: bash ls is blocked with the instruction; git add/commit, write, edit, apply_patch and a skill read pass', async () => {
    const { w, m } = world()
    w.percent = 76
    const blocked = await m.onToolCall({ toolName: 'bash', input: { command: 'ls' } })
    expect(blocked?.block).toBe(true)
    expect(blocked?.reason).toContain('MOLT-HANDOFF: <absolute path')
    expect(blocked?.reason).toContain('past molt\'s block threshold')
    expect(await m.onToolCall({ toolName: 'bash', input: { command: 'git add x && git commit -m y' } })).toBeUndefined()
    expect(await m.onToolCall({ toolName: 'write', input: { path: 'h.md', content: 'x' } })).toBeUndefined()
    expect(await m.onToolCall({ toolName: 'edit', input: { path: 'h.md' } })).toBeUndefined()
    expect(await m.onToolCall({ toolName: 'apply_patch', input: { input: '*** Begin Patch' } })).toBeUndefined()
    expect(await m.onToolCall({ toolName: 'ast_edit', input: { paths: ['a.ts'] } })).toBeUndefined()
    expect(await m.onToolCall({ toolName: 'read', input: { path: 'skill://handoff' } })).toBeUndefined()
  })

  test('76%: every other omp tool is refused, whatever its name', async () => {
    const { m, w } = world()
    w.percent = 76
    const refused = ['read', 'grep', 'glob', 'find', 'ast_grep', 'web_search', 'lsp', 'debug', 'eval', 'github', 'task', 'ask', 'todo', 'wait',
      'notebook', 'manage_skill', 'memory_edit', 'new_context', 'mcp__srv__write', 'Write', 'Edit', 'Skill', 'Bash', 'brand_new_tool']
    for (const name of refused) expect((await m.onToolCall({ toolName: name, input: { path: 'a', command: 'git add x' } }))?.block).toBe(true)
    // a plain read, and a skill:// read that climbs out of the skill's folder
    expect((await m.onToolCall({ toolName: 'read', input: { path: 'src/a.ts' } }))?.block).toBe(true)
    expect((await m.onToolCall({ toolName: 'read', input: { path: 'skill://handoff/../../etc/passwd' } }))?.block).toBe(true)
    expect((await m.onToolCall({ toolName: 'bash', input: { command: 'git push' } }))?.block).toBe(true)
  })

  test('Review Focus 4: 66% then 76% in one turn, with no stop between, blocks the 76% call', async () => {
    const { w, m } = world()
    w.percent = 66
    await m.onToolResult(result('read'))
    expect(await m.onToolCall({ toolName: 'bash', input: { command: 'ls' } })).toBeUndefined()
    w.percent = 76
    expect((await m.onToolCall({ toolName: 'bash', input: { command: 'ls' } }))?.block).toBe(true)
  })

  test('below block nothing is gated, and /molt off lifts the gate', async () => {
    const { w, m } = world()
    w.percent = 74
    expect(await m.onToolCall({ toolName: 'bash', input: { command: 'ls' } })).toBeUndefined()
    w.percent = 90
    await m.onCommand('off')
    expect(await m.onToolCall({ toolName: 'bash', input: { command: 'ls' } })).toBeUndefined()
    await m.onCommand('on')
    expect((await m.onToolCall({ toolName: 'bash', input: { command: 'ls' } }))?.block).toBe(true)
  })
})

describe('a stop at the handoff stage', () => {
  test('a marker naming a missing file is blocked with the does-not-exist text', async () => {
    const { w, m } = world()
    w.percent = 66
    w.branch = marked('/h/gone.md')
    const r = await m.onSessionStop()
    expect(r?.decision).toBe('block')
    expect(r?.reason).toContain('/h/gone.md does not exist')
  })

  test('a relative marker is read against the cwd', async () => {
    const { w, m } = world({ files: { '/repo/h.md': '# h' } })
    w.percent = 66
    w.branch = marked('h.md')
    expect(await m.onSessionStop()).toBeUndefined()
    expect(w.seeds).toHaveLength(1)
    expect(w.seeds[0]).toContain('/repo/h.md')
  })

  test('81% with no marker and both blocks spent: one ephemeral brief, the fallback file, a seed naming it', async () => {
    const { w, m } = world()
    w.branch = [msg('user', 'fix #12'), msg('assistant', 'still working')]
    w.percent = 66
    await m.onSessionStop()
    await m.onSessionStop()
    expect(w.ephemerals).toEqual([])
    w.percent = 81
    w.ephemeralReply = '## Work in progress\nx\n## Next step\nresume here'
    expect(await m.onSessionStop()).toBeUndefined()
    expect(w.ephemerals).toHaveLength(1)
    expect(w.ephemerals[0]).toContain('ran out of context before it wrote a handoff')
    const path = fallbackPath(HOME, 'S1')
    expect(w.files.get(path)).toContain('resume here')
    expect(w.files.get(path)).toContain('#12')
    expect(w.seeds).toEqual([`${fill(DEFAULT_SEED, { path })}\n\n${JOBS_CANCELLED}`])
  })

  test('81% with no marker: the first two stops block (no brief, no clear); the third runs the fallback brief and the molt', async () => {
    const { w, m } = world()
    w.branch = unmarked
    w.percent = 81
    w.ephemeralReply = 'no sections here'
    expect((await m.onSessionStop())?.decision).toBe('block')
    expect((await m.onSessionStop())?.decision).toBe('block')
    expect(w.ephemerals).toEqual([])
    expect(w.seeds).toEqual([])
    expect(await m.onSessionStop()).toBeUndefined()
    expect(w.ephemerals).toHaveLength(1)
    // an unusable brief still yields the facts file
    expect(w.files.get(fallbackPath(HOME, 'S1'))).toContain('## Last request')
    expect(w.files.get(fallbackPath(HOME, 'S1'))).not.toContain('no sections here')
    expect(w.seeds).toHaveLength(1)
  })

  test('a fallback brief that never settles (a host that ignores the abort signal) ends at the deadline: the facts-only brief, the molt, a log line', async () => {
    const { w, m } = world({ hang: true, briefMs: 60 })
    w.branch = [msg('user', 'fix #12'), msg('assistant', 'still working')]
    w.percent = 81
    await m.onSessionStop()
    await m.onSessionStop()
    const t0 = Date.now()
    expect(await m.onSessionStop()).toBeUndefined()
    expect(Date.now() - t0).toBeLessThan(2_000)
    expect(w.ephemerals).toHaveLength(1)
    const path = fallbackPath(HOME, 'S1')
    expect(w.files.get(path)).toContain('#12')
    expect(w.files.get(path)).not.toContain('Work in progress')
    expect(w.seeds).toEqual([`${fill(DEFAULT_SEED, { path })}\n\n${JOBS_CANCELLED}`])
    expect(w.logs.join('\n')).toContain('ephemeral brief error session=S1')
  })

  test('the brief deadline sits inside omp\'s 30 s session_stop budget', () => {
    expect(FALLBACK_BRIEF_MS).toBeLessThanOrEqual(25_000)
  })

  test('a child at 81% follows the same order: two blocks, then the fallback brief and the hand-off, never a clear', async () => {
    const { w, m } = world({ env: { MOLT_HANDOFF: 'parent', MOLT_STATUS_PATH: '/s/status' } })
    w.branch = unmarked
    w.percent = 81
    expect((await m.onSessionStop())?.decision).toBe('block')
    expect((await m.onSessionStop())?.decision).toBe('block')
    expect(w.ephemerals).toEqual([])
    expect(await m.onSessionStop()).toBeUndefined()
    expect(w.ephemerals).toHaveLength(1)
    expect(w.files.get('/s/status')).toContain(`handed-off ${fallbackPath(HOME, 'S1')}`)
    expect(w.seeds).toEqual([])
  })

  test('a .md written past the handoff stage stands in for a missing marker once the blocks are spent', async () => {
    const { w, m } = world({ files: { '/repo/notes.md': 'n' } })
    w.percent = 66
    w.branch = unmarked
    await m.onToolCall({ toolName: 'write', input: { path: '/repo/notes.md' } })
    await m.onToolResult(result('write', { path: '/repo/notes.md' }))
    await m.onSessionStop()
    await m.onSessionStop()
    await m.onSessionStop()
    expect(w.ephemerals).toEqual([])
    expect(w.seeds[0]).toContain('/repo/notes.md')
  })

  test('a notes.md write gated at 64% is not a handoff after a sibling advances to 66%', async () => {
    const { w, m } = world({ files: { '/repo/notes.md': 'n' } })
    w.percent = 64
    w.branch = unmarked
    const write = { toolCallId: 'notes', toolName: 'write', input: { path: '/repo/notes.md' } }
    const sibling = { toolCallId: 'sibling', toolName: 'read', input: {} }
    await m.onToolCall(write)
    await m.onToolCall(sibling)
    w.percent = 66
    await m.onToolResult({ ...sibling, isError: false })
    await m.onToolResult({ ...write, isError: false })
    await m.onSessionStop()
    await m.onSessionStop()
    await m.onSessionStop()
    expect(w.ephemerals).toHaveLength(1)
    expect(w.seeds[0]).not.toContain('/repo/notes.md')
  })

  test('a failed write is not a handoff', async () => {
    const { w, m } = world({ files: { '/repo/notes.md': 'n' } })
    w.percent = 66
    w.branch = unmarked
    await m.onToolCall({ toolName: 'write', input: { path: '/repo/notes.md' } })
    await m.onToolResult(result('write', { path: '/repo/notes.md' }, true))
    await m.onSessionStop()
    await m.onSessionStop()
    await m.onSessionStop()
    expect(w.ephemerals).toHaveLength(1)
  })
})

describe('an ast_edit preview is not a change until it is resolved', () => {
  const ast = (path: string) => result('ast_edit', { ops: [{ pat: 'a', out: 'b' }], paths: [path] })
  const resolve = (isError = false) => result('write', { path: 'xd://resolve', content: 'the preview is right' }, isError)
  const reject = () => result('write', { path: 'xd://reject', content: 'wrong files' })

  // A stop at the handoff stage after the given tool results, no marker: the .md the session last changed is the handoff.
  async function handoffAfter(...results: Array<ReturnType<typeof result>>) {
    const { w, m } = world({ files: { '/repo/notes.md': 'n', '/repo/old.md': 'o' } })
    w.percent = 66
    w.branch = unmarked
    for (const r of results) await m.onToolResult(r)
    await m.onSessionStop()
    await m.onSessionStop()
    await m.onSessionStop()
    return w
  }

  test('a previewed .md is not the handoff: a reject, or no resolve, leaves the fallback brief', async () => {
    for (const results of [[ast('/repo/notes.md')], [ast('/repo/notes.md'), reject()], [ast('/repo/notes.md'), resolve(true)]]) {
      const w = await handoffAfter(...results)
      expect(w.ephemerals).toHaveLength(1)
      expect(w.seeds[0]).not.toContain('/repo/notes.md')
    }
  })

  test('a resolved preview credits its paths: the .md is the handoff', async () => {
    const w = await handoffAfter(ast('/repo/notes.md'), resolve())
    expect(w.ephemerals).toEqual([])
    expect(w.seeds[0]).toContain('/repo/notes.md')
  })

  test('a resolve applies the last staged preview, a reject discards it', async () => {
    const w = await handoffAfter(ast('/repo/old.md'), ast('/repo/notes.md'), reject(), resolve())
    expect(w.seeds[0]).toContain('/repo/old.md')
    expect(w.seeds[0]).not.toContain('/repo/notes.md')
  })

  test('a preview with no replacements stages nothing, so a later resolve credits nothing of it', async () => {
    const empty = { ...ast('/repo/notes.md'), details: { totalReplacements: 0 } }
    const w = await handoffAfter(empty, resolve())
    expect(w.ephemerals).toHaveLength(1)
  })

  // The autopilot loop guard: a second molt with no progress since the first one is paused.
  async function secondMoltAfter(...results: Array<ReturnType<typeof result>>) {
    const { w, m } = world({ files: { '/h/a.md': 'a', '/h/b.md': 'b', [autonomicPath(HOME, 'S2')]: '{"mode":"autopilot"}' } })
    w.percent = 66
    w.branch = marked('/h/a.md')
    w.onClear = async () => { w.id = 'S2'; await m.onSessionSwitch('new') }
    await m.onSessionStop()
    w.percent = 10
    await m.onInput({ text: 'carry on', source: 'rpc' })
    for (const r of results) await m.onToolResult(r)
    w.percent = 90
    w.branch = marked('/h/b.md')
    await m.onSessionStop()
    return w
  }

  test('progress: a preview, or a rejected one, does not count; a resolved one does', async () => {
    expect((await secondMoltAfter()).seeds).toHaveLength(1)
    expect((await secondMoltAfter(ast('/repo/a.ts'))).seeds).toHaveLength(1)
    expect((await secondMoltAfter(ast('/repo/a.ts'), reject())).seeds).toHaveLength(1)
    expect((await secondMoltAfter(ast('/repo/a.ts'), resolve())).seeds).toHaveLength(2)
    expect((await secondMoltAfter(result('write', { path: '/repo/a.ts' }))).seeds).toHaveLength(2)
  })

  test('a transcript lists the files of a resolved preview only', () => {
    const call = (id: string, name: string, args: unknown) => ({ type: 'toolCall', id, name, arguments: args })
    const turn = (...calls: unknown[]) => ({ type: 'message', message: { role: 'assistant', content: calls } })
    const done = (id: string, isError = false) => ({ type: 'message', message: { role: 'toolResult', toolCallId: id, isError, content: [{ type: 'text', text: 'ok' }] } })
    const filesOf = (branch: unknown[]) => extractFacts(messagesOf(branch)).files
    const staged = [turn(call('1', 'ast_edit', { paths: ['/r/a.ts'] })), done('1')]
    expect(filesOf(staged)).toEqual([])
    expect(filesOf([...staged, turn(call('2', 'write', { path: 'xd://reject', content: 'no' })), done('2')])).toEqual([])
    expect(filesOf([...staged, turn(call('2', 'write', { path: 'xd://resolve', content: 'yes' })), done('2')])).toEqual(['/r/a.ts'])
    expect(filesOf([...staged, turn(call('2', 'write', { path: 'xd://resolve', content: 'yes' })), done('2', true)])).toEqual([])
    expect(filesOf([...staged, turn(call('2', 'resolve', { action: 'apply', reason: 'yes' })), done('2')])).toEqual(['/r/a.ts'])
  })
})

describe('the files a session changed, read from its edit payload text', () => {
  test('a hashline edit of the handoff .md is the handoff once the blocks are spent, and the file is in the brief facts', async () => {
    const { w, m } = world({ files: { '/repo/handoff.md': 'h' } })
    w.percent = 66
    const input = '[/repo/handoff.md]\n= 1|# Handoff'
    w.branch = [msg('user', 'go'), { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'edit', arguments: { input } }] } }]
    w.branch.push({ type: 'message', message: { role: 'toolResult', toolCallId: 'c1', isError: false } })
    await m.onToolCall({ toolName: 'edit', input: { input } })
    await m.onToolResult(result('edit', { input }))
    await m.onSessionStop()
    await m.onSessionStop()
    await m.onSessionStop()
    expect(w.ephemerals).toEqual([])
    expect(w.seeds[0]).toContain('/repo/handoff.md')
    expect(extractFacts(messagesOf(w.branch)).files).toEqual(['/repo/handoff.md'])
  })

  test('an apply_patch over two files lists both', () => {
    const input = '*** Begin Patch\n*** Update File: /r/a.ts\n@@\n-x\n+y\n*** Update File: /r/b.ts\n@@\n-1\n+2\n*** End Patch'
    const branch: unknown[] = [{ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'apply_patch', arguments: { input } }] } }]
    branch.push({ type: 'message', message: { role: 'toolResult', toolCallId: 'c1', isError: false } })
    expect(extractFacts(messagesOf(branch)).files).toEqual(['/r/a.ts', '/r/b.ts'])
  })
})

describe('a child (MOLT_HANDOFF=parent)', () => {
  const env = { MOLT_HANDOFF: 'parent', MOLT_STATUS_PATH: '/s/status' }
  test('warnings and the hand-off are appended to the status file, and the session is never cleared', async () => {
    const { w, m } = world({ env, files: { '/h/handoff.md': '# h' } })
    w.percent = 41
    await m.onToolResult(result('read'))
    w.percent = 51
    await m.onToolResult(result('read'))
    w.branch = marked('/h/handoff.md')
    await m.onSessionStop()
    const lines = (w.files.get('/s/status') ?? '').trim().split('\n').map(l => l.slice(l.indexOf(' ') + 1))
    expect(lines).toEqual(['warned 40', 'warned 50', 'handed-off /h/handoff.md'])
    expect(w.seeds).toEqual([])
  })

  test('the child warning names the parent, and a child is not given the arm rewrite', async () => {
    const { w, m } = world({ env })
    w.percent = 41
    await m.onToolResult(result('read'))
    expect(w.steers[0]).toContain('Your parent dispatched you')
    expect(await m.onInput({ text: 'hello', source: 'rpc' })).toBeUndefined()
  })

  test('at the handoff stage the stop reflex still asks, and the status file says so once', async () => {
    const { w, m } = world({ env })
    w.percent = 66
    w.branch = unmarked
    await m.onToolResult(result('read'))
    expect((await m.onSessionStop())?.reason).toContain('molt does not clear a child session')
    expect((w.files.get('/s/status') ?? '').match(/handoff required/g)).toHaveLength(1)
  })
})

describe('a molt and the session it starts', () => {
  test('session_switch "new" after a molt resets the fill state and writes the lineage at depth 1', async () => {
    const { w, m } = world({ files: { '/h/handoff.md': '# h' } })
    w.percent = 66
    w.branch = marked('/h/handoff.md')
    await m.onSessionStart()
    expect(w.files.has(activePath(HOME, 'S1'))).toBe(true)
    await m.onToolResult(result('read'))
    expect(w.steers).toHaveLength(1)
    w.onClear = async () => {
      w.id = 'S2'
      w.percent = undefined
      await m.onSessionSwitch('new')
    }
    expect(await m.onSessionStop()).toBeUndefined()
    expect(JSON.parse(w.files.get(lineagePath(HOME, 'S2')) ?? 'null')).toEqual({ from: 'S1', chain: 'S1', depth: 1, handoff: '/h/handoff.md' })
    expect(w.files.has(activePath(HOME, 'S1'))).toBe(false)
    expect(w.files.has(activePath(HOME, 'S2'))).toBe(true)
    // the seeded session's ladder is unknown until a reading measures its start
    expect(JSON.parse(w.files.get(stagePath(HOME, 'S2')) ?? 'null')).toMatchObject({ stage: 'below' })
    expect(JSON.parse(w.files.get(stagePath(HOME, 'S2')) ?? 'null').command).toBeUndefined()
    w.percent = 30
    w.steers.length = 0
    await m.onToolResult(result('read'))
    expect(w.steers).toEqual([])
    expect(JSON.parse(w.files.get(stagePath(HOME, 'S2')) ?? 'null')).toMatchObject({ stage: 'below', command: 70, block: 80, fallback: 85 })
  })

  test('a second molt carries the chain and the depth', async () => {
    const { w, m } = world({ files: { '/h/a.md': 'a', '/h/b.md': 'b' } })
    w.percent = 66
    w.branch = marked('/h/a.md')
    w.onClear = async () => { w.id = 'S2'; await m.onSessionSwitch('new') }
    await m.onSessionStop()
    w.percent = 90
    await m.onInput({ text: 'carry on', source: 'rpc' })
    w.percent = 66
    w.branch = marked('/h/b.md')
    w.onClear = async () => { w.id = 'S3'; await m.onSessionSwitch('new') }
    await m.onSessionStop()
    expect(JSON.parse(w.files.get(lineagePath(HOME, 'S3')) ?? 'null')).toEqual({ from: 'S2', chain: 'S1', depth: 2, handoff: '/h/b.md' })
  })

  test('a clear that is cancelled leaves the session going and says so', async () => {
    const { w, m } = world({ files: { '/h/h.md': 'h' } })
    w.percent = 66
    w.branch = marked('/h/h.md')
    w.clearResult = 'cancelled'
    expect(await m.onSessionStop()).toBeUndefined()
    expect(w.notes.some(n => n.includes('was not cleared'))).toBe(true)
    // the next stop tries again: nothing is stuck in flight
    await m.onSessionStop()
    expect(w.seeds).toHaveLength(2)
  })

  test('manual mode pauses after manualMaxMolts molts with no operator message; a prompt lifts the pause', async () => {
    const { w, m } = world({ files: { '/h/h.md': 'h' } })
    w.percent = 66
    w.branch = marked('/h/h.md')
    let n = 1
    w.onClear = async () => { w.id = `S${++n}`; await m.onSessionSwitch('new') }
    await m.onSessionStop()
    await m.onSessionStop()
    expect(w.seeds).toHaveLength(2)
    await m.onSessionStop()
    expect(w.seeds).toHaveLength(2)
    expect(w.notes.some(x => x.includes('molt paused: 2 molts in a row'))).toBe(true)
    await m.onInput({ text: 'go on', source: 'interactive' })
    await m.onSessionStop()
    expect(w.seeds).toHaveLength(3)
  })

  test('no route (print mode): the session is gated and never cleared, once', async () => {
    const { w, m } = world({ files: { '/h/h.md': 'h' } })
    w.route = false
    w.printMode = true
    w.percent = 66
    w.branch = marked('/h/h.md')
    await m.onSessionStop()
    await m.onSessionStop()
    expect(w.seeds).toEqual([])
    expect(w.logs.filter(l => l.endsWith('no clear route in print mode'))).toHaveLength(1)
  })

  test('unroutable at one handoff, then /molt-arm saves a route: the next handoff clears the session', async () => {
    const { w, m } = world({ files: { '/h/h.md': 'h' } })
    w.route = false
    w.percent = 66
    w.branch = marked('/h/h.md')
    await m.onSessionStop()
    expect(w.seeds).toEqual([])
    expect(w.notes.some(x => x.includes('cannot be cleared here'))).toBe(true)
    w.route = true                                  // /molt-arm ran: the command ctx is saved
    await m.onSessionStop()
    expect(w.seeds).toHaveLength(1)
    expect(w.seeds[0]).toContain('/h/h.md')
  })

  test('the arm rewrite applies to the first plain operator prompt only', async () => {
    const { w, m } = world()
    w.route = false
    expect(await m.onInput({ text: 'hello', source: 'interactive' })).toEqual({ text: '/molt-arm hello' })
    expect(await m.onInput({ text: '/molt status', source: 'interactive' })).toBeUndefined()
    expect(await m.onInput({ text: 'x', source: 'extension' })).toBeUndefined()
    expect(await m.onInput({ text: 'x', source: 'rpc', images: [{}] })).toBeUndefined()
    w.route = true
    expect(await m.onInput({ text: 'again', source: 'interactive' })).toBeUndefined()
  })
})

describe('settings, the stage file and the active marker', () => {
  test('~/.omp/agent/molt.json lowers the thresholds', async () => {
    const { w, m } = world({ files: { [`${HOME}/.omp/agent/molt.json`]: JSON.stringify({ warnPercent: 10, warnAgainPercent: 20, commandPercent: 30, blockPercent: 40 }) } })
    w.percent = 11
    await m.onToolResult(result('read'))
    expect(w.steers).toHaveLength(1)
    expect(w.steers[0]).toContain('first warning')
    expect(w.steers[0]).toContain('30%')
    w.percent = 41
    expect((await m.onToolCall({ toolName: 'bash', input: { command: 'ls' } }))?.block).toBe(true)
  })

  test('an absent molt.json means the defaults, and a broken one means the defaults plus a stated problem', async () => {
    const absent = world()
    absent.w.percent = 11
    await absent.m.onToolResult(result('read'))
    expect(absent.w.steers).toEqual([])
    const bad = world({ files: { [`${HOME}/.omp/agent/molt.json`]: '{nope' } })
    await bad.m.onSessionStart()
    expect(bad.w.notes.join('\n')).toContain('not valid JSON')
    bad.w.percent = 41
    await bad.m.onToolResult(result('read'))
    expect(bad.w.steers).toHaveLength(1)
  })

  test('a ladder that breaks the ordering falls back to the defaults and says so', async () => {
    const { w, m } = world({ files: { [`${HOME}/.omp/agent/molt.json`]: JSON.stringify({ warnPercent: 80 }) } })
    await m.onSessionStart()
    expect(w.notes.join('\n')).toContain('break warn < warnAgain < command < block')
  })

  test('the stage file carries the Claude glue body, rewritten only when the stage changes', async () => {
    const { w, m } = world()
    w.percent = 10
    await m.onToolResult(result('read'))
    const body = JSON.parse(w.files.get(stagePath(HOME, 'S1')) ?? 'null')
    expect(body).toMatchObject({ stage: 'below', percent: 10, command: 65, block: 75, fallback: 80 })
    expect(typeof body.at).toBe('string')
    const first = w.files.get(stagePath(HOME, 'S1'))
    w.percent = 12
    await m.onToolResult(result('read'))
    expect(w.files.get(stagePath(HOME, 'S1'))).toBe(first)
    w.percent = 66
    await m.onToolResult(result('read'))
    expect(JSON.parse(w.files.get(stagePath(HOME, 'S1')) ?? 'null')).toMatchObject({ stage: 'command', percent: 66 })
  })

  test('the active marker is written at start and dropped by /molt off and at shutdown', async () => {
    const { w, m } = world()
    await m.onSessionStart()
    expect(w.files.has(activePath(HOME, 'S1'))).toBe(true)
    await m.onCommand('off')
    expect(w.files.has(activePath(HOME, 'S1'))).toBe(false)
    expect(JSON.parse(w.files.get(stagePath(HOME, 'S1')) ?? 'null').stage).toBe('off')
    await m.onCommand('on')
    expect(w.files.has(activePath(HOME, 'S1'))).toBe(true)
    await m.onSessionShutdown()
    expect(w.files.has(activePath(HOME, 'S1'))).toBe(false)
  })

  test('/molt now sends the instruction as an aside (it starts a turn on an idle session) whatever the fill, and /molt status reports', async () => {
    const { w, m } = world()
    w.percent = 5
    await m.onCommand('now')
    expect(w.steers).toEqual([])
    expect(w.asides).toHaveLength(1)
    expect(w.asides[0]).toContain('MOLT-HANDOFF: <absolute path')
    // Below the threshold the text says the operator asked, never "past molt's handoff threshold".
    expect(w.asides[0]).toContain('Context is at 5% of the window, and the operator asked for a handoff now.')
    expect(w.asides[0]).not.toContain('past molt')
    const s = await m.onCommand('status')
    expect(s).toContain('molt is on')
    expect(s).toContain('handoff 65%')
    expect(await m.onCommand('bogus')).toContain('usage: /molt')
  })

  test('a null reading (omp reports percent null early) changes nothing', async () => {
    const { w, m } = world()
    w.percent = undefined
    await m.onToolResult(result('read'))
    expect(await m.onToolCall({ toolName: 'bash', input: { command: 'ls' } })).toBeUndefined()
    expect(w.steers).toEqual([])
  })
})

describe('the omp-to-Claude tool shapes', () => {
  test('bash, write, edit, ast_edit, apply_patch and a skill read map; anything else keeps its omp name', () => {
    expect(claudeShape('bash', { command: 'ls' })).toEqual({ tool: 'Bash', args: { command: 'ls' } })
    expect(claudeShape('write', { path: 'a.md' })).toEqual({ tool: 'Write', args: { file_path: 'a.md' } })
    expect(claudeShapes('edit', { path: 'a', paths: ['a', 'b'] }).map(s => [s.tool, s.args.file_path])).toEqual([['Edit', 'a'], ['Edit', 'b']])
    expect(claudeShapes('edit', { path: 'a' }).map(s => s.args.file_path)).toEqual(['a'])
    expect(claudeShapes('edit', { edits: [{ path: 'x' }] }).map(s => s.args.file_path)).toEqual(['x'])
    expect(claudeShape('ast_edit', { paths: ['p.ts'] })).toEqual({ tool: 'Edit', args: { file_path: 'p.ts' } })
    expect(claudeShape('apply_patch', {}).tool).toBe('Edit')
    expect(claudeShape('read', { path: 'skill://handoff' })).toEqual({ tool: 'Skill', args: { skill: 'handoff' } })
    expect(claudeShape('read', { path: 'skill://ossify/handoff/refs/a.md' }).tool).toBe('Skill')
    expect(claudeShape('read', { path: 'a.ts' })).toEqual({ tool: 'read', args: { path: 'a.ts' } })
    expect(claudeShape('grep', { pattern: 'x' }).tool).toBe('grep')
    expect(claudeShape('Write', {}).tool).toBe('omp:Write')
    expect(claudeShape('bash', null).args).toEqual({ command: undefined })
  })

  test('edit variants that carry their targets in the input text: hashline headers and MV, apply_patch and sloppy headers', () => {
    const files = (tool: string, input: Record<string, unknown>) => claudeShapes(tool, input).map(s => s.args.file_path)
    // hashline: `[file]` and `¶file` section headers (a `#hhhh` tag and one pair of quotes are dropped), `MV <dest>`
    expect(files('edit', { input: '[/r/a.md]\n= 3|x\n[/r/b.ts#1a2b]\n= 1|y' })).toEqual(['/r/a.md', '/r/b.ts'])
    expect(files('edit', { input: '¶/r/a.md\n= 3|x\nMV /r/moved.md' })).toEqual(['/r/a.md', '/r/moved.md'])
    expect(files('edit', { _input: '["/r/q q.md"]\n= 1|x' })).toEqual(['/r/q q.md'])
    // apply_patch and its sloppy form: `*** Update|Add|Delete|Edit File:` and `*** Move to:`, case and spacing as omp reads them
    const patch = '*** Begin Patch\n*** Update File: /r/a.md\n@@\n-x\n+y\n*** Add File: /r/b.md\n+z\n*** Move to: /r/c.md\n*** End Patch'
    expect(files('apply_patch', { input: patch })).toEqual(['/r/a.md', '/r/b.md', '/r/c.md'])
    expect(files('edit', { input: '*** delete file:   /r/gone.md' })).toEqual(['/r/gone.md'])
    // the replace and patch variants carry `path` (and patch a `rename`); the headers are not read from anything else
    expect(files('edit', { path: '/r/a.md', rename: '/r/b.md', diff: '@@' })).toEqual(['/r/a.md', '/r/b.md'])
    expect(files('edit', { edits: [{ path: '/r/a.md', rename: '/r/n.md' }] })).toEqual(['/r/a.md', '/r/n.md'])
    // a path already named is listed once; text that is not a header is not a target
    expect(files('edit', { path: '/r/a.md', input: '[/r/a.md]\n= 1|[not a header] x\n+ [1, 2]' })).toEqual(['/r/a.md'])
    expect(files('write', { path: '/r/a.md', input: '[/r/b.md]' })).toEqual(['/r/a.md'])
  })

  test('a transcript becomes the Message shape handoff.ts reads, tool calls included', () => {
    const branch = [
      { type: 'message', message: { role: 'user', content: 'fix #7' } },
      { type: 'message', message: { role: 'assistant', content: [
        { type: 'text', text: 'on it' },
        { type: 'toolCall', id: 'write1', name: 'write', arguments: { path: '/r/a.md' } },
        { type: 'toolCall', id: 'commit1', name: 'bash', arguments: { command: 'git commit -m x' } },
      ] } },
      { type: 'message', message: { role: 'toolResult', toolCallId: 'write1', isError: false } },
      { type: 'message', message: { role: 'toolResult', toolCallId: 'commit1', isError: false } },
      { type: 'custom_message', content: 'ignored' },
    ]
    expect(messagesOf(branch)).toEqual([
      { role: 'user', text: 'fix #7', toolUses: [] },
      { role: 'assistant', text: 'on it', toolUses: [{ tool: 'Write', input: { file_path: '/r/a.md' } }, { tool: 'Bash', input: { command: 'git commit -m x' } }] },
    ])
  })
})

// The default export against fakes of omp's pi and ctx, with a real HOME under a temp dir.
describe('the omp wiring', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'molt-omp-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  function boot(opts: { mode?: string; percent?: number; kind?: string; env?: Record<string, string>; molt?: object } = {}) {
    const home = mkdtempSync(join(tmp, 'h-'))
    const saved: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries({ HOME: home, MOLT_HANDOFF: undefined, MOLT_STATUS_PATH: undefined, ...opts.env })) {
      saved[k] = process.env[k]
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    if (opts.molt) {
      mkdirSync(join(home, '.omp/agent'), { recursive: true })
      writeFileSync(join(home, '.omp/agent/molt.json'), JSON.stringify(opts.molt))
    }
    const handlers = new Map<string, (e: any, c: any) => any>()
    const commands = new Map<string, { handler: (args: string, c: any) => any }>()
    const sent: Array<{ kind: string; text: string; options?: any }> = []
    const order: string[] = []
    const pi = {
      on: (name: string, fn: any) => handlers.set(name, fn),
      registerCommand: (name: string, def: any) => commands.set(name, def),
      sendMessage: (text: string, options: any) => { sent.push({ kind: 'message', text, options }); order.push('message') },
      sendUserMessage: (text: string) => { sent.push({ kind: 'user', text }); order.push('user') },
    }
    const state = { id: 'W1', percent: opts.percent as number | undefined, branch: [] as unknown[], notices: [] as string[], statuses: [] as string[], newSessions: 0 }
    const ctxFor = (kind = opts.kind ?? 'main') => ({
      agent: { kind, id: 'x', name: kind },
      cwd: '/repo',
      mode: opts.mode ?? 'rpc',
      hasUI: false,
      getContextUsage: () => ({ tokens: 1, contextWindow: 100, percent: state.percent ?? null }),
      sessionManager: { getSessionId: () => state.id, getBranch: () => state.branch },
      ui: { notify: (t: string) => state.notices.push(t), setStatus: (_k: string, t: string) => state.statuses.push(t) },
      runEphemeralTurn: async () => ({ replyText: '## Next step\ngo' }),
      newSession: async () => {
        state.newSessions += 1
        order.push('newSession')
        state.id = `W${state.newSessions + 1}`
        await handlers.get('session_switch')?.({ reason: 'new' }, ctxFor())
        return { cancelled: false }
      },
    })
    ompExtension(pi)
    const restore = () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } }
    return { home, handlers, commands, sent, order, state, ctxFor, restore }
  }

  for (const event of ['session_tree', 'rewind']) {
    test(`round 3 ${event} resets branch A reminders, stop blocks, lastMd and staged previews`, async () => {
      const b = boot({ percent: 81 })
      try {
        const c = b.ctxFor()
        b.state.branch = unmarked
        const old = join(b.home, 'branch-a.md')
        writeFileSync(old, 'abandoned handoff')
        const tool = (name: string, input: object) => b.handlers.get('tool_result')!(result(name, input), c)
        await tool('write', { path: old })
        await tool('ast_edit', { paths: [old] })
        b.state.percent = 42
        await tool('read', {})
        b.state.percent = 81
        await tool('read', {})
        // A missing explicit marker spends both stop blocks even though lastMd exists.
        for (let i = 0; i < 2; i++) await b.handlers.get('session_stop')!({ last_assistant_message: 'MOLT-HANDOFF: /missing.md' }, c)
        if (event === 'rewind') await tool('rewind', { report: 'kept findings' })
        else await b.handlers.get(event)?.({ oldLeafId: 'A', newLeafId: 'B' }, c)
        expect(JSON.parse(readFileSync(stagePath(b.home, 'W1'), 'utf8')).stage).toBe('below')
        const before = b.sent.length
        b.state.percent = 42
        await tool('read', {})
        expect(b.sent.length).toBe(before + 1)
        b.state.percent = 81
        await tool('write', { path: 'xd://resolve' })
        expect(b.sent.length).toBe(before + 2)
        await b.commands.get('molt-arm')!.handler('', c)
        for (let i = 0; i < 2; i++) expect((await b.handlers.get('session_stop')!({}, c))?.decision).toBe('block')
        await b.handlers.get('session_stop')!({}, c)
        expect(b.state.newSessions).toBe(1)
        expect(b.sent.at(-1)?.text).toContain(fallbackPath(b.home, 'W1'))
        expect(b.sent.at(-1)?.text).not.toContain(old)
      } finally { b.restore() }
    })
  }

  test('checkpoint, failed rewind, child rewind and another session rewind preserve current fill state', async () => {
    const b = boot({ percent: 81 })
    try {
      const c = b.ctxFor()
      const tool = (name: string, isError = false, ctx = c) => b.handlers.get('tool_result')!({ ...result(name, {}), isError }, ctx)
      await tool('read')
      for (let i = 0; i < 2; i++) expect((await b.handlers.get('session_stop')!({}, c))?.decision).toBe('block')
      const before = b.sent.length
      await tool('checkpoint')
      await tool('rewind', true)
      await tool('rewind', false, b.ctxFor('task'))
      expect(b.sent.length).toBe(before)
      b.state.id = 'W2'
      await tool('rewind')
      b.state.id = 'W1'
      const afterOtherSession = b.sent.length
      await tool('read')
      expect(b.sent.length).toBe(afterOtherSession)
      expect(JSON.parse(readFileSync(stagePath(b.home, 'W1'), 'utf8')).stage).toBe('fallback')
      expect(await b.handlers.get('session_stop')!({}, c)).toBeUndefined()
    } finally { b.restore() }
  })

  test('successful rewind keeps a subsequent retained handoff available to the stop', async () => {
    const b = boot({ percent: 81 })
    try {
      const c = b.ctxFor()
      const handoff = join(b.home, 'kept.md')
      writeFileSync(handoff, '# kept findings')
      await b.commands.get('molt-arm')!.handler('', c)
      await b.handlers.get('tool_result')!(result('rewind', { report: 'kept findings' }), c)
      await b.handlers.get('tool_result')!(result('read', {}), c)
      await b.handlers.get('tool_result')!(result('write', { path: handoff }), c)
      b.state.branch = unmarked
      for (let i = 0; i < 3; i++) await b.handlers.get('session_stop')!({}, c)
      expect(b.state.newSessions).toBe(1)
      expect(b.sent.at(-1)?.text).toContain(handoff)
    } finally { b.restore() }
  })

  test('the default export is a function and imports under plain bun', () => {
    expect(typeof ompExtension).toBe('function')
    const path = join(import.meta.dir, '../../molt/omp/extension.ts')
    const r = Bun.spawnSync(['bun', '-e', `const m = await import(${JSON.stringify(path)}); process.exit(typeof m.default === 'function' ? 0 : 3)`], { stdout: 'pipe', stderr: 'pipe' })
    expect(r.stderr.toString()).toBe('')
    expect(r.exitCode).toBe(0)
  })

  test('a subagent or advisor call at 90% is not gated; the main session is', async () => {
    const b = boot({ percent: 90 })
    try {
      const call = { toolName: 'bash', input: { command: 'ls' } }
      expect(await b.handlers.get('tool_call')!(call, b.ctxFor('sub'))).toBeUndefined()
      expect((await b.handlers.get('tool_call')!(call, b.ctxFor('main')))?.block).toBe(true)
    } finally { b.restore() }
  })

  test('the first plain operator prompt arms the route; /molt-arm saves the ctx and re-sends the text', async () => {
    const b = boot()
    try {
      const input = b.handlers.get('input')!
      expect(await input({ text: 'hello', source: 'rpc' }, b.ctxFor())).toEqual({ text: '/molt-arm hello' })
      await b.commands.get('molt-arm')!.handler('hello', b.ctxFor())
      expect(b.sent).toEqual([{ kind: 'user', text: 'hello' }])
      expect(await input({ text: 'again', source: 'rpc' }, b.ctxFor())).toBeUndefined()
    } finally { b.restore() }
  })

  test('a molt through the real wiring: session_stop calls the saved ctx newSession, then sends the seed', async () => {
    const b = boot({ percent: 66 })
    try {
      const handoff = join(b.home, 'handoff.md')
      writeFileSync(handoff, '# h')
      await b.handlers.get('session_start')!({}, b.ctxFor())
      await b.handlers.get('input')!({ text: 'hello', source: 'rpc' }, b.ctxFor())
      await b.commands.get('molt-arm')!.handler('hello', b.ctxFor())
      b.state.branch = marked(handoff)
      expect(await b.handlers.get('session_stop')!({}, b.ctxFor())).toBeUndefined()
      expect(b.order).toEqual(['user', 'newSession', 'user'])
      expect(b.sent.at(-1)).toEqual({ kind: 'user', text: `${fill(DEFAULT_SEED, { path: handoff })}\n\n${JOBS_CANCELLED}` })
      expect(JSON.parse(readFileSync(lineagePath(b.home, 'W2'), 'utf8'))).toMatchObject({ from: 'W1', depth: 1, handoff })
      expect(existsSync(activePath(b.home, 'W1'))).toBe(false)
      expect(existsSync(activePath(b.home, 'W2'))).toBe(true)
    } finally { b.restore() }
  })

  test('#855 through the real wiring: agent_end with willContinue (a job pending) molts on the marker; /molt now asides', async () => {
    const b = boot({ percent: 41 })
    try {
      const handoff = join(b.home, 'handoff.md')
      writeFileSync(handoff, '# h')
      await b.handlers.get('session_start')!({}, b.ctxFor())
      await b.handlers.get('input')!({ text: 'hello', source: 'rpc' }, b.ctxFor())
      await b.commands.get('molt-arm')!.handler('hello', b.ctxFor())
      await b.commands.get('molt')!.handler('now', b.ctxFor())
      expect(b.sent.at(-1)).toMatchObject({ kind: 'message', options: { deliverAs: 'aside' } })
      b.state.branch = marked(handoff)
      const messages = b.state.branch.map(x => (x as { message: unknown }).message)
      await b.handlers.get('agent_end')!({ messages, willContinue: true }, b.ctxFor())
      expect(b.order.slice(-2)).toEqual(['newSession', 'user'])
      expect(b.sent.at(-1)).toEqual({ kind: 'user', text: `${fill(DEFAULT_SEED, { path: handoff })}\n\n${JOBS_CANCELLED}` })
    } finally { b.restore() }
  })

  test('print mode never arms, never clears, and logs the missing route', async () => {
    const b = boot({ percent: 66, mode: 'print' })
    try {
      const handoff = join(b.home, 'handoff.md')
      writeFileSync(handoff, '# h')
      b.state.branch = marked(handoff)
      await b.handlers.get('session_stop')!({}, b.ctxFor())
      expect(b.state.newSessions).toBe(0)
      expect(readFileSync(join(b.home, '.claude/state/molt/molt.log'), 'utf8')).toContain('no clear route in print mode')
    } finally { b.restore() }
  })

  test('a warning is steered with deliverAs steer; the molt.json under HOME applies', async () => {
    const b = boot({ percent: 12, molt: { warnPercent: 10, warnAgainPercent: 20, commandPercent: 30, blockPercent: 40 } })
    try {
      await b.handlers.get('tool_result')!({ toolName: 'read', input: {}, isError: false }, b.ctxFor())
      expect(b.sent).toHaveLength(1)
      expect(b.sent[0]?.options).toEqual({ deliverAs: 'steer' })
      expect(b.sent[0]?.text).toContain('first warning')
    } finally { b.restore() }
  })

  test('/molt reports through ctx.ui.notify', async () => {
    const b = boot({ percent: 12 })
    try {
      await b.commands.get('molt')!.handler('status', b.ctxFor())
      expect(b.state.notices.join('\n')).toContain('molt is on')
    } finally { b.restore() }
  })
})

describe('round 2 handoff targets and facts', () => {
  for (const toolName of ['edit', 'apply_patch']) {
    test(`${toolName} selects the last Markdown target`, async () => {
      const { w, m } = world({ files: { '/repo/README.md': '# readme', '/repo/handoff.md': '# handoff' } })
      w.percent = 70
      await m.onToolResult(result('read'))
      await m.onToolResult(result(toolName, { input: '*** Update File: /repo/README.md\n*** Add File: /repo/handoff.md' }))
      for (let i = 0; i < 3; i++) await m.onSessionStop()
      expect(w.seeds[0]).toContain('/repo/handoff.md')
      expect(w.seeds[0]).not.toContain('/repo/README.md')
    })
  }

  test('facts omit missing and error results, including unresolved previews and denied commits', () => {
    const call = (id: string, name: string, args: unknown) => ({ type: 'toolCall', id, name, arguments: args })
    const branch = [
      { type: 'message', message: { role: 'assistant', content: [
        call('denied', 'write', { path: '/repo/denied.md' }),
        call('commit', 'bash', { command: 'git commit -F msg' }),
        call('error', 'edit', { path: '/repo/error.md' }),
        call('ok', 'write', { path: '/repo/ok.md' }),
        call('preview', 'ast_edit', { path: '/repo/preview.md' }),
        call('resolve', 'write', { path: 'xd://resolve' }),
      ] } },
      ...['ok', 'error', 'resolve'].map(toolCallId => ({ type: 'message', message: { role: 'toolResult', toolCallId, isError: toolCallId === 'error' } })),
    ]
    const facts = extractFacts(messagesOf(branch))
    expect(facts.files).toEqual(['/repo/ok.md'])
    expect(facts.commits).toEqual([])
  })

  const spellings = [
    ['~/h.md', `${HOME}/h.md`], ['file:///tmp/h.md', '/tmp/h.md'],
    ['@/tmp/h.md', '/tmp/h.md'], [':/tmp/h.md', '/tmp/h.md'],
    ['[/tmp/h.md#AB12]', '/tmp/h.md'], ['/tmp/h.md#AB12', '/tmp/h.md'],
    ['["/tmp/h.md"#AB12]', '/tmp/h.md'], ['relative.md', '/repo/relative.md'],
    ['~', HOME],
  ]
  for (const [raw, path] of spellings) {
    for (const source of ['marker', 'write']) {
      if (source === 'write' && raw === '~') continue
      test(`${source} normalizes ${raw} before validating and seeding`, async () => {
        const { w, m } = world({ files: { [path!]: '# h' } })
        w.percent = 70
        await m.onToolResult(result('read'))
        if (source === 'marker') w.branch = marked(raw!)
        else await m.onToolResult(result('write', { path: raw }))
        for (let i = 0; i < (source === 'marker' ? 1 : 3); i++) await m.onSessionStop()
        expect(w.seeds[0]).toContain(`${fill(DEFAULT_SEED, { path: path! })}\n\n${JOBS_CANCELLED}`)
        expect(w.ephemerals).toHaveLength(0)
      })
    }
  }
  for (const raw of ['local://h.md', 'xd://h.md', 'https://example.com/h.md']) {
    for (const source of ['marker', 'write']) {
      test(`${source} rejects non-file URL ${raw}`, async () => {
        const { w, m } = world({ files: { [raw]: '# fake', [`/repo/${raw}`]: '# fake' } })
        w.percent = 70
        await m.onToolResult(result('read'))
        if (source === 'marker') w.branch = marked(raw)
        else await m.onToolResult(result('write', { path: raw }))
        for (let i = 0; i < 3; i++) await m.onSessionStop()
        expect(w.seeds[0]).toContain(fallbackPath(HOME, 'S1'))
        expect(w.ephemerals).toHaveLength(1)
      })
    }
  }
})

// Round 3: cancellation belongs to the stop, not molt's brief deadline.
describe('round 3 stop cancellation', () => {
  for (const child of [false, true]) {
    for (const when of ['before', 'during', 'after'] as const) {
      test(`cancel ${when} brief (${child ? 'child' : 'root'}): no fallback or handoff`, async () => {
        const { w, io, m } = world({ env: child ? { MOLT_HANDOFF: 'parent', MOLT_STATUS_PATH: '/s/status' } : {} })
        w.percent = 81
        w.branch = unmarked
        await m.onSessionStop()
        await m.onSessionStop()
        const controller = new AbortController()
        if (when === 'before') controller.abort()
        io.ephemeral = async () => {
          w.ephemerals.push('brief')
          if (when === 'during') { controller.abort(); throw new Error('cancelled') }
          controller.abort()
          return '## Next step\ngo'
        }
        expect(await m.onSessionStop({ signal: controller.signal })).toBeUndefined()
        expect(w.files.has(fallbackPath(HOME, 'S1'))).toBe(false)
        expect(w.seeds).toEqual([])
        expect(w.files.get('/s/status') ?? '').not.toContain('handed-off')
        if (when === 'before') expect(w.ephemerals).toEqual([])
      })
    }
  }
  test('cancellation releases a brief even when the host ignores its signal', async () => {
    const { w, m } = world({ hang: true, briefMs: 1000 })
    w.percent = 81
    w.branch = unmarked
    await m.onSessionStop()
    await m.onSessionStop()
    const controller = new AbortController()
    const stopped = m.onSessionStop({ signal: controller.signal })
    setTimeout(() => controller.abort(), 5)
    const outcome = await Promise.race([stopped.then(() => 'returned'), new Promise(resolve => setTimeout(() => resolve('stuck'), 100))])
    expect(outcome).toBe('returned')
    expect(w.files.has(fallbackPath(HOME, 'S1'))).toBe(false)
    expect(w.seeds).toEqual([])
  })
})

// #855: omp defers session_stop while a background job is pending, and skips it for a todo continuation. It reports
// both as agent_end with willContinue. molt reads the marker there too; a clear cancels the jobs anyway.
describe('a marker at a deferred settle (agent_end, willContinue)', () => {
  const end = (branch: unknown[], willContinue?: boolean) => ({ messages: messagesOfBranch(branch), willContinue })
  const messagesOfBranch = (branch: unknown[]) => branch.map(x => (x as { message: unknown }).message)

  test('a warned session whose reply ends with a readable marker molts at once, and only once', async () => {
    const { w, m } = world({ files: { '/h/handoff.md': '# h' } })
    w.percent = 41
    w.branch = marked('/h/handoff.md')
    w.onClear = async () => { w.id = 'S2'; await m.onSessionSwitch('new') }
    await m.onAgentEnd(end(w.branch, true))
    expect(w.seeds).toHaveLength(1)
    expect(w.seeds[0]).toContain('/h/handoff.md')
    expect(w.logs.some(l => l.includes('source=marker'))).toBe(true)
    await m.onAgentEnd(end(w.branch, true))
    expect(w.seeds).toHaveLength(1)
  })

  test('a terminal settle is left to session_stop', async () => {
    const { w, m } = world({ files: { '/h/handoff.md': '# h' } })
    w.percent = 41
    w.branch = marked('/h/handoff.md')
    await m.onAgentEnd(end(w.branch, false))
    await m.onAgentEnd(end(w.branch))
    expect(w.seeds).toEqual([])
  })

  test('below the first warning a marker is not a molt', async () => {
    const { w, m } = world({ files: { '/h/handoff.md': '# h' } })
    w.percent = 30
    w.branch = marked('/h/handoff.md')
    await m.onAgentEnd(end(w.branch, true))
    expect(w.seeds).toEqual([])
  })

  test('no marker, or a marker naming a missing file, does nothing here: no block, no fallback', async () => {
    const { w, m } = world()
    w.percent = 81
    w.branch = unmarked
    await m.onAgentEnd(end(w.branch, true))
    w.branch = marked('/h/gone.md')
    await m.onAgentEnd(end(w.branch, true))
    expect(w.seeds).toEqual([])
    expect(w.ephemerals).toEqual([])
  })

  test('the OMP seed says the clear cancelled every background job', async () => {
    const { w, m } = world({ files: { '/h/handoff.md': '# h' } })
    w.percent = 66
    w.branch = marked('/h/handoff.md')
    expect(await m.onSessionStop()).toBeUndefined()
    expect(w.seeds[0]).toContain('omp cancelled every background job this session had running when it cleared')
  })
})
