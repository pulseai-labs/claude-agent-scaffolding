// seat-mods rules: the role profiles and the pure checks behind them. No `$` here;
// register.ts resolves paths and environment, then asks decide().

export type Role = 'implementer' | 'verifier' | 'reviewer'
export const ROLES: readonly Role[] = ['implementer', 'verifier', 'reviewer']

// Operator-marked roles the mod never guards: no denies, no write placement checks.
export type FreeRole = 'orchestrator' | 'coordinator'
export const FREE_ROLES: readonly FreeRole[] = ['orchestrator', 'coordinator']

export type RoleState =
  | { kind: 'on'; role: Role }         // explicit implementer, verifier, reviewer
  | { kind: 'default'; role: Role }    // SEAT_MODS_ROLE unset or empty: guarded as implementer
  | { kind: 'free'; role: FreeRole }   // orchestrator, coordinator: unguarded
  | { kind: 'invalid'; value: string } // any other non-empty value: deny everything

export type RuleId =
  | 'merge' | 'force-push' | 'branch-delete' | 'no-verify' | 'ai-trailer'
  | 'commit' | 'push' | 'pr-create'

export type Place = 'worktree' | 'allow' | 'outside'

export type Removal = { place: Place; protected: boolean }
export type Facts = { kind: 'bash'; rules: readonly RuleId[]; removals?: readonly Removal[] } | { kind: 'write'; place: Place }

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

// At a line start, as the repository's commit-msg hook reads them; mid-line prose is not a trailer.
const TRAILER = /^[ \t]*(?:co-authored-by:|🤖 generated with)/im
// Command boundaries for matching; subshell parentheses count too.
const COMMANDS = /;|&&|\|\||\||\n|\(|\)/
// Heredoc bodies and quoted strings are text, not commands: a commit message may
// name `git merge` or `-n`. Each is swapped for a numbered marker before matching,
// and the trailer check expands the markers in the commit's own segment.
// A heredoc opener; its delimiter is any quoted word, or a bare word.
const HEREDOC = /(?<!<)<<(?!<)(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|([^\s;&|<>()'"]+))/g
const QUOTED = /"(?:[^"\\]|\\.)*"|'[^']*'/g
const MARKER = /\u0000(\d+)\u0000/g
// Words that run the next word as the command.
const WRAPPERS = new Set(['sudo', 'env', 'command', 'exec', 'nohup', 'time'])

// Each heredoc, opener through its closing line, becomes one piece. The body ends at
// the first line that is exactly the delimiter (leading tabs allowed after `<<-`);
// a heredoc with no closing line runs to the end of the command, as in Bash.
function blankHeredocs(command: string, keep: (piece: string) => string): string {
  let out = ''
  let from = 0
  for (;;) {
    HEREDOC.lastIndex = from
    const open = HEREDOC.exec(command)
    if (open === null) return out + command.slice(from)
    const delimiter = open[2] ?? open[3] ?? open[4] ?? ''
    const bodyStart = command.indexOf('\n', HEREDOC.lastIndex)
    if (bodyStart < 0) return out + command.slice(from)
    let end = command.length
    for (let line = bodyStart + 1; line <= command.length; ) {
      const next = command.indexOf('\n', line)
      const stop = next < 0 ? command.length : next
      const text = command.slice(line, stop)
      if ((open[1] === '-' ? text.replace(/^\t+/, '') : text) === delimiter) { end = stop; break }
      if (next < 0) break
      line = next + 1
    }
    out += command.slice(from, open.index) + keep(command.slice(open.index, end))
    from = end
  }
}

function blank(command: string): { text: string; pieces: string[] } {
  const pieces: string[] = []
  const keep = (piece: string) => `\u0000${pieces.push(piece) - 1}\u0000`
  // An unquoted backslash-newline is a line continuation, not a command boundary.
  const joined = command.replace(/\\\n/g, ' ')
  // A backslash outside quotes makes the next character text (`\\|` is not a pipe).
  // A `#` that starts a word begins a comment, which runs no command.
  const text = blankHeredocs(joined, keep).replace(QUOTED, keep).replace(/\\./g, keep)
  return { text: text.replace(/(^|[ \t;&|()])#[^\n]*/gm, '$1'), pieces }
}

// A segment's text with its blanked pieces put back, nested pieces included.
function expand(text: string, pieces: readonly string[], seen: readonly string[] = []): string {
  return text.replace(MARKER, (_, i: string) => {
    if (seen.includes(i) || seen.length >= 64) throw new Error('unresolvable shell marker')
    return expand(pieces[Number(i)] ?? '', pieces, [...seen, i])
  })
}

// The command word and its arguments: leading VAR=value assignments and wrapper
// words are skipped, and a path such as /usr/bin/git names git.
function commandOf(tokens: readonly string[]): { name: string; args: string[] } | undefined {
  let i = 0
  for (;;) {
    const token = tokens[i]
    if (token === undefined) return undefined
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token) || WRAPPERS.has(token.replace(/^.*\//, ''))) i += 1
    else return { name: token.replace(/^.*\//, ''), args: tokens.slice(i + 1) }
  }
}

export function parseRole(value: string | undefined): RoleState {
  if (value === undefined || value === '') return { kind: 'default', role: 'implementer' }
  const role = ROLES.find(r => r === value)
  if (role !== undefined) return { kind: 'on', role }
  const free = FREE_ROLES.find(r => r === value)
  return free === undefined ? { kind: 'invalid', value } : { kind: 'free', role: free }
}

// The session's status line: every state reads distinctly, so an unmarked session is visible.
export function statusText(state: RoleState): string {
  if (state.kind === 'on') return `seat: ${state.role}`
  if (state.kind === 'default') return `seat: ${state.role} (default: SEAT_MODS_ROLE unset or empty)`
  if (state.kind === 'free') return `seat: ${state.role}`
  return `seat: INVALID ROLE "${state.value}"`
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
  const command = commandOf(tokens)
  if (command?.name !== 'git') return undefined
  const rest = command.args
  let i = 0
  while (rest[i]?.startsWith('-')) i += rest[i] === '-C' || rest[i] === '-c' ? 2 : 1
  const sub = rest[i]
  if (sub === undefined) return undefined
  // Arguments after `--` are paths, never options.
  const args = rest.slice(i + 1)
  const end = args.indexOf('--')
  return { sub, args: end < 0 ? args : args.slice(0, end) }
}

export function bashRules(command: string, messageFileText = ''): RuleId[] {
  const found = new Set<RuleId>()
  const { text, pieces } = blank(command)
  for (const segment of text.split(COMMANDS)) {
    const tokens = tokensOf(segment)
    const head = commandOf(tokens)
    if (head?.name === 'gh' && head.args[0] === 'pr') {
      // `gh pr` takes -R/--repo before its subcommand.
      let k = 1
      while (head.args[k] === '-R' || head.args[k] === '--repo' || head.args[k]?.startsWith('--repo='))
        k += head.args[k]?.startsWith('--repo=') ? 1 : 2
      if (head.args[k] === 'merge') found.add('merge')
      if (head.args[k] === 'create') found.add('pr-create')
    }
    const git = gitOf(tokens)
    if (git === undefined) continue
    const { sub, args } = git
    if (args.includes('--no-verify') || (sub === 'commit' && args.includes('-n'))) found.add('no-verify')
    if (sub === 'merge') found.add('merge')
    if (sub === 'branch' && (args.includes('-D') ||
      ((args.includes('--delete') || args.includes('-d')) && (args.includes('--force') || args.includes('-f')))))
      found.add('branch-delete')
    if (sub === 'commit') {
      found.add('commit')
      // The segment with its quoted and heredoc text put back: the message lives there.
      if (TRAILER.test(expand(segment, pieces)) || TRAILER.test(messageFileText)) found.add('ai-trailer')
    }
    if (sub === 'push') {
      found.add('push')
      if (args.includes('-f') ||
        args.some(a => a === '--force' || a === '--mirror' || a.startsWith('--force-with-lease') || a.startsWith('+')))
        found.add('force-push')
      if (args.includes('--delete') || args.includes('--prune') || args.includes('-d') || args.some(a => a.startsWith(':')))
        found.add('branch-delete')
    }
  }
  return [...found]
}

// Every commit message file the call names (-F, --file, --file=), quoted paths whole.
export function commitMessageFiles(command: string): string[] {
  const files: string[] = []
  const { text, pieces } = blank(command)
  for (const segment of text.split(COMMANDS)) {
    const git = gitOf(tokensOf(segment))
    if (git?.sub !== 'commit') continue
    const { args } = git
    for (const [i, arg] of args.entries()) {
      const value = arg === '-F' || arg === '--file' ? args[i + 1]
        : arg.startsWith('--file=') ? arg.slice('--file='.length)
        : arg.startsWith('-F') ? arg.slice(2) : undefined
      if (value === undefined) continue
      const path = expand(value, pieces).replace(/^(['"])(.*)\1$/s, '$2')
      if (path !== '' && path !== '-') files.push(path)
    }
  }
  return files
}

// rm alone gets operand parsing; the other Bash rails keep their existing matcher.
// Quoting is retained until this point: single quotes and backslash escapes are
// literal, while active expansions cannot be resolved by the hook.
export type RmTarget = { path: string | undefined; glob: boolean }

function rmWord(word: string): { path: string; globAt: number; home: boolean } | undefined {
  let path = ''
  let quote = ''
  let globAt = -1
  const home = word.startsWith('~')
  for (let i = 0; i < word.length; i++) {
    const char = word[i]!
    if (quote === "'") {
      if (char === "'") quote = ''
      else path += char
    } else if (char === "'" && quote === '') quote = "'"
    else if (char === '"') quote = quote === '"' ? '' : '"'
    else if (char === '\\') {
      const next = word[++i]
      if (next === undefined) return undefined
      // Inside double quotes Bash only escapes these characters.
      if (quote === '"' && !['$', '`', '"', '\\', '\n'].includes(next)) path += '\\'
      path += next
    } else if (char === '$' || char === '`' || (char === '{' && quote === '')) return undefined
    else {
      if (quote === '' && globAt < 0 && '*?['.includes(char)) globAt = path.length
      path += char
    }
  }
  if (quote !== '' || path === '') return undefined
  if (home && path !== '~' && !path.startsWith('~/')) return undefined
  // A quoted tilde is an ordinary relative file name, not HOME expansion.
  return { path, globAt, home }
}

const RM_HEAD_WORDS = new Set(['if', 'then', 'elif', 'else', 'do', 'while', 'until', '!', '{', '(', 'time', 'builtin'])

export function rmTargets(command: string): RmTarget[] {
  const targets: RmTarget[] = []
  const { text, pieces } = blank(command)
  let changedDirectory = false
  // Redirections belong to the shell, not rm. Blanked quotes/escapes keep
  // literal glyphs out of this match. Remove fd prefixes before their operators,
  // then operators with their attached or separate target words.
  const redirects = text.replace(/(^|[\s;|&()])\d+(?=[<>])/g, '$1')
    .replace(/(?:<<<|&>>|&>|<>|>\||>>|[<>]&|>|(?<!<)<(?!<))[ \t]*[^\s;&|()]+/g, ' ')
  for (const segment of redirects.split(/;|&&|\|\||[|&]|\n|\(|\)/)) {
    let head = commandOf(tokensOf(segment))
    while (head !== undefined && RM_HEAD_WORDS.has(head.name)) head = commandOf(head.args)
    if (head === undefined) continue
    if (['cd', 'pushd', 'popd'].includes(head.name) || expand(head.name, pieces) === '\\cd') changedDirectory = true
    if (head.name !== 'rm') continue
    let options = true
    for (const arg of head.args) {
      const word = rmWord(expand(arg, pieces))
      if (word !== undefined && options && word.path === '--') { options = false; continue }
      if (word !== undefined && options && word.path.startsWith('-') && word.path !== '-') continue
      if (word === undefined || (changedDirectory && !word.path.startsWith('/') && !word.home)) {
        targets.push({ path: undefined, glob: false })
        continue
      }
      let path = word.path
      const glob = word.globAt >= 0
      if (glob && (path.includes('**') || path.split('/').some(part => part.startsWith('.') && /[*?\[]/.test(part)) || /(?:^|\/)\.\.(?:\/|$)/.test(path.slice(word.globAt)))) {
        targets.push({ path: undefined, glob: false })
        continue
      }
      if (glob) {
        const prefix = path.slice(0, word.globAt)
        const slash = prefix.lastIndexOf('/')
        path = slash < 0 ? '.' : slash === 0 ? '/' : prefix.slice(0, slash)
      }
      // Preserve whether the leading tilde was active, without treating a quoted
      // literal tilde as HOME. register.ts only expands an active leading tilde.
      if (!word.home && path.startsWith('~')) path = './' + path
      targets.push({ path, glob })
    }
  }
  return targets
}

export function removalOf(target: string | undefined, root: string | undefined, allow: readonly string[], glob: boolean): Removal {
  if (target === undefined || root === undefined) return { place: 'outside', protected: false }
  const ancestor = (dir: string) => target === dir || dir.startsWith(target.replace(/\/$/, '') + '/')
  return { place: placeOf(target, root, allow), protected: [root, ...allow].some(dir => ancestor(dir) && (!glob || target !== dir)) }
}

export function placeOf(target: string, root: string, allow: readonly string[]): Place {
  const within = (dir: string) => (dir === '/' && target.startsWith('/')) || target === dir || target.startsWith(dir + '/')
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
    if (hit !== undefined) return denyText(role, RULE_TEXT[hit], 'run this command')
    if (facts.removals?.some(target => target.protected || !profile.writeIn.includes(target.place)))
      return denyText(role, 'no rm outside writable places, of their roots or ancestors, or with unresolvable operands', 'run this command')
    return undefined
  }
  if (profile.writeIn.includes(facts.place)) return undefined
  const rule = facts.place === 'worktree'
    ? 'no edits in the worktree'
    : 'no writes outside the worktree and the SEAT_MODS_ALLOW directories'
  return denyText(role, rule, 'write here')
}

export function uncheckedRmText(role: Role): string {
  return denyText(role, 'Bash command could not be checked', 'run this command')
}

export function invalidText(value: string): string {
  return `seat-mods: SEAT_MODS_ROLE="${value}" is not a role ` +
    '(valid: implementer, verifier, reviewer, orchestrator, coordinator). ' +
    'Every tool call is denied; respawn this seat with a valid role.'
}
