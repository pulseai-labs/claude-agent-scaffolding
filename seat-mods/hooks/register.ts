import type { EngineInterface, Register } from 'claude-code'
import { parseRole, parseAllow, scratchDirs, scratchAllow, bashRules, commitMessageFiles, rmTargets, removalOf, UNREAD, placeOf, decide, uncheckedRmText, invalidText, statusText } from './rules'
import type { RoleState } from './rules'
import { classifyPrompt, checkBlock, hasMoltHandoff, isIdleStop, waitingOnOperator, rewriteReason, STATUS_CONTEXT, STATUS_WARNING, IDLE_REASON, IDLE_WARNING, WAITING_NOTICE } from './status'
import { autonomicPath, parseAutonomic, seatLogPath } from './records'

type Engine = EngineInterface

// The live turn's status state, one session per process: set at prompt.submit,
// read at classic.Stop, cleared at the main loop's turn.complete. It is defined
// only inside an orchestrator's turn, so every check below skips otherwise.
// `warning` is the line of the failure that stood at the last stop — the shape
// check's or the idle check's (#876) — or undefined. `notice` is the
// waiting-on-operator line the status block handed the operator (#873), shown
// at turn.complete; it is set only on a stop that ends the turn.
let turn: { status: boolean; blocked: boolean; warning: string | undefined; notice: string | undefined } | undefined

async function roleOf($: any): Promise<RoleState> {
  return parseRole(await $.env.get('SEAT_MODS_ROLE'))
}

// seat-mods' own log: the bell's failures only. It is created on the first failure;
// nothing else writes it, and nothing waits on it.
async function log($: Engine, line: string): Promise<void> {
  try {
    await $.process.run(['sh', '-c', 'mkdir -p "$(dirname "$2")" && printf "%s\\n" "$1" >> "$2"',
      'sh', `${new Date().toISOString()} ${line}`, seatLogPath((await $.env.get('HOME')) ?? '')])
  } catch {}
}

// seat-mods' copy of molt's bell (#873): BELL_TIMEOUT_MS and ring are byte-identical to
// molt's, pinned by tests/test-mod-shell-parity.sh. The comment below is molt's own,
// kept verbatim so the pin compares it.

// One copy in two files: molt's register.tsx and autonomic's; tests/test-mod-shell-parity.sh holds the two identical.
// The engine kills a `process.run` child at 30 s when no bound is given — the same bound
// molt-v0.2.2's awaited bell therefore ran under. Stated explicitly, and never tightened:
// a slow bell (a remote notify curl) that completed on 0.2.2 must still complete, while a
// hung one stays bounded. Nothing waits on it (see `pause`), so this is only a backstop.
const BELL_TIMEOUT_MS = 30_000

// Rung once and left to finish: the bell never gates the hook that paused the session. A bell
// that cannot start, throws, or is killed at BELL_TIMEOUT_MS rejects; one that runs and exits
// non-zero resolves. Both are failures and both are logged once — `log` never throws, so this
// promise always resolves and nothing is left unhandled (#665 item 4).
async function ring($: Engine, bell: string, message: string): Promise<void> {
  try {
    const r = await $.process.run(['sh', '-c', `AUTONOMIC_MESSAGE="$1"; export AUTONOMIC_MESSAGE; ${bell}`, 'sh', message], { timeoutMs: BELL_TIMEOUT_MS })
    if (r.exitCode !== 0) await log($, `bell failed exit=${r.exitCode}`)
  } catch (err) {
    await log($, `bell failed ${String(err)}`)
  }
}

// The waiting-on-operator signal (#873): when a stop that ends a status turn hands the
// operator a decision or an action, and autonomic's record says autopilot, ring its bell
// (when set) and return the notice to show at turn.complete. It adds a notification only:
// a missing record, a manual session, a quiet field or a failing read returns undefined.
async function noticeFor($: Engine, reply: string): Promise<string | undefined> {
  const text = waitingOnOperator(reply)
  if (text === undefined) return undefined
  try {
    const [homeDir, id] = await Promise.all([$.env.get('HOME'), $.session.id()])
    const saved = await $.fs.read(autonomicPath(homeDir ?? '', id)).catch(() => undefined)
    const record = parseAutonomic(typeof saved === 'string' ? saved : undefined)
    if (record.mode !== 'autopilot') return undefined
    const notice = `${WAITING_NOTICE}${text}`
    if (record.bell !== undefined) void ring($, record.bell, notice)
    return notice
  } catch {
    return undefined
  }
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
    const kind = classifyPrompt(e.origin, e.text)
    // The context rides only a status prompt that will run as (or inside) a
    // status turn: a new turn whose kind is status, or a mid-turn status prompt
    // while the running turn is status. Never an operator prompt, queued or not
    // (Codex and CodeRabbit, PR #874 round 4).
    const withContext = kind === 'status' && (e.turnId === undefined || turn?.status === true)
    const r = await next(withContext ? { ...e, context: [...(e.context ?? []), STATUS_CONTEXT] } : e)
    // A refused prompt never entered: its result stands and the turn is untouched
    // (Codex, PR #874 round 4).
    if (r.drop !== undefined) return r
    // With the prompt confirmed in: a new turn sets the record from its kind; a
    // non-waiting operator prompt typed into the running turn frees it.
    if (e.turnId === undefined) {
      turn = { status: kind === 'status', blocked: false, warning: undefined, notice: undefined }
    } else if (kind === 'operator' && e.wait !== true && turn !== undefined) {
      turn.status = false
    }
    return r
  })

  on('classic.Stop', async ($, e, next) => {
    const r = await next(e)
    // autonomic's block (or any beneath one) passes unchanged and is not seat-mods' rewrite.
    if (r.block !== undefined) return r
    const state = await roleOf($)
    if (state.kind !== 'free' || state.role !== 'orchestrator' || turn?.status !== true) return r
    const reply = e.last_assistant_message ?? ''
    if (hasMoltHandoff(reply)) {
      turn.warning = undefined
      return r
    }
    // The shape failure first, else the idle failure (#876): one block per turn
    // is shared by both checks, in either order.
    const check = checkBlock(reply)
    const failure = !check.ok
      ? { reason: rewriteReason(check.failed), warning: STATUS_WARNING }
      : isIdleStop(reply) ? { reason: IDLE_REASON, warning: IDLE_WARNING } : undefined
    if (failure === undefined) {
      turn.warning = undefined
    } else if (turn.blocked) {
      // The one block stands: let this stop through, and mark it for turn.complete.
      turn.warning = failure.warning
    } else {
      turn.blocked = true
      return { ...r, block: failure.reason }
    }
    // The turn ends here, whether the block passed or was let through after its
    // one rewrite: a status block that hands the operator a decision or an action
    // rings in autopilot (#873, design §5.2 — a malformed block that still waits
    // on the operator rings too).
    turn.notice = await noticeFor($, reply)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    // A subagent's turn end: not the main loop's, so neither warns nor clears turn.
    if (e.agentId !== undefined) return r
    const state = await roleOf($)
    if (state.kind !== 'free' || state.role !== 'orchestrator') return r
    const warning = turn?.warning
    const notice = turn?.notice
    // The main turn is over.
    turn = undefined
    // Core's result text repeats `e.answer`; only a text a mod beneath set is
    // output of its own. The warning replaces core's text (the reply would
    // otherwise show twice) and appends after any other, its own last line
    // (review round 2, PR #874; the idle warning takes the same place, #876).
    // The waiting-on-operator notice follows the warning, as its own line (#873). The
    // warning stands in for core's text (the reply would show twice); a notice on a
    // block that passed appends to the reply, which is still the turn's own text.
    const added = [warning, notice].filter((line): line is string => line !== undefined)
    if (added.length === 0) return r
    const base = warning !== undefined && (r.text === '' || r.text === e.answer) ? '' : r.text
    return { ...r, text: base === '' ? added.join('\n') : `${base}\n${added.join('\n')}` }
  })
}
