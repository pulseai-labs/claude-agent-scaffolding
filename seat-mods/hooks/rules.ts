// seat-mods rules: the role profiles and the pure checks behind them. No `$` here;
// register.ts resolves paths and environment, then asks decide().

export type Role = 'implementer' | 'verifier' | 'reviewer'
export const ROLES: readonly Role[] = ['implementer', 'verifier', 'reviewer']

export type RoleState = { kind: 'off' } | { kind: 'on'; role: Role } | { kind: 'invalid'; value: string }

export type RuleId =
  | 'merge' | 'force-push' | 'branch-delete' | 'no-verify' | 'ai-trailer'
  | 'commit' | 'push' | 'pr-create'

export type Place = 'worktree' | 'allow' | 'outside'

export type Facts = { kind: 'bash'; rules: readonly RuleId[] } | { kind: 'write'; place: Place }

// Rules every herdr-crew brief of every role shares (spec §4).
const COMMON: readonly RuleId[] = ['merge', 'force-push', 'branch-delete', 'no-verify', 'ai-trailer']

const PROFILES: Record<Role, { deny: readonly RuleId[]; writeIn: readonly Place[] }> = {
  implementer: { deny: COMMON, writeIn: ['worktree', 'allow'] },
  verifier: { deny: [...COMMON, 'commit', 'push', 'pr-create'], writeIn: ['worktree', 'allow'] },
  reviewer: { deny: [...COMMON, 'commit', 'push', 'pr-create'], writeIn: ['allow'] },
}

const RULE_TEXT: Record<RuleId, string> = {
  merge: 'no merges (git merge, gh pr merge)',
  'force-push': 'no force-push',
  'branch-delete': 'no branch deletion (git branch -D, git push --delete)',
  'no-verify': 'no --no-verify',
  'ai-trailer': 'no AI trailers in commit messages (Co-Authored-By:, 🤖 Generated with)',
  commit: 'no git commit',
  push: 'no git push',
  'pr-create': 'no gh pr create',
}

const SEGMENT = /;|&&|\|\||\||\n/
const TRAILER = /co-authored-by:|🤖 generated with/i

export function parseRole(value: string | undefined): RoleState {
  if (value === undefined || value === '') return { kind: 'off' }
  const role = ROLES.find(r => r === value)
  return role === undefined ? { kind: 'invalid', value } : { kind: 'on', role }
}

export function parseAllow(value: string | undefined): string[] {
  return (value ?? '')
    .split(':')
    .map(dir => dir.replace(/\/+$/, ''))
    .filter(dir => dir.startsWith('/'))
}

function tokensOf(segment: string): string[] {
  return segment.trim().split(/\s+/).filter(Boolean)
}

// The git subcommand and its arguments, skipping global options (-C and -c take a value).
function gitOf(tokens: string[]): { sub: string; args: string[] } | undefined {
  let i = tokens.indexOf('git')
  if (i < 0) return undefined
  i += 1
  while (i < tokens.length && tokens[i].startsWith('-')) i += tokens[i] === '-C' || tokens[i] === '-c' ? 2 : 1
  return i < tokens.length ? { sub: tokens[i], args: tokens.slice(i + 1) } : undefined
}

export function bashRules(command: string, messageFileText = ''): RuleId[] {
  const found = new Set<RuleId>()
  for (const segment of command.split(SEGMENT)) {
    const tokens = tokensOf(segment)
    const gh = tokens.indexOf('gh')
    if (gh >= 0 && tokens[gh + 1] === 'pr') {
      if (tokens[gh + 2] === 'merge') found.add('merge')
      if (tokens[gh + 2] === 'create') found.add('pr-create')
    }
    const git = gitOf(tokens)
    if (git === undefined) continue
    const { sub, args } = git
    if (args.includes('--no-verify') || (sub === 'commit' && args.includes('-n'))) found.add('no-verify')
    if (sub === 'merge') found.add('merge')
    if (sub === 'branch' && args.includes('-D')) found.add('branch-delete')
    if (sub === 'commit') {
      found.add('commit')
      // The whole command, not the segment: a heredoc message spans several lines.
      if (TRAILER.test(command) || TRAILER.test(messageFileText)) found.add('ai-trailer')
    }
    if (sub === 'push') {
      found.add('push')
      if (args.some(a => a === '--force' || a === '-f' || a.startsWith('--force-with-lease') || a.startsWith('+')))
        found.add('force-push')
      if (args.includes('--delete') || args.includes('-d') || args.some(a => a.startsWith(':')))
        found.add('branch-delete')
    }
  }
  return [...found]
}

export function commitMessageFile(command: string): string | undefined {
  for (const segment of command.split(SEGMENT)) {
    const git = gitOf(tokensOf(segment))
    if (git?.sub !== 'commit') continue
    const { args } = git
    for (let i = 0; i < args.length; i++) {
      const value = args[i] === '-F' || args[i] === '--file' ? args[i + 1]
        : args[i].startsWith('--file=') ? args[i].slice('--file='.length) : undefined
      const path = value?.replace(/^['"]|['"]$/g, '')
      if (path !== undefined && path !== '' && path !== '-') return path
    }
  }
  return undefined
}

export function placeOf(target: string, root: string, allow: readonly string[]): Place {
  const within = (dir: string) => target === dir || target.startsWith(dir + '/')
  if (allow.some(within)) return 'allow'
  return within(root) ? 'worktree' : 'outside'
}

function denyText(role: Role, rule: string, action: string): string {
  return `seat-mods (${role}): ${rule} — this seat may not ${action}; report it instead.`
}

export function decide(role: Role, facts: Facts): string | undefined {
  const profile = PROFILES[role]
  if (facts.kind === 'bash') {
    const hit = facts.rules.find(rule => profile.deny.includes(rule))
    return hit === undefined ? undefined : denyText(role, RULE_TEXT[hit], 'run this command')
  }
  if (profile.writeIn.includes(facts.place)) return undefined
  const rule = facts.place === 'worktree'
    ? 'no edits in the worktree'
    : 'no writes outside the worktree and the SEAT_MODS_ALLOW directories'
  return denyText(role, rule, 'write here')
}

export function invalidText(value: string): string {
  return `seat-mods: SEAT_MODS_ROLE="${value}" is not a role (valid: implementer, verifier, reviewer). ` +
    'Every tool call is denied; respawn this seat with a valid role.'
}
