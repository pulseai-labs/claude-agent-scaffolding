// molt on OMP, the logic: the ladder of hooks/register.tsx over MoltIO, with no omp import and no side effect
// of its own (extension.ts wires it to omp). Every rule, threshold and text comes from ../hooks.
import { DEFAULTS, parseConfig } from '../hooks/config'
import type { MoltConfig } from '../hooks/config'
import { atLeast, stageOf, thresholdsFor } from '../hooks/measure'
import type { Stage, Thresholds } from '../hooks/measure'
import { gateAllows, isProgress } from '../hooks/gate'
import { briefPrompt, extractFacts, factsBrief, isUsableSummary, markerPath, pickHandoff, resolvePath } from '../hooks/handoff'
import type { Handoff, Message } from '../hooks/handoff'
import { activePath, autonomicPath, fallbackPath, lineagePath, logPath, parseAutonomic, parseLineage, safeSessionId, stagePath } from '../hooks/records'
import type { Lineage } from '../hooks/records'
import { BLOCK_NOTE, CHILD_NOTE, CHILD_WARNING, DEFAULT_INSTRUCTIONS, DEFAULT_SEED, DEFAULT_WARNING, OLD_DEFAULT_INSTRUCTIONS, ROOT_NOTE, expandHome, fill } from '../hooks/templates'

export type Shape = { tool: string; args: Record<string, unknown> }

// omp 18.8.9's built-in tools (the binary's BUILTIN_TOOLS registry plus think, yield, goal, the edit tool's
// `apply_patch` wire name, and the tools registered outside it), each decided once:
//   write, edit, apply_patch, ast_edit   -> Write / Edit: the handoff's own file tools; progress and lastMd count them
//   bash                                 -> Bash {command}: only git add / git commit segments pass the gate
//   read of skill://<name>[/file]        -> Skill: the handoff instruction names a handoff skill
//   everything else keeps its omp name and falls to gateAllows' default, refused past `block`:
//     read (any other target), grep, glob, find, ast_grep, web_search, fetch, ls, lsp, debug, ida, eval, js,
//     python, notebook, github, browser, puppeteer, computer, ask, task, wait, todo, think, yield, goal, advise,
//     security_scan, checkpoint, rewind, context_notes, new_context, memory_edit, retain, recall, reflect, learn,
//     manage_skill, generate_image, tts, vibe_*, mcp__* tools and extension tools.
// notebook, lsp (rename and code actions), manage_skill and memory_edit write too; they are refused, not mapped,
// because a handoff does not need them and an unknown writer must fail closed.
const WRITE_TOOLS = new Set(['write', 'edit', 'apply_patch', 'ast_edit'])
// Claude names a gate decision turns on. An omp tool that happens to carry one must not inherit it.
const CLAUDE_NAMES = new Set(['Write', 'Edit', 'Skill', 'Bash', 'NotebookEdit'])
const SKILL_URL = /^skill:\/\/([^/\s]+)((?:\/[^\s]*)?)$/i

const stringsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [])

function writePaths(input: Record<string, unknown>): string[] {
  const found = new Set<string>(stringsOf(input.paths))
  for (const v of [input.path, input.file_path]) if (typeof v === 'string' && v !== '') found.add(v)
  if (Array.isArray(input.edits))
    for (const e of input.edits) if (e !== null && typeof e === 'object') for (const p of stringsOf([(e as Record<string, unknown>).path])) found.add(p)
  return [...found]
}

// Every Claude-shaped call one omp call stands for: a write-class call is one Write or Edit per target path.
export function claudeShapes(toolName: string, input: unknown): Shape[] {
  const args = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  if (toolName === 'bash') return [{ tool: 'Bash', args: { command: args.command } }]
  if (WRITE_TOOLS.has(toolName)) {
    const tool = toolName === 'write' ? 'Write' : 'Edit'
    const paths = writePaths(args)
    return paths.length === 0 ? [{ tool, args: {} }] : paths.map(file_path => ({ tool, args: { file_path } }))
  }
  if (toolName === 'read' && typeof args.path === 'string') {
    const m = SKILL_URL.exec(args.path.trim())
    // A `..` segment climbs out of the skill's folder: that is a read, not a skill.
    if (m !== null && !/(?:^|\/)\.\.(?:\/|$)/.test(m[2] ?? '')) return [{ tool: 'Skill', args: { skill: m[1] } }]
  }
  return [{ tool: CLAUDE_NAMES.has(toolName) ? `omp:${toolName}` : toolName, args }]
}

export function claudeShape(toolName: string, input: unknown): Shape {
  return claudeShapes(toolName, input)[0] as Shape
}

// The fallback brief runs inside session_stop, whose handlers get 30 s in omp 18.8.9 (a longer one is dropped while the
// molt goes on detached). The brief has its own deadline inside that, whether or not the host honours the abort signal.
export const FALLBACK_BRIEF_MS = 25_000

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no brief within ${ms} ms`)), ms)
    p.then(v => { clearTimeout(timer); resolve(v) }, e => { clearTimeout(timer); reject(e) })
  })
}

export type ClearResult = 'cleared' | 'cancelled' | 'no-route' | 'seed-rejected'

// Every side effect, so a test drives the ladder with fakes.
export type MoltIO = {
  usage(): number | undefined                          // ctx.getContextUsage().percent, the real window
  sessionId(): string
  isChild: boolean                                     // MOLT_HANDOFF=parent
  env: Readonly<Record<string, string | undefined>>
  cwd: string
  readText(path: string): Promise<string | undefined>
  exists(path: string): Promise<boolean>
  writeText(path: string, text: string): Promise<void> // creates the folder
  remove(path: string): Promise<void>
  appendLog(line: string): Promise<void>
  steer(text: string): void                            // pi.sendMessage(text, { deliverAs: 'steer' })
  warnNext(text: string): void                         // pi.sendMessage(text, { deliverAs: 'nextTurn' })
  status(text: string): void
  notify(text: string, tone: 'info' | 'warn'): void
  bell(command: string, message: string): Promise<void>
  ephemeral(prompt: string): Promise<string | undefined>
  route(): boolean                                     // a command ctx is saved, so newSession() is reachable
  printMode(): boolean
  newSessionAndSeed(seed: string): Promise<ClearResult>
  branch(): readonly unknown[]
}

type Pending = { oldSession: string; handoff: string; chain: string; depth: number }
const MAX_STOP_BLOCKS = 2
const USAGE = 'usage: /molt now | off | on | status'
const CONFIG_PATH = '.omp/agent/molt.json'

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('\n')
}

// getBranch() entries -> the Message shape handoff.ts reads. Tool calls are `toolCall` blocks (name, arguments).
export function messagesOf(branch: readonly unknown[]): Message[] {
  const out: Message[] = []
  for (const entry of branch as Array<{ type?: string; message?: { role?: string; content?: unknown } }>) {
    const m = entry?.type === 'message' ? entry.message : undefined
    if (m?.role === 'user') out.push({ role: 'user', text: textOf(m.content), toolUses: [] })
    else if (m?.role === 'assistant') {
      const calls = Array.isArray(m.content) ? m.content.filter(b => b?.type === 'toolCall') : []
      out.push({
        role: 'assistant',
        text: textOf(m.content),
        toolUses: calls.flatMap(b => claudeShapes(String(b.name), b.arguments).map(s => ({ tool: s.tool, input: s.args }))),
      })
    }
  }
  return out
}

// The reply the session stopped on: the event's own field, else the last assistant message of the branch.
function answerOf(e: { last_assistant_message?: unknown }, branch: readonly unknown[]): string {
  const m = e.last_assistant_message
  if (typeof m === 'string') return m
  if (m !== null && typeof m === 'object') return textOf((m as { content?: unknown }).content)
  return [...messagesOf(branch)].reverse().find(x => x.role === 'assistant')?.text ?? ''
}

export function createMolt(io: MoltIO, briefMs: number = FALLBACK_BRIEF_MS) {
  let cfg: MoltConfig = DEFAULTS
  let stage: Stage = 'below'
  let lastPercent: number | undefined
  const off = new Set<string>()
  let paused: string | undefined
  let seeded: { session: string; startPercent?: number } | undefined
  let inFlight = false                      // a molt between newSession() and its seed
  let progress = 0                          // Write, Edit or commit since the last molt
  const nudged = new Set<string>()
  const stopBlocks = new Map<string, number>()
  const lastMd = new Map<string, string>()
  const forced = new Set<string>()          // /molt now: the command stage whatever the fill
  let unattended = 0                        // molts since the operator last sent a prompt
  let pending: Pending | undefined
  const warned = new Map<string, number>()
  const handedOff = new Set<string>()
  const commandNoted = new Set<string>()
  const unroutable = new Set<string>()      // sessions whose molt found no way to clear
  const published = new Map<string, string>()
  let statusFailed = false
  let stageFailed = false
  let ready: Promise<void> | undefined

  const home = () => io.env.HOME ?? ''
  const log = async (line: string) => { try { await io.appendLog(`${new Date().toISOString()} ${line}`) } catch {} }
  const isReadable = async (path: string) => (await io.readText(path)) !== undefined
  const notify = (text: string, tone: 'info' | 'warn') => { try { io.notify(text, tone) } catch {} }

  // ~/.omp/agent/molt.json holds molt's userConfig keys; absent is DEFAULTS, unreadable is DEFAULTS plus a problem.
  const load = (): Promise<void> => (ready ??= (async () => {
    const text = await io.readText(`${home()}/${CONFIG_PATH}`)
    if (text === undefined) return
    try { cfg = parseConfig(JSON.parse(text) as Record<string, unknown>) } catch (err) {
      cfg = { ...DEFAULTS, problems: [`${CONFIG_PATH} is not valid JSON (${String(err)}); using the defaults`] }
    }
  })())

  async function template(path: string, fallback: string): Promise<string> {
    const text = (await io.readText(expandHome(path, home())))?.trim()
    // 0.1.0 wrote its own default instructions to disk; that exact text is not an operator's edit.
    if (!text || (fallback === DEFAULT_INSTRUCTIONS && text === OLD_DEFAULT_INSTRUCTIONS.trim())) return fallback
    return text
  }

  const thresholds = (id: string): Thresholds => thresholdsFor(cfg, seeded?.session === id ? seeded.startPercent : undefined)

  async function touchActive(id: string) {
    if (!safeSessionId(id) || off.has(id) || paused === id) return
    try { await io.writeText(activePath(home(), id), `${new Date().toISOString()}\n`) } catch {}
  }
  async function dropActive(id: string) {
    if (!safeSessionId(id)) return
    try { await io.remove(activePath(home(), id)) } catch {}
  }

  // The stage file: molt's stage and effective thresholds, for autonomic's turn-end floor (same body as the Claude glue).
  async function publishStage(id: string) {
    if (!safeSessionId(id)) return
    const t = thresholds(id)
    const s = off.has(id) ? 'off' : stage
    // A seeded session's ladder is unknown until a measurement reads its start: no thresholds yet (PR #681).
    const known = !(seeded?.session === id && seeded.startPercent === undefined)
    const key = known ? `${s} ${t.command} ${t.block} ${t.fallback}` : `${s} unknown`
    if (published.get(id) === key) return
    try {
      const ladder = known ? { command: t.command, block: t.block, fallback: t.fallback } : {}
      const body = { stage: s, ...(lastPercent === undefined ? {} : { percent: lastPercent }), ...ladder, at: new Date().toISOString() }
      await io.writeText(stagePath(home(), id), `${JSON.stringify(body)}\n`)
      published.set(id, key)
    } catch (err) {
      if (stageFailed) return
      stageFailed = true
      await log(`stage write failed session=${id} ${String(err)}`)
    }
  }

  async function measure(id: string): Promise<number | undefined> {
    const percent = io.usage()
    if (percent !== undefined) {
      // The first reading of a seeded session is its start fill; the ladder sits above it.
      if (seeded?.session === id && seeded.startPercent === undefined) seeded.startPercent = percent
      lastPercent = percent
      stage = stageOf(percent, thresholds(id))
    }
    if (forced.has(id) && !atLeast(stage, 'command')) stage = 'command'
    await publishStage(id)
    return percent
  }

  function showStatus(id: string) {
    try {
      if (off.has(id)) return io.status('molt: off')
      if (paused === id) return io.status('molt: paused')
      io.status(lastPercent === undefined ? 'molt' : `molt ${Math.round(lastPercent)}%/${Math.round(thresholds(id).command)}%`)
    } catch {}
  }

  async function instruction(id: string): Promise<string> {
    const t = thresholds(id)
    const values = {
      percent: Math.round(lastPercent ?? t.command), command: Math.round(t.command), block: Math.round(t.block),
      soft: Math.round(t.command), hard: Math.round(t.block),   // 0.1.0 template names
    }
    const text = `${fill(await template(cfg.instructionsTemplate, DEFAULT_INSTRUCTIONS), values)}\n\n${io.isChild ? CHILD_NOTE : ROOT_NOTE}`
    return atLeast(stage, 'block') ? `${text}\n\n${fill(BLOCK_NOTE, values)}` : text
  }

  // The warning this session is owed at its current stage, if any. Past the command the command text stands in.
  function dueWarning(id: string): 1 | 2 | undefined {
    if (atLeast(stage, 'command') || !atLeast(stage, 'warn')) return undefined
    const done = warned.get(id) ?? 0
    if (stage === 'warnAgain') return done < 2 ? 2 : undefined
    return done < 1 ? 1 : undefined
  }

  async function warningText(id: string, which: 1 | 2): Promise<string> {
    const t = thresholds(id)
    const values = { percent: Math.round(lastPercent ?? t.warn), stage: which === 1 ? 'first' : 'second', command: Math.round(t.command) }
    const text = fill(await template(cfg.warningTemplate, DEFAULT_WARNING), values)
    return io.isChild ? `${text}\n\n${CHILD_WARNING}` : text
  }

  // A child's events, one line each, appended for its parent to read. Never for a root; never stops a warning.
  async function appendStatus(event: string) {
    if (!io.isChild) return
    const path = (io.env.MOLT_STATUS_PATH ?? '').trim()
    if (path === '') return
    try {
      // A file that exists but cannot be read is left alone: rewriting it would drop the parent's earlier lines.
      const old = await io.readText(path)
      if (old === undefined && await io.exists(path)) throw new Error('exists but cannot be read')
      await io.writeText(path, `${old ?? ''}${new Date().toISOString()} ${event}\n`)
    } catch (err) {
      if (statusFailed) return
      statusFailed = true
      await log(`status write failed ${path} ${String(err)}`)
    }
  }

  async function noteCommand(id: string) {
    if (commandNoted.has(id)) return
    commandNoted.add(id)
    await appendStatus('handoff required')
  }

  const warnedAt = (id: string, which: 1 | 2) => Math.round(which === 1 ? thresholds(id).warn : thresholds(id).warnAgain)

  async function pause(id: string, text: string, bell: string | undefined) {
    paused = id
    await dropActive(id)
    notify(text, 'warn')
    showStatus(id)
    if (bell !== undefined) void io.bell(bell, text).catch(err => log(`bell failed ${String(err)}`))
    await log(`pause session=${id} ${text}`)
  }

  // A child is never cleared: its parent replaces it.
  async function handOff(id: string, handoff: Handoff) {
    handedOff.add(id)
    await appendStatus(`handed-off ${handoff.path}`)
    notify(`molt: handed off to the parent — ${handoff.path}`, 'info')
    await log(`handed off session=${id} handoff=${handoff.path} source=${handoff.source} percent=${lastPercent}`)
  }

  async function fallbackBrief(id: string): Promise<string> {
    const messages = messagesOf(io.branch())
    const facts = extractFacts(messages)
    let summary: string | undefined
    try {
      const reply = await within(io.ephemeral(briefPrompt(messages, facts)), briefMs)
      if (reply !== undefined && isUsableSummary(reply)) summary = reply
      else await log(`ephemeral brief unusable session=${id} reason=${reply === undefined ? 'no reply' : 'no Next step section'}`)
    } catch (err) {
      await log(`ephemeral brief error session=${id} ${String(err)}`)
    }
    const path = fallbackPath(home(), id)
    await io.writeText(path, factsBrief(facts, { sessionId: id, percent: lastPercent, summary }))
    return path
  }

  async function molt(id: string, handoff: Handoff) {
    const record = parseAutonomic(await io.readText(autonomicPath(home(), id)))
    const own = parseLineage(await io.readText(lineagePath(home(), id)))
    if (record.mode === 'manual' && unattended >= cfg.manualMaxMolts)
      return pause(id, `molt paused: ${unattended} molts in a row with no message from you. Send a message to resume; the handoff is at ${handoff.path}.`, undefined)
    // /molt now is the operator asking for this molt: it is not a loop, whatever the progress.
    if (record.mode === 'autopilot' && own !== undefined && progress === 0 && !forced.has(id))
      return pause(id, `molt paused: no progress since the last molt (no Write, Edit or commit). Autopilot stops here; the handoff is at ${handoff.path}.`, record.bell)
    if (!io.route()) {
      unroutable.add(id)
      await log(io.printMode() ? 'no clear route in print mode' : 'no clear route: no command context is armed yet')
      return notify(`molt: this session cannot be cleared here; it keeps going, gated. The handoff is at ${handoff.path}.`, 'warn')
    }
    inFlight = true
    const p: Pending = { oldSession: id, handoff: handoff.path, chain: own?.chain ?? id, depth: (own?.depth ?? 0) + 1 }
    pending = p
    notify(`molt: handing off at ${Math.round(lastPercent ?? 0)}% — ${handoff.path}`, 'info')
    await log(`molt session=${id} handoff=${handoff.path} source=${handoff.source} percent=${lastPercent}`)
    let result: ClearResult | undefined
    try {
      const seed = await template(cfg.seedTemplate, DEFAULT_SEED)
      // session_switch fires inside this call and consumes `pending`.
      result = await io.newSessionAndSeed(fill(seed, { path: handoff.path }))
    } catch (err) {
      await log(`clear rejected session=${id} ${String(err)}`)
    }
    if (pending === p) {
      pending = undefined
      inFlight = false
      notify(`molt: the session was not cleared (${result ?? 'rejected'}); it keeps going. The handoff is at ${handoff.path}.`, 'warn')
      await log(`clear did not clear session=${id} result=${result}`)
    } else if (result === 'seed-rejected') {
      notify(`molt: the seed was rejected. Resume by hand from ${handoff.path}.`, 'warn')
      await log(`seed rejected session=${io.sessionId()}`)
    }
  }

  // The window is new: module state survives, the fill it measured does not (a compact keeps the id too).
  function resetFill(id: string) {
    stage = 'below'
    lastPercent = undefined
    for (const set of [nudged, commandNoted]) set.delete(id)
    for (const map of [warned, stopBlocks, lastMd, published]) map.delete(id)
  }

  async function onSessionStart() {
    await load()
    try {
      const id = io.sessionId()
      await touchActive(id)
      showStatus(id)
      if (cfg.problems.length) notify(`molt: ${cfg.problems.join('; ')}`, 'warn')
    } catch (err) {
      await log(`session_start error ${String(err)}`)
    }
  }

  async function onSessionSwitch(reason: string) {
    await load()
    const id = io.sessionId()
    const p = reason === 'new' ? pending : undefined
    if (p !== undefined) pending = undefined
    resetFill(id)
    unroutable.delete(id)
    if (p === undefined) {
      try { await publishStage(id) } catch {}
    } else {
      // The seed is already on its way (newSessionAndSeed); this is the rest of a seeded start.
      unattended += 1
      progress = 0
      forced.delete(p.oldSession)
      seeded = { session: id }
      notify(`molt: resumed from ${p.handoff}`, 'info')
      try {
        const lineage: Lineage = { from: p.oldSession, chain: p.chain, depth: p.depth, handoff: p.handoff }
        await io.writeText(lineagePath(home(), id), `${JSON.stringify(lineage, null, 2)}\n`)
      } catch (err) {
        await log(`lineage write failed session=${id} ${String(err)}`)
      }
      await dropActive(p.oldSession)
      try { await publishStage(id) } catch {}
      await log(`seeded session=${id} from=${p.oldSession} depth=${p.depth}`)
    }
    inFlight = false
    await touchActive(id)
  }

  async function onSessionCompact() {
    resetFill(io.sessionId())
    await publishStage(io.sessionId())
  }

  async function onSessionShutdown() {
    await dropActive(io.sessionId())
  }

  // Returns the rewrite that arms the clear route, or nothing.
  async function onInput(e: { text?: string; source?: string; images?: unknown[] }): Promise<{ text: string } | undefined> {
    await load()
    const id = io.sessionId()
    const operator = e.source !== 'extension'
    try {
      if (operator) {
        unattended = 0
        if (paused === id) paused = undefined
      }
      await touchActive(id)
    } catch (err) {
      await log(`input error ${String(err)}`)
    }
    try {
      // A seeded session's ladder is unknown until a reading measures its start: its seed carries no warning.
      const unshifted = seeded?.session === id && seeded.startPercent === undefined
      if (!off.has(id) && !inFlight && paused !== id && !unshifted) {
        await measure(id)
        const due = dueWarning(id)
        if (due !== undefined && !handedOff.has(id)) {
          io.warnNext(await warningText(id, due))
          warned.set(id, due)
          await appendStatus(`warned ${warnedAt(id, due)}`)
        }
      }
    } catch (err) {
      await log(`input warning error ${String(err)}`)
    }
    // The route: a saved command ctx is the only way to reach newSession(). A child is never cleared.
    const text = e.text ?? ''
    if (operator && !io.route() && !io.isChild && text.trim() !== '' && !text.startsWith('/') && !(e.images?.length))
      return { text: `/molt-arm ${text}` }
    return undefined
  }

  // The gate: past `block` only the handoff's own tools run.
  async function onToolCall(e: { toolName: string; input?: unknown }): Promise<{ block: true; reason: string } | undefined> {
    await load()
    const id = io.sessionId()
    try {
      if (!off.has(id) && !inFlight) {
        await measure(id)
        if (atLeast(stage, 'block')) {
          const shape = claudeShape(e.toolName, e.input)
          if (!gateAllows(shape.tool, shape.args)) {
            await log(`gate denied session=${id} tool=${e.toolName} percent=${lastPercent}`)
            return { block: true, reason: await instruction(id) }
          }
        }
      }
    } catch (err) {
      await log(`tool_call gate error ${String(err)}`)
    }
    return undefined
  }

  async function onToolResult(e: { toolName: string; input?: unknown; isError?: boolean }) {
    await load()
    const id = io.sessionId()
    try {
      if (off.has(id) || inFlight || handedOff.has(id)) return
      // Counted against the stage the call was gated at: past the first warning the session may write and
      // commit its handoff, which would make every molt look like progress to the autopilot loop guard.
      if (e.isError !== true) {
        const shapes = claudeShapes(e.toolName, e.input)
        if (!atLeast(stage, 'warn') && shapes.some(s => isProgress(s.tool, s.args))) progress += 1
        const md = shapes.find(s => (s.tool === 'Write' || s.tool === 'Edit') && typeof s.args.file_path === 'string' && s.args.file_path.endsWith('.md'))
        if (md !== undefined && atLeast(stage, 'command')) lastMd.set(id, md.args.file_path as string)
      }
      await measure(id)
      if (atLeast(stage, 'command')) {
        if (nudged.has(id)) return
        warned.set(id, 2)
        nudged.add(id)
        await noteCommand(id)
        return io.steer(await instruction(id))
      }
      const due = dueWarning(id)
      if (due === undefined) return
      warned.set(id, due)
      await appendStatus(`warned ${warnedAt(id, due)}`)
      io.steer(await warningText(id, due))
    } catch (err) {
      await log(`tool_result error ${String(err)}`)
    }
  }

  // classic.Stop (block up to twice) and turn.complete (handoff, molt, fallback) share this one event.
  async function onSessionStop(e: { last_assistant_message?: unknown } = {}): Promise<{ decision: 'block'; reason: string } | undefined> {
    await load()
    const id = io.sessionId()
    try {
      await touchActive(id)
      if (off.has(id) || inFlight || paused === id || handedOff.has(id)) {
        showStatus(id)
        return undefined
      }
      await measure(id)
      showStatus(id)
      // Below the first warning a marker is not a molt: a seeded session keeps its minimum room.
      if (!atLeast(stage, 'warn')) return undefined
      const answer = answerOf(e, io.branch())
      const marker = markerPath(answer)
      const resolved = marker === undefined ? undefined : resolvePath(marker, io.cwd, home())
      const n = stopBlocks.get(id) ?? 0
      // The Stop reflex, as in the Claude glue: ask again at every stage from `command` up, until the cap is
      // spent. A block makes the model continue; the next session_stop re-enters and, once spent, molts.
      if (atLeast(stage, 'command') && n < MAX_STOP_BLOCKS) {
        const missing = resolved !== undefined && !(await isReadable(resolved)) ? resolved : undefined
        if (resolved === undefined || missing !== undefined) {
          stopBlocks.set(id, n + 1)
          await noteCommand(id)
          const reason = missing === undefined
            ? await instruction(id)
            : `molt: the MOLT-HANDOFF line names ${missing}, but ${missing} does not exist or is not a readable file. Write the handoff file, then end your reply with MOLT-HANDOFF: <its absolute path>.`
          return { decision: 'block', reason }
        }
      }
      if (unroutable.has(id)) return undefined
      let handoff = pickHandoff(resolved, lastMd.get(id))
      if (handoff !== undefined && !(await isReadable(handoff.path))) {
        await log(`handoff path missing session=${id} path=${handoff.path}`)
        handoff = undefined
      }
      if (handoff === undefined) {
        // A warned session may hand off at a point it chose; nothing is asked of it yet.
        if (!atLeast(stage, 'command')) return undefined
        handoff = { path: await fallbackBrief(id), source: 'fallback' }
      }
      if (io.isChild) await handOff(id, handoff)
      else await molt(id, handoff)
    } catch (err) {
      await log(`session_stop error ${String(err)}`)
    }
    return undefined
  }

  async function status(id: string): Promise<string> {
    const t = thresholds(id)
    const record = parseAutonomic(await io.readText(autonomicPath(home(), id)))
    const lines = [
      `molt is ${off.has(id) ? 'off' : paused === id ? 'paused' : 'on'} for this session.`,
      `fill: ${lastPercent === undefined ? 'not measured yet' : `${Math.round(lastPercent)}%`} — warnings ${Math.round(t.warn)}% and ${Math.round(t.warnAgain)}%, handoff ${Math.round(t.command)}%, block ${Math.round(t.block)}%, fallback ${Math.round(t.fallback)}%`,
      `mode (autonomic's record): ${record.mode}`,
      io.route() ? 'clear route: armed.' : io.printMode() ? 'clear route: none (print mode).' : 'clear route: not armed yet (the next prompt you send arms it).',
    ]
    if (cfg.problems.length) lines.push(`settings: ${cfg.problems.join('; ')}`)
    return lines.join('\n')
  }

  async function onCommand(args: string): Promise<string> {
    await load()
    const id = io.sessionId()
    const arg = args.trim()
    if (arg === 'off') {
      off.add(id)
      await dropActive(id)
      await publishStage(id)
      showStatus(id)
      return 'molt is off for this session. The crew context-ceiling hooks speak again here.'
    }
    if (arg === 'on') {
      off.delete(id)
      await touchActive(id)
      await publishStage(id)
      showStatus(id)
      return 'molt is on for this session.'
    }
    if (arg === 'now') {
      off.delete(id)
      paused = undefined
      await touchActive(id)
      forced.add(id)
      await measure(id)
      io.steer(await instruction(id))
      return 'molt: the handoff request is sent. The session acts on it at its next step.'
    }
    if (arg === 'status') return status(id)
    return USAGE
  }

  return { onSessionStart, onSessionSwitch, onSessionCompact, onSessionShutdown, onInput, onToolCall, onToolResult, onSessionStop, onCommand }
}
