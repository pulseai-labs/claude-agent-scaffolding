import { commandOf, gitOf, segments } from './shell'

// The never-approve list (spec §3.3): checked in code before any fork. A match leaves the
// ask in place. Unknown means listed: a path or a branch autonomic cannot read is
// treated as the dangerous one.

export type NeverRule = 'force-push' | 'default-branch-push' | 'branch-delete' | 'rm-outside' | 'no-verify' | 'unreadable'
export type Where = { cwd: string; root: string; home: string; branch?: string; defaultBranch?: string }

// Blanked text (a \u0000 marker), a variable, a substitution or a glob home is unreadable.
function resolve(path: string, cwd: string, home: string): string | undefined {
  if (/[\u0000$`]/.test(path)) return undefined
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
const RUNNERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'eval', 'xargs', 'timeout', 'nice', 'ionice', 'watch', 'parallel', 'find', 'su', 'doas', 'ssh'])
const OPENERS = new Set(['if', 'then', 'do', 'else', 'elif', 'while', 'until', '{', '}', '!'])
const DANGER = /\bpush\b|\brm\b|\bbranch\b|\bcommit\b|--no-verify/
const OPTION_VALUES = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec'])
// Commit options whose next word is a message, a path or a name, never a flag.
const COMMIT_VALUES = new Set(['-m', '--message', '-F', '--file', '-C', '-c', '--reuse-message', '--reedit-message',
  '--author', '--date', '--fixup', '--squash', '-t', '--template', '--trailer', '--cleanup'])

// -uf is -u -f: a cluster of short flags is read flag by flag.
const flags = (args: readonly string[]) =>
  args.flatMap(a => (/^-[A-Za-z]{2,}$/.test(a) ? [...a.slice(1)].map(c => `-${c}`) : [a]))

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
const opaque = (t: string) => /[\u0000$]/.test(t)

const recursive = (args: readonly string[]) =>
  args.some(a => a === '--recursive' || /^-[A-Za-z]*[rR][A-Za-z]*$/.test(a))

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
  const refspecs = [...positional.slice(1), ...refspecsAfter]   // the first is the remote
  const current = (ref: string) => (ref === 'HEAD' ? where.branch : ref)
  if (refspecs.length === 0) return where.branch === undefined || defaults.includes(where.branch)
  return refspecs.some(spec => {
    const raw = spec.replace(/^\+/, '')
    const dst = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : current(raw)
    if (dst === undefined) return true
    return defaults.includes(dst.replace(/^refs\/heads\//, ''))
  })
}

// The session's branch holds only inside the session's repo; elsewhere, or anywhere
// unknown, the branch is unknown and the default is main or master.
const inRepo = (dir: string | undefined, root: string) =>
  dir !== undefined && (dir === root.replace(/\/+$/, '') || below(dir, root))

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
  for (const body of quotedSubstitutions(command)) for (const r of neverRules(body, where)) found.add(r)
  let cwd: string | undefined = where.cwd
  let dir: string | undefined = where.cwd   // followed through cd, for the repo check only
  for (const tokens of segments(command).flatMap(pieces)) {
    const head = commandOf(tokens)
    if (head === undefined) continue
    if (head.name.startsWith('-') || opaque(head.name) || RUNNERS.has(head.name) || tokens.some(t => t.includes('`') || t.includes('$('))) {
      if (DANGER.test(command)) found.add('unreadable')
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
      const targets = head.args.filter(a => !a.startsWith('-'))
      if (targets.some(t => { const p = cwd === undefined ? undefined : resolve(t, cwd, where.home); return p === undefined || !below(p, where.root) }))
        found.add('rm-outside')
    }
    const git = gitOf(tokens)
    if (git === undefined) continue
    const { sub } = git
    if (opaque(sub) && DANGER.test(command)) found.add('unreadable')
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
      if (args.includes('-f') || args.some(a => a === '--force' || a === '--mirror' || a.startsWith('--force-with-lease') || a.startsWith('+')))
        found.add('force-push')
      if (args.includes('--delete') || args.includes('--prune') || args.includes('-d') || args.some(a => a.startsWith(':')))
        found.add('branch-delete')
      // A quoted or variable remote, refspec or flag may name the default branch or --force.
      if ([...positionalOf(args), ...after].some(opaque)) found.add('unreadable')
      else if (pushesDefault(args, after, inRepo(gitDirOf(tokens, dir, where.home), where.root)
        ? where : { ...where, branch: undefined, defaultBranch: undefined })) found.add('default-branch-push')
    }
  }
  return [...found]
}
