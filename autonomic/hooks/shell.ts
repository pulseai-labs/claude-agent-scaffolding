// autonomic's reading of a Bash command. The declarations from COMMANDS to gitOf are a
// copy of seat-mods/hooks/rules.ts: plugins never import each other, and
// tests/test-mod-shell-parity.sh holds the copies identical. Change them there
// first, then copy.

// Command boundaries for matching; subshell parentheses count too.
const COMMANDS = /;|&&|\|\||\||\n|\(|\)/

// Heredoc bodies and quoted strings are text, not commands: a commit message may
// name `git merge` or `-n`. Each is swapped for a numbered marker before matching,
// and the trailer check expands the markers in the commit's own segment.
// A heredoc opener; its delimiter is any quoted word, or a bare word.
const HEREDOC = /<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|([^\s;&|<>()'"]+))/g

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
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token) || WRAPPERS.has(token)) i += 1
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

// Each command segment's tokens, quoted and heredoc text blanked.
export function segments(command: string): string[][] {
  const { text } = blank(command)
  return text.split(COMMANDS).map(tokensOf).filter(tokens => tokens.length > 0)
}

export { commandOf, gitOf }
