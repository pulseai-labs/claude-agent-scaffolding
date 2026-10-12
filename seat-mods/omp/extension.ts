// seat-mods on OMP: the same rules as hooks/register.ts, read through OMP's extension API.
// Loaded only by omp-seat with -e (never ambient). Reads SEAT_MODS_ROLE / SEAT_MODS_ALLOW
// for the main session and ctx.agent.name for a task child, whose env is its parent's.
import { realpathSync, existsSync, lstatSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, basename } from 'node:path'
import {
  parseRole, parseAllow, bashRules, commitMessageFiles, rmTargets, removalOf, placeOf, decide,
  uncheckedRmText, invalidText, statusText,
} from '../hooks/rules'
import type { Role, RoleState, RuleId } from '../hooks/rules'

type Agent = { kind?: string; name?: string } | undefined
export type GuardDeps = {
  env: Record<string, string | undefined>
  cwd: string
  worktree: () => Promise<string | undefined>
  real: (path: string) => Promise<string | undefined>
  readFile: (path: string) => Promise<string>
}

const CHILD_ROLE: Record<string, Role> = { reviewer: 'reviewer', scout: 'reviewer' }
// Planner decision 1: an implementer child stages and never commits, so it gets the verifier profile.
export function childRole(name: string | undefined): Role {
  return CHILD_ROLE[name ?? ''] ?? 'verifier'
}

export function roleFor(env: string | undefined, agent: Agent): RoleState {
  // Only the main session follows the env; anything else, a missing agent included, is a child (fail closed).
  if (agent?.kind !== 'main') return { kind: 'on', role: childRole(agent?.name) }
  return parseRole(env)
}

const WRITE_TOOLS = new Set(['write', 'edit', 'ast_edit'])
// Every path a write-class call can touch. omp fills `path`/`paths` from an edit's section headers only, so an
// edit's other destinations are read from where they live: `rename`, `edits[].path`/`rename`, and the hashline
// `MV <dest>` lines of `input`, and apply_patch's file and `Move to:` headers.
export function writeTargets(toolName: string, input: Record<string, unknown>): string[] | undefined {
  if (!WRITE_TOOLS.has(toolName)) return undefined
  const found = new Set<string>()
  const add = (v: unknown) => { if (typeof v === 'string' && v !== '') found.add(v) }
  add(input.path)
  if (Array.isArray(input.paths)) input.paths.forEach(add)
  if (toolName === 'edit') {
    add(input.rename)
    if (Array.isArray(input.edits))
      for (const e of input.edits) if (e !== null && typeof e === 'object') { add((e as Record<string, unknown>).path); add((e as Record<string, unknown>).rename) }
    if (typeof input.input === 'string')
      for (const line of input.input.split('\n')) {
        const t = line.trim()
        if (t.startsWith('MV ')) add(t.slice(3).trim())
        const patch = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/.exec(t) // apply_patch mode
        if (patch !== null) add(patch[1].trim())
      }
  }
  return [...found]
}

// Tools that run code: reviewer rails never run them; implementer rails scan eval's source.
const RUNS_CODE = new Set(['eval', 'debug'])
const LSP_WRITES = new Set(['rename', 'rename_file', 'code_actions', 'request'])

// Best effort (spec §4.2): eval code is not shell, so read its string literals as commands —
// each one alone, and all of them joined, which catches an argv list such as ['git', 'push'].
export function evalCommands(code: string): string[] {
  const literals = [...code.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map(m => m[1] ?? m[2] ?? '')
  return literals.length === 0 ? [] : [...literals, literals.join(' ')]
}

function spawnDeny(role: Role): string {
  return `seat-mods (${role}): no subagents — this seat may not spawn; report it instead.`
}
// before_subagent_spawn fires for task, eval agent() and workpool workers alike. Only the main session may spawn.
export function spawnDecision(agent: Agent): { block: true; reason: string } | undefined {
  return agent?.kind === 'main' ? undefined : { block: true, reason: spawnDeny(childRole(agent?.name)) }
}
function runDeny(role: Role, tool: string): string {
  return `seat-mods (${role}): no ${tool} — this seat may not run code here; report it instead.`
}

export async function guard(deps: GuardDeps, toolName: string, input: Record<string, unknown>, agent: Agent): Promise<string | undefined> {
  const state = roleFor(deps.env.SEAT_MODS_ROLE, agent)
  if (state.kind === 'free') return undefined
  if (state.kind === 'invalid') return invalidText(state.value)
  const role = state.role
  const child = agent?.kind !== 'main'

  if (toolName === 'task' && child) return spawnDeny(role)
  if (RUNS_CODE.has(toolName) && role === 'reviewer') return runDeny(role, toolName)

  if (toolName === 'github') {
    // pr_create / pr_push are the harness's own gh pr create / git push; a force-with-lease push is a force-push.
    const rules: RuleId[] = []
    if (input.op === 'pr_create') rules.push('pr-create')
    if (input.op === 'pr_push') rules.push('push')
    if (input.forceWithLease === true || input.forceWithLease === 'true') rules.push('force-push')
    return rules.length === 0 ? undefined : decide(role, { kind: 'bash', rules })
  }
  // lsp edits files (rename, applied code actions) or sends any raw request; a reviewer reads only.
  if (toolName === 'lsp' && role === 'reviewer' && LSP_WRITES.has(String(input.action)))
    return decide(role, { kind: 'write', place: 'worktree' })

  if (toolName === 'bash' || toolName === 'eval') {
    // bash takes its own cwd; rm operands and -F files resolve against it, not the session's.
    const base = toolName === 'bash' && typeof input.cwd === 'string' && input.cwd !== '' ? absolute(deps.cwd, input.cwd) : deps.cwd
    const commands = toolName === 'bash' ? [String(input.command ?? '')] : evalCommands(String(input.code ?? ''))
    try {
      for (const command of commands) {
        const texts = await Promise.all(commitMessageFiles(command).map(f => deps.readFile(absolute(base, f)).catch(() => '')))
        const removals = []
        for (const operand of rmTargets(command)) {
          const [root, allow] = await Promise.all([deps.worktree(), allowOf(deps)])
          const target = operand.path === undefined ? undefined : await removalPath(deps, base, operand.path, operand.glob)
          removals.push(removalOf(target, root, allow, operand.glob))
        }
        const deny = decide(role, { kind: 'bash', rules: bashRules(command, texts.join('\n')), removals })
        if (deny !== undefined) return deny
      }
      return undefined
    } catch {
      return uncheckedRmText(role)
    }
  }

  const targets = writeTargets(toolName, input)
  if (targets === undefined) return undefined
  const [root, allow] = await Promise.all([deps.worktree(), allowOf(deps)])
  if (targets.length === 0) return decide(role, { kind: 'write', place: 'outside' })
  for (const path of targets) {
    const target = await deps.real(absolute(deps.cwd, path))
    const place = target === undefined || root === undefined ? 'outside' : placeOf(target, root, allow)
    const deny = decide(role, { kind: 'write', place })
    if (deny !== undefined) return deny
  }
  return undefined
}

// The absolute path, NOT normalised: path.resolve collapses `..` before symlinks resolve, so
// `link/../x` would be checked as `<wt>/x` while the OS writes beside link's target. real() sees
// the raw path and fails closed on an unresolvable `..` (as register.ts does).
function absolute(cwd: string, path: string): string {
  return path.startsWith('/') ? path : `${cwd}/${path}`
}

// rm's operand placed as register.ts removalPath does: the parent resolves through links and the final
// component stays literal (rm unlinks a terminal symlink); a glob or a trailing / . .. follows the directory.
async function removalPath(deps: GuardDeps, base: string, operand: string, glob: boolean): Promise<string | undefined> {
  const path = absolute(base, homeOf(operand, deps.env.HOME))
  if (glob || /\/(?:\.|\.\.)?$/.test(path)) return deps.real(path)
  const cut = path.lastIndexOf('/')
  const parent = await deps.real(cut === 0 ? '/' : path.slice(0, cut))
  return parent === undefined ? undefined : `${parent.replace(/\/$/, '')}/${path.slice(cut + 1)}`
}

// rmTargets leaves an active leading tilde in place (register.ts removalPath expands it); a bare
// absolute() would read `~/x` as a folder named `~` under cwd, inside the worktree.
function homeOf(path: string, home: string | undefined): string {
  if (path !== '~' && !path.startsWith('~/')) return path
  if (home === undefined || !home.startsWith('/')) throw new Error('rm operand needs HOME')
  return (home.replace(/\/$/, '') + path.slice(1)) || '/'
}

async function allowOf(deps: GuardDeps): Promise<string[]> {
  const real = await Promise.all(parseAllow(deps.env.SEAT_MODS_ALLOW).map(d => deps.real(d)))
  return real.filter((d): d is string => d !== undefined)
}

// The path itself if it resolves, else its nearest existing ancestor plus the rest (as register.ts realOf).
// Bun's realpathSync collapses `..` lexically before the kernel follows a link, so `link/..` would read as
// the link's own folder. A path with a `..` component is therefore walked one component at a time: each
// step is a `..`-free path (safe to realpath), and `..` takes the parent of the already-resolved folder.
export function realOf(path: string): string | undefined {
  const parts = path.split('/')
  if (!parts.includes('..')) return plainRealOf(path)
  if (!path.startsWith('/')) return undefined // a relative path with .. would take the lexical collapse; callers pass absolute paths
  let cur = '/'
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (!existsSync(cur)) return undefined // the kernel cannot step up from a folder that does not exist
      cur = dirname(cur)
      continue
    }
    const next = plainRealOf(`${cur.replace(/\/$/, '')}/${part}`)
    if (next === undefined) return undefined
    cur = next
  }
  return cur
}

function plainRealOf(path: string): string | undefined {
  try { return realpathSync(path) } catch {}
  // lstat sees the link itself; existsSync follows it, so it is false for a dangling link, which a write would follow.
  try { lstatSync(path); return undefined } catch {}
  const folder = dirname(path)
  const name = basename(path)
  if (folder === path || name === '..') return undefined
  const dir = plainRealOf(folder)
  return dir === undefined ? undefined : name === '' || name === '.' ? dir : `${dir.replace(/\/$/, '')}/${name}`
}

function depsFor(ctx: any): GuardDeps {
  const cwd: string = ctx.cwd
  return {
    env: process.env,
    cwd,
    worktree: async () => {
      const top = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 10_000 })
      return realOf(top.status === 0 ? top.stdout.trim() : cwd)
    },
    real: async (p: string) => realOf(p),
    readFile: async (p: string) => readFileSync(absolute(cwd, p), 'utf8'),
  }
}

export default function (pi: any) {
  pi.on('session_start', (_e: any, ctx: any) => {
    if (ctx.agent?.kind === 'main') ctx.ui?.setStatus?.('seat-mods', statusText(roleFor(process.env.SEAT_MODS_ROLE, ctx.agent)))
  })
  pi.on('before_subagent_spawn', (_e: any, ctx: any) => spawnDecision(ctx.agent))
  pi.on('tool_call', async (e: any, ctx: any) => {
    // A throw in a tool_call handler blocks the call (fail closed, doc 018).
    const reason = await guard(depsFor(ctx), e.toolName, (e.input ?? {}) as Record<string, unknown>, ctx.agent)
    return reason === undefined ? undefined : { block: true, reason }
  })
}
