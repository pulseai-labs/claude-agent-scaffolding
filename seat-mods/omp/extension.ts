// seat-mods on OMP: the same rules as hooks/register.ts, read through OMP's extension API.
// Loaded only by omp-seat with -e (never ambient). Reads SEAT_MODS_ROLE / SEAT_MODS_ALLOW
// for the main session and ctx.agent.name for a task child, whose env is its parent's.
import { realpathSync, existsSync, lstatSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseRole, parseAllow, bashRules, commitMessageFiles, rmTargets, removalOf, UNREAD, placeOf, decide,
  uncheckedRmText, invalidText, statusText,
} from '../hooks/rules'
import type { Place, Role, RoleState, RuleId } from '../hooks/rules'

type Agent = { kind?: string; name?: string } | undefined
export type GuardDeps = {
  env: Record<string, string | undefined>
  cwd: string
  worktree: () => Promise<string | undefined>
  real: (path: string) => Promise<string | undefined>
  readFile: (path: string) => Promise<string>
}

const CHILD_ROLE: Record<string, Role> = { 'seat-reviewer': 'reviewer', reviewer: 'reviewer', scout: 'reviewer' }
// Planner decision 1: an implementer child stages and never commits, so it gets the verifier profile.
export function childRole(name: string | undefined): Role {
  return CHILD_ROLE[name ?? ''] ?? 'verifier'
}

export function roleFor(env: string | undefined, agent: Agent): RoleState {
  // Only the main session follows the env; anything else, a missing agent included, is a child (fail closed).
  if (agent?.kind !== 'main') return { kind: 'on', role: childRole(agent?.name) }
  return parseRole(env)
}

// omp 18.8.9's tool names, each with the check a guarded call of it gets. The source is the binary's registry
// (BUILTIN_TOOL_NAMES and HIDDEN_TOOL_NAMES), the edit tool's `apply_patch` wire name, and the tools registered
// outside it (advise, browser, computer, generate_image, tts, vibe_*, the legacy ls, MCP and extension tools).
// A name that is not a key here is denied under guarded rails, so a tool omp adds later, an MCP tool or an
// extension's tool fails closed. Coordinators and orchestrators are never asked.
type Gate = 'pass' | 'top' | 'shell' | 'write' | 'lsp' | 'github' | 'debug'
export const GUARDED_TOOLS: ReadonlyMap<string, Gate> = new Map<string, Gate>([
  // reads; the session's own todo list; a wait on its own jobs; a structured child's return; a thought; an advisor's note
  ['read', 'pass'], ['grep', 'pass'], ['glob', 'pass'], ['find', 'pass'], ['ast_grep', 'pass'], ['web_search', 'pass'],
  ['recall', 'pass'], ['todo', 'pass'], ['wait', 'pass'], ['yield', 'pass'], ['think', 'pass'], ['advise', 'pass'],
  // the top-level seat only: a child does not ask (its role file says to return blocked, spec §4.4), set goals or spawn
  ['ask', 'top'], ['goal', 'top'], ['task', 'top'],
  ['bash', 'shell'], ['eval', 'shell'],                                    // the bash rules; eval source best effort
  ['write', 'write'], ['edit', 'write'], ['apply_patch', 'write'], ['ast_edit', 'write'], // placement of every target
  ['lsp', 'lsp'], ['github', 'github'], ['debug', 'debug'],              // read actions only; see guard()
])
// omp's own read-only sets (lsp's LSP_READONLY_ACTIONS, github's GITHUB_READONLY_OPS); every other action or op
// edits files, git or GitHub, or sends a raw request.
const LSP_READS = new Set(['diagnostics', 'definition', 'type_definition', 'implementation', 'references', 'hover', 'symbols', 'status', 'capabilities'])
const GITHUB_READS = new Set(['repo_view', 'file_read', 'search_issues', 'search_prs', 'search_code', 'search_commits', 'search_repos', 'run_watch'])

// omp's AXo (hashline paths): trim, cut a trailing `#hhhh`, then one pair of matching quotes. Empty stays empty.
function hashlinePath(raw: string): string {
  const t = raw.trim()
  const cut = /#[0-9a-fA-F]{4}$/u.exec(t)?.index
  const n = cut === undefined ? t : t.slice(0, cut)
  if (n.length < 2) return n
  const [o, r] = [n[0], n[n.length - 1]]
  return (o === '"' || o === "'") && o === r ? n.slice(1, -1) : n
}

// write.ts's unwrapHashlineHeaderPath: a `read` header pasted as a path, `[path]` or `[path#HHHH]`, names `path`.
function headerPath(raw: string): string {
  const t = raw.trimEnd()
  if (t.length < 2 || t[0] !== '[' || t[t.length - 1] !== ']') return raw
  const inner = t.slice(1, -1)
  const tag = /#[0-9A-Fa-f]{4}$/.exec(inner)
  const path = tag === null ? inner : inner.slice(0, tag.index)
  return path.length === 0 || (tag === null && path.includes('#')) ? raw : path
}

const WRITE_TOOLS = new Set(['write', 'edit', 'apply_patch', 'ast_edit'])
// Every path a write-class call can touch. omp fills `path`/`paths` from an edit's section headers only, so an
// edit's other destinations are read from where they live: `rename`, `edits[].path`/`rename`, and the hashline
// `MV <dest>` lines of `input` (or `_input`), and apply_patch's file and `Move to:` headers.
export function writeTargets(toolName: string, input: Record<string, unknown>): string[] | undefined {
  if (!WRITE_TOOLS.has(toolName)) return undefined
  const found = new Set<string>()
  const add = (v: unknown) => { if (typeof v === 'string' && v !== '') found.add(v) }
  add(input.path)
  if (Array.isArray(input.paths)) input.paths.forEach(add)
  if (toolName === 'edit' || toolName === 'apply_patch') {
    add(input._path)
    add(input.rename)
    if (Array.isArray(input.edits))
      for (const e of input.edits) if (e !== null && typeof e === 'object') { add((e as Record<string, unknown>).path); add((e as Record<string, unknown>).rename) }
    for (const body of [input.input, input._input]) {
      if (typeof body !== 'string') continue
      const text = body.startsWith('﻿') ? body.slice(1) : body // omp's EXo drops one BOM
      for (const line of text.split('\n')) {
        const raw = line.replace(/\r$/, '')
        const t = raw.trim()
        if (t.startsWith('MV ')) add(hashlinePath(t.slice(3))) // hashline rename
        const head = raw.trimEnd() // hashline section header: `[file]` (or `¶file`), as omp's parser reads it
        if (head.startsWith('[')) add(hashlinePath(head.endsWith(']') ? head.slice(1, -1) : head.slice(1)))
        else if (head.startsWith('¶')) add(hashlinePath(head.slice(1)))
        // apply_patch and sloppy headers, as lenient as omp's detector (case-insensitive, any spacing)
        const patch = /^\*{3}[ \t]+(?:Edit|Add|Update|Delete)[ \t]+File:[ \t]*(.+)$/i.exec(t) ?? /^\*{3}[ \t]+Move[ \t]+to:[ \t]*(.+)$/i.exec(t)
        if (patch !== null) { add(patch[1].trim()); add(hashlinePath(patch[1])) }
      }
    }
  }
  return [...found]
}

// Every reading omp may give a write target before it resolves it: as written, write.ts's header unwrap, the
// hashline AXo strip, and for an ast_edit scope the entry split on `,` `;` and whitespace (omp splits a delimited
// entry that does not exist) and outer double quotes dropped. Each reading is placed and the strictest wins, so a
// reading omp does not take can only deny.
function readings(raw: string, scope: boolean): string[] {
  const out = new Set([raw, headerPath(raw), headerPath(raw.trim()), hashlinePath(raw)])
  if (scope) {
    const bare = raw.trim().replace(/^"(.*)"$/s, '$1')
    out.add(bare)
    for (const piece of bare.split(/[,;\s]+/)) if (piece !== '') out.add(piece)
  }
  return [...out]
}

// A glob scope reaches below its literal prefix only, so it is placed by the folder before its first glob
// character. A `..` after that character, or a brace alternative naming a folder, can climb anywhere: unresolvable.
function globBase(path: string): string | undefined {
  const at = path.search(/[*?[{]/)
  if (at < 0) return path
  const rest = path.slice(at)
  if (/(?:^|\/)\.\.(?:\/|$)/.test(rest) || /\{[^}]*(?:\/|\.\.)/.test(rest)) return undefined
  const cut = path.lastIndexOf('/', at)
  // `<folder>/.`, never a bare `/`: omp's `/`-means-cwd rule is for a whole path argument, not a glob's folder.
  return cut < 0 ? '.' : path.slice(0, cut + 1) + '.'
}

// Best effort (spec §4.2): eval code is not shell, so read its string literals as commands —
// each one alone, and all of them joined, which catches an argv list such as ['git', 'push'].
export function evalCommands(code: string): string[] {
  const literals = [...code.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map(m => m[1] ?? m[2] ?? '')
  return literals.length === 0 ? [] : [...literals, literals.join(' ')]
}

function spawnDeny(role: Role): string {
  return `seat-mods (${role}): no subagents — this seat may not spawn; report it instead.`
}
// #798: GLM 5.3 dispatched "agent":"task" against its role file. herdr-crew's top dispatches herdr seats, never subagents.
function orchestratorSpawnDeny(): string {
  return 'seat-mods (orchestrator): no subagents — dispatch a herdr seat instead (herdr-crew orchestrate; #798).'
}
// before_subagent_spawn fires for task, eval agent() and workpool workers alike. Only the main session may spawn,
// and not when it is the orchestrator (#798).
export function spawnDecision(agent: Agent, roleEnv?: string): { block: true; reason: string } | undefined {
  if (agent?.kind !== 'main') return { block: true, reason: spawnDeny(childRole(agent?.name)) }
  const s = parseRole(roleEnv)
  return s.kind === 'free' && s.role === 'orchestrator' ? { block: true, reason: orchestratorSpawnDeny() } : undefined
}
function runDeny(role: Role, tool: string): string {
  return `seat-mods (${role}): no ${tool} — this seat may not run code here; report it instead.`
}
function toolDeny(role: Role, tool: string): string {
  return `seat-mods (${role}): no ${tool.slice(0, 80)} — this tool is not allowed for this seat; report it instead.`
}

// JSON objects and arrays can contain expansion-triggering keys at any depth.
function hasExpandableKey(args: object): boolean {
  const pending = [args]
  while (pending.length > 0) {
    for (const [key, value] of Object.entries(pending.pop()!)) {
      if (key.includes('[') || key.includes('.')) return true
      if (value !== null && typeof value === 'object') pending.push(value)
    }
  }
  return false
}

export async function guard(deps: GuardDeps, toolName: string, input: Record<string, unknown>, agent: Agent, label = ''): Promise<string | undefined> {
  const state = roleFor(deps.env.SEAT_MODS_ROLE, agent)
  if (state.kind === 'free') return state.role === 'orchestrator' && toolName === 'task' ? orchestratorSpawnDeny() : undefined
  if (state.kind === 'invalid') return invalidText(state.value)
  const role = state.role
  const child = agent?.kind !== 'main'

  // Transport args are raw: omp coerces values and expands keys before the inner tool runs.
  // Only these three devices are checked here; every other name keeps write placement.
  if (toolName === 'write' && typeof input.path === 'string') {
    const path = input.path.trim()
    const name = /^xd:\/\//i.test(path) ? path.slice(5) : undefined
    if (name === 'lsp' || name === 'ast_grep' || name === 'github') {
      if (typeof input.content !== 'string') return toolDeny(role, `xd://${name}`)
      if (/^\s*(\?|help)?\s*$/i.test(input.content)) return undefined // docs run nothing
      let args: unknown
      try { args = JSON.parse(input.content) } catch { return toolDeny(role, `xd://${name}`) }
      if (args === null || typeof args !== 'object' || Array.isArray(args)) return toolDeny(role, `xd://${name}`)
      if (hasExpandableKey(args)) return toolDeny(role, `xd://${name}`)
      return guard(deps, name, args as Record<string, unknown>, agent, 'xd://')
    }
  }

  switch (GUARDED_TOOLS.get(toolName)) {
    case 'pass':
      return undefined
    case 'top':
      return !child ? undefined : toolName === 'task' ? spawnDeny(role) : toolDeny(role, label + toolName)
    case 'lsp': {
      const action = typeof input.action === 'string' ? input.action.toLowerCase() : ''
      if (LSP_READS.has(action)) return undefined
      // rename, rename_file and applied code actions edit files the language server picks; request is raw.
      return role === 'reviewer' ? decide(role, { kind: 'write', place: 'worktree' }) : toolDeny(role, `${label}lsp ${action}`)
    }
    case 'github': {
      // pr_create / pr_push are the harness's own gh pr create / git push; a force-with-lease push is a force-push.
      const op = String(input.op)
      const forced = label === 'xd://'
        ? ['forceWithLease', 'force'].some(key => Object.hasOwn(input, key) && input[key] !== false)
        : input.forceWithLease === true || input.forceWithLease === 'true'
      const rules: RuleId[] = forced ? ['force-push'] : []
      if (op === 'pr_create') rules.push('pr-create')
      else if (op === 'pr_push') rules.push('push')
      // pr_checkout makes a worktree and branch outside this one (default ~/.omp/wt); `force` resets a branch.
      else if (op === 'pr_checkout') return decide(role, { kind: 'write', place: 'outside', allow: await allowOf(deps) })
      else if (!GITHUB_READS.has(op)) return toolDeny(role, `${label}github ${op}`)
      return rules.length === 0 ? undefined : decide(role, { kind: 'bash', rules })
    }
    case 'debug': {
      // debug launches a program, evaluates expressions and sends raw DAP requests: it runs code and can write.
      if (role !== 'implementer') return runDeny(role, label + toolName)
      const argv = [input.program, ...(Array.isArray(input.args) ? input.args : [])].filter(a => typeof a === 'string')
      const commands = [argv.join(' '), ...evalCommands(String(input.expression ?? '')), String(input.command ?? '')]
      const cwd = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : undefined // debug.ts: resolveToCwd
      return shellCheck(deps, role, commands.filter(c => c !== ''), () => cwd === undefined ? deps.cwd : ompPlace(cwd, deps.cwd, deps.env.HOME, 'cwd'))
    }
    case 'shell': {
      if (toolName === 'eval') {
        if (role === 'reviewer') return runDeny(role, label + toolName)
        return shellCheck(deps, role, evalCommands(String(input.code ?? '')), () => deps.cwd)
      }
      // bash takes its own cwd; rm operands and -F files resolve against it, not the session's.
      const cwd = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : undefined
      return shellCheck(deps, role, [String(input.command ?? '')], () => cwd === undefined ? deps.cwd : ompPlace(cwd, deps.cwd, deps.env.HOME, 'cwd'))
    }
    case 'write':
      return writeCheck(deps, role, toolName, input)
    default:
      return toolDeny(role, label + toolName)
  }
}

// `base` is the command's folder, or undefined when it is an omp URL (the embedded shell's filesystem): an rm
// there is outside, and a -F file there cannot be read.
async function shellCheck(deps: GuardDeps, role: Role, commands: string[], baseOf: () => string | undefined): Promise<string | undefined> {
  try {
    const base = baseOf()
    for (const command of commands) {
      const files = commitMessageFiles(command)
      if (files.length > 0 && base === undefined) throw new Error('commit message file under an omp URL cwd')
      const texts = await Promise.all(messagePaths(files, base as string, deps.env.HOME).map(f => deps.readFile(f).catch(() => '')))
      const removals = []
      for (const operand of rmTargets(command)) {
        const [root, allow] = await Promise.all([deps.worktree(), allowOf(deps)])
        if (operand.path === undefined) { removals.push(UNREAD); continue }
        const target = base === undefined ? undefined : await removalPath(deps, base, operand.path, operand.glob)
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

async function writeCheck(deps: GuardDeps, role: Role, toolName: string, input: Record<string, unknown>): Promise<string | undefined> {
  const targets = writeTargets(toolName, input) ?? []
  const [root, allow] = await Promise.all([deps.worktree(), allowOf(deps)])
  if (targets.length === 0) return decide(role, { kind: 'write', place: 'outside', allow })
  for (const raw of targets) {
    // `write xd://resolve` / `xd://reject` confirm or discard a preview an earlier, already-checked ast_edit staged.
    const places: Place[] = []
    if (toolName === 'write' && CONFIRM_ONLY.test(raw)) continue // names no file; acts on a preview already placed
    if (toolName === 'write' && LOCAL_SCRATCH.test(raw)) continue // session scratch omp confines (#844)
    else for (const reading of readings(raw, toolName === 'ast_edit')) {
      const path = toolName === 'ast_edit' ? globBase(reading) : reading
      let abs: string | undefined
      try { abs = path === undefined ? undefined : ompPlace(path, deps.cwd, deps.env.HOME, 'target') } catch { abs = undefined }
      const target = abs === undefined ? undefined : await deps.real(abs)
      places.push(target === undefined || root === undefined ? 'outside' : placeOf(target, root, allow))
    }
    for (const place of places) {
      const deny = decide(role, { kind: 'write', place, allow })
      if (deny !== undefined) return deny
    }
  }
  return undefined
}

// A `scheme:/` anywhere in a path. omp routes `scheme://` to a handler (local, vault, ssh, cfg, xd, agent, ...) and
// normalises `local:/x` and `dir/local://x` to `local://x` too, so the scan is deliberately loose: a false hit only denies.
const SCHEME = /[A-Za-z][A-Za-z0-9+.-]*:\//
// `write xd://resolve` / `xd://reject` take a one-sentence reason and apply or discard the preview that an earlier
// ast_edit call staged with its own (already checked) paths; they name no file. Only lsp, ast_grep and github
// device writes are checked as their inner tool in guard(), with raw-arg key and force-flag guards. Every other
// device name (docs included), special name and malformed device URL still fails placement.
const CONFIRM_ONLY = /^\s*xd:\/\/(?:resolve|reject)\s*$/
// #844: the write tool's `local://<name>` is omp's per-session scratch. omp confines it itself (absolute paths and `..`
// refused after URL decoding, real-path containment under the session's local root), so a guarded seat may write it.
// Only this exact lowercase form with a closed character set is taken: every other spelling, and every other tool,
// keeps write placement, where a scheme is outside (a false deny costs one turn).
const LOCAL_SCRATCH = /^local:\/\/(?!(?:.*\/)?\.\.?(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/

// The one reading of an omp path argument — a write-class target or a bash `cwd` — as omp's expandPath and
// resolveToCwd do it: a leading `:` before a path shape is dropped; `@` before `/abs`, `~`, `~/` or a URL is
// dropped; unicode spaces become spaces; a `file://` URL becomes its path; `~`, `~/x` and `~user` (read by omp as
// <home>/user) expand against HOME. Anything still carrying a `scheme:/` belongs to omp's URL router or its
// embedded shell's filesystem: undefined, which callers place outside. `/` alone is the session cwd; an absolute
// path is kept; a relative one is joined to the cwd — collapsed (path.resolve) for a `cwd`, as omp does, and left
// raw for a `target`, so realOf() follows links before `..` as the kernel will.
// `shell` reads a word the shell hands a program — an rm operand, a `-F` file — whose folder is the command's: it
// takes omp's spellings too (a false rewrite only denies) and a scheme is outside (omp's embedded coreutils route a
// URL operand to its backing file), but `/` stays the root and only an active `~` or `~/` is HOME (`~user` throws:
// that user's home is not known here). rmTargets and commitMessageFiles hand over a quoted `~` as literal.
export type PlaceMode = 'cwd' | 'target' | 'shell'
export function ompPlace(raw: string, cwd: string, home: string | undefined, mode: PlaceMode): string | undefined {
  let t = /^:(?=[/\\~]|\.\.?[/\\]|[A-Za-z]:)/.test(raw) ? raw.slice(1) : raw
  if (t.startsWith('@')) { const r = t.slice(1); if (r.startsWith('/') || r === '~' || r.startsWith('~/') || SCHEME.test(r)) t = r }
  t = t.replace(/[  -   　]/g, ' ')
  if (t.toLowerCase().startsWith('file://')) { try { t = fileURLToPath(t) } catch {} }
  if (SCHEME.test(t)) return undefined
  if (t.startsWith('~')) {
    if (home === undefined || !home.startsWith('/')) throw new Error('an omp ~ path needs HOME')
    const h = home.replace(/\/+$/, '') || '/'
    if (t === '~') t = h
    else if (t.startsWith('~/') || (mode !== 'shell' && t.startsWith('~\\'))) t = h === '/' ? t.slice(1) : h + t.slice(1)
    else if (mode === 'shell') throw new Error('~user is not read here')
    else t = join(h, t.slice(1))
  }
  if (mode !== 'shell' && /^\/+$/.test(t)) return cwd
  if (t.startsWith('/')) return t
  return mode === 'cwd' ? resolve(cwd, t) : absolute(cwd, t)
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
  const path = ompPlace(operand, base, deps.env.HOME, 'shell')
  if (path === undefined) return undefined
  if (glob || /\/(?:\.|\.\.)?$/.test(path)) return deps.real(path)
  const cut = path.lastIndexOf('/')
  const parent = await deps.real(cut === 0 ? '/' : path.slice(0, cut))
  return parent === undefined ? undefined : `${parent.replace(/\/$/, '')}/${path.slice(cut + 1)}`
}

// A `git commit -F` file, read where the shell will open it. commitMessageFiles drops the quotes around a whole
// value, so `"~/msg"` (literal, under the cwd) and `~/msg` (HOME) arrive alike: a leading `~` is read both ways
// and the texts are joined, the strictest reading winning. A scheme file, or a `~` file without HOME, throws:
// the caller reports the command as not checkable.
function messagePaths(files: string[], base: string, home: string | undefined): string[] {
  const paths: string[] = []
  for (const file of files) {
    const path = ompPlace(file, base, home, 'shell')
    if (path === undefined) throw new Error('a commit message file under an omp URL')
    paths.push(path)
    if (file.startsWith('~')) paths.push(absolute(base, file))
  }
  return paths
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
  pi.on('before_subagent_spawn', (_e: any, ctx: any) => spawnDecision(ctx.agent, process.env.SEAT_MODS_ROLE))
  pi.on('tool_call', async (e: any, ctx: any) => {
    // A throw in a tool_call handler blocks the call (fail closed, doc 018).
    const reason = await guard(depsFor(ctx), e.toolName, (e.input ?? {}) as Record<string, unknown>, ctx.agent)
    return reason === undefined ? undefined : { block: true, reason }
  })
}
