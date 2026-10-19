// Normalized operation facts and deterministic eligibility (Plan Task 5 §7 Step 3).
// Pure Autonomic logic and supplied canonical facts only: no OMP module, and no host call but one
// local, bounded `existsSync` on a resolved working directory, which exists so a literal cwd that
// does not exist is marked unresolved rather than classified against the pinned facts. It reads
// nothing else and a failure to read means unresolved, never a release. Every other fact here
// comes from the literal input and the pinned snapshot/placement; a model supplies no path, ref,
// flag or argv.
import { existsSync } from 'node:fs'
import type { EvidenceMaterial, Operation, PlacementFacts, Resource, Snapshot } from './authority'
import { rolePermits } from './authority'
import type { Finding, Where } from './never'
import { executionSegments, floorFindings, TRAILER } from './never'

export type Effect = {
  operation: Operation | null; resource: Resource | null; argv: string[]; cwd: string
  force: boolean; deletion: boolean; noVerify: boolean; merge: boolean; trailer: boolean
  targets: string[]; sourceObject: string | null; unresolved: string | null
}
export type OperationFacts = {
  inputSha256: string; tool: string; cwd: string; effects: Effect[]
  findings: Finding[]; unresolved: string[]
}
export type PermissionEligibility =
  | { kind: 'ask'; reason: string }
  | { kind: 'covered'; decision: 'allow' | 'ask'; grantIds: string[]; evidenceIds: string[]; reason: string }
  | { kind: 'semantic'; grantIds: string[]; evidenceIds: string[] }
export type ApprovedPermission = { inputSha256: string; grantIds: string[]; decision: 'allow' | 'ask'; evidenceIds: string[] }
// The exact structural shape of `PolicyBundle.approved.commands`; declared locally so no OMP
// module is imported here (the same pattern ApprovedPermission already uses).
export type ApprovedCommand = { grantId: string; argv: string[]; cwd: string; evidenceIds: string[] }
export type OperationContext = {
  inputSha256: string; facts: PlacementFacts; snapshot: Snapshot
  approved: ApprovedPermission[]; evidence: readonly EvidenceMaterial[]
  commands: readonly ApprovedCommand[]
}

const base = (w: string): string => w.replace(/^.*\//, '')
const isExactRef = (r: string): boolean => /^refs\/[^\s~^:?*[\\]+$/.test(r)
const exact = (r: string): string => r.replace(/^\+/, '')
// The push flag vocabulary this route can establish. An unknown flag may change the effect.
const PUSH_FLAGS = /^(?:-[uqvn]+|--(?:set-upstream|quiet|verbose|tags|follow-tags|atomic|porcelain|progress|no-progress|dry-run|thin|no-thin|force|force-with-lease|force-if-includes|delete|prune|mirror|all|branches|no-verify))$/
const SHORT_FORCE = /^-[A-Za-z]*f/
const SHORT_DELETE = /^-[A-Za-z]*d/
// `--follow-tags` writes annotated tag refs the push resource never names, so the grant no longer
// bounds every ref the push writes: like --tags/--mirror/--all/--branches it stays unresolved.
const PUSH_UNSUPPORTED = /^--(?:mirror|all|branches|tags|follow-tags)/
// The commit options whose value is a separate argv word: the short letters and the long names.
// A word one of these consumes is a value, never a path target, so `-m hello` cannot bound the
// commit to a file called hello. An option outside this table does not consume the next word, so a
// value it missed is read as a path — which only narrows the bound, the safe direction.
const COMMIT_SHORT_VALUE: Record<string, true> = { m: true, F: true, C: true, c: true, t: true }
const COMMIT_LONG_VALUE: Record<string, true> = { '--message': true, '--file': true, '--reuse-message': true,
  '--reedit-message': true, '--fixup': true, '--squash': true, '--author': true, '--date': true,
  '--template': true, '--cleanup': true, '--trailer': true, '--pathspec-from-file': true }
// The message-bearing commit options. Their value is the commit message, so a trailer in it is the
// red line; a message this module cannot read — from a file (`-F`/`--file`), another commit
// (`--reuse-message`/`--reedit-message`/`--squash`) or a template (`--template`) — cannot be shown
// trailer-free, so each takes the same red line rather than releasing unread bytes.
const COMMIT_FILE_LONG: Record<string, true> = { '--file': true, '--reuse-message': true, '--reedit-message': true,
  '--template': true, '--squash': true }
const SED_DELETE = /^(?:rm|unlink)$/
// Programs whose effects the approved-command vocabulary could name, so an exact approved
// executable+argv can authorize them. Path scope alone never does.
const COMMAND_PROGRAM = /^(?:bun|npm|npx|pnpm|yarn|cargo|go|make|pytest|uv|pip|tsc|eslint|prettier|ruff|vitest|jest|gradle|mvn|dotnet)$/

function resolveRef(ref: string, facts: PlacementFacts): string | null {
  const r = exact(ref)
  if (isExactRef(r)) return r
  if (r === 'HEAD' || r === '@') return facts.branch
  const head = `refs/heads/${r}`
  if (facts.sourceRefs[head] !== undefined || facts.branch === head) return head
  return null
}

// The owner/repo an origin-style URL names, for resolving a gh mutation's repository from facts.
function repoOf(url: string): string | undefined {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/]+@)?[^/:]+[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url)
  return m === null ? undefined : `${m[1]}/${m[2]}`
}

/** The literal argv index of `word` — the program at index 0, or an exact argument. */
const subAt = (argv: readonly string[], word: string): number => argv.indexOf(word)

/** git's subcommand word (past its global options), or undefined when there is none. */
function gitSub(argv: readonly string[]): string | undefined {
  for (let i = 1; i < argv.length; i++) {
    const w = argv[i]!
    if (w === '-C' || w === '-c' || w === '--git-dir' || w === '--work-tree' || w === '--namespace' || w === '--exec-path' || w === '--config-env') { i++; continue }
    if (w.startsWith('-')) continue
    return w
  }
  return undefined
}

function pushEffect(argv: readonly string[], ctx: OperationContext, cwd: string): Effect {
  const at = subAt(argv, 'push')
  const rest = at < 0 ? [] : argv.slice(at + 1)
  const effect: Effect = { operation: null, resource: null, argv: [...argv], cwd,
    force: false, deletion: false, noVerify: false, merge: false, trailer: false, targets: [], sourceObject: null, unresolved: null }
  const operands: string[] = []
  for (const w of rest) {
    if (w.startsWith('+')) { effect.force = true; operands.push(w.slice(1)); continue }
    if (w.startsWith('-')) {
      if (!PUSH_FLAGS.test(w)) effect.unresolved = `unknown push flag ${w}`
      if (w === '--force' || w.startsWith('--force') || SHORT_FORCE.test(w)) effect.force = true
      if (w === '--delete' || w === '--prune' || SHORT_DELETE.test(w)) effect.deletion = true
      if (w === '--no-verify') effect.noVerify = true
      if (PUSH_UNSUPPORTED.test(w)) effect.unresolved = `unsupported push effect ${w}`
      continue
    }
    operands.push(w)
  }
  const remote = operands[0]
  const specs = operands.slice(1)
  if (remote === undefined || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) return { ...effect, unresolved: effect.unresolved ?? 'no literal push remote' }
  if (ctx.facts.remotes[remote] === undefined) return { ...effect, unresolved: effect.unresolved ?? `remote ${remote} is not configured` }
  if (specs.length !== 1) return { ...effect, unresolved: effect.unresolved ?? 'push refspec is not exactly one source:destination' }
  const spec = specs[0]!
  const colon = spec.indexOf(':')
  const srcText = colon < 0 ? spec : spec.slice(0, colon)
  const dstText = colon < 0 ? spec : spec.slice(colon + 1)
  if (colon >= 0 && (srcText === '' || dstText === '')) { effect.deletion = true; return { ...effect, unresolved: effect.unresolved ?? 'a delete refspec' } }
  const src = resolveRef(srcText, ctx.facts)
  const dst = resolveRef(dstText, ctx.facts)
  if (src === null || dst === null) return { ...effect, unresolved: effect.unresolved ?? 'a push ref is not resolvable against the pinned facts' }
  if (effect.unresolved !== null) return { ...effect, sourceObject: src }
  return { ...effect, operation: 'git.push-own-branch', sourceObject: src,
    resource: { kind: 'push', repository: ctx.facts.repository, remote, sourceRef: src, destinationRef: dst } }
}

/** The HTTP method a `gh api` call names, uppercased, or undefined when it names none. */
function ghMethod(rest: readonly string[]): string | undefined {
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]!
    if (w === '-X' || w === '--method') { const v = rest[i + 1]; return v === undefined || v.startsWith('-') ? undefined : v.toUpperCase() }
    if (w.startsWith('--method=')) { const v = w.slice(9); return v === '' ? undefined : v.toUpperCase() }
    if (/^-X./.test(w)) return w.slice(2).toUpperCase()
  }
  return undefined
}
// The `gh api` methods that can be a bounded PR/issue update. DELETE is a delete (its own red
// line), and anything else — PUT on a merge endpoint, or a method this route does not know — is
// not classified as a benign update: only the model's reading of raw argv would stand between the
// call and execution otherwise.
const API_UPDATE_METHODS: Record<string, true> = { GET: true, HEAD: true, POST: true, PATCH: true }

function ghEffect(argv: readonly string[], ctx: OperationContext, cwd: string): Effect {
  const effect: Effect = { operation: null, resource: null, argv: [...argv], cwd,
    force: false, deletion: false, noVerify: false, merge: false, trailer: false, targets: [], sourceObject: null, unresolved: null }
  const at = subAt(argv, 'gh')
  const rest = at < 0 ? [] : argv.slice(at + 1)
  const sub = rest[0]
  const path = rest.find(w => w.startsWith('repos/')) ?? ''
  const pathAction = /\/(?:pulls|issues)\/\d+\/([a-z_]+)(?:\/\d+\/([a-z_]+))?/.exec(path)
  let ownerRepo: string | undefined
  let number: number | undefined
  let merge = false
  const pathRepo = /^repos\/([^/]+\/[^/]+)\/(?:pulls|issues)\/(\d+)/.exec(path)
  if (pathRepo !== null) { ownerRepo = pathRepo[1]; number = Number(pathRepo[2]) }
  if (/\/merge$/.test(path)) merge = true
  if (sub === 'pr' || sub === 'issue') {
    const n = rest.find(w => /^\d+$/.test(w))
    if (n !== undefined) number = Number(n)
    if (rest.includes('merge')) merge = true
  }
  // The create branch is computed before the identity check: `gh pr create` names no existing
  // pull request, and rejecting it for a missing identity first made pr.create-own unreachable.
  const create = sub === 'pr' && rest.includes('create')
  if (merge) return { ...effect, merge: true, unresolved: 'a merge is operator-owned' }
  if (sub === 'api') {
    const method = ghMethod(rest)
    if (method === 'DELETE') return { ...effect, deletion: true, unresolved: 'a delete is operator-owned' }
    if (method !== undefined && API_UPDATE_METHODS[method] !== true) return { ...effect, unresolved: `the ${method} method names no bounded update` }
  }
  // An explicit repository selector names the target, so it is resolved from the call's own words
  // before the identity check — and it must still resolve to a configured remote. Without this,
  // `gh pr edit 1 -R other/repo` (or --repo=, or attached -R…) defaulted to the single origin's
  // owner/repo and a grant for our own PR 1 matched a call acting on another repository.
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]!
    const v = w === '-R' || w === '--repo' ? rest[i + 1] : w.startsWith('--repo=') ? w.slice(7) : /^-R./.test(w) ? w.slice(2) : undefined
    if (v !== undefined) {
      if (ownerRepo !== undefined && ownerRepo !== v) return { ...effect, unresolved: 'conflicting repository identity' }
      ownerRepo = v
    }
    // `--hostname` names a GitHub host that is not a pinned fact: the remotes pin the repository,
    // never the host it is reached through.
    if (w === '--hostname' || w.startsWith('--hostname=')) return { ...effect, unresolved: 'an explicit gh host is not a pinned fact' }
  }
  if (!create && (number === undefined || !Number.isSafeInteger(number) || number <= 0)) return { ...effect, unresolved: 'no exact pull-request/issue identity' }
  // The repository resolves only from the configured remotes: a named owner/repo must match one,
  // and an unnamed one needs exactly one configured remote to be unambiguous.
  const urls = Object.values(ctx.facts.remotes)
  const named = ownerRepo ?? (urls.length === 1 ? repoOf(urls[0]!) : undefined)
  if (named === undefined) return { ...effect, unresolved: 'no exact repository identity' }
  if (!urls.some(url => repoOf(url) === named)) return { ...effect, unresolved: `repository ${named} is not a configured remote` }
  if (ctx.facts.branch === null) return { ...effect, unresolved: 'no exact head ref' }
  // The action is the argv word, or the path's own segment (`…/1/comments/2/replies`).
  const wordAction = rest.find(w => ['comment', 'edit', 'review', 'replies', 'merge', 'create'].includes(w))
  const action = wordAction ?? pathAction?.[2] ?? pathAction?.[1]
  if (action === undefined || action === 'view') return { ...effect, unresolved: 'no exact gh action' }
  return { ...effect, operation: create ? 'pr.create-own' : 'pr.update-own',
    resource: { kind: 'pr', repository: ctx.facts.repository, headRef: ctx.facts.branch, number: create ? null : number } }
}

function rmEffect(argv: readonly string[], ctx: OperationContext, cwd: string): Effect {
  const effect: Effect = { operation: null, resource: null, argv: [...argv], cwd,
    force: false, deletion: true, noVerify: false, merge: false, trailer: false, targets: [], sourceObject: null, unresolved: null }
  const at = subAt(argv, 'rm')
  const rest = at < 0 ? [] : argv.slice(at + 1)
  const targets = rest.filter(w => !w.startsWith('-'))
  if (targets.length === 0) return { ...effect, unresolved: 'no literal rm target' }
  return { ...effect, targets }
}

/** The absolute target of a literal relative or absolute path, as the pinned worktree reads it. */
const targetPath = (facts: PlacementFacts, target: string): string =>
  target.startsWith('/') ? target : `${facts.worktree}/${target.replace(/^\.\//, '')}`

function commitEffect(argv: readonly string[], ctx: OperationContext, cwd: string): Effect {
  const effect: Effect = { operation: null, resource: null, argv: [...argv], cwd,
    force: false, deletion: false, noVerify: false, merge: false, trailer: false, targets: [], sourceObject: null, unresolved: null }
  const at = subAt(argv, 'commit')
  const rest = at < 0 ? [] : argv.slice(at + 1)
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]!
    // Everything past `--` is a pathspec, whatever it spells.
    if (w === '--') { for (i++; i < rest.length; i++) effect.targets.push(rest[i]!); break }
    if (!w.startsWith('-')) { effect.targets.push(w); continue }
    if (w === '--no-verify' || /^-[A-Za-z]*n/.test(w)) effect.noVerify = true
    // The literal paths bound only an `--only` commit: `--include`/`-i` adds everything already
    // staged, and `--amend` keeps HEAD's whole tree and message, so the commit carries content the
    // path bound never names.
    if (w === '--include' || w === '--amend') { effect.unresolved ??= 'the commit carries content outside its literal paths'; continue }
    if (w.startsWith('--')) {
      const eq = w.indexOf('=')
      const name = eq < 0 ? w : w.slice(0, eq)
      const inline = eq < 0 ? undefined : w.slice(eq + 1)
      // `--message <value>` and `--message=<value>`: a trailer in the message is the red line. An
      // empty inline value takes the next word, because a quoted value is its own argv word once
      // the segment's masking has split it (`--message="Co-Authored-By: …"` arrives as two words).
      if (name === '--message') { const value = inline === undefined || inline === '' ? (rest[++i] ?? '') : inline; if (TRAILER.test(value)) effect.trailer = true; continue }
      // An explicit `--trailer <value>` IS a trailer, whatever it names, and its value is consumed
      // here rather than read as a pathspec.
      if (name === '--trailer') { effect.trailer = true; if (inline === undefined || inline === '') i++; continue }
      // `--file <path>`, `--file=<path>` and the message sources this module cannot read
      // (`--reuse-message`, `--reedit-message`, `--template`, `--squash`): the message bytes come
      // from a file, another commit or a template, so they cannot be shown to hold no trailer — the
      // red line covers them rather than releasing unread bytes.
      if (COMMIT_FILE_LONG[name] === true) { effect.trailer = true; if (inline === undefined) i++; continue }
      if (COMMIT_LONG_VALUE[name] === true) { if (inline === undefined) i++; continue }
      continue
    }
    // A short cluster (`-m x`, `-am x`, `-amx`): read left to right, and the first letter that
    // takes a value ends the cluster — what follows it in the word is the value, else the next word.
    const letters = w.slice(1)
    for (let k = 0; k < letters.length; k++) {
      const letter = letters[k]!
      if (COMMIT_SHORT_VALUE[letter] !== true) {
        // A letter ahead of the first value-taking letter is another boolean option in the cluster:
        // `-i` is `--include` (see above). A letter after that first one is inside its value, so it
        // is never read here.
        if (letter === 'i') effect.unresolved ??= 'the commit carries content outside its literal paths'
        continue
      }
      const attached = letters.slice(k + 1)
      const value = attached === '' ? (rest[++i] ?? '') : attached
      if (letter === 'm') { if (TRAILER.test(value)) effect.trailer = true }
      // F sources the message from a file, C/c reuse another commit's message, t from a template:
      // bytes this module never read, so each takes the red line.
      else if (letter === 'F' || letter === 'C' || letter === 'c' || letter === 't') effect.trailer = true
      break
    }
  }
  if (ctx.facts.branch === null) return { ...effect, unresolved: 'no exact commit branch' }
  return { ...effect, operation: 'git.commit',
    resource: { kind: 'commit', repository: ctx.facts.repository, branch: ctx.facts.branch,
      paths: effect.targets.map(t => targetPath(ctx.facts, t)) } }
}

function approvedCommandEffect(argv: readonly string[], ctx: OperationContext, cwd: string): Effect {
  const effect: Effect = { operation: null, resource: null, argv: [...argv], cwd,
    force: false, deletion: false, noVerify: false, merge: false, trailer: false, targets: [], sourceObject: null, unresolved: null }
  const match = ctx.commands.find(c => c.cwd === cwd && c.argv.length === argv.length && c.argv.every((w, i) => w === argv[i]))
  const grant = match === undefined ? undefined : ctx.snapshot.grants.find(g => g.id === match.grantId)
  if (grant === undefined || grant.resource.kind !== 'paths') return { ...effect, unresolved: 'no exact approved executable/argv evidence for this command' }
  return { ...effect, operation: grant.operation, resource: grant.resource }
}

/** Classify one literal segment into the existing approved vocabulary, or leave it unresolved.
 *  A segment that runs outside the pinned worktree, or in a directory that does not exist, can
 *  never be matched to the task's own resources, so it resolves to unresolved rather than being
 *  classified against the pinned facts (Plan §7 Step 3: known cwd changes are resolved to facts
 *  or marked unresolved). The existence read is local and bounded; it fails closed. */
function effectOf(argv: readonly string[], ctx: OperationContext, cwd: string): Effect {
  const pinned = ctx.facts.worktree
  if (cwd !== pinned && !cwd.startsWith(pinned + '/')) {
    return { operation: null, resource: null, argv: [...argv], cwd, force: false, deletion: false,
      noVerify: false, merge: false, trailer: false, targets: [], sourceObject: null,
      unresolved: `the command runs in ${cwd}, outside the pinned worktree` }
  }
  if (!existsSync(cwd)) {
    return { operation: null, resource: null, argv: [...argv], cwd, force: false, deletion: false,
      noVerify: false, merge: false, trailer: false, targets: [], sourceObject: null,
      unresolved: `the command's working directory ${cwd} does not exist` }
  }
  const name = argv[0] === undefined ? '' : base(argv[0])
  if (name === 'git') {
    const sub = gitSub(argv)
    if (sub === 'push') return pushEffect(argv, ctx, cwd)
    if (sub === 'commit') return commitEffect(argv, ctx, cwd)
    if (sub === 'merge') {
      return { operation: null, resource: null, argv: [...argv], cwd, force: false, deletion: false,
        noVerify: false, merge: true, trailer: false, targets: [], sourceObject: null, unresolved: 'a merge is operator-owned' }
    }
    if (sub === 'rm') return { ...rmEffect(argv, ctx, cwd), deletion: true }
    return { operation: null, resource: null, argv: [...argv], cwd, force: false, deletion: false,
      noVerify: false, merge: false, trailer: false, targets: [], sourceObject: null, unresolved: `git ${sub ?? ''} names no approved effect` }
  }
  if (name === 'gh') return ghEffect(argv, ctx, cwd)
  if (SED_DELETE.test(name)) return rmEffect(argv, ctx, cwd)
  if (COMMAND_PROGRAM.test(name)) return approvedCommandEffect(argv, ctx, cwd)
  return { operation: null, resource: null, argv: [...argv], cwd, force: false, deletion: false,
    noVerify: false, merge: false, trailer: false, targets: [], sourceObject: null, unresolved: `${name || 'this program'} names no approved effect` }
}

const defaultBranchOf = (facts: PlacementFacts): string | undefined => {
  const first = facts.defaultRefs[0]
  if (first === undefined) return undefined
  const local = first.replace(/^refs\/remotes\/[^/]+\//, 'refs/heads/')
  return local.split('/').pop()
}
const whereFor = (facts: PlacementFacts): Where => ({ cwd: facts.cwd, root: facts.repository, home: '',
  ...(facts.branch === null ? {} : { branch: facts.branch.replace(/^refs\/heads\//, '') }),
  ...(defaultBranchOf(facts) === undefined ? {} : { defaultBranch: defaultBranchOf(facts)! }) })

/**
 * Re-attach a segment's shell redirections as write targets of its own effect. `executionSegments`
 * strips a redirection from argv, so without this the write it names appears in no effect at all
 * and a released call carries an unexamined write target. A commit's path bound then covers it; an
 * effect that cannot express a path bound (a push or a PR) has nothing to bound the write with, so
 * it becomes unresolved rather than released.
 */
function withRedirects(effect: Effect, facts: PlacementFacts, redirects: readonly string[]): Effect {
  if (redirects.length === 0) return effect
  const targets = [...effect.targets, ...redirects]
  if (effect.resource?.kind === 'commit') {
    return { ...effect, targets, resource: { ...effect.resource,
      paths: [...effect.resource.paths, ...redirects.map(t => targetPath(facts, t))] } }
  }
  return { ...effect, targets, unresolved: effect.unresolved ?? 'a shell redirection is a write target this effect cannot bound' }
}

/**
 * The normalized facts of a tool call: ordered literal effects, the retained floor findings and
 * anything that could not be established. The floor's bag-of-words is never promoted to facts.
 */
export function operationFacts(tool: string, input: unknown, context: OperationContext,
  readers: readonly (readonly string[])[]): OperationFacts {
  const command = (input as { command?: unknown } | null | undefined)?.command
  const text = typeof command === 'string' ? command : ''
  const facts = context.facts
  const where = whereFor(facts)
  const findings = text === '' ? [] : floorFindings(text, where, readers).findings
  const effects: Effect[] = []
  if (text !== '') for (const s of executionSegments(text, facts.cwd, facts.worktree)) {
    if (s.opaque) {
      effects.push({ operation: null, resource: null, argv: s.argv, cwd: s.cwd, force: false, deletion: false, noVerify: false,
        merge: false, trailer: false, targets: [...s.redirects], sourceObject: null, unresolved: 'the segment\'s effects cannot be established' })
      continue
    }
    if (s.argv.length === 0) {
      // A segment that is only a redirection writes the file it names — it has an effect even
      // though it runs no program, and this route has no bound to apply to it.
      if (s.redirects.length > 0) effects.push({ operation: null, resource: null, argv: [], cwd: s.cwd, force: false,
        deletion: false, noVerify: false, merge: false, trailer: false, targets: [...s.redirects],
        sourceObject: null, unresolved: 'a write target with no program to bound it' })
      continue
    }
    effects.push(withRedirects(effectOf(s.argv, context, s.cwd), facts, s.redirects))
  }
  // A structured native force-with-lease is a real force push, read from its own field.
  if (tool === 'github') {
    const native = input !== null && typeof input === 'object' ? input as Record<string, unknown> : {}
    if (native.op === 'pr_push') {
      const ref = typeof native.branch === 'string' && /^[\w./-]+$/.test(native.branch) ? native.branch : 'HEAD'
      const target = resolveRef(ref, facts)
      const force = native.forceWithLease === true || native.forceWithLease === 'true'
      effects.push({ operation: 'git.push-own-branch', resource: target === null ? null : { kind: 'push', repository: facts.repository, remote: 'origin', sourceRef: target, destinationRef: target },
        argv: ['git', 'push', ...(force ? ['--force-with-lease'] : []), 'origin', ref], cwd: facts.cwd, force, deletion: false, noVerify: false, merge: false, trailer: false,
        targets: [], sourceObject: target, unresolved: target === null ? 'the native push ref is not resolvable' : null })
    }
  }
  const unresolved = effects.map(e => e.unresolved).filter((r): r is string => r !== null)
  return { inputSha256: context.inputSha256, tool, cwd: facts.cwd, effects, findings, unresolved }
}

/** The lease-verifiable task evidence IDs: the only evidence a record may cite. */
function taskEvidence(context: OperationContext): string[] {
  const ids = new Set([...context.snapshot.task.scopeRefs, ...context.snapshot.task.instructionRefs].map(r => r.id))
  const known = new Set(context.evidence.map(e => e.ref.id))
  return [...ids].filter(id => known.has(id))
}

function resourceMatches(a: Resource, b: Resource): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'push' && b.kind === 'push') return a.remote === b.remote && a.sourceRef === b.sourceRef && a.destinationRef === b.destinationRef
  // Every path the commit names must sit inside a bound the grant names (the same containment the
  // paths resource and `narrows` use). An index commit names no path at all, which is an unbounded
  // effect: the empty list must never match a roots-bounded grant vacuously, so it matches only a
  // grant that carries no path bound of its own — and a snapshot never issues one, so an index
  // commit asks.
  if (a.kind === 'commit' && b.kind === 'commit') return a.branch === b.branch &&
    (a.paths.length === 0 ? b.paths.length === 0 : a.paths.every(p => b.paths.some(root => p === root || p.startsWith(root === '/' ? '/' : `${root}/`))))
  if (a.kind === 'pr' && b.kind === 'pr') return a.headRef === b.headRef && a.number === b.number
  if (a.kind === 'paths' && b.kind === 'paths') return b.roots.some(root => a.roots.some(r => r === root || r.startsWith(`${root}/`)))
  return false
}
/** Whether one live grant covers one effect: the same operation and a resource the effect is inside. */
function grantCovers(grant: Snapshot['grants'][number], effect: Effect): boolean {
  return effect.operation === grant.operation && effect.resource !== null && resourceMatches(effect.resource, grant.resource)
}
const inProtected = (ref: string, facts: PlacementFacts): boolean =>
  [...facts.defaultRefs, ...facts.protectedRefs].some(p => p === ref || p.replace(/^refs\/remotes\/[^/]+\//, 'refs/heads/') === ref)

/**
 * The deterministic order of Step 3: role ceiling and floor interception; red lines and
 * operator gates; complete facts for every segment; live positive matching grants; an exact
 * already-approved decision; otherwise semantic ambiguity inside those matched grants.
 */
export function permissionEligibility(facts: OperationFacts, context: OperationContext): PermissionEligibility {
  if (facts.effects.length === 0) return { kind: 'ask', reason: 'no literal effect to bound' }
  const evidenceIds = taskEvidence(context)
  const role = context.snapshot.seat.role
  // 1. Role ceiling: a guarded role's denied operation is never released by a matching grant.
  for (const e of facts.effects) {
    if (e.operation !== null && !rolePermits(role, e.operation)) return { kind: 'ask', reason: `the ${role} seat does not hold ${e.operation}` }
  }
  // 2. Red lines and operator gates. A force effect leaves red line 2 only when its destination is
  // the seat's own branch and that branch is not the default (the same reading as never.ts's
  // ownForceDestination; call 4: no resource, another destination, a missing branch or the default
  // name all stay on the floor). Delete effects have no clause of their own any more (0.10.0):
  // complete facts plus a covering grant reach the judge, and anything else asks below.
  const own = context.facts.branch
  const ownShort = own === null ? null : own.replace(/^refs\/heads\//, '')
  const ownBranchDefault = defaultBranchOf(context.facts)
  const defaultNames = ownBranchDefault === undefined ? ['main', 'master'] : [ownBranchDefault]
  for (const e of facts.effects) {
    if (e.force && !(ownShort !== null && e.resource?.kind === 'push' && e.resource.destinationRef === own && !defaultNames.includes(ownShort))) return { kind: 'ask', reason: 'a force effect is operator-owned' }
    if (e.noVerify) return { kind: 'ask', reason: '--no-verify is operator-owned' }
    if (e.merge) return { kind: 'ask', reason: 'a merge is operator-owned' }
    if (e.trailer) return { kind: 'ask', reason: 'an AI trailer is operator-owned' }
    if (e.unresolved !== null) return { kind: 'ask', reason: e.unresolved }
    if (e.resource?.kind === 'push' && inProtected(e.resource.destinationRef, context.facts)) return { kind: 'ask', reason: 'the destination is a default or protected ref' }
  }
  // 3. Complete facts for every segment.
  if (facts.unresolved.length > 0) return { kind: 'ask', reason: facts.unresolved[0]! }
  for (const e of facts.effects) if (e.operation === null || e.resource === null) return { kind: 'ask', reason: 'an effect is not bounded by the approved vocabulary' }
  // 4. Live positive matching grants, one per effect: a compound command is routable exactly when
  // the live grant SET covers every one of its effects (the red lines and the role ceiling above
  // have already applied effect by effect), and the matched set is what the record names.
  const grants = context.snapshot.grants.filter(g => facts.effects.some(e => grantCovers(g, e)))
  if (!facts.effects.every(e => grants.some(g => grantCovers(g, e)))) return { kind: 'ask', reason: 'no applicable grant' }
  const grantIds = grants.map(g => g.id)
  // 5. An exact already-approved decision decides it deterministically, with no inference.
  const approved = context.approved.find(a => a.inputSha256 === context.inputSha256 && a.grantIds.every(id => grantIds.includes(id)))
  if (approved !== undefined) {
    return { kind: 'covered', decision: approved.decision, grantIds: approved.grantIds,
      evidenceIds: approved.evidenceIds.filter(id => evidenceIds.includes(id)),
      reason: `the approved decision ${approved.inputSha256.slice(0, 12)} covers this input` }
  }
  // 6. Otherwise a bounded semantic ambiguity, inside exactly these grants and this evidence.
  return { kind: 'semantic', grantIds, evidenceIds }
}
