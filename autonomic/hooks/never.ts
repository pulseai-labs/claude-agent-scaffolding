import { commandOf, gitOf, segments } from './shell'

// The never-approve list (spec §3.3): checked in code before any fork. A match leaves the
// ask in place. Unknown means listed: a path or a branch autonomic cannot read is
// treated as the dangerous one.

export type NeverRule = 'force-push' | 'default-branch-push' | 'branch-delete' | 'rm-outside' | 'no-verify' | 'unreadable'
export type Where = { cwd: string; root: string; home: string; branch?: string; defaultBranch?: string }

// Blanked text (a \u0000 marker), a variable, a substitution or a glob home is unreadable.
function resolve(path: string, cwd: string, home: string): string | undefined {
  // A brace or a backslash may expand to `..`, and a glob on a dot name may match it (bash 3.2) (PR #681).
  if (/[\u0000$`{\\]/.test(path) || /(?:^|\/)\.[^/]*[*?[]/.test(path)) return undefined
  const abs = path === '~' ? home : path.startsWith('~/') ? `${home}/${path.slice(2)}` : path.startsWith('/') ? path : `${cwd}/${path}`
  if (abs.startsWith('~')) return undefined
  const out: string[] = []
  for (const part of abs.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return `/${out.join('/')}`
}

// Strictly below the root: removing the worktree itself is outside.
const below = (path: string, root: string) => path.startsWith(`${root.replace(/\/+$/, '')}/`)

// Shapes the shared reader does not follow (final review I1). A segment led by one of these,
// or holding a backtick or $( outside quotes, is unreadable; it is listed when the command
// names a danger at all. Keywords that only open a block are stripped and the rest is read.
const RUNNERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'eval', 'xargs', 'timeout', 'nice', 'ionice', 'watch', 'parallel', 'find', 'su', 'doas', 'ssh',
  // Wrappers that run the program they are given (PR #681 round 4).
  // A path-qualified wrapper (/usr/bin/env) is not skipped by the shared reader (round 6).
  'env', 'sudo', 'command', 'exec', 'nohup', 'time',
  'setsid', 'stdbuf', 'taskset', 'flock', 'chroot', 'chrt', 'systemd-run', 'nsenter', 'unshare', 'numactl', 'runuser', 'setpriv', 'sg', 'firejail', 'unbuffer', 'caffeinate', 'script', 'strace', 'ltrace'])
// An interpreter runs a program the reader never sees (its quoted text is blanked), so it is
// a runner too (PR #681): `python3 -c '…git push -f…'`.
const INTERPRETER = /^(?:python[\d.]*|pypy[\d.]*|node|nodejs|deno|bun|perl[\d.]*|ruby[\d.]*|php[\d.]*|lua(?:jit)?[\d.]*|Rscript|pwsh|powershell|osascript|tclsh|expect|[gmn]?awk)$/
// git globals that take no value. Any other global the shared reader cannot skip with its
// value, so the word after it is taken for the subcommand (PR #681).
const GIT_FLAGS = new Set(['-p', '-P', '--paginate', '--no-pager', '--bare', '--no-replace-objects', '--no-lazy-fetch',
  '--no-optional-locks', '--no-advice', '--literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs'])
// GNU and git accept a unique prefix of a long option: `--forc` is --force, `--recurs` is
// --recursive. A prefix of a dangerous option is read as that option (PR #681).
const LONGS = ['--force', '--force-with-lease', '--mirror', '--delete', '--prune', '--all', '--branches', '--no-verify', '--recursive']
const expand = (a: string): string => (/^--[a-z][a-z-]*$/.test(a) && !LONGS.includes(a) ? (LONGS.find(l => l.startsWith(a)) ?? a) : a)
const OPENERS = new Set(['if', 'then', 'do', 'else', 'elif', 'while', 'until', '{', '}', '!'])
const DANGER = /\bpush\b|\brm\b|\bbranch\b|\bcommit\b|--no-verify|\bsend-pack\b|\bhttp-push\b/
// The cheap pre-check: every rule neverRules finds needs one of these words, so a command
// without one runs no git (the bypass floor, 0.1.1 §3.1).
// Bash drops a backslash and joins quoted pieces, so `pu\sh` and `pu""sh` are push (PR #681).
export const namesDanger = (command: string): boolean => DANGER.test(command.replace(/[\\'"]/g, ''))
const OPTION_VALUES = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec'])
// Commit options whose next word is a message, a path or a name, never a flag.
const COMMIT_VALUES = new Set(['-m', '--message', '-F', '--file', '-C', '-c', '--reuse-message', '--reedit-message',
  '--author', '--date', '--fixup', '--squash', '-t', '--template', '--trailer', '--cleanup'])

// -uf is -u -f: a cluster of short flags is read flag by flag.
// -nF/tmp/m is -n -F /tmp/m: a cluster is split up to the first option that takes a value,
// and the rest is that value (PR #681 round 4).
const SHORT_VALUES = new Set(['m', 'F', 'C', 'c', 't', 'o', 'S'])
function cluster(a: string): string[] {
  if (!/^-[A-Za-z]./.test(a)) return [expand(a)]
  const out: string[] = []
  for (let i = 1; i < a.length; i++) {
    const c = a[i]!
    if (!/[A-Za-z]/.test(c)) { out.push(a.slice(i)); break }
    out.push(`-${c}`)
    if (SHORT_VALUES.has(c)) { if (i + 1 < a.length) out.push(a.slice(i + 1)); break }
  }
  return out
}
const flags = (args: readonly string[]) => args.flatMap(cluster)

// A lone & ends a command as ; does, spaced or not (`sleep 1&git push`); the shared reader
// splits only on &&. The & of a redirect (2>&1, &>log) is not one.
const AMP = /(?<![<>&])&(?![>&])/

// A redirect and its target are not arguments: `git push >/dev/null` names no remote,
// and `-f>/dev/null` is -f.
const REDIRECT = /^(?:\d+|&)?(?:>>|>&|>\||<<<|<&|<>|>|<)/
function unredirect(tokens: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    const op = REDIRECT.exec(t)
    if (op !== null) { if (t.length === op[0].length) i += 1; continue }
    const at = t.search(/[<>]/)
    if (at < 0) { out.push(t); continue }
    out.push(t.slice(0, at))
    const rest = REDIRECT.exec(t.slice(at))
    if (rest !== null && t.length - at === rest[0].length) i += 1
  }
  return out
}

function pieces(tokens: readonly string[]): string[][] {
  const out: string[][] = [[]]
  for (const t of tokens) {
    t.split(AMP).forEach((part, k) => {
      if (k > 0) out.push([])
      if (part !== '') out[out.length - 1]!.push(part)
    })
  }
  return out.map(unredirect)
    .map(p => { let i = 0; while (p[i] !== undefined && OPENERS.has(p[i]!)) i += 1; return p.slice(i) }).filter(p => p.length > 0)
}

// Quoted text (a \u0000 marker) or a variable: a word autonomic cannot read.
const opaque = (t: string) => /[\u0000$\\{]/.test(t)

const recursive = (args: readonly string[]) =>
  args.some(a => expand(a) === '--recursive' || /^-[A-Za-z]*[rR][A-Za-z]*$/.test(a))

// True when every git global before the subcommand is one the reader can skip: -C or -c with
// its value (an inline alias is not readable), --name=value, or a global that takes no value.
function readableGlobals(tokens: readonly string[]): boolean {
  const g = commandOf(tokens)?.args ?? []
  for (let i = 0; g[i]?.startsWith('-'); i += 1) {
    const a = g[i]!
    if (a === '-C') { i += 1; continue }
    if (a === '-c') { if ((g[i + 1] ?? '').startsWith('alias.')) return false; i += 1; continue }
    if (a.startsWith('--config-env')) return false
    if (/^--[a-z-]+=/.test(a) || GIT_FLAGS.has(a)) continue
    return false
  }
  return true
}

function positionalOf(args: readonly string[]): string[] {
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (OPTION_VALUES.has(a)) { i += 1; continue }
    if (!a.startsWith('-')) positional.push(a)
  }
  return positional
}

function pushesDefault(args: readonly string[], refspecsAfter: readonly string[], where: Where): boolean {
  const defaults = where.defaultBranch !== undefined ? [where.defaultBranch] : ['main', 'master']
  if (args.includes('--all') || args.includes('--branches') || args.includes('--mirror')) return true
  const positional = positionalOf(args)
  // The first positional is the remote, unless --repo named it (PR #681).
  const repo = args.some(a => a === '--repo' || a.startsWith('--repo='))
  const refspecs = [...(repo ? positional : positional.slice(1)), ...refspecsAfter]
  const current = (ref: string) => (ref === 'HEAD' || ref === '@' ? where.branch : ref)
  if (refspecs.length === 0) return where.branch === undefined || defaults.includes(where.branch)
  return refspecs.some(spec => {
    const raw = spec.replace(/^\+/, '')
    const dst = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : current(raw)
    // A wildcard destination may match the default branch (PR #681 round 3).
    // ':' alone is the matching refspec: every matching branch, the default included (round 6).
    if (dst === undefined || dst === '' || dst.includes('*')) return true
    return defaults.includes(dst.replace(/^refs\/heads\//, ''))
  })
}

// The directory a git call runs in: -C moves it; --git-dir and --work-tree make it unknown.
function gitDirOf(tokens: readonly string[], dir: string | undefined, home: string): string | undefined {
  const g = commandOf(tokens)?.args ?? []
  let at = dir
  for (let i = 0; g[i]?.startsWith('-'); i += g[i] === '-C' || g[i] === '-c' ? 2 : 1) {
    const v = g[i + 1]
    if (g[i] === '-C') at = v === undefined || (at === undefined && !v.startsWith('/')) ? undefined : resolve(v, at ?? '/', home)
    else if (/^--(git-dir|work-tree)\b/.test(g[i]!)) at = undefined
  }
  return at
}

// The bodies of $(…) and `…` inside double quotes: Bash runs them, though the shared reader
// blanks the quoted text around them. Each body is read as a command of its own.
function quotedSubstitutions(command: string): string[] {
  const out: string[] = []
  let inDouble = false
  for (let i = 0; i < command.length; ) {
    const c = command[i]
    if (c === '\\') { i += 2; continue }
    if (!inDouble && c === "'") { const j = command.indexOf("'", i + 1); i = j < 0 ? command.length : j + 1; continue }
    if (c === '"') { inDouble = !inDouble; i += 1; continue }
    if (inDouble && c === '$' && command[i + 1] === '(') {
      let depth = 1
      let j = i + 2
      for (; j < command.length && depth > 0; j++) {
        if (command[j] === '\\') j += 1
        else if (command[j] === '(') depth += 1
        else if (command[j] === ')') depth -= 1
      }
      out.push(command.slice(i + 2, depth === 0 ? j - 1 : j))
      i = j
      continue
    }
    if (inDouble && c === '`') {
      const j = command.indexOf('`', i + 1)
      out.push(command.slice(i + 1, j < 0 ? command.length : j))
      i = j < 0 ? command.length : j + 1
      continue
    }
    i += 1
  }
  return out
}

export function neverRules(command: string, where: Where): NeverRule[] {
  const found = new Set<NeverRule>()
  // An unquoted heredoc runs its $( ) and backticks; the shared reader blanks the body (round 6).
  if (/<<-?[ \t]*(?!['"])[^\s;&|<>()]/.test(command) && /\$\(|`/.test(command) && namesDanger(command)) found.add('unreadable')
  for (const body of quotedSubstitutions(command)) for (const r of neverRules(body, where)) found.add(r)
  let cwd: string | undefined = where.cwd
  let dir: string | undefined = where.cwd   // followed through cd, for the repo check only
  for (const tokens of segments(command).flatMap(pieces)) {
    const head = commandOf(tokens)
    if (head === undefined) continue
    if (head.name.startsWith('-') || opaque(head.name) || RUNNERS.has(head.name) || INTERPRETER.test(head.name) || tokens.some(t => t.includes('`') || t.includes('$('))) {
      if (namesDanger(command)) found.add('unreadable')
    }
    if (head?.name === 'cd' || head?.name === 'pushd' || head?.name === 'popd') {
      const t = head.name === 'popd' ? undefined : (head.args.find(a => !a.startsWith('-')) ?? (head.name === 'cd' ? '~' : undefined))
      dir = t === undefined || t === '-' || (dir === undefined && !t.startsWith('/') && !t.startsWith('~')) ? undefined : resolve(t, dir ?? '/', where.home)
      cwd = undefined
      continue
    }
    // A variable or quoted word may be -r: an rm that does not read as recursive is unreadable.
    if (head?.name === 'rm' && !recursive(head.args) && head.args.some(opaque)) found.add('unreadable')
    if (head?.name === 'rm' && recursive(head.args)) {
      // After `--` every operand is a path, even one that starts with - (round 6).
      const dd = head.args.indexOf('--')
      const targets = [...(dd < 0 ? head.args : head.args.slice(0, dd)).filter(a => !a.startsWith('-')), ...(dd < 0 ? [] : head.args.slice(dd + 1))]
      if (targets.some(t => { const p = cwd === undefined ? undefined : resolve(t, cwd, where.home); return p === undefined || !below(p, where.root) }))
        found.add('rm-outside')
    }
    const git = gitOf(tokens)
    if (git === undefined) continue
    const { sub } = git
    if ((opaque(sub) || !readableGlobals(tokens) || sub === 'send-pack' || sub === 'http-push') && namesDanger(command)) found.add('unreadable')
    const args = flags(git.args)
    // The shared reader drops what follows `--`; for push those words are refspecs.
    const dashes = tokens.indexOf('--')
    const after = sub === 'push' && dashes >= 0 ? tokens.slice(dashes + 1) : []
    if (args.includes('--no-verify') || (sub === 'commit' && args.includes('-n'))) found.add('no-verify')
    // A quoted or variable word may be -n, -D or -f, except as the value of a commit option.
    if (sub === 'branch' && args.some(opaque)) found.add('unreadable')
    if (sub === 'commit')
      for (let i = 0; i < args.length; i++) { if (COMMIT_VALUES.has(args[i]!)) i += 1; else if (opaque(args[i]!)) found.add('unreadable') }
    if (sub === 'branch' && (args.includes('-D') ||
      ((args.includes('--delete') || args.includes('-d')) && (args.includes('--force') || args.includes('-f')))))
      found.add('branch-delete')
    if (sub === 'push') {
      // Refspecs after `--` carry + and : too (PR #681 round 3).
      if (args.includes('-f') || args.some(a => a === '--force' || a === '--mirror' || a.startsWith('--force-with-lease') || a.startsWith('+')) || after.some(a => a.startsWith('+')))
        found.add('force-push')
      if (args.includes('--delete') || args.includes('--prune') || args.includes('-d') || [...args, ...after].some(a => a.startsWith(':')))
        found.add('branch-delete')
      // A quoted or variable remote, refspec or flag may name the default branch or --force.
      if ([...positionalOf(args), ...after].some(opaque)) found.add('unreadable')
      else {
        // -C into a directory other than the repo root may enter a nested repo or submodule,
        // whose branch is not the session's: unknown (PR #681 round 3).
        const at = gitDirOf(tokens, dir, where.home)
        // So may a cd below the root: only the session's own directory and the root are known (round 4).
        const same = at !== undefined && (at === where.cwd || at === where.root.replace(/\/+$/, ''))
        if (pushesDefault(args, after, same ? where : { ...where, branch: undefined, defaultBranch: undefined })) found.add('default-branch-push')
      }
    }
  }
  return [...found]
}
