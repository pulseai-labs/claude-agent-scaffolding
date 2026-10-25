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
// A heredoc opener and its whole delimiter word: any mix of quoted parts, escapes and
// plain characters, up to an unquoted blank or metacharacter (#702 B10).
const HEREDOC = /(?<!<)<<(?!<)(-?)[ \t]*((?:'[^'\n]*'|"(?:[^"\\\n]|\\.)*"|\\.|[^\s;&|<>()'"\\])+)/y

const QUOTED = /"(?:[^"\\]|\\.)*"|'[^']*'/g

// Words that run the next word as the command.
const WRAPPERS = new Set(['sudo', 'env', 'command', 'exec', 'nohup', 'time'])

// Each heredoc becomes one piece: its opener (`<<` and the delimiter word) and its body
// through the closing line. `quoted` says the word held a quote or backslash, so Bash
// expands nothing in the body. The opener line's text after the word stays command text
// (#724 A3, A9), and the bodies follow that line in opener order. The delimiter is the
// word after quote removal; a body ends at the first line that is exactly it (leading
// tabs stripped after `<<-`), and in an unquoted body a line ending in a backslash first
// joins the next, as in Bash. A heredoc with no closing line runs to the end of the
// command. A `<<` in a comment or in arithmetic opens nothing (#724 A11, #702 B3).
function blankHeredocs(command: string, keep: (piece: string, quoted: boolean) => string): string {
  const opens: Array<{ at: number; end: number; delimiter: string; strip: boolean; quoted: boolean }> = []
  let out = ''
  let from = 0
  let quote = ''     // the quote open here: ' or "
  let parens = 0     // parentheses open in a `$((…))` or `((…))`
  let comment = false
  let inWord = false // the character before this one belongs to a word
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!
    if (char === '\n' && opens.length > 0) {
      // The opener line ends here; each body starts where the one before it ended.
      let body = i
      for (const open of opens) {
        let end = command.length
        let joined = ''
        for (let line = body + 1; line < command.length; ) {
          const next = command.indexOf('\n', line)
          const stop = next < 0 ? command.length : next
          const text = joined + command.slice(line, stop)
          if ((open.strip ? text.replace(/^\t+/, '') : text) === open.delimiter) { end = stop; break }
          if (next < 0) break
          joined = !open.quoted && /(?<!\\)(?:\\\\)*\\$/.test(text) ? text.slice(0, -1) : ''
          line = next + 1
        }
        out += command.slice(from, open.at) + keep(command.slice(open.at, open.end) + command.slice(body, end), open.quoted)
        from = open.end
        body = end
      }
      out += command.slice(from, i)
      from = body
      i = body - 1
      opens.length = 0
      continue
    }
    if (comment) { comment = char !== '\n'; continue }
    if (parens > 0) { parens += char === '(' ? 1 : char === ')' ? -1 : 0; continue }
    if (char === '<') {
      HEREDOC.lastIndex = i
      const open = HEREDOC.exec(command)
      if (open !== null) {
        const word = open[2]!
        opens.push({
          at: i, end: HEREDOC.lastIndex, strip: open[1] === '-', quoted: /['"\\]/.test(word),
          delimiter: word.replace(/'([^']*)'|"((?:[^"\\]|\\.)*)"|\\(.)/g, (_: string, single?: string, double?: string, escaped?: string) =>
            single ?? escaped ?? double!.replace(/\\([$`"\\])/g, '$1')),
        })
        i = HEREDOC.lastIndex - 1
        inWord = true
        continue
      }
    }
    if (quote === "'") { if (char === "'") quote = ''; continue }
    if (char === '\\') { if (command[i + 1] !== '\n') inWord = true; i += 1; continue }
    if (char === '$' && command.startsWith('((', i + 1)) { parens = 2; i += 2; inWord = true; continue }
    if (quote === '"') { if (char === '"') quote = ''; continue }
    if (char === "'" || char === '"') { quote = char; inWord = true; continue }
    if (!inWord && char === '#') { comment = true; continue }
    if (!inWord && command.startsWith('((', i)) { parens = 2; i += 1; inWord = true; continue }
    inWord = !' \t\n;&|()'.includes(char)
  }
  return out + command.slice(from)
}

function blank(command: string): { text: string; pieces: string[] } {
  const pieces: string[] = []
  const keep = (piece: string) => `\u0000${pieces.push(piece) - 1}\u0000`
  // An unquoted backslash-newline is a line continuation, not a command boundary; an
  // escaped backslash before a newline continues nothing. The heredocs are found first,
  // so only command text and unquoted bodies are folded (#702 B11).
  const fold = (text: string) => text.replace(/(?<!\\)((?:\\\\)*)\\\n/g, '$1 ')
  // A backslash outside quotes makes the next character text (`\\|` is not a pipe).
  // Before a word character, `.`, `/` or `-` it only quotes: quote removal makes `\rm` read
  // `rm`, so it is dropped (#702 B8). A reserved word is syntax only unquoted, so `\if`
  // keeps its escape and stays a program name.
  const reserved = /^(?:if|then|elif|else|fi|do|while|until)(?=[\s;&|()<>]|$)/
  const unescape = (escape: string, at: number, whole: string) =>
    /[A-Za-z0-9_./-]/.test(escape[1]!) && !reserved.test(whole.slice(at + 1)) ? escape[1]! : keep(escape)
  const text = fold(blankHeredocs(command, (piece, quoted) => keep(quoted ? piece : fold(piece))))
    .replace(QUOTED, keep).replace(/\\./g, unescape)
  // A `#` that starts a word begins a comment, which runs no command.
  return { text: text.replace(/(^|[ \t;&|()])#[^\n]*/gm, '$1'), pieces }
}

// The command word and its arguments: leading VAR=value assignments and wrapper
// words are skipped, and a path such as /usr/bin/git names git. `viaPath` says a skipped
// wrapper was named by a relative path (`./env`, `bin/env`): that may be any local program
// (#702 B7), so a reader that approves must not take it for the system one. An absolute
// path (`/usr/bin/env`) reads as the bare word.
function commandOf(tokens: readonly string[]): { name: string; args: string[]; viaPath: boolean } | undefined {
  let i = 0
  let viaPath = false
  for (;;) {
    const token = tokens[i]
    if (token === undefined) return undefined
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) i += 1
    else if (WRAPPERS.has(token.replace(/^.*\//, ''))) { viaPath = viaPath || (token.includes('/') && !token.startsWith('/')); i += 1 }
    else return { name: token.replace(/^.*\//, ''), args: tokens.slice(i + 1), viaPath }
  }
}

// A segment's words, less its redirections: a word that is one (`2>&1`, `{fd}>f`, `&>f`)
// is dropped, with the next word when the operator ends its word (`> f`), and a redirection
// glued to a word (`--force>&2`) is cut off it (#724 A10, #702 B2).
function tokensOf(segment: string): string[] {
  const redirect = /^(?:\{[A-Za-z_]\w*\}|\d+|&)?(?:>>?|<|>&|<&|&>>?|>\|)/
  const words = segment.trim().split(/\s+/).filter(Boolean)
  const tokens: string[] = []
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    const cut = redirect.test(word) ? 0 : word.search(/&?[<>]/)
    if (cut < 0) { tokens.push(word); continue }
    if (cut > 0) tokens.push(word.slice(0, cut))
    const operator = redirect.exec(word.slice(cut))
    if (operator !== null && /^[<>&|]*$/.test(word.slice(cut + operator[0].length))) i += 1
  }
  return tokens
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

// A segment's git subcommand. A wrapper reached by a relative path (`./env git add f`) may
// be any local program, and this gate approves what it reads, so such a segment is not git
// (#702 B7).
function subOf(rest: string[]): string | undefined {
  return commandOf(rest)?.viaPath ? undefined : gitOf(rest)?.sub
}

export function gitSubcommands(command: string): Array<string | undefined> {
  return segmentsOf(command).map(segment => subOf(segment.rest))
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
    .map(segment => subOf(segment.rest))
}
