// seat-mods on OMP: the same rules as hooks/register.ts, read through OMP's extension API.
// Loaded only by omp-seat with -e (never ambient). Reads SEAT_MODS_ROLE / SEAT_MODS_ALLOW
// for the main session and ctx.agent.name for a task child, whose env is its parent's.
import { realpathSync, existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, basename } from 'node:path'
import {
  parseRole, parseAllow, bashRules, commitMessageFiles, rmTargets, removalOf, placeOf, decide,
  uncheckedRmText, invalidText, statusText,
} from '../hooks/rules'
import type { Role, RoleState } from '../hooks/rules'

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
export function writeTargets(toolName: string, input: Record<string, unknown>): string[] | undefined {
  if (!WRITE_TOOLS.has(toolName)) return undefined
  const paths = Array.isArray(input.paths) ? input.paths.filter((p): p is string => typeof p === 'string') : []
  if (paths.length > 0) return paths
  return typeof input.path === 'string' ? [input.path] : []
}

// Tools that run code: reviewer rails never run them; implementer rails scan eval's source.
const RUNS_CODE = new Set(['eval', 'debug'])

// Best effort (spec §4.2): eval code is not shell, so read its string literals as commands —
// each one alone, and all of them joined, which catches an argv list such as ['git', 'push'].
export function evalCommands(code: string): string[] {
  const literals = [...code.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map(m => m[1] ?? m[2] ?? '')
  return literals.length === 0 ? [] : [...literals, literals.join(' ')]
}

function spawnDeny(role: Role): string {
  return `seat-mods (${role}): no subagents — this seat may not spawn; report it instead.`
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

  if (toolName === 'bash' || toolName === 'eval') {
    const commands = toolName === 'bash' ? [String(input.command ?? '')] : evalCommands(String(input.code ?? ''))
    try {
      for (const command of commands) {
        const texts = await Promise.all(commitMessageFiles(command).map(f => deps.readFile(f).catch(() => '')))
        const removals = []
        for (const operand of rmTargets(command)) {
          const [root, allow] = await Promise.all([deps.worktree(), allowOf(deps)])
          const target = operand.path === undefined ? undefined : await removalPath(deps, operand.path, operand.glob)
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
async function removalPath(deps: GuardDeps, operand: string, glob: boolean): Promise<string | undefined> {
  const path = absolute(deps.cwd, homeOf(operand, deps.env.HOME))
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
function realOf(path: string): string | undefined {
  try { return realpathSync(path) } catch {}
  if (existsSync(path)) return undefined // dangling link
  const folder = dirname(path)
  const name = basename(path)
  if (folder === path || name === '..') return undefined
  const dir = realOf(folder)
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
  pi.on('tool_call', async (e: any, ctx: any) => {
    // A throw in a tool_call handler blocks the call (fail closed, doc 018).
    const reason = await guard(depsFor(ctx), e.toolName, (e.input ?? {}) as Record<string, unknown>, ctx.agent)
    return reason === undefined ? undefined : { block: true, reason }
  })
}
