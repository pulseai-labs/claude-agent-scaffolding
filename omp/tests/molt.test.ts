import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ompExtension, { claudeShape, claudeShapes, createMolt, messagesOf } from '../../molt/omp/extension'
import type { ClearResult, MoltIO } from '../../molt/omp/extension'
import { activePath, fallbackPath, lineagePath, stagePath } from '../../molt/hooks/records'
import { DEFAULT_SEED, fill } from '../../molt/hooks/templates'

const HOME = '/home/u'
const msg = (role: 'user' | 'assistant', text: string) => ({ type: 'message', message: { role, content: [{ type: 'text', text }] } })

// A fake MoltIO: scripted percent, an in-memory file system, and a record of every side effect.
function world(over: { env?: Record<string, string>; files?: Record<string, string> } = {}) {
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
    warnNext: t => { w.warnNexts.push(t) },
    status: () => {},
    notify: t => { w.notes.push(t) },
    bell: async (_c, m) => { w.bells.push(m) },
    ephemeral: async p => { w.ephemerals.push(p); return w.ephemeralReply },
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
  return { w, m: createMolt(io) }
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
    expect(w.seeds).toEqual([fill(DEFAULT_SEED, { path })])
  })

  test('at the fallback stage the molt supersedes the block, and an unusable brief still yields the facts file', async () => {
    const { w, m } = world()
    w.branch = unmarked
    w.percent = 81
    w.ephemeralReply = 'no sections here'
    expect(await m.onSessionStop()).toBeUndefined()
    expect(w.files.get(fallbackPath(HOME, 'S1'))).toContain('## Last request')
    expect(w.files.get(fallbackPath(HOME, 'S1'))).not.toContain('no sections here')
    expect(w.seeds).toHaveLength(1)
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

  test('/molt now steers the instruction whatever the fill, and /molt status reports', async () => {
    const { w, m } = world()
    w.percent = 5
    await m.onCommand('now')
    expect(w.steers[0]).toContain('MOLT-HANDOFF: <absolute path')
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

  test('a transcript becomes the Message shape handoff.ts reads, tool calls included', () => {
    const branch = [
      { type: 'message', message: { role: 'user', content: 'fix #7' } },
      { type: 'message', message: { role: 'assistant', content: [
        { type: 'text', text: 'on it' },
        { type: 'toolCall', name: 'write', arguments: { path: '/r/a.md' } },
        { type: 'toolCall', name: 'bash', arguments: { command: 'git commit -m x' } },
      ] } },
      { type: 'message', message: { role: 'toolResult', content: [{ type: 'text', text: 'ok' }] } },
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
      expect(b.sent.at(-1)).toEqual({ kind: 'user', text: fill(DEFAULT_SEED, { path: handoff }) })
      expect(JSON.parse(readFileSync(lineagePath(b.home, 'W2'), 'utf8'))).toMatchObject({ from: 'W1', depth: 1, handoff })
      expect(existsSync(activePath(b.home, 'W1'))).toBe(false)
      expect(existsSync(activePath(b.home, 'W2'))).toBe(true)
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
