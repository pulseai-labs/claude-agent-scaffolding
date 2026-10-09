// molt's reading of a Bash command. The declarations from COMMANDS to gitOf are a
// copy of seat-mods/hooks/rules.ts: plugins never import each other, and
// tests/test-mod-shell-parity.sh holds the copies identical. Change them there
// first, then copy.

// Command boundaries for matching; subshell parentheses count too. A lone `&` —
// Bash's background list separator — is one, and only a lone one: `&&` is the
// and-list, and a `&` a redirection carries (`>&`, `<&`, `&>`, `&>>`) is not a
// boundary (#723). `rmTargets` splits on `&` through its own second spelling;
// change one and check the other.
const COMMANDS = /;|&&|(?<![&<>])&(?![&>])|\|\||\||\n|\(|\)/

// Heredoc bodies and quoted strings are text, not commands: a commit message may
// name `git merge` or `-n`. Each is swapped for a numbered marker before matching,
// and the trailer check expands the markers in the commit's own segment.
// A heredoc opener; its delimiter is any quoted word, or a bare word.
const HEREDOC = /(?<!<)<<(?!<)(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|([^\s;&|<>()'"]+))/g

const QUOTED = /"(?:[^"\\]|\\.)*"|'[^']*'/g

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

// A Bash construct opens with a reserved head word; the reader skips those before
// reading a segment's command (#711). Deliberately a subset of the words seat-mods
// 0.3.1 skips (review R4): a loop head (`while`, `until`, `do`) and its closer
// (`done`) are not skipped, so a loop stays refused past the block, where the hard
// threshold is for wrapping up; and `builtin` is an execution prefix, never a head
// word — its argument must never restart the walk. The walk is an exact raw head:
// a path-qualified or quoted head word is an ordinary program, so it is not in the
// set. Kept outside the declarations above that tests/test-mod-shell-parity.sh
// holds identical to seat-mods; molt's own suite pins these sets.
export const HEAD_WORDS = new Set(['if', 'then', 'elif', 'else', '!', '{', 'time'])

// The words that only close a construct a head word opens: if→fi, {→}. Each is a
// Bash reserved word, read as syntax at the head of a command and never as a
// program there, so a segment of nothing else runs no command of its own. `done`
// is not here: the loop words are unskipped, so a loop's closer stays a refused
// segment.
export const CLOSERS = new Set(['fi', '}'])

// The segment's leading head words and the tokens after them.
function afterHeads(tokens: readonly string[]): { heads: string[]; rest: string[] } {
  let i = 0
  while (HEAD_WORDS.has(tokens[i] ?? '')) i += 1
  return { heads: tokens.slice(0, i), rest: tokens.slice(i) }
}

// A segment that names no command: one the head walk emptied (a bare then, else or
// lone !), or one made only of closing words. It is neither a refused segment nor a
// git subcommand (#711).
function namesNoCommand(tokens: readonly string[]): boolean {
  return tokens.every(token => CLOSERS.has(token))
}

// The segments that name a command, each with the head words the walk skipped.
function segmentsOf(command: string): Array<{ heads: string[]; rest: string[] }> {
  const { text } = blank(command)
  const segments: Array<{ heads: string[]; rest: string[] }> = []
  for (const segment of text.split(COMMANDS)) {
    const { heads, rest } = afterHeads(tokensOf(segment))
    if (namesNoCommand(rest)) continue
    segments.push({ heads, rest })
  }
  return segments
}

export function gitSubcommands(command: string): Array<string | undefined> {
  return segmentsOf(command).map(segment => gitOf(segment.rest)?.sub)
}

// The one head word that surely runs the command after it: `time` runs what it
// times. `{` does not qualify (review RR1): the shared COMMANDS splits on the
// parentheses, so a brace-group body and a function definition's body present the
// same `{ git commit …` segment — and `f() { git commit -m m; }` only defines the
// function, running no commit. Every other head the walk skips — `if`, `then`,
// `elif`, `else`, `!` — may not run its command either, and a commit behind one can
// exit 0 having committed nothing (`if git add missing.lock; then git commit -m m;
// fi`); a successful `! git commit` exits 1 and never reaches the count. So the
// autopilot progress count reads only a commit the line really runs (review R2/RR1).
const RUNS_ITS_COMMAND = new Set(['time'])

// The subs of the segments whose head words all run their command. The gate reads
// every segment (gitSubcommands); the autopilot progress count reads this one.
export function gitSubcommandsThatRun(command: string): Array<string | undefined> {
  return segmentsOf(command)
    .filter(segment => segment.heads.every(head => RUNS_ITS_COMMAND.has(head)))
    .map(segment => gitOf(segment.rest)?.sub)
}
