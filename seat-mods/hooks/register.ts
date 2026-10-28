import type { EngineInterface, Register } from 'claude-code'
import { parseRole, parseAllow, scratchDirs, scratchAllow, bashRules, commitMessageFiles, rmTargets, removalOf, UNREAD, placeOf, decide, uncheckedRmText, invalidText, statusText } from './rules'
import type { RoleState } from './rules'
import { classifyPrompt, checkBlock, hasMoltHandoff, isIdleStop, rewriteReason, redoDrop, REDO_ORPHAN, STATUS_CONTEXT, STATUS_WARNING, IDLE_REASON, IDLE_WARNING } from './status'
import { moltStagePath, seatLogPath } from './records'

type Engine = EngineInterface

// The live turn's status state, one session per process: set at prompt.submit,
// checked and cleared at the main loop's turn.complete. It is defined only inside an
// orchestrator's turn, so every check below skips otherwise. `redone` marks seat-mods'
// own redo turn, which is checked but never redone; `sessionId` is the session the turn
// started in.
let turn: { status: boolean; redone: boolean; sessionId: string } | undefined

// The redos seat-mods submitted at failed status turns' ends, oldest first, until each
// arrives at prompt.submit (#929: classic.Stop, which held the turn open, never runs for a
// plugin on an org account). The host runs queued prompts in order, so each seat-mods
// prompt that arrives answers the oldest entry. `warning` is the failure's flag, shown if the
// redo never runs; `superseded` marks another turn
// that started first.
type Redo = { sessionId: string; warning: string; superseded: boolean }
const pending: Redo[] = []

// A redo that never runs leaves the failed reply as the turn that stands: its flag is shown
// as a toast.
async function standAlone($: Engine, redo: Redo): Promise<void> {
  $.ui.toast(redo.warning)
}

async function roleOf($: any): Promise<RoleState> {
  return parseRole(await $.env.get('SEAT_MODS_ROLE'))
}

// seat-mods' own log: a failed redo only. It is created on the first failure;
// nothing else writes it, and nothing waits on it.
async function log($: Engine, line: string): Promise<void> {
  try {
    await $.process.run(['sh', '-c', 'mkdir -p "$(dirname "$2")" && printf "%s\\n" "$1" >> "$2"',
      'sh', `${new Date().toISOString()} ${line}`, seatLogPath((await $.env.get('HOME')) ?? '')])
  } catch {}
}

// Where a path lands: the path itself if it stats, else its nearest existing
// ancestor plus the rest (a Write may create the file and its folders). A `..`
// below a folder that does not exist cannot be resolved, so it is undefined.
async function realOf($: any, path: string): Promise<string | undefined> {
  const own = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  if (own?.realPath !== undefined) return own.realPath
  // A path that exists but does not resolve is a dangling link: a Write would follow it.
  if (await $.fs.stat(path).then(() => true, () => false)) return undefined
  const cut = path.lastIndexOf('/')
  const folder = cut < 0 ? '.' : cut === 0 ? '/' : path.slice(0, cut)
  const name = path.slice(cut + 1)
  if (folder === path || name === '..') return undefined
  const dir = await realOf($, folder)
  if (dir === undefined) return undefined
  return name === '' || name === '.' ? dir : `${dir.replace(/\/$/, '')}/${name}`
}

// The git top level of the session's working directory, or the directory itself outside git.
async function worktreeOf($: any): Promise<string | undefined> {
  const cwd = await $.session.cwd()
  const top = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel']).catch(() => undefined)
  return realOf($, top?.exitCode === 0 ? top.stdout.trim() : cwd)
}

// The directories a guarded seat may write: SEAT_MODS_ALLOW as each resolves, then /tmp and $TMPDIR (scratchAllow: the
// scratch ones as given and as resolved, none that holds the worktree `root`).
async function allowOf($: any, root: string | undefined): Promise<string[]> {
  const dirs = parseAllow(await $.env.get('SEAT_MODS_ALLOW'))
  const scratch = scratchDirs(await $.env.get('TMPDIR'))
  const [real, scratchReal] = await Promise.all([
    Promise.all(dirs.map(dir => realOf($, dir))),
    Promise.all(scratch.map(dir => realOf($, dir))),
  ])
  return [...new Set([...real.filter((dir): dir is string => dir !== undefined), ...scratchAllow(scratch, scratchReal, root)])]
}

// Where the kernel lands a path: each link followed before the `..` after it. The
// engine's resolve collapses `..` first, so `link/../x` would land beside the link,
// not beside its target (#781). Write and Edit collapse `..` themselves, so only rm,
// which runs in a shell, needs this walk.
async function physicalOf($: any, path: string): Promise<string | undefined> {
  const parts = path.split('/')
  if (!parts.includes('..')) return realOf($, path)
  if (!path.startsWith('/')) return undefined
  let cur = '/'
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      // The kernel cannot step up from a folder that does not exist.
      if (!(await $.fs.stat(cur).then(() => true, () => false))) return undefined
      cur = cur.slice(0, cur.lastIndexOf('/')) || '/'
      continue
    }
    const next = await realOf($, `${cur.replace(/\/$/, '')}/${part}`)
    if (next === undefined) return undefined
    cur = next
  }
  return cur
}

// Resolve rm's parent through links, keeping the final component literal: rm
// unlinks a terminal symlink. A trailing slash (or . / ..) follows the directory.
async function removalPath($: any, operand: string, cwd: string, home: string | undefined, glob: boolean): Promise<string | undefined> {
  let path = operand
  if (path === '~' || path.startsWith('~/')) {
    if (home === undefined || !home.startsWith('/')) return undefined
    path = (home.replace(/\/$/, '') + path.slice(1)) || '/'
  }
  if (!path.startsWith('/')) path = `${cwd}/${path}`
  if (glob || /\/(?:\.|\.\.)?$/.test(path)) return physicalOf($, path)
  const cut = path.lastIndexOf('/')
  const parent = await physicalOf($, cut === 0 ? '/' : path.slice(0, cut))
  return parent === undefined ? undefined : `${parent.replace(/\/$/, '')}/${path.slice(cut + 1)}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.ui.status(statusText(await roleOf($)))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const state = await roleOf($)
    if (state.kind === 'free') return next(e)
    if (state.kind === 'invalid') return { deny: invalidText(state.value) }
    const role = state.role // 'on' or 'default'

    if (e.tool === 'Bash') {
      let deny: string | undefined
      try {
        const texts = await Promise.all(commitMessageFiles(e.command).map(file => $.fs.read(file).catch(() => '')))
        const text = texts.join('\n')
        const operands = rmTargets(e.command)
        const removals = []
        if (operands.length > 0) {
          const [cwd, home, root] = await Promise.all([$.session.cwd(), $.env.get('HOME'), worktreeOf($)])
          const allow = await allowOf($, root)
          for (const operand of operands) {
            if (operand.path === undefined) { removals.push(UNREAD); continue }
            const target = await removalPath($, operand.path, cwd, home, operand.glob)
            removals.push(removalOf(target, root, allow, operand.glob))
          }
        }
        deny = decide(role, { kind: 'bash', rules: bashRules(e.command, text), removals })
      } catch {
        return { deny: uncheckedRmText(role) }
      }
      return deny === undefined ? next(e) : { deny }
    }

    if (e.tool === 'Edit' || e.tool === 'Write') {
      const [target, root] = await Promise.all([realOf($, e.file_path), worktreeOf($)])
      const allow = await allowOf($, root)
      const place = target === undefined || root === undefined ? 'outside' : placeOf(target, root, allow)
      const deny = decide(role, { kind: 'write', place, allow })
      return deny === undefined ? next(e) : { deny }
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const state = await roleOf($)
    if (state.kind !== 'free' || state.role !== 'orchestrator') return next(e)
    // seat-mods' own redo (#929): it runs only in the session whose turn failed, before any
    // other turn, while molt does not act on that turn end (molt's handoff wins).
    const mine = e.origin.kind === 'plugin' && e.origin.name === 'seat-mods' && e.turnId === undefined
    const redo = mine ? pending.shift() : undefined
    // seat-mods submits nothing but redos: one with no entry (a reloaded module) never runs
    // as a status turn of its own, which could earn it a second redo.
    if (mine && redo === undefined) return { drop: REDO_ORPHAN }
    if (redo !== undefined) {
      const [homeDir, id] = await Promise.all([$.env.get('HOME'), $.session.id()])
      const stage = await $.fs.read(moltStagePath(homeDir ?? '', redo.sessionId)).catch(() => undefined)
      const drop = redoDrop({ pendingSession: redo.sessionId, currentSession: id, superseded: redo.superseded, moltStage: typeof stage === 'string' ? stage : undefined })
      if (drop !== undefined) {
        // In another session the old flag means nothing; elsewhere the failed reply stands.
        if (id === redo.sessionId) await standAlone($, redo)
        return { drop }
      }
    }
    const kind = classifyPrompt(e.origin, e.text)
    // The context rides only a status prompt that will run as (or inside) a
    // status turn: a new turn whose kind is status, or a mid-turn status prompt
    // while the running turn is status. Never an operator prompt, queued or not
    // (Codex and CodeRabbit, PR #874 round 4).
    const withContext = kind === 'status' && (e.turnId === undefined || turn?.status === true)
    const r = await next(withContext ? { ...e, context: [...(e.context ?? []), STATUS_CONTEXT] } : e)
    // A refused prompt never entered: its result stands and the turn is untouched
    // (Codex, PR #874 round 4).
    if (r.drop !== undefined) {
      if (redo !== undefined) await standAlone($, redo)
      return r
    }
    // With the prompt confirmed in: a new turn sets the record from its kind; a
    // non-waiting operator prompt typed into the running turn frees it. Any other new
    // turn starting while a redo waits goes first, so the redo is dropped on arrival.
    if (e.turnId === undefined) {
      if (redo === undefined) for (const queued of pending) queued.superseded = true
      turn = { status: kind === 'status', redone: redo !== undefined, sessionId: await $.session.id() }
    } else if (kind === 'operator' && e.wait !== true && turn !== undefined) {
      turn.status = false
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    // A subagent's turn end: not the main loop's, so it neither checks nor clears turn.
    if (e.agentId !== undefined) return r
    const state = await roleOf($)
    if (state.kind !== 'free' || state.role !== 'orchestrator') return r
    // The main turn is over.
    const ended = turn
    turn = undefined
    // An interrupted turn, and one that ended in an API error or a refusal, never answered:
    // classic.Stop did not run on them either, so a redo would ask for a reply that never came.
    if (ended?.status !== true || e.isAborted || e.reason === 'error' || e.reason === 'refusal') return r
    const reply = e.answer ?? ''
    if (hasMoltHandoff(reply)) return r
    // The shape failure first, else the idle failure (#876): one redo per turn is shared
    // by both checks, in either order.
    const check = checkBlock(reply)
    const failure = !check.ok
      ? { reason: rewriteReason(check.failed), warning: STATUS_WARNING }
      : isIdleStop(reply) ? { reason: IDLE_REASON, warning: IDLE_WARNING } : undefined
    if (failure !== undefined && !ended.redone) {
      // One redo turn (#929), not awaited: it starts once this turn is over. The reply
      // stands as it is meanwhile — no flag while its redo is pending.
      const mine: Redo = { sessionId: ended.sessionId, warning: failure.warning, superseded: false }
      pending.push(mine)
      $.prompt.submit({ text: failure.reason }).catch(async (err: unknown) => {
        const at = pending.indexOf(mine)
        if (at !== -1) pending.splice(at, 1)
        await standAlone($, mine)
        await log($, `redo failed ${String(err)}`)
      })
      return r
    }
    const warning = failure?.warning
    // Core's result text repeats `e.answer`; only a text a mod beneath set is
    // output of its own. The warning replaces core's text (the reply would
    // otherwise show twice) and appends after any other, its own last line
    // (review round 2, PR #874; the idle warning takes the same place, #876).
    if (warning === undefined) return r
    const base = r.text === '' || r.text === e.answer ? '' : r.text
    return { ...r, text: base === '' ? warning : `${base}\n${warning}` }
  })
}
