import { commandOf, gitOf, segments } from './shell'

// The never-approve list (spec §3.3): checked in code before any fork. A match leaves the
// ask in place. Unknown means listed: a path or a branch autonomic cannot read is
// treated as the dangerous one.

export type NeverRule = 'force-push' | 'default-branch-push' | 'branch-delete' | 'rm-outside' | 'no-verify'
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

const recursive = (args: readonly string[]) =>
  args.some(a => a === '--recursive' || /^-[A-Za-z]*[rR][A-Za-z]*$/.test(a))

function pushesDefault(args: readonly string[], where: Where): boolean {
  const defaults = where.defaultBranch !== undefined ? [where.defaultBranch] : ['main', 'master']
  if (args.includes('--all') || args.includes('--mirror')) return true
  const positional = args.filter(a => !a.startsWith('-'))
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
  for (const tokens of segments(command)) {
    const head = commandOf(tokens)
    if (head?.name === 'cd' || head?.name === 'pushd' || head?.name === 'popd') { cwd = undefined; continue }
    if (head?.name === 'rm' && recursive(head.args)) {
      const targets = head.args.filter(a => !a.startsWith('-'))
      if (targets.some(t => { const p = cwd === undefined ? undefined : resolve(t, cwd, where.home); return p === undefined || !below(p, where.root) }))
        found.add('rm-outside')
    }
    const git = gitOf(tokens)
    if (git === undefined) continue
    const { sub, args } = git
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
