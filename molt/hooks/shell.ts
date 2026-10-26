// molt's reading of a Bash command. The declarations from COMMANDS to substitutionsOf
// are a copy of seat-mods/hooks/rules.ts: plugins never import each other, and
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

// A quoted string — double, single or `$'…'` — or a backslash escape or `$$` (the shell's
// PID, so `$$'…'` is single-quoted), neither of which opens a string. blankHeredocs reads
// quotes the same way: where the two readings differ, a quote can pair across a heredoc
// body and hide the lines after it.
const QUOTED = /\\.|\$\$|\$'(?:[^'\\]|\\[\s\S])*'|"(?:[^"\\]|\\.)*"|'[^']*'/g

// Words that run the next word as the command.
const WRAPPERS = new Set(['sudo', 'env', 'command', 'exec', 'nohup', 'time'])

// Each heredoc becomes one piece: its opener (`<<` and the delimiter word) and, from the
// newline that ends the opener's line, its body through the closing line. `quoted` says
// the word held a quote or backslash, so Bash expands nothing in the body. The delimiter
// is the word after quote removal; a body ends at the first line that is exactly it
// (leading tabs stripped after `<<-`), and in an unquoted body a line ending in a
// backslash first joins the next, as in Bash. The bodies follow their line in opener
// order; one with no closing line runs to the end of the command. Inside a `$(…)`, Bash
// 5.3 also ends a body, with a warning, at a line that starts with the delimiter and holds
// a `)` after it, and reads the rest of that line as command text: for the last opener on
// its line, inside a `$(` opened on that line, the piece ends after the delimiter there and
// the scan resumes after it (not in a backtick span, which Bash reads apart, and not on a
// line a backslash joined).
// After an unquoted opener the line's text stays command text (#724 A3, A9), and the line
// ends at a newline outside quotes and arithmetic. Quotes nest inside `$(…)`, backticks
// and `${…}`, which this scan does not model, so a line holding one after the first
// opener's word keeps the seat-mods 0.9.0 reading: only that opener is read, its line ends
// at its first newline, and the rest of the line goes in its piece. So does a `<<` in
// quotes after one of those on its line (the `"$(cat <<'EOF' … )"` commit form); any other
// `<<` in quotes is text, as in Bash. A `<<` in arithmetic opens nothing, and a `#` that
// starts a word begins a comment, which runs no command: it is dropped here, quotes and
// all (#724 A11, #702 B3). `keep` also gets where the piece's two parts lie in `command`:
// `at`..`upto` (the opener, and in the 0.9.0 reading the rest of its line) and `body`..`end`.
function blankHeredocs(command: string, keep: (piece: string, quoted: boolean, region: { at: number; upto: number; body: number; end: number }) => string): string {
  const opens: Array<{ at: number; end: number; quote: string; delimiter: string; strip: boolean; quoted: boolean }> = []
  let out = ''
  let from = 0
  let quote = ''     // the quote open here: ', " or $'
  let parens = 0     // parentheses open in a `$((…))` or `((…))`
  let comment = -1   // where the open comment starts
  let nested = -1    // the last `$(`, backtick or `${` since a newline outside quotes
  let inWord = false // the character before this one belongs to a word
  // Whether `text`, the opener's line up to the opener, ends inside a `$(…)` opened on that line: the innermost span
  // still open at its end is one, not a backtick span.
  const inSubstitution = (text: string): boolean => {
    let tick: boolean | undefined
    for (let span = substitutionSpans(text, 'command').pop(); span !== undefined && span.to === text.length; span = substitutionSpans(text, 'command').pop()) {
      tick = span.tick
      text = text.slice(span.from)
    }
    return tick === false
  }
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!
    const first = opens[0]
    const older = first !== undefined && (first.quote !== '' || nested > first.at)
    if (char === '\n' && first !== undefined && (older || (quote === '' && parens === 0))) {
      // The opener line ends here; each body starts where the one before it ended.
      let body = i
      const last = older ? first : opens[opens.length - 1]
      for (const open of older ? [first] : opens) {
        let end = command.length
        let joined = ''
        let inside: boolean | undefined
        for (let line = body + 1; line < command.length; ) {
          const next = command.indexOf('\n', line)
          const stop = next < 0 ? command.length : next
          const text = joined + command.slice(line, stop)
          const bare = open.strip ? text.replace(/^\t+/, '') : text
          if (bare === open.delimiter) { end = stop; break }
          if (open === last && joined === '' && bare.startsWith(open.delimiter) && bare.includes(')', open.delimiter.length) &&
            (inside ??= inSubstitution(command.slice(command.lastIndexOf('\n', open.at - 1) + 1, open.at)))) { end = stop - bare.length + open.delimiter.length; break }
          if (next < 0) break
          joined = !open.quoted && /(?<!\\)(?:\\\\)*\\$/.test(text) ? text.slice(0, -1) : ''
          line = next + 1
        }
        const upto = older ? i : open.end
        out += command.slice(from, open.at) + keep(command.slice(open.at, upto) + command.slice(body, end), open.quoted, { at: open.at, upto, body, end })
        from = upto
        body = end
      }
      out += command.slice(from, comment < 0 ? i : comment)
      from = body
      i = body - 1
      quote = first.quote
      comment = -1
      opens.length = 0
      continue
    }
    if (char === '\n' && quote === '') nested = -1
    if (comment >= 0) {
      if (char === '\n') { out += command.slice(from, comment); from = i; comment = -1 }
      continue
    }
    if (char === '`' || (char === '$' && (command[i + 1] === '{' || (command[i + 1] === '(' && command[i + 2] !== '(')))) nested = i
    if (parens > 0) { parens += char === '(' ? 1 : char === ')' ? -1 : 0; continue }
    if (char === '<' && (first === undefined ? quote === '' || nested >= 0 : quote === '')) {
      HEREDOC.lastIndex = i
      const open = HEREDOC.exec(command)
      if (open !== null) {
        const word = open[2]!
        opens.push({
          at: i, end: HEREDOC.lastIndex, quote, strip: open[1] === '-', quoted: /['"\\]/.test(word),
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
    if (quote === "$'") { if (char === "'") quote = ''; continue }
    if (char === '$' && command[i + 1] === '$') { i += 1; inWord = true; continue }
    if (char === '$' && command.startsWith('((', i + 1)) { parens = 2; i += 2; inWord = true; continue }
    if (quote === '"') { if (char === '"') quote = ''; continue }
    if (char === '$' && command[i + 1] === "'") { quote = "$'"; i += 1; inWord = true; continue }
    if (char === "'" || char === '"') { quote = char; inWord = true; continue }
    if (!inWord && char === '#') { comment = i; continue }
    if (!inWord && command.startsWith('((', i)) { parens = 2; i += 1; inWord = true; continue }
    inWord = !' \t\n;&|()'.includes(char)
  }
  return out + command.slice(from, comment < 0 ? command.length : comment)
}

// The `$(…)` and backtick spans of `text`, in order: `at`..`end` is the whole span, `from`..`to`
// its command text, which runs to the end of the text when the span never closes. Bash reads a
// span's text as a command of its own, with fresh quoting, so its quotes pair inside it and a `#`
// that starts a word there begins a comment (#724 A1, A2). A `$((…))` is arithmetic, walked for the
// spans in it, unless its inner parenthesis closes first (`$((a); b)` is a substitution). `mode`:
// 'command' reports every span at the text's top level; 'blank' reports a backtick span or a
// `$(…)` in double quotes only when it closes, and walks on through an unquoted `$(…)`, which
// the parenthesis split reads; 'body' reads an unquoted heredoc body, where quotes are text. A
// walk more than 64 constructs deep reads as never closing.
function substitutionSpans(text: string, mode: 'command' | 'blank' | 'body'): Array<{ at: number; from: number; to: number; end: number; tick: boolean }> {
  const spans: Array<{ at: number; from: number; to: number; end: number; tick: boolean }> = []
  // From `i`, the index of the character that closes the construct, `)`, `"` or a backtick, or
  // the text's length for '' (the top level); -1 when it never closes. Inside a span nothing is
  // reported: its text is read on its own.
  const walk = (i: number, close: string, quoted: boolean, report: boolean, nest: number): number => {
    if (nest > 64) return -1
    const literal = close === '"' || (close === '' && mode === 'body')
    const comments = mode === 'command' || !report
    let depth = 0
    let word = false
    for (; i < text.length; i++) {
      const char = text[i]!
      if (char === '\\') { if (text[i + 1] !== '\n') word = true; i += 1; continue }
      if (close === '`') { if (char === '`') return i; continue }
      if (char === '"' && close === '"') return i
      if (char === '$' && text[i + 1] === '$') { i += 1; word = true; continue }
      if (char === '`' || (char === '$' && text[i + 1] === '(')) {
        const tick = char === '`'
        if (!tick && mode === 'blank' && !quoted) { word = true; continue }
        const from = i + (tick ? 1 : 2)
        let end: number
        if (!tick && text[i + 2] === '(') {
          const mark = spans.length
          const inner = walk(i + 3, ')', quoted, report, nest + 1)
          if (inner >= 0 && text[inner + 1] === ')') { i = inner + 1; word = true; continue }
          spans.length = mark
          end = inner < 0 ? -1 : walk(inner + 1, ')', false, false, nest + 1)
        } else end = walk(from, tick ? '`' : ')', false, false, nest + 1)
        if (report && (end >= 0 || mode !== 'blank'))
          spans.push({ at: i, from, to: end < 0 ? text.length : end, end: end < 0 ? text.length : end + 1, tick })
        if (end < 0) return -1
        i = end
        word = true
        continue
      }
      if (literal) continue
      if (char === "'") { i = text.indexOf("'", i + 1); if (i < 0) return -1; word = true; continue }
      if (char === '$' && text[i + 1] === "'") {
        for (i += 2; i < text.length && text[i] !== "'"; i += text[i] === '\\' ? 2 : 1);
        if (i >= text.length) return -1
        word = true
        continue
      }
      if (char === '"') { i = walk(i + 1, '"', true, report, nest + 1); if (i < 0) return -1; word = true; continue }
      if (comments && !word && char === '#') { const end = text.indexOf('\n', i); if (end < 0) break; i = end - 1; continue }
      if (close === ')' && char === '(') depth += 1
      if (close === ')' && char === ')' && depth-- === 0) return i
      word = !' \t\n;&|()'.includes(char)
    }
    return close === '' ? text.length : -1
  }
  walk(0, '', false, true, 0)
  return spans
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
  // blankHeredocs has already dropped the comments, so a quote in one pairs with nothing. A
  // backtick span, and a `$(…)` in double quotes, is masked whole before the quotes are read:
  // its quotes pair inside it, as in Bash (#724 A1, A2).
  const folded = fold(blankHeredocs(command, (piece, quoted) => keep(quoted ? piece : fold(piece))))
  let masked = ''
  let from = 0
  for (const span of substitutionSpans(folded, 'blank')) {
    masked += folded.slice(from, span.at) + keep(folded.slice(span.at, span.end))
    from = span.end
  }
  const text = (masked + folded.slice(from))
    .replace(QUOTED, quoted => quoted.startsWith('\\') ? quoted : keep(quoted)).replace(/\\./g, unescape)
  return { text, pieces }
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

// What substitutionsOf lists for a span nested more than 8 deep: bashRules reads it as
// force-push and rmTargets as an unread operand, and molt's gate never allows it.
export const SUBSTITUTION_TOO_DEEP = '\u0000substitution nested more than 8 deep\u0000'

// The command text of every `$(…)` and backtick span Bash would run: unquoted, in double quotes,
// on a heredoc's opener line and in an unquoted heredoc body; never in single quotes or a quoted
// body (#724 A1, A2). The spans are found in a copy of the command with each heredoc's opener
// (with the rest of its line in the 0.9.0 reading) and body blanked, and each is sliced from the
// command itself, so its text is in Bash's order (Task 3 review C1). Each is read again on its
// own, as Bash reads it, for the spans nested in it, which follow it in the list.
export function substitutionsOf(command: string): string[] {
  const found: string[] = []
  const read = (command: string, level: number): void => {
    const heredocs: Array<{ quoted: boolean; at: number; upto: number; body: number; end: number }> = []
    blankHeredocs(command, (_, quoted, region) => { heredocs.push({ quoted, ...region }); return '' })
    let view = command
    for (const { at, upto, body, end } of heredocs)
      for (const [from, to] of [[at, upto], [body, end]] as const)
        view = view.slice(0, from) + ' '.repeat(to - from) + view.slice(to)
    const spans: Array<{ at: number; end: number; text: string }> = []
    // The spans of `text`, which stands at `offset` in the command. A heredoc that closed at a line only starting with
    // its delimiter ends mid-line: Bash reads the rest of that line as the next line, so the span's text gets a newline there.
    const take = (text: string, offset: number, mode: 'command' | 'body'): void => {
      for (const span of substitutionSpans(text, mode)) {
        const from = offset + span.from
        const to = offset + span.to
        let inner = ''
        let cut = from
        for (const { end } of heredocs)
          if (cut < end && end < to && command[end] !== '\n') { inner += command.slice(cut, end) + '\n'; cut = end }
        inner += command.slice(cut, to)
        spans.push({ at: offset + span.at, end: offset + span.end, text: span.tick ? inner.replace(/\\([\\`$])/g, '$1') : inner })
      }
    }
    take(view, 0, 'command')
    // A heredoc outside every span: the rest of its opener line in the 0.9.0 reading is command
    // text, and an unquoted body is read for spans.
    const outer = [...spans]
    for (const { quoted, at, upto, body, end } of heredocs) {
      if (outer.some(span => span.at <= at && at < span.end)) continue
      HEREDOC.lastIndex = at
      const word = HEREDOC.exec(command) === null ? at : HEREDOC.lastIndex
      if (upto > word) take(command.slice(word, upto), word, 'command')
      if (!quoted) take(command.slice(body, end), body, 'body')
    }
    for (const span of spans.sort((a, b) => a.at - b.at)) {
      if (level > 8) { if (!found.includes(SUBSTITUTION_TOO_DEEP)) found.push(SUBSTITUTION_TOO_DEEP); return }
      found.push(span.text)
      read(span.text, level + 1)
    }
  }
  read(command, 1)
  return found
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

// The command of each segment of a substitution's text, for the gate's inner rule (#724 A1,
// A2). A heredoc is the command's stdin, not an operand, so its marker is left out of the words;
// `input` says another `<` feeds the command a file, and a segment of only that (`$(<file)`) is
// Bash's own file read, listed as no command. `local` says the command word is a relative path,
// which may be any local program (#702 B7), and `plain` holds the words after quote removal. An
// opener line kept whole in the 0.9.0 reading is also read on its own, opener blanked.
export function innerCommandsOf(command: string): Array<{ name: string; args: string[]; plain: string[]; sub: string | undefined; local: boolean; input: boolean } | undefined> {
  const commands: Array<{ name: string; args: string[]; plain: string[]; sub: string | undefined; local: boolean; input: boolean } | undefined> = []
  blankHeredocs(command, (_, __, { at, upto }) => {
    HEREDOC.lastIndex = at
    const word = HEREDOC.exec(command) === null ? at : HEREDOC.lastIndex
    if (upto > word)
      commands.push(...innerCommandsOf(command.slice(command.lastIndexOf('\n', at - 1) + 1, at) + ' '.repeat(word - at) + command.slice(word, upto)))
    return ''
  })
  const { text, pieces } = blank(command)
  const plain = (word: string, depth: number): string => depth > 8 ? word
    : word.replace(/\u0000(\d+)\u0000/g, (_: string, n: string) => plain(pieces[Number(n)] ?? '', depth + 1)).replace(/['"\\]/g, '')
  for (const segment of text.split(COMMANDS)) {
    const words = segment.replace(/\u0000(\d+)\u0000/g, (marker: string, n: string) => pieces[Number(n)]?.startsWith('<<') ? ' ' : marker)
    const input = /(?<!<)<(?!<)/.test(words)
    const { rest } = afterHeads(tokensOf(words))
    if (namesNoCommand(rest)) { if (input) commands.push(undefined); continue }
    const head = commandOf(rest)
    const word = head === undefined ? '' : rest[rest.length - head.args.length - 1] ?? ''
    commands.push(head && {
      name: head.name, args: head.args, plain: head.args.map(arg => plain(arg, 0)), sub: gitOf(rest)?.sub,
      local: head.viaPath || (word.includes('/') && !word.startsWith('/')), input,
    })
  }
  return commands
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
