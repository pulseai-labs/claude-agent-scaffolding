import { gitSubcommands, gitSubcommandsThatRun } from './shell'

// Past the hard threshold only the handoff's own tools run: the file tools that write
// it, Skill (the instruction names a handoff skill), and Bash made only of git add and
// git commit segments. Everything else, reads included, is refused: a read is what
// overflows a window that is nearly full.
const HANDOFF_TOOLS = new Set(['Write', 'Edit', 'Skill'])
const GIT_ALLOWED = new Set(['add', 'commit'])

export function gateAllows(tool: string, args: Readonly<Record<string, unknown>>): boolean {
  if (HANDOFF_TOOLS.has(tool)) return true
  if (tool !== 'Bash' || typeof args.command !== 'string') return false
  const subs = gitSubcommands(args.command)
  return subs.length > 0 && subs.every(sub => sub !== undefined && GIT_ALLOWED.has(sub))
}

// The flags that make a commit no commit: git-commit(1)'s --dry-run, and the status forms
// --short, --porcelain and --long, which it gives that same meaning ("when doing a
// dry-run") — each of the three implies one (#665).
const DRY_RUN = new Set(['--dry-run', '--short', '--porcelain', '--long'])

// shell.ts is a byte-parity copy of seat-mods/hooks/rules.ts and hands back one segment's
// subcommand, never its tokens, so a commit's own arguments are read here. The split and
// the blanking are the boundary set those readers use (`COMMANDS`, `QUOTED`); a flag
// inside a quoted message is text there and here both.
const SEGMENTS = /;|&&|(?<![&<>])&(?![&>])|\|\||\||\n|\(|\)/
const QUOTED = /"(?:[^"\\]|\\.)*"|'[^']*'/g

// The options that take the next word as their value (git-commit(1)), alone or ending a
// short cluster (`-am`). A value is data, and so is every word after `--`: neither is a flag.
const TAKES_VALUE = new Set(['--message', '--file', '--reuse-message', '--reedit-message', '--template',
  '--author', '--date', '--fixup', '--squash', '--cleanup', '--trailer', '--pathspec-from-file'])
const SHORT_TAKES_VALUE = /^-[A-Za-z]*[mFCct]$/

function commitIsDryRun(segment: string): boolean {
  // A quoted string is one word of data, so it stays one word here.
  const tokens = segment.replace(QUOTED, ' Q ').trim().split(/\s+/).filter(Boolean)
  for (let i = tokens.indexOf('commit') + 1; i > 0 && i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token === '--') return false
    if (DRY_RUN.has(token)) return true
    if (TAKES_VALUE.has(token) || SHORT_TAKES_VALUE.test(token)) i += 1
  }
  return false
}

// Progress, for the autopilot loop guard (spec §2): a file written or a commit made.
// A commit counts only where the line runs it — bare, or behind `time`; behind `{`
// (a brace-group body reads the same as a function definition's), `if`, `then`,
// `elif`, `else` or `!` it may not run, and counting it would hide a stalled loop
// from the guard (review R2/RR1) — and only where its own arguments make it a commit
// rather than a dry run (#665).
export function isProgress(tool: string, args: Readonly<Record<string, unknown>>): boolean {
  if (tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit') return true
  if (tool !== 'Bash' || typeof args.command !== 'string') return false
  const command = args.command
  // The whole command decides first, as it always has: a commit that only shows in a
  // heredoc body or a quoted string is not one, and the segment reader below can only
  // take commits away from that count, never add one.
  if (!gitSubcommandsThatRun(command).includes('commit')) return false
  // A quoted message can hold a split character (`;`, `(`, a newline): blank those inside
  // each quoted string first, so the split never cuts a message open (PR #775 review).
  const unsplit = command.replace(QUOTED, quoted => quoted.replace(/[;&|()\n]/g, ' '))
  return unsplit.split(SEGMENTS).some(segment =>
    gitSubcommandsThatRun(segment).includes('commit') && !commitIsDryRun(segment))
}
