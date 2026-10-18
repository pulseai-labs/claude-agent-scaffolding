import type { Register } from 'claude-code'
import { parseRole, parseAllow, bashRules, commitMessageFiles, rmTargets, removalOf, UNREAD, placeOf, decide, uncheckedRmText, invalidText, statusText } from './rules'
import type { RoleState } from './rules'
import { classifyPrompt, checkBlock, hasMoltHandoff, rewriteReason, STATUS_CONTEXT, STATUS_WARNING } from './status'

// The live turn's status state, one session per process: set at prompt.submit,
// read at classic.Stop, cleared at the main loop's turn.complete. It is defined
// only inside an orchestrator's turn, so every check below skips otherwise.
let turn: { status: boolean; blocked: boolean; failedAfterRewrite: boolean } | undefined

async function roleOf($: any): Promise<RoleState> {
  return parseRole(await $.env.get('SEAT_MODS_ROLE'))
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

async function allowOf($: any): Promise<string[]> {
  const dirs = parseAllow(await $.env.get('SEAT_MODS_ALLOW'))
  const real = await Promise.all(dirs.map(dir => realOf($, dir)))
  return real.filter((dir): dir is string => dir !== undefined)
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
          const [cwd, home, root, allow] = await Promise.all([$.session.cwd(), $.env.get('HOME'), worktreeOf($), allowOf($)])
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
      const [target, root, allow] = await Promise.all([realOf($, e.file_path), worktreeOf($), allowOf($)])
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
    if (e.turnId === undefined) {
      turn = { status: kind === 'status', blocked: false, failedAfterRewrite: false }
    } else if (kind === 'operator' && turn !== undefined) {
      // Typed into a running status turn: the reply now answers the operator (design).
      turn.status = false
    }
    return turn?.status === true
      ? next({ ...e, context: [...(e.context ?? []), STATUS_CONTEXT] })
      : next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    const r = await next(e)
    // autonomic's block (or any beneath one) passes unchanged and is not seat-mods' rewrite.
    if (r.block !== undefined) return r
    const state = await roleOf($)
    if (state.kind !== 'free' || state.role !== 'orchestrator' || turn?.status !== true) return r
    if (hasMoltHandoff(e.last_assistant_message ?? '')) {
      turn.failedAfterRewrite = false
      return r
    }
    const check = checkBlock(e.last_assistant_message ?? '')
    if (check.ok) {
      turn.failedAfterRewrite = false
      return r
    }
    if (turn.blocked) {
      // The one rewrite stands: let this stop through, and mark it for turn.complete.
      turn.failedAfterRewrite = true
      return r
    }
    turn.blocked = true
    return { ...r, block: rewriteReason(check.failed) }
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    // A subagent's turn end: not the main loop's, so neither warns nor clears turn.
    if (e.agentId !== undefined) return r
    const state = await roleOf($)
    if (state.kind !== 'free' || state.role !== 'orchestrator') return r
    const warn = turn?.failedAfterRewrite === true
    // The main turn is over.
    turn = undefined
    // Core's result text repeats `e.answer`; only a text a mod beneath set is
    // output of its own. The warning replaces core's text (the reply would
    // otherwise show twice) and appends after any other, its own last line
    // (review round 2, PR #874).
    return warn ? { ...r, text: r.text === '' || r.text === e.answer ? STATUS_WARNING : `${r.text}\n${STATUS_WARNING}` } : r
  })
}
