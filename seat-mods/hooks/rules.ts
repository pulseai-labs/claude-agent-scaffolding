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

// `unresolved`: the guard could not read the operand's shell word (a $VAR no literal assignment gave, `…`, {…}, a relative path after a cd it cannot follow): UNREAD.
export type Removal = { place: Place; protected: boolean; unresolved?: boolean }
// `allow`: the folders a guarded seat may write beside its worktree, SEAT_MODS_ALLOW then /tmp and $TMPDIR (as given and as resolved), named in an outside write's deny text as the place for scratch files.
export type Facts = { kind: 'bash'; rules: readonly RuleId[]; removals?: readonly Removal[] } | { kind: 'write'; place: Place; allow?: readonly string[] }

// Rules every crew brief of every role shares (spec §4).
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
// Command boundaries for matching; subshell parentheses count too. A lone `&` —
// Bash's background list separator — is one, and only a lone one: `&&` is the
// and-list, and a `&` a redirection carries (`>&`, `<&`, `&>`, `&>>`) is not a
// boundary (#723). `rmTargets` splits on `&` through its own second spelling;
// change one and check the other.
const COMMANDS = /;|&&|(?<![&<>])&(?![&>])|\|\||\||\n|\(|\)/
// The seat-mods-v0.3.1 separator, kept as the union's second reading: it ran every rail
// before 0.3.2, so a union with it can miss nothing the tag caught, whatever exotic grammar
// the newer reading mis-scans (#723 rounds 3-4). seat-mods-local, outside the parity-held
// declarations; it can go when a fresh review finds no shape where the shared reading alone
// misses a command Bash runs that this separator caught.
const TAG_COMMANDS = /;|&&|\|\||\||\n|\(|\)/
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
const MARKER = /\u0000(\d+)\u0000/g
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
// a `)` after it, and reads the rest of that line as command text: for the last opener read
// on its line, inside a `$(` opened on that line, the piece ends after the delimiter there and
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

// A lone `&` inside an unquoted `${…}` or `$[…]` is literal to Bash — the word
// carries it — so only that `&` stops being a boundary; every other character
// (`(`, `)`, `;`, `|`, newline) keeps its COMMANDS meaning, and the `&` of a
// `$(…)` nested in an expansion is a real separator and keeps splitting. Each
// masked `&` becomes a marker piece, so expand() restores the real text for the
// trailer and `-F` readers. `$$` is one token, so a `${` right after it opens an
// expansion while the `{` after a completed `$$` stays literal; an unterminated
// expansion masks nothing — the split stays, fail closed. seat-mods-local by
// ruling: molt's gate keeps its 0.2.4 reading of these words (#723 review
// R1/C1/C2, round 3); kept outside the parity-held declarations.
function maskExpansionAmps(text: string, pieces: string[]): string {
  type Zone = { kind: 'brace' | 'bracket' | 'paren'; closed: boolean }
  const stack: Zone[] = []
  const candidates: Array<{ at: number; zones: Zone[] }> = []
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (char === '$') {
      const next = text[i + 1]
      if (next === '$') { i += 1; continue }                    // `$$` is a complete token
      if (next === '{') { stack.push({ kind: 'brace', closed: false }); i += 1; continue }
      if (next === '[') { stack.push({ kind: 'bracket', closed: false }); i += 1; continue }
      if (next === '(') { stack.push({ kind: 'paren', closed: false }); i += 1; continue }
      continue
    }
    const top = stack[stack.length - 1]
    if (char === '}' && top?.kind === 'brace') { top.closed = true; stack.pop(); continue }
    if (char === ']' && top?.kind === 'bracket') { top.closed = true; stack.pop(); continue }
    if (char === ')' && top?.kind === 'paren') { top.closed = true; stack.pop(); continue }
    if (char === '(' && top?.kind === 'paren') { stack.push({ kind: 'paren', closed: false }); continue }
    if (char === '[' && top?.kind === 'bracket') { stack.push({ kind: 'bracket', closed: false }); continue }
    if (char !== '&') continue
    if (top?.kind !== 'brace' && top?.kind !== 'bracket') continue
    if ('&<>'.includes(text[i - 1] ?? '') || '&>'.includes(text[i + 1] ?? '')) continue
    // The snapshot shares the zone objects, so a later close flips `closed` here:
    // a candidate survives only when every zone around it terminated.
    candidates.push({ at: i, zones: [...stack] })
  }
  let out = ''
  let from = 0
  for (const candidate of candidates) {
    if (candidate.zones.some(zone => !zone.closed)) continue
    out += text.slice(from, candidate.at) + `\u0000${pieces.push('&') - 1}\u0000`
    from = candidate.at + 1
  }
  return out + text.slice(from)
}

// One reading of a command: its splits under `separator`, with the expansion mask applied
// when `mask` says so. Every COMMANDS-split rail reads the command twice — once with the
// shared `COMMANDS` and the mask, once with the 0.3.1 `TAG_COMMANDS` and no mask — and takes
// the union of the two rule sets (and of the `-F` files), so by construction the rails can
// miss nothing the tag caught (#723 round 4, the structural fix).
function segmentsFor(text: string, pieces: string[], separator: RegExp, mask: boolean): string[] {
  return (mask ? maskExpansionAmps(text, pieces) : text).split(separator)
}

// A segment's text with its blanked pieces put back, nested pieces included.
function expand(text: string, pieces: readonly string[], seen: readonly string[] = []): string {
  return text.replace(MARKER, (_, i: string) => {
    if (seen.includes(i) || seen.length >= 64) throw new Error('unresolvable shell marker')
    return expand(pieces[Number(i)] ?? '', pieces, [...seen, i])
  })
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

// The scratch places every guarded seat may write beside the SEAT_MODS_ALLOW directories: /tmp, and $TMPDIR when it is an
// absolute directory below the root (a relative one, and `/`, name no scratch place; `/` would put every path inside). A
// seat may write and remove what lies below them; removalOf still protects each one's own path and its ancestors.
export function scratchDirs(tmpdir: string | undefined): string[] {
  const own = (tmpdir ?? '').replace(/\/+$/, '')
  return own.startsWith('/') && own !== '/tmp' ? ['/tmp', own] : ['/tmp']
}

// What both glues append to the SEAT_MODS_ALLOW list: each scratch directory as given and as its realpath resolved it
// (macOS: /tmp is a link to /private/tmp, so a target is inside by either spelling). A directory that does not resolve adds
// nothing. Neither does one that holds the worktree: placeOf lets an allow directory outrank the worktree, so /tmp would
// hand a reviewer the worktree of a seat whose tree lives under /tmp. That seat gets no scratch place there, and keeps the
// refusals it had in 0.9.0.
export function scratchAllow(scratch: readonly string[], resolved: readonly (string | undefined)[], root: string | undefined): string[] {
  const kept = scratch.flatMap((dir, i) => {
    const real = resolved[i]
    if (real === undefined) return []
    const holdsRoot = root !== undefined && (root === real || root.startsWith(real.replace(/\/$/, '') + '/'))
    return holdsRoot ? [] : [dir, real]
  })
  return [...new Set(kept)]
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

// Shell syntax is an exact raw head, before assignments or execution wrappers.
// Keep this walk outside the declarations shared with molt. `builtin` is an
// execution prefix, not syntax: its argument must never restart this walk.
const HEAD_WORDS = new Set(['if', 'then', 'elif', 'else', 'do', 'while', 'until', '!', '{', '(', 'time'])

function afterHeads(tokens: string[]): string[] {
  while (HEAD_WORDS.has(tokens[0] ?? '')) tokens = tokens.slice(1)
  // Preserve the existing builtin command/cd recognition where Bash itself
  // invokes it: at the head, after assignments, or through the command builtin.
  // Other wrappers execute a program, so they cannot expose shell syntax here.
  let i = 0
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i] ?? '') || tokens[i] === 'command') i += 1
  if (tokens[i] !== 'builtin') return tokens
  while (tokens[i] === 'builtin') i += 1
  return tokens.slice(i)
}

// Every rail reads the command and each substitution in it as a command of its own, and takes
// the union (#724 A1, A2); a substitution nested too deep is refused.
export function bashRules(command: string, messageFileText = ''): RuleId[] {
  const found = new Set<RuleId>()
  for (const read of [command, ...substitutionsOf(command)]) {
    if (read === SUBSTITUTION_TOO_DEEP) found.add('force-push')
    else for (const rule of rulesOf(read, messageFileText)) found.add(rule)
  }
  return [...found]
}

function rulesOf(command: string, messageFileText: string): RuleId[] {
  const found = new Set<RuleId>()
  const { text, pieces } = blank(command)
  const segments = [
    ...segmentsFor(text, pieces, COMMANDS, true),
    ...segmentsFor(text, pieces, TAG_COMMANDS, false),
  ]
  for (const segment of segments) {
    const tokens = afterHeads(tokensOf(segment))
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
  for (const read of [command, ...substitutionsOf(command)])
    if (read !== SUBSTITUTION_TOO_DEEP) for (const file of messageFilesOf(read)) if (!files.includes(file)) files.push(file)
  return files
}

function messageFilesOf(command: string): string[] {
  const files: string[] = []
  const { text, pieces } = blank(command)
  const segments = [
    ...segmentsFor(text, pieces, COMMANDS, true),
    ...segmentsFor(text, pieces, TAG_COMMANDS, false),
  ]
  for (const segment of segments) {
    const git = gitOf(afterHeads(tokensOf(segment)))
    if (git?.sub !== 'commit') continue
    const { args } = git
    for (const [i, arg] of args.entries()) {
      const value = arg === '-F' || arg === '--file' ? args[i + 1]
        : arg.startsWith('--file=') ? arg.slice('--file='.length)
        : arg.startsWith('-F') ? arg.slice(2) : undefined
      if (value === undefined) continue
      const path = expand(value, pieces).replace(/^(['"])(.*)\1$/s, '$2')
      if (path !== '' && path !== '-' && !files.includes(path)) files.push(path)
    }
  }
  return files
}

// rm alone gets operand parsing; all Bash rails share the head-word walk.
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

// The cd and variable walk (spec §7, Rulings 21 and 24). Along a plain `;`, `&&` or newline sequence from the
// command's start the walk keeps the set of directories the next command may run in, and `$NAME` or `${NAME}`,
// quoted or not, reads the value a literal `NAME=value` gave. A variable stays known only across three kinds of
// command, none with a redirection: assignments whose every value is literal, a plain cd with literal operands, and
// a bare rm after literal assignments only. Any other command may write a variable by a name the guard never sees, so it forgets them all. A literal
// `cd <path>` may fail, so after `;` or a newline the set keeps what it held beside the new directory; the rest of a
// `cd <path> &&` list runs there only. A relative rm operand gives one target per directory in the set, and each
// must be allowed (spec §4: never approve a removal Bash may run elsewhere). The first `||`, `|`, `&`, parenthesis
// or compound command ends the walk (what runs there may run in a subshell, or not at all), and so do a builtin in
// SHELL_STATE and a command word the guard cannot read: from there a set with a cd in it is unknown, no variable is
// read, and every cd makes the directory unknown, as every cd did before. With no cd before it an operand keeps the
// session's directory.

// Reserved words that open a compound command, beside HEAD_WORDS. The walk never restarts, so no closer is needed.
const BLOCK_WORDS = new Set(['case', 'for', 'select', 'function', 'coproc'])
// Builtins that run text as commands, change how cd reads, or may set CDPATH: each ends the walk.
const SHELL_STATE = new Set(['eval', 'source', '.', 'trap', 'alias', 'enable', 'shopt', 'declare', 'typeset', 'local',
  'export', 'readonly', 'unset', 'read', 'readarray', 'mapfile', 'printf', 'let', 'getopts', 'wait'])
// Variables Bash sets, reads or locks itself, so `$NAME` need not give the literal assigned. Assigning IFS,
// CDPATH or POSIXLY_CORRECT changes how later words split or where a relative cd lands: that ends the walk.
const SHELL_VARIABLES = /^(?:BASH\w*|COMP_\w*|COMPREPLY|RANDOM|SRANDOM|SECONDS|LINENO|EPOCHSECONDS|EPOCHREALTIME|HISTCMD|FUNCNAME|GROUPS|DIRSTACK|PPID|UID|EUID|SHELLOPTS|PWD|OLDPWD|OPTIND|OPTARG|REPLY|_)$/
const WALK_ENDERS = new Set(['IFS', 'CDPATH', 'POSIXLY_CORRECT'])
// A value that reads the same quoted or not: no blank, glob, quote, `$`, backslash, brace or `~`.
const PLAIN_VALUE = /^[A-Za-z0-9_./+,:@%=-]+$/
// An assignment word as commandWord skips one, a subscript or `+=` included.
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/

// `word` with each `$NAME` and `${NAME}` the walk knows put in, outside single quotes and escapes. A known value
// is PLAIN_VALUE, so it reads the same at any quote level. A word starting with `~` is left whole: Bash reads its
// tilde prefix before the expansion.
function withVariables(word: string, vars: ReadonlyMap<string, string>): string {
  if (vars.size === 0 || word.startsWith('~')) return word
  let out = ''
  let quote = ''
  for (let i = 0; i < word.length; i++) {
    const char = word[i]!
    if (quote === "'") { if (char === "'") quote = ''; out += char; continue }
    if (char === '\\') { out += word.slice(i, i + 2); i += 1; continue }
    if (char === "'" && quote === '') quote = "'"
    else if (char === '"') quote = quote === '"' ? '' : '"'
    else if (char === '$') {
      const use = /^\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})/.exec(word.slice(i))
      const value = use === null ? undefined : vars.get(use[1] ?? use[2]!)
      if (use !== null && value !== undefined) { out += value; i += use[0].length - 1; continue }
    }
    out += char
  }
  return out
}

// The command a segment runs after its head words, assignments and wrappers with their options (`command -p cd`
// runs the builtin; no option of `command` or `builtin` takes a value), quotes removed: undefined for a word the
// guard cannot read (`$C`, a backtick, a glob), null for none.
function commandWord(tokens: readonly string[], pieces: readonly string[]): string | null | undefined {
  let i = 0
  while (HEAD_WORDS.has(tokens[i] ?? '')) i += 1
  for (; i < tokens.length; i++) {
    if (ASSIGNMENT.test(tokens[i]!)) continue
    const word = rmWord(expand(tokens[i]!, pieces))
    if (word === undefined || word.globAt >= 0) return undefined
    const name = word.path.replace(/^.*\//, '')
    if (!WRAPPERS.has(name) && name !== 'builtin') return name
    while (tokens[i + 1]?.startsWith('-')) i += 1
  }
  return null
}

const DIRECTORY_CHANGES = ['cd', 'pushd', 'popd']

// A directory a command may run in: '' for the session's (the glue joins a bare operand to it), a path relative to
// it written `./…` (so no glue reads a leading `~`, `@` or `:` as anything but a name), an absolute path, or UNKNOWN.
// A set holding UNKNOWN, or more than DIRECTORY_CAP members, is [UNKNOWN].
const UNKNOWN = '\u0000unknown directory\u0000'
const DIRECTORY_CAP = 4
const under = (dir: string, path: string) => `${dir === '/' ? '' : dir}/${path}`
function directories(dirs: readonly string[]): string[] {
  const set = [...new Set(dirs)]
  return set.includes(UNKNOWN) || set.length > DIRECTORY_CAP ? [UNKNOWN] : set
}

// Where a plain `cd` with these operands leaves the shell when it succeeds, from each directory in `dirs`: one
// literal operand with no option, `~`, glob or `..` (Bash's cd takes `..` from $PWD, not through links), absolute
// or joined onto each directory. Anything else is [UNKNOWN].
function cdTargets(args: readonly string[], dirs: readonly string[], vars: ReadonlyMap<string, string>, pieces: readonly string[]): string[] {
  const word = args.length === 1 ? rmWord(withVariables(expand(args[0]!, pieces), vars)) : undefined
  if (word === undefined || word.home || word.globAt >= 0 || word.path.startsWith('-') || /(?:^|\/)\.\.(?:\/|$)/.test(word.path)) return [UNKNOWN]
  const trim = (path: string) => path.replace(/\/+$/, '') || '/'
  const relative = word.path.startsWith('./') ? word.path : `./${word.path}`
  return directories(word.path.startsWith('/') ? [trim(word.path)] : dirs.map(dir => dir === UNKNOWN ? dir : trim(dir === '' ? relative : under(dir, word.path))))
}

// A relative operand in a substitution is unread when the command changes directory anywhere,
// in a substitution too: substitutionsOf's flat list does not say which span holds which, so any
// cd counts (Ruling 2). A substitution is read with no walk: it inherits no directory or variable.
// A target the outer reading already found (it splits an unquoted `$(…)` at its parentheses) is
// not listed twice.
export function rmTargets(command: string): RmTarget[] {
  const subs = substitutionsOf(command)
  const outer = rmRead(command, false, true)
  const moved = outer.moved || subs.some(sub => sub !== SUBSTITUTION_TOO_DEEP && rmRead(sub, false, false).moved)
  const targets = outer.targets
  for (const sub of subs) {
    const found = sub === SUBSTITUTION_TOO_DEEP ? [{ path: undefined, glob: false }] : rmRead(sub, moved, false).targets
    for (const target of found)
      if (!targets.some(t => t.path === target.path && t.glob === target.glob)) targets.push(target)
  }
  return targets
}

// The token that stands for a heredoc in rmRead's text: a command made of a heredoc alone is still a command. It holds
// a NUL, which no Bash word can.
const HEREDOC_MARK = '\u0000heredoc\u0000'
// rm's own spelling of the command separators (COMMANDS above), on text whose redirections are still in place: a `&`
// or `|` of a redirection operator (`>&`, `<&`, `&>`, `>|`) separates nothing. Change one spelling and check the other.
const RM_SEPARATORS = /(;|&&|\|\||(?<!>)\|(?!\|)|(?<![&<>])&(?![&>])|\n|\(|\))/
// A Bash 5.3 command substitution that runs in the current shell, `${ …; }` or `${| …; }`: the walk cannot read it,
// and it may change the directory, so the directory is unknown.
const FUNSUB = /\$\{[\s|]/

// A segment without its redirections, which belong to the shell, not rm: fd prefixes before their operators, then
// operators with their attached or separate target words. Blanked quotes and escapes keep literal glyphs out of it.
function withoutRedirections(segment: string): string {
  return segment.replace(/(^|[\s;|&()])(?:\d+|\{[A-Za-z_]\w*\})(?=[<>])/g, '$1')
    .replace(/(?:<<<|&>>|&>|<>|>\||>>|[<>]&|>|(?<!<)<(?!<))[ \t]*[^\s;&|()]+/g, ' ')
}

function rmRead(command: string, moved: boolean, walk: boolean): { targets: RmTarget[]; moved: boolean } {
  const targets: RmTarget[] = []
  // Only a heredoc's opener, body and closing line are input: blankHeredocs keeps the
  // opener-line words after the delimiter in the command, so the normal quote, escape and
  // redirect walk judges them. It reads the raw command; blank folds continuations after.
  // Remove a numeric fd at a word boundary, preserving x2 and quoted '2'.
  // An opener line read in the 0.9.0 layout keeps its tail in the piece, where the walk cannot read it: such a tail
  // keeps the walk from starting.
  let tail = false
  const source = command.replace(/(^|[\s;|&()])\d+(?=<<(?!<))/g, '$1')
  const withoutInput = blankHeredocs(source, (_, __, { at, upto }) => {
    HEREDOC.lastIndex = at
    const word = HEREDOC.exec(source) === null ? at : HEREDOC.lastIndex
    if (source.slice(word, upto).trim() !== '') tail = true
    return ` ${HEREDOC_MARK} `
  })
  const { text: input, pieces } = blank(withoutInput)
  const funsub = FUNSUB.test(command)
  let changedDirectory = moved || funsub
  // The walk: `here` is where the next command of this &&-list may run, `after` where the shell may be when the list
  // ends. `open` until the walk ends. `literalList` while every command so far in this list is a literal assignment,
  // which cannot fail: an assignment behind anything else may be skipped, so it never becomes known.
  let here = [moved || funsub ? UNKNOWN : '']
  let after = here
  const vars = new Map<string, string>()
  let open = walk && !tail && !funsub
  let literalList = true
  const end = () => { open = false; vars.clear(); if (after.length !== 1 || after[0] !== '') here = after = [UNKNOWN] }
  const literal = (text: string) => !/[$`(]/.test(text)
  const parts = input.split(RM_SEPARATORS)
  // `before` is the separator in force for the segment; after `&&`, `||` or `|` a newline continues the list, so it
  // is no separator until a command has come.
  let before: string | undefined
  let continued = false
  for (let k = 0; k < parts.length; k += 2) {
    const separator = parts[k - 1]
    if (separator !== undefined && !(separator === '\n' && continued)) {
      before = separator
      continued = separator === '&&' || separator === '||' || separator === '|'
      if (separator === ';' || separator === '\n') { here = after; literalList = true }
      else if (separator !== '&&') end()
    }
    const segment = parts[k]!
    if (segment.trim() === '') continue
    continued = false
    const tokens = tokensOf(withoutRedirections(segment)).filter(token => token !== HEREDOC_MARK)
    const redirected = /[<>]/.test(segment) || segment.includes(HEREDOC_MARK)
    if (HEAD_WORDS.has(tokens[0] ?? '') || BLOCK_WORDS.has(tokens[0] ?? '')) end()
    const head = commandOf(afterHeads(tokens))
    if (head?.name === 'rm') {
      let options = true
      for (const arg of head.args) {
        const raw = expand(arg, pieces)
        const text = withVariables(raw, vars)
        const word = rmWord(text)
        if (word !== undefined && options && word.path === '--') { options = false; continue }
        if (word !== undefined && options && word.path.startsWith('-') && word.path !== '-') continue
        const relative = word !== undefined && !word.path.startsWith('/') && !word.home
        if (word === undefined || (relative && here[0] === UNKNOWN)) {
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
        // A relative operand gives one target per directory; the glues collapse no `..` before following links.
        // A bare one built from a variable, or a literal one with a leading quoted `~`, is written `./…`, so no glue
        // reads a leading `~`, `@` or `:` in it (register.ts only expands an active leading tilde).
        if (!relative) { targets.push({ path, glob }); continue }
        const bare = text !== raw || path.startsWith('~') ? (path.startsWith('./') ? path : `./${path}`) : path
        for (const dir of here) targets.push({ path: dir === '' ? bare : under(dir, path), glob })
      }
    }
    // The raw reading counts every cd it counted before; the quote-removed one adds `"cd"` and `"command" cd`.
    const name = commandWord(tokens, pieces)
    const changes = DIRECTORY_CHANGES.includes(head?.name ?? '') || DIRECTORY_CHANGES.includes(name ?? '')
    if (changes) changedDirectory = true
    // Ruling 24: the three kinds of command that keep the variables. A literal assignment has no subscript, no `+=`
    // and no `$`, backtick or `(` in its value; a plain cd's operands read with no expansion left; an rm is the bare
    // word `rm` after literal assignments alone, since a prefix value or a wrapper's operand expands in this shell.
    const literalAssignment = (token: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token) && literal(expand(token.slice(token.indexOf('=') + 1), pieces))
    let word = 0
    while (word < tokens.length && literalAssignment(tokens[word]!)) word += 1
    const literalAssigns = !redirected && tokens.length > 0 && word === tokens.length
    const plainRm = !redirected && tokens[word] === 'rm'
    const plainCd = rmWord(expand(tokens[0] ?? '', pieces))?.path === 'cd'
    const literalCd = !redirected && plainCd && tokens.slice(1).every(token => literal(withVariables(expand(token, pieces), vars)))
    if (open && literalAssigns) {
      for (const token of tokens) {
        const variable = token.slice(0, token.indexOf('='))
        if (WALK_ENDERS.has(variable)) { end(); break }
        const value = rmWord(expand(token.slice(variable.length + 1), pieces))?.path
        if (value !== undefined && PLAIN_VALUE.test(value) && !SHELL_VARIABLES.test(variable) && (literalList || (before !== '&&' && before !== '||')))
          vars.set(variable, value)
        else vars.delete(variable)
      }
      continue
    }
    literalList = false
    if (open && plainCd) {
      here = cdTargets(tokens.slice(1), here, vars, pieces)
      after = directories([...after, ...here])
      if (!literalCd) vars.clear()
      continue
    }
    if (!plainRm) vars.clear()
    if (changes) here = after = [UNKNOWN]
    if (!open) continue
    if (name === undefined || SHELL_STATE.has(name ?? '')) end()
  }
  return { targets, moved: changedDirectory }
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
    // #844: an operand the guard cannot read gets its own text, which says how to make it readable.
    if (facts.removals?.some(target => target.unresolved))
      return `${denyText(role, 'no rm with an operand the guard cannot resolve', 'run this command')} ${RM_LITERAL}`
    if (facts.removals?.some(target => target.protected || !profile.writeIn.includes(target.place)))
      return denyText(role, 'no rm outside writable places (the worktree unless this seat reviews, /tmp, $TMPDIR and the SEAT_MODS_ALLOW directories), or of their roots or ancestors', 'run this command')
    return undefined
  }
  if (profile.writeIn.includes(facts.place)) return undefined
  if (facts.place === 'worktree') return denyText(role, 'no edits in the worktree', 'write here')
  const deny = denyText(role, 'no writes outside the worktree, /tmp, $TMPDIR and the SEAT_MODS_ALLOW directories', 'write here')
  return facts.allow?.length ? `${deny} Scratch files, such as a commit message, go in ${facts.allow.join(', ')}.` : deny
}

// An rm operand rmTargets could not read (its path is undefined): a removal the glues report without placing it.
export const UNREAD: Readonly<Removal> = Object.freeze({ place: 'outside', protected: false, unresolved: true })

const RM_LITERAL = 'To remove a file, spell its path out literally: the guard does not read `…` or {…}, a $VAR no plain NAME=value just before gave, or a relative path after a cd it cannot follow.'

export function uncheckedRmText(role: Role): string {
  return denyText(role, 'Bash command could not be checked', 'run this command')
}

export function invalidText(value: string): string {
  return `seat-mods: SEAT_MODS_ROLE="${value}" is not a role ` +
    '(valid: implementer, verifier, reviewer, orchestrator, coordinator). ' +
    'Every tool call is denied; respawn this seat with a valid role.'
}
