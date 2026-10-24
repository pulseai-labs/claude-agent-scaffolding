import { describe, test, expect } from 'claude-code/testing'
import { world } from './world'

const at = (w: ReturnType<typeof world>, percent: number) => { w.usage = { tokens: percent * 10_000, window: 1_000_000 } }
const TURN = (answer: string) => ({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' }) as never
const POST = { tool_name: 'Read', tool_input: {}, tool_response: {}, tool_use_id: 't1', session_id: 's1' } as never
const STOP = { stop_hook_active: false, last_assistant_message: 'done', session_id: 's1' } as never
const CLEAR = (id: string) => ({ source: 'clear', session_id: id }) as never
const PROMPT = (kind = 'sdk') => ({ text: 'go on', wait: false, origin: { kind } }) as never
const RUN = (args: string) =>
  ({ command: 'molt', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as never
const H = '/repo/docs/handoff.md'
const T3 = { CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' }
// The record's own path, written out: the tests pin the file the seed writes and the guard reads.
const SUCC = (id: string) => `/home/u/.claude/state/molt/successor/${id}.json`
const RECORD = JSON.stringify({ successor: 's2', handoff: H, at: '2026-10-23T16:13:01.567Z' })

describe('a root under an Agent SDK host (#901)', () => {
  test('a handoff does not clear; the agent is told to send the operator to a new thread', async ($, on) => {
    const w = world(on, { env: T3, files: { [H]: '#' } })
    w.clearTo.push('s2')
    at(w, 67)
    expect((await $.classic.PostToolUse(POST)).additionalContext?.join('\n')).toContain('start a new thread')
    await $.turn.complete(TURN(`done\nMOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(0)
    expect(w.session.id).toBe('s1')
    expect(w.runs.some(r => r.join(' ').includes('handed off to operator session=s1'))).toBe(true)
    await $.prompt.submit(PROMPT())
    expect(w.contexts.join('\n')).toContain(`resume it from ${H}`)
  })
  test('after the handoff molt stops pushing; the block stays', async ($, on) => {
    const w = world(on, { env: T3, files: { [H]: '#' } })
    at(w, 67); await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect((await $.classic.Stop(STOP)).block).toBeUndefined()
    expect((await $.classic.PostToolUse(POST)).additionalContext).toBeUndefined()
    at(w, 76)
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeDefined()
  })
  test('a warning names the new-thread step', async ($, on) => {
    const w = world(on, { env: T3 })
    at(w, 42)
    expect((await $.classic.PostToolUse(POST)).additionalContext?.join('\n')).toContain('start a new thread')
  })
  // Adjacent controls: the check accepts sdk-ts and sdk-py only.
  for (const entry of ['cli', 'sdk-cli']) {
    test(`CLAUDE_CODE_ENTRYPOINT=${entry} still clears in place`, async ($, on) => {
      const w = world(on, { env: { CLAUDE_CODE_ENTRYPOINT: entry }, files: { [H]: '#' } })
      w.clearTo.push('s2')
      at(w, 67)
      expect((await $.classic.PostToolUse(POST)).additionalContext?.join('\n')).not.toContain('start a new thread')
      await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
      expect(w.clears).toBe(1)
    })
  }
  test('sdk-py is an SDK host too', async ($, on) => {
    const w = world(on, { env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-py' }, files: { [H]: '#' } })
    at(w, 67); await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(0)
  })
  test('a child under an SDK host is still a child', async ($, on) => {
    const S = '/run/status'
    const w = world(on, { env: { ...T3, MOLT_HANDOFF: 'parent', MOLT_STATUS_PATH: S }, files: { [H]: '#' } })
    at(w, 67); await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.files.get(S)).toContain(`handed-off ${H}`)
  })
})

describe('the stale-resume guard (#901)', () => {
  test('a seed records the successor under the session that molted', async ($, on) => {
    const w = world(on, { files: { [H]: '#' } })
    w.clearTo.push('s2')
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    await $.classic.SessionStart(CLEAR('s2'))
    const r = JSON.parse(w.files.get(SUCC('s1')) ?? '{}')
    expect(r.successor).toBe('s2')
    expect(r.handoff).toBe(H)
    expect(w.files.has(SUCC('s2'))).toBe(false)
  })
  test('a resumed molted session is told it is stale, at every prompt', async ($, on) => {
    const w = world(on, { files: { [SUCC('s1')]: RECORD } })
    await $.prompt.submit(PROMPT())
    await $.prompt.submit(PROMPT('composer'))
    const told = w.contexts.filter(c => c.includes('STALE SESSION') && c.includes('molted into s2'))
    expect(told).toHaveLength(2)
  })
  test('a stale session runs reads only, even with molt off', async ($, on) => {
    const w = world(on, { files: { [SUCC('s1')]: RECORD } })
    await $.command.run(RUN('off'))
    expect((await $.tool.call({ tool: 'Bash', command: 'git push' } as never)).deny).toContain('STALE SESSION')
    expect((await $.tool.call({ tool: 'Write', file_path: '/r/a.md', content: 'x' } as never)).deny).toContain('STALE SESSION')
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Grep', pattern: 'x' } as never)).deny).toBeUndefined()
  })
  test('/molt on lifts the guard and removes the record', async ($, on) => {
    const w = world(on, { files: { [SUCC('s1')]: RECORD } })
    await $.command.run(RUN('on'))
    expect(w.files.has(SUCC('s1'))).toBe(false)
    expect((await $.tool.call({ tool: 'Bash', command: 'ls' } as never)).deny).toBeUndefined()
    await $.prompt.submit(PROMPT())
    expect(w.contexts.join('\n')).not.toContain('STALE SESSION')
  })
  // Adjacent controls: no record, or a record that does not parse, guards nothing.
  test('a session with no record is not stale', async ($, on) => {
    const w = world(on, { files: { [SUCC('s9')]: RECORD } })
    expect((await $.tool.call({ tool: 'Bash', command: 'ls' } as never)).deny).toBeUndefined()
    await $.prompt.submit(PROMPT())
    expect(w.contexts.join('\n')).not.toContain('STALE SESSION')
  })
  test('a record that does not parse guards nothing', async ($, on) => {
    const w = world(on, { files: { [SUCC('s1')]: '{"successor":"s2"}' } })
    expect((await $.tool.call({ tool: 'Bash', command: 'ls' } as never)).deny).toBeUndefined()
    await $.prompt.submit(PROMPT())
    expect(w.contexts.join('\n')).not.toContain('STALE SESSION')
  })
  test('a stale session start toasts and logs', async ($, on) => {
    const w = world(on, { files: { [SUCC('s1')]: RECORD } })
    await $.session.start({ cwd: '/repo' } as never)
    expect(w.toasts.some(t => t.includes('STALE SESSION'))).toBe(true)
    expect(w.runs.some(r => r.join(' ').includes('stale session started session=s1 successor=s2'))).toBe(true)
  })
})
