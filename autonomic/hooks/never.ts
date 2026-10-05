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

// -uf is -u -f: a cluster of short flags is read flag by flag.
const flags = (args: readonly string[]) =>
  args.flatMap(a => (/^-[A-Za-z]{2,}$/.test(a) ? [...a.slice(1)].map(c => `-${c}`) : [a]))

// A lone & ends a command as ; does; the shared reader splits only on &&.
function pieces(tokens: readonly string[]): string[][] {
  const out: string[][] = [[]]
  for (const t of tokens) {
    if (t === '&') { out.push([]); continue }
    if (t.endsWith('&') && !t.endsWith('&&')) { out[out.length - 1]!.push(t.slice(0, -1)); out.push([]); continue }
    out[out.length - 1]!.push(t)
  }
  return out.map(p => { let i = 0; while (p[i] !== undefined && OPENERS.has(p[i]!)) i += 1; return p.slice(i) }).filter(p => p.length > 0)
}

const recursive = (args: readonly string[]) =>
  args.some(a => a === '--recursive' || /^-[A-Za-z]*[rR][A-Za-z]*$/.test(a))

function pushesDefault(args: readonly string[], where: Where): boolean {
  const defaults = where.defaultBranch !== undefined ? [where.defaultBranch] : ['main', 'master']
  if (args.includes('--all') || args.includes('--mirror')) return true
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (OPTION_VALUES.has(a)) { i += 1; continue }
    if (!a.startsWith('-')) positional.push(a)
  }
  const refspecs = positional.slice(1)   // the first is the remote
  const current = (ref: string) => (ref === 'HEAD' ? where.branch : ref)
  if (refspecs.length === 0) return where.branch === undefined || defaults.includes(where.branch)
  return refspecs.some(spec => {
    const raw = spec.replace(/^\+/, '')
    const dst = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : current(raw)
    if (dst === undefined) return true
    return defaults.includes(dst.replace(/^refs\/heads\//, ''))
  })
}

export function neverRules(command: string, where: Where): NeverRule[] {
  const found = new Set<NeverRule>()
  let cwd: string | undefined = where.cwd
  for (const tokens of segments(command).flatMap(pieces)) {
    const head = commandOf(tokens)
    if (head === undefined) continue
    if (head.name.startsWith('-') || RUNNERS.has(head.name) || tokens.some(t => t.includes('`') || t.includes('$('))) {
      if (DANGER.test(command)) found.add('unreadable')
    }
    if (head?.name === 'cd' || head?.name === 'pushd' || head?.name === 'popd') { cwd = undefined; continue }
    if (head?.name === 'rm' && recursive(head.args)) {
      const targets = head.args.filter(a => !a.startsWith('-'))
      if (targets.some(t => { const p = cwd === undefined ? undefined : resolve(t, cwd, where.home); return p === undefined || !below(p, where.root) }))
        found.add('rm-outside')
    }
    const git = gitOf(tokens)
    if (git === undefined) continue
    const { sub } = git
    const args = flags(git.args)
    if (args.includes('--no-verify') || (sub === 'commit' && args.includes('-n'))) found.add('no-verify')
    if (sub === 'branch' && (args.includes('-D') ||
      ((args.includes('--delete') || args.includes('-d')) && (args.includes('--force') || args.includes('-f')))))
      found.add('branch-delete')
    if (sub === 'push') {
      if (args.includes('-f') || args.some(a => a === '--force' || a === '--mirror' || a.startsWith('--force-with-lease') || a.startsWith('+')))
        found.add('force-push')
      if (args.includes('--delete') || args.includes('--prune') || args.includes('-d') || args.some(a => a.startsWith(':')))
        found.add('branch-delete')
      if (pushesDefault(args, where)) found.add('default-branch-push')
    }
  }
  return [...found]
}
