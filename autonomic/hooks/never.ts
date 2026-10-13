// The never-approve list (spec §3.3; autonomic 0.2.0, #684 direction 2′): checked in code
// before any fork. A match leaves the ask in place.
//
// Since 0.5.0 the floor judges each simple command on its own words when the text parses, with
// context from the whole text (moves, branch switches, variables assigned once to a literal, git
// config writes).
// Text it cannot parse, and text that names a program that may run text, is read as one bag of
// words, so quoting, nesting, wrappers and interpreters still cannot hide a word there:
// `python3 -c 'git push -f'` shows `push` and `-f`. Text that never runs (messages, heredoc
// bodies, a literal `sh -c` string read as commands) is data.

// 'unreadable' matches nothing since 0.2.0; the name stays valid so an existing setting parses.
export type NeverRule = 'force-push' | 'default-branch-push' | 'branch-delete' | 'rm-outside' | 'no-verify' | 'unreadable'
export type Where = { cwd: string; root: string; home: string; branch?: string; defaultBranch?: string }

// Bash joins a backslash-newline, drops a backslash and joins quoted pieces, so `pu\sh`,
// `pu""sh` and `'git' push` are push. A substitution or a backtick opens new words; `${`
// does not, so `${OPTS}` stays a word that starts with `$`.
const SPLIT = /\$\(|[\s;&|()<>`]+/
// A commit message is text Bash never runs, so its body is dropped: `-m "$(cat <<'X'` … `X`
// `)"` (or `--message`), the usual commit. The delimiter must be quoted, so the body holds no
// expansion. Written files, Python edits and message consumers are read by `WRITES` below.
const MESSAGE = /(?:-m|--message)(?:=|[ \t]*)"\$\(cat[ \t]+<<-?[ \t]*(['"])([A-Za-z_]\w*)\1[ \t]*\n[\s\S]*?\n[ \t]*\2[ \t]*\n?[ \t]*\)"/g
// A program that may run text it is given keeps every word, the dropped bodies included:
// a shell, an interpreter, a remote or wrapping runner, sed, awk. `.` counts only where a
// command starts (`git add .` is a path).
const RUNNER = /^(?:bash|sh|zsh|dash|ksh|fish|eval|source|xargs|ssh|su|watch|parallel|sed|python[\d.]*|pypy[\d.]*|node|nodejs|deno|bun|perl[\d.]*|ruby[\d.]*|php[\d.]*|lua(?:jit)?[\d.]*|Rscript|pwsh|powershell|osascript|tclsh|expect|[gmn]?awk)$/
const DOT_SOURCE = /(?:^|[\n;&|(`]|\$\()[ \t]*\.[ \t]/
// Inert commands never run text they are given and never define a name, so their words
// leave the bag (#693). Every other command keeps its words: the list is trusted to hold
// only safe names, never to hold every dangerous one.
const INERT = new Set(['[', '[[', 'test', 'echo', 'printf', 'exit', 'true', 'false', 'cat', 'head', 'tail', 'wc', 'ls',
  'stat', 'grep', 'jq', 'cut', 'tr', 'mkdir', 'touch', 'mv', 'cp'])
const KEYWORD = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '}'])
function split(command: string): string[] {
  const text = command.replace(/\\\r?\n/g, '').replace(/[\\'"]/g, '')
  // NAME=VALUE also shows its value: FLAGS=-rf, alias.p=push, remote.x.push=refs/heads/main.
  return text.split(SPLIT).flatMap(w => (w.indexOf('=') > 0 ? [w, w.slice(w.indexOf('=') + 1)] : [w])).filter(w => w !== '')
}
// 0.5.1 (§2): a command's own words, the arguments Bash passes. A redirect and its target are not
// words the command is given (`git push >log` passes none), so they are dropped as `command` drops
// them. Whitespace and separators inside quotes stay inside one word, so a quoted message holds no
// verb; quotes still join pieces (`'git' push`, `pu""sh`). In single quotes `$` is literal too. A
// substitution or a backtick inside double quotes runs: its text is kept as it is and read as 0.5.0
// reads it.
const hide = (c: string, dollar: boolean) => (/[\s;&|()<>`]/.test(c) || (dollar && c === '$') ? String.fromCharCode(0xe000 + c.charCodeAt(0)) : c)
function maskQuoted(text: string): string {
  let out = ''
  let q: string | undefined
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (q === "'") { if (c === "'") { q = undefined; out += c } else out += hide(c, true); continue }
    if (c === '\\') { out += text.slice(i, i + 2); i++; continue }
    if (q === '"') {
      if (c === '$' && text[i + 1] === '(') { const e = closeOf(text, i + 1); const end = e < 0 ? text.length : e; out += text.slice(i, end); i = end - 1; continue }
      if (c === '`') { let e = i + 1; while (e < text.length && text[e] !== '`') e += text[e] === '\\' ? 2 : 1; out += text.slice(i, e + 1); i = e; continue }
      if (c === '"') { q = undefined; out += c } else out += hide(c, false)
      continue
    }
    if (c === "'" || c === '"') q = c
    out += c
  }
  return out
}
function ownWords(text: string): string[] { return command(maskQuoted(text)) }
// Simple commands: split at ; & | && || and newlines outside quotes and escapes. `&` and `|`
// next to a redirect (`2>&1`, `>&f`, `&>f`, `>|f`) belong to the command. A `#` that starts a
// word comments out the rest of its line, so a quote or a backslash in a comment opens nothing.
// `pipe` marks a command whose output goes on to the next one. A command substitution `$( … )`
// (also inside double quotes) stays in its command: `subs` holds each one's inner text and
// `bare` is the text with each replaced by `$S` (0.4.3 §3.1). An open quote, an unbalanced `$(`
// or an arithmetic `$((` returns undefined.
type Command = { text: string; bare: string; subs: string[]; end: number; pipe: boolean }
// The index just past the `)` that closes the `$(` whose `(` is at `open`, or -1.
function closeOf(text: string, open: number): number {
  let depth = 1
  let q: string | undefined
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i]!
    if (q === "'") { if (c === "'") q = undefined; continue }
    if (c === '\\') { i++; continue }
    if (q === '"') { if (c === '"') q = undefined; else if (c === '$' && text[i + 1] === '(') { const e = closeOf(text, i + 1); if (e < 0) return -1; i = e - 1 } continue }
    if (c === "'" || c === '"') { q = c; continue }
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i + 1
  }
  return -1
}
function commands(text: string): Command[] | undefined {
  const out: Command[] = []
  let from = 0
  // bare is built from the pieces between substitutions; mark is where the current piece starts.
  let mark = 0
  let bare = ''
  let subs: string[] = []
  let q: string | undefined
  const cut = (i: number, next: number, pipe: boolean) => {
    out.push({ text: text.slice(from, i), bare: bare + text.slice(mark, i), subs, end: i, pipe })
    from = next; mark = next; bare = ''; subs = []
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (q === "'") { if (c === "'") q = undefined; continue }
    if (c === '\\') { i++; continue }
    if (c === '$' && text[i + 1] === '(') {
      if (text[i + 2] === '(') return undefined
      const e = closeOf(text, i + 1)
      if (e < 0) return undefined
      // A case pattern's `)` or a comment's may close the substitution early: read none of it.
      if (/(?:^|[\s;&|(])(?:case[\s;]|#)/.test(text.slice(i + 2, e - 1))) return undefined
      bare += text.slice(mark, i) + '$S'
      subs.push(text.slice(i + 2, e - 1))
      mark = e
      i = e - 1
      continue
    }
    // 0.5.0 cause 5: a live backtick pair (also inside double quotes) is a substitution like `$( )`.
    // Single-quoted or escaped backticks never reach here. An unclosed one does not parse.
    if (c === '`') {
      let e = i + 1
      while (e < text.length && text[e] !== '`') e += text[e] === '\\' ? 2 : 1
      if (e >= text.length) return undefined
      const inner = text.slice(i + 1, e).replace(/\\([`$\\])/g, '$1')
      if (/(?:^|[\s;&|(])(?:case[\s;]|#)/.test(inner)) return undefined
      bare += text.slice(mark, i) + '$S'
      subs.push(inner)
      mark = e + 1
      i = e
      continue
    }
    if (q === '"') { if (c === '"') q = undefined; continue }
    if (c === "'" || c === '"') { q = c; continue }
    if (c === '#' && (i === 0 || /[\s;&|()]/.test(text[i - 1]!))) {
      const nl = text.indexOf('\n', i)
      i = (nl < 0 ? text.length : nl) - 1
      continue
    }
    if (c === '&' || c === '|') {
      const prev = text[i - 1]
      const next = text[i + 1]
      if (prev === '>' || prev === '<' || (c === '&' && next === '>')) continue
      if (next === c) { cut(i, i + 2, false); i++; continue }
      if (c === '|' && next === '&') { cut(i, i + 2, true); i++; continue }
      cut(i, i + 1, c === '|')
      continue
    }
    if (c === ';' || c === '\n') cut(i, i + 1, false)
  }
  if (q !== undefined) return undefined
  out.push({ text: text.slice(from), bare: bare + text.slice(mark), subs, end: text.length, pipe: false })
  return out
}
// Groups (0.4.3 §3.2): an opener ({, (, if, while, until, for, case, select) and its closer
// (}, ), fi, done, esac). A redirect or a pipe on the closer applies to every command in the
// group. `targets` and `pipe` per command carry what its enclosing groups add. An unmatched
// opener or closer returns undefined.
type Group = { targets: string[]; pipe: boolean }
const OPENER = new Set(['{', 'if', 'while', 'until', 'for', 'case', 'select'])
const CLOSER = new Set(['}', 'fi', 'done', 'esac'])
const unquoted = (t: string) => t.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, '')
function groups(cmds: readonly Command[]): Group[] | undefined {
  const add: Group[] = cmds.map(() => ({ targets: [], pipe: false }))
  const stack: { at: number; kind: string }[] = []
  for (let i = 0; i < cmds.length; i++) {
    const shape = unquoted(cmds[i]!.bare)
    const lead = shape.trim().split(/\s+/)
    let inCase = stack.some(s => s.kind === 'case')
    for (const w of lead) {
      if (OPENER.has(w)) { stack.push({ at: i, kind: w }); if (w === 'case') inCase = true; continue }
      if (CLOSER.has(w)) { const s = stack.pop(); if (s === undefined) return undefined; close(s.at, i); if (w === 'esac') inCase = stack.some(x => x.kind === 'case'); continue }
      if (w === 'then' || w === 'do' || w === 'else' || w === 'elif' || w === '!') continue
      break
    }
    if (!inCase) {
      for (const ch of shape) {
        if (ch === '(') stack.push({ at: i, kind: '(' })
        else if (ch === ')') { const s = stack.pop(); if (s === undefined || s.kind !== '(') return undefined; close(s.at, i) }
      }
    }
  }
  if (stack.length > 0) return undefined
  return add
  function close(from: number, to: number) {
    const c = cmds[to]!
    const t = targets(c.bare)
    const p = pipesOn(cmds, to)
    for (let k = from; k <= to; k++) { add[k]!.targets.push(...t); add[k]!.pipe ||= p }
  }
}
// Does the output of command i reach a command that is not inert, or a file? A pipeline of
// inert commands that only prints (`grep x f | cut -c1`) does neither; a stage that is not inert
// may run it (`… | at now`), and a stage that writes a file may save it (`… | cat > x.sh`).
function pipesOn(cmds: readonly Command[], i: number): boolean {
  for (let j = i; cmds[j]?.pipe; j++) {
    const next = cmds[j + 1]
    // A group on the right takes the input for all its commands: it counts (`… | { cat; } | make -f -`).
    if (next === undefined || !isInert(next.bare) || targets(next.bare).length > 0 || /^\s*(?:\(|\{\s|(?:if|while|until|for|case|select)\s)/.test(next.bare)) return true
  }
  return false
}
const base = (w: string) => w.replace(/^.*\//, '')
const clean = (w: string) => w.replace(/[\\'"]/g, '')
// The command word. Only a path in a system bin directory is read by its base name (/bin/echo
// is echo); any other path (./scripts/test, /repo/echo) is a program of its own, never inert.
const SYSTEM = /^\/(?:usr\/(?:local\/)?)?s?bin\/[^/]+$|^\/opt\/homebrew\/bin\/[^/]+$/
function head(words: readonly string[]): string | undefined {
  const w = words.find(x => !KEYWORD.has(x))
  return w === undefined ? undefined : SYSTEM.test(w) ? base(w) : w
}
// A function defined in the command may take an inert name: `echo() { … }`, also after a
// keyword (`then echo() …`). Any `()` makes the command non-inert.
const DEFINES = /\([ \t]*\)/
// `printf -v NAME` (or a cluster such as -vV) assigns a variable, so it is not inert. Read on
// `bare`, so a substitution's words never decide the outer command.
// A redirection and its target are not the command: `} > brief.md` has no command word.
const REDIRS = /\d*(?:&>>?|>>?|<)[|&]?[ \t]*[^\s;&|<>()]*/g
const command = (text: string) => split(text.replace(REDIRS, ' '))
function isInert(text: string): boolean {
  const ws = command(text)
  const h = head(ws)
  if (h === undefined) return true
  if (h === 'sed') return safeSed(text) && !DEFINES.test(text)
  return INERT.has(h) && !DEFINES.test(text) && !(h === 'printf' && ws.some(w => /^-[A-Za-z]*v/.test(w)))
}
// A command of assignments only runs nothing; a value is read where the variable is used (0.5.0).
const ASSIGNS = /^[ \t]*(?:[A-Za-z_]\w*=(?:'[^']*'|"(?:\\.|[^"\\])*"|[^\s'";&|<>()`])*[ \t]*)+$/
function assignOnly(text: string): boolean {
  return ASSIGNS.test(text) && targets(text).length === 0
}
// git runs or reads a file in .git/ (hooks, config) or a hooks directory, and its config files
// elsewhere (~/.gitconfig, ~/.config/git/, .gitattributes, .gitmodules, a .git file).
const hook = (w: string) =>
  /(?:^|\/)(?:\.git|hooks|\.githooks|\.husky|\.config\/git)\/|(?:^|\/)\.git$|gitconfig|\.gitattributes|\.gitmodules/.test(clean(w))
const REDIRECT = />>?[|&]?[ \t]*([^\s;&|<>()]+)/g
const targets = (text: string) => [...text.matchAll(REDIRECT)].map(m => m[1]!).filter(w => !/^(?:\d+|-)$/.test(w))
// Readers (0.4.3 §3.5): command prefixes that name a file but never run it. The operator's
// `readers` setting replaces the default.
export const DEFAULT_READERS: readonly (readonly string[])[] = [['gh', 'pr', 'create'], ['gh', 'pr', 'edit'], ['gh', 'issue', 'create'], ['gh', 'issue', 'comment']]
export const parseReaders = (s: string): string[][] => s.split(';').map(r => r.trim().split(/\s+/).filter(Boolean)).filter(r => r.length > 0)
type Readers = readonly (readonly string[])[]
// Namers (0.5.0): commands that name a file to read, remove or change its mode, and never run it. A file they
// name passes on as an inert command's would (a pipe or a redirect from them still counts).
const NAMER = new Set(['rm', 'unlink', 'chmod', 'chown', 'wc', 'diff', 'cmp', 'sha1sum', 'sha256sum', 'sha512sum', 'md5sum', 'b2sum', 'file', 'du', 'readlink', 'realpath', 'basename', 'dirname'])
const GIT_NAMER = new Set(['add', 'status', 'diff', 'check-ignore', 'commit', 'show', 'log', 'rm', 'mv', 'restore', 'ls-files', 'hash-object', 'blame', 'cat-file'])
const GH_NAMER = new Set(['pr create', 'pr edit', 'pr comment', 'pr review', 'pr view', 'issue create', 'issue edit', 'issue comment', 'issue view', 'release create', 'release edit', 'release upload', 'release view'])
function namer(ws: readonly string[]): boolean {
  const i = ws.findIndex(x => !KEYWORD.has(x))
  if (i < 0) return false
  const h = ws[i]!
  if (NAMER.has(h)) return true
  if (h === 'git') { let k = i + 1; while (ws[k] === '-C' || ws[k] === '-q') k += ws[k] === '-C' ? 2 : 1; return GIT_NAMER.has(ws[k] ?? '') && !ws.some(w => /^-c$|^--exec|^-x$/.test(w)) }
  if (h === 'gh') return ws[i + 1] === 'api' || GH_NAMER.has(`${ws[i + 1]} ${ws[i + 2]}`)
  return false
}
function isReader(ws: readonly string[], readers: Readers): boolean {
  const i = ws.findIndex(x => !KEYWORD.has(x))
  return i >= 0 && readers.some(r => r.every((w, k) => ws[i + k] === w))
}
// Every command a text runs, its substitutions' commands first. An unparsable substitution
// stands as one command holding its whole text.
// `pipe` in the result means the output reaches a command that is not inert (pipesOn).
function flat(cmds: readonly Command[]): Command[] {
  return cmds.flatMap((_, i) => flatOne(cmds, i))
}
function flatOne(cmds: readonly Command[], i: number): Command[] {
  const c = cmds[i]!
  return [
    ...c.subs.flatMap(s => { const inner = commands(s); return inner === undefined ? [{ text: s, bare: s, subs: [], end: c.end, pipe: false }] : flat(inner) }),
    { ...c, pipe: pipesOn(cmds, i) },
  ]
}
// Is a written file run (or read by a program that may run it) later? A file in .git/ or
// hooks/ is. So is one a later command that is not inert names, and every file when that
// command's own name is a variable or a glob (`./$T.sh`, `./x*`). A reader that names it does
// not run it. An inert command that names the file passes the name on to what it writes (mv,
// cp, a redirect), and a pipe from it counts as run. A name matches inside any word, whatever
// its case, so `./X.SH` names x.sh. A file name holding a variable the text assigns once is
// read with its value; one that stays opaque may be any file (.git/config included), so any
// later command that is not inert counts.
type Resolve = (f: string) => string
// `gitRuns`: the text writes git config (or sets GIT_CONFIG*), so any later git command may run a
// written file it never names — through an alias or core.hooksPath (PR #735 round 1).
type Ctx = { resolve: Resolve; readers: Readers; gitRuns: boolean }
const configWritten = (text: string, cmds: readonly Command[]) =>
  /GIT_CONFIG/.test(text) || flat(cmds).some(c => { const ws = split(c.bare); return (isGit(ws) && writesConfig(ws)) || ws.some(gitConfigFile) })
// A git config file a command names, as a redirect target among them (PR #735 round 2).
const gitConfigFile = (w: string) => /(?:^|\/)\.git\/config$|gitconfig|\.config\/git\/config$/.test(clean(w))
const opaqueName = (f: string) => /[$*?[`{]/.test(f)
// What usedLater reads of each later command, worked out once per command list, so a script of
// many redirects is not re-split for every target (final review I4). `from[i]` is where command
// i's entries start; the commands after i start at `from[i + 1]`. A command's words are joined
// by NUL, lowercased, so one `includes` per name reads them all (a name holds no NUL).
type Later = { all: string; rest: string; git: boolean; h: string | undefined; inert: boolean; namer: boolean; reader: boolean; pipe: boolean; hook: boolean; opaque: boolean; names: string[] }
function laters(cmds: readonly Command[], ctx: Ctx): { list: Later[]; from: number[] } {
  const list: Later[] = []
  const from: number[] = []
  cmds.forEach((_, i) => {
    from.push(list.length)
    for (const c of flatOne(cmds, i)) {
      // 0.5.0 fix: a later word holding a variable is read with its value, as the file names are.
      const ws = split(c.bare).map(w => (w.includes('$') ? ctx.resolve(w) : w))
      const h = head(command(c.bare))
      const to = targets(c.bare)
      // mv and cp write to their last word, or to the directory -t / --target-directory names (PR #735).
      if ((h === 'mv' || h === 'cp') && ws.length > 1) {
        const t = ws.findIndex(w => w === '-t' || w === '--target-directory')
        const long = ws.find(w => w.startsWith('--target-directory='))
        to.push(t > 0 && ws[t + 1] !== undefined ? ws[t + 1]! : long !== undefined ? long.slice(19) : ws[ws.length - 1]!)
      }
      const next = to.map(ctx.resolve)
      const low = ws.map(w => w.toLowerCase())
      list.push({ all: low.join('\0'), rest: low.slice(1).join('\0'), git: isGit(ws), h, inert: isInert(c.bare), namer: namer(ws), reader: isReader(ws, ctx.readers), pipe: c.pipe,
        hook: next.some(hook), opaque: next.some(opaqueName), names: next.map(t => base(clean(t)).toLowerCase()).filter(n => n !== '') })
    }
  })
  from.push(list.length)
  return { list, from }
}
function usedLater(raw: readonly string[], later: readonly Later[], ctx: Ctx, start = 0): boolean {
  const files = raw.map(ctx.resolve)
  const runsAny = () => { for (let k = start; k < later.length; k++) if (!later[k]!.inert) return true; return false }
  if (files.some(hook)) return true
  if (files.some(opaqueName)) return runsAny()
  const names = new Set(files.map(f => base(clean(f)).toLowerCase()).filter(n => n !== ''))
  const named = (s: string) => { for (const n of names) if (s.includes(n)) return true; return false }
  for (let k = start; k < later.length; k++) {
    const c = later[k]!
    if (c.h === undefined) continue
    if (ctx.gitRuns && c.git) return true
    if (!c.inert && !c.namer) {
      if (c.reader) continue
      if (named(c.all) || /[$*?[]/.test(c.h)) return true
      continue
    }
    if (!named(c.rest)) continue
    if (c.pipe) return true
    if (c.hook) return true
    if (c.opaque) return runsAny()
    for (const n of c.names) names.add(n)
  }
  return false
}
// Assignments that are a whole command (`T=/s/r.md.tmp`). A name assigned twice stays opaque.
const ASSIGN = /^[ \t]*([A-Za-z_]\w*)=("[^"$`]*"|'[^']*'|[^\s;&|<>"'$`]*)[ \t]*$/
// After a directory change a relative name is read inside the new directory: `cd .git` makes
// `config` .git/config. A cd or pushd to a variable, `cd -` and popd leave the directory
// unknown, so a relative name is opaque. With several literal targets, a name that reaches git
// control files from any of them counts as that path (0.4.3).
function resolver(parts: readonly Command[]): Resolve {
  const vars = new Map<string, string | undefined>()
  for (const c of parts) {
    const m = ASSIGN.exec(c.text)
    if (m) { vars.set(m[1]!, vars.has(m[1]!) ? undefined : clean(m[2]!)); continue }
    // 0.5.0: a temp file from mktemp is a fresh name, never a git control file; a value built from
    // names already read is read too. Any other assignment makes the name opaque.
    const a = /^[ \t]*([A-Za-z_]\w*)=/.exec(c.text)
    if (!a) continue
    const name = a[1]!
    let v: string | undefined
    if (/^[ \t]*[A-Za-z_]\w*=("?)\$\((?:\/(?:usr\/)?bin\/)?mktemp(?:[ \t]+[^\s)`$;&|<>'"]+)*\)\1[ \t]*$/.test(c.text)) v = `/tmp/.mktemp-${name}`
    else {
      const ch = /^[ \t]*[A-Za-z_]\w*=("[^"`]*"|[^\s;&|<>"'`]*)[ \t]*$/.exec(c.text)
      // `${NAME:-…}`, `${NAME#…}` and the like are not `$NAME`: the value stays opaque.
      if (ch && !/\$\(/.test(ch[1]!) && !/\$\{\w*[^}\w]/.test(ch[1]!)) {
        let ok = true
        v = clean(ch[1]!).replace(/\$\{?([A-Za-z_]\w*)\}?/g, (_x, n: string) => { const r = vars.get(n); if (r === undefined) ok = false; return r ?? '' })
        if (!ok) v = undefined
      }
    }
    vars.set(name, vars.has(name) ? undefined : v)
  }
  const dirs: string[] = []
  let unknown = false
  for (const c of parts) {
    const ws = split(c.bare)
    const i = ws.findIndex(x => !KEYWORD.has(x))
    const h = i < 0 ? undefined : ws[i]
    // A link made in the text may make a literal directory another one (`ln -s .git d; cd d`).
    if (h === 'popd' || h === 'ln') unknown = true
    if (h !== 'cd' && h !== 'pushd') continue
    const t = ws.slice(i + 1).find(w => !/^-[LPe@]+$/.test(w))
    if (t === undefined) dirs.push('~')
    else if (t === '-' || opaqueName(t)) unknown = true
    else dirs.push(t.replace(/\/+$/, ''))
  }
  return f => {
    // An expansion with an operator (`${OUT:-.}`) may be any name: keep it opaque (PR #735).
    if (/\$\{\w*[^}\w]/.test(clean(f))) return clean(f)
    const r = clean(f).replace(/\$\{?([A-Za-z_]\w*)\}?/g, (v, n: string) => vars.get(n) ?? v)
    if (/^[/~]/.test(r) || (dirs.length === 0 && !unknown)) return r
    if (unknown) return `$${r}`
    return dirs.map(d => `${d}/${r}`).find(hook) ?? `${dirs[0]}/${r}`
  }
}
// sed runs shell code through its `e` command and `s///e` flag.
// sed's arguments as the shell passes them: a quoted script stays one word (`'1p;e cmd'`), and
// adjacent quoted and bare pieces join into one (`'s/x/y/'e` is `s/x/y/e`; PR #735 round 1).
// 0.5.1 (§2): quotes are removed as the shell removes them. Inside single quotes a backslash is
// literal (`'s/a\/b/c/'` keeps its `\/`); in double quotes it escapes only $ ` " \ and a newline.
function unquote(w: string): string {
  let out = ''
  let q: string | undefined
  for (let i = 0; i < w.length; i++) {
    const c = w[i]!
    if (q === "'") { if (c === "'") q = undefined; else out += c; continue }
    if (c === '\\') {
      const n = w[i + 1]
      if (n === undefined) break
      if (q === '"' && !'$`"\\\n'.includes(n)) out += c
      out += n
      i++
      continue
    }
    if (q === '"') { if (c === '"') q = undefined; else out += c; continue }
    if (c === "'" || c === '"') { q = c; continue }
    out += c
  }
  return out
}
const argv = (text: string) => (text.match(/(?:'[^']*'|"(?:\\.|[^"\\])*"|[^\s'"]+)+/g) ?? []).map(unquote)
// 0.5.0 shape B: a wider safe sed. Options from -n -E -r -s -z -u, -e SCRIPT and -i (with a
// suffix); each script a `;`/newline list of `s<d>re<d>repl<d>[gpiImM0-9]*` or an address plus
// p, d, q or =. No e, w, W, r, R command or flag; no -i target that is a git control path.
function safeScript(s: string): boolean {
  let p = 0
  const n = s.length
  const ws = () => { while (p < n && /[\s;]/.test(s[p]!)) p++ }
  const addr1 = (): boolean => {
    if (s[p] === '$') { p++; return true }
    if (/\d/.test(s[p] ?? '')) { while (/\d/.test(s[p] ?? '')) p++; return true }
    if (s[p] === '/') {
      p++
      while (p < n && s[p] !== '/') { if (s[p] === '\\') p++; if (s[p] === '\n') return false; p++ }
      if (p >= n) return false
      p++
      if (s[p] === 'I') p++
      return true
    }
    return true // no address
  }
  ws()
  if (p >= n) return false
  while (p < n) {
    if (!addr1()) return false
    if (s[p] === ',') { p++; if (s[p] === '+' || s[p] === '~') p++; const at = p; if (!addr1() || p === at) return false }
    if (s[p] === '!') p++
    const c = s[p]
    if (c === undefined) return false
    if ('pdq='.includes(c)) { p++; if (c === 'q') while (/\d/.test(s[p] ?? '')) p++ }
    else if (c === 's') {
      const d = s[p + 1]
      if (d === undefined || /[\s\\\n]/.test(d)) return false
      p += 2
      for (let part = 0; part < 2; part++) {
        while (p < n && s[p] !== d) { if (s[p] === '\\') p++; p++ }
        if (p >= n) return false
        p++
      }
      while (p < n && /[gpiImM0-9]/.test(s[p]!)) p++
    } else return false
    while (p < n && /[ \t]/.test(s[p]!)) p++
    if (p < n && !/[;\n]/.test(s[p]!)) return false
    ws()
  }
  return true
}
function safeSed(text: string): boolean {
  const ws = argv(text.replace(REDIRS, ' '))
  const i = ws.findIndex(x => !KEYWORD.has(x))
  const rest = ws.slice(i + 1)
  const scripts: string[] = []
  const files: string[] = []
  let inplace = false
  let fromE = false
  for (let k = 0; k < rest.length; k++) {
    const w = rest[k]!
    if (w === '-e' || w === '--expression') { const s = rest[++k]; if (s === undefined) return false; scripts.push(s); fromE = true; continue }
    if (w.startsWith('--expression=')) { scripts.push(w.slice(13)); fromE = true; continue }
    if (/^-[nErsuz]*i/.test(w) || /^--in-place(?:=|$)/.test(w)) { inplace = true; if (w === '-i' && rest[k + 1] === '') k++; continue }
    if (/^-[nErsuz]+$|^--(?:quiet|silent|regexp-extended|separate|unbuffered|null-data|posix|debug|sandbox)$/.test(w)) continue
    if (w.startsWith('-')) return false
    if (!fromE && scripts.length === 0) scripts.push(w)
    else files.push(w)
  }
  if (scripts.length === 0 || !scripts.every(safeScript)) return false
  return !inplace || !files.some(hook)
}
// The files a sed -i edits: like a redirect target, a file a later command runs keeps the words.
function sedTargets(text: string): string[] {
  const ws = argv(text.replace(REDIRS, ' '))
  const i = ws.findIndex(x => !KEYWORD.has(x))
  if (i < 0 || base(ws[i]!) !== 'sed') return []
  const rest = ws.slice(i + 1)
  if (!rest.some(w => /^-[nErsuz]*i/.test(w) || /^--in-place(?:=|$)/.test(w))) return []
  return rest.filter(w => !w.startsWith('-') && w !== '').slice(rest.some(w => w === '-e' || w.startsWith('--expression')) ? 0 : 1)
}
// Does the text name a program that may run text? Per command where it parses, so a narrow sed
// at a command's head is not one; anywhere else the word alone counts.
function runs(text: string, cmds: readonly Command[] | undefined): boolean {
  if (cmds === undefined ? DOT_SOURCE.test(text) : flat(cmds).some(c => head(split(c.bare)) === '.')) return true
  if (cmds === undefined) return split(text).some(w => RUNNER.test(base(w)))
  return flat(cmds).some(c => {
    const ws = split(c.bare)
    const h = head(ws)
    const hi = ws.findIndex(x => !KEYWORD.has(x))
    // 0.5.0 cause 1: an argument of cd, pushd or an inert command, or git -C's value, runs nothing.
    const argOnly = h === 'cd' || h === 'pushd' || isInert(c.bare)
    return ws.some((w, k) => RUNNER.test(base(w)) && !(k === hi && base(w) === 'sed' && safeSed(c.bare)) &&
      !(k !== hi && argOnly) && !(k !== hi && w.includes('/') && h === 'git' && ws[k - 1] === '-C'))
  })
}
// An unquoted heredoc body is literal when it holds no substitution or expansion that runs code
// (`$(`, a backtick, `$((`, `$[`, `${…@…}`); a plain `$VAR` only expands (0.4.3 §3.3). A
// backtick after an even run of backslashes is live (`\\` is one literal backslash), and so is
// a line continuation.
const LIVE_BODY = /\$\(|(?<!\\)(?:\\\\)*`|\$\[|\$\{[^}]*@|\\\n/
const WRITE_ANY = /(?<=^|[\n;&|({)])[ \t]*cat[ \t]+(?:>>?[ \t]*([^\s;&|<>]+)[ \t]+)?<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\2(?:[ \t]*>>?[ \t]*([^\s;&|<>]+))?[ \t]*\n([\s\S]*?)\n[ \t]*\3[ \t]*(?=\n|$)/g
// Whether `at` sits inside a `$(` or a backtick not closed before it. A substitution that
// does not close counts as open.
function insideSub(text: string, at: number): boolean {
  let q: string | undefined
  for (let i = 0; i < at; i++) {
    const c = text[i]!
    if (q === "'") { if (c === "'") q = undefined; continue }
    if (c === '\\') { i++; continue }
    if (c === '$' && text[i + 1] === '(') {
      const e = closeOf(text, i + 1)
      if (e < 0 || e > at) return true
      i = e - 1
      continue
    }
    if (c === '`') {
      let e = i + 1
      while (e < text.length && text[e] !== '`') e += text[e] === '\\' ? 2 : 1
      if (e >= at) return true
      i = e
      continue
    }
    if (q === '"') { if (c === '"') q = undefined; continue }
    if (c === "'" || c === '"') q = c
  }
  return false
}
// 0.5.0 shape C: a Python heredoc (`python3 - <<'X'`, `python3 <<'X'`, quoted delimiter) whose
// body names nothing that starts a process and no git control path drops its body. A file the
// body names that a later command runs keeps it, as for a cat write.
// The deny words match as identifiers (`filesystem`, `evaluation` are prose).
const PY_DENY = /(?<![A-Za-z0-9])(?:subprocess|system|popen|exec(?:v|ve|vp|vpe|l|le|lp|lpe)?|spawn\w*|fork\w*|pty|eval|compile|__import__|importlib|getattr|ctypes|multiprocessing)(?![A-Za-z0-9])/
const PYDOC = String.raw`(?<=^|[\n;&|({)])[ \t]*(?:\S*\/)?(?:python[\d.]*|pypy[\d.]*)((?:[ \t]+-[uBIEsS]+)*)((?:[ \t]+-(?:[ \t]+[^\s<;&|>]+)*)?)[ \t]*<<-?[ \t]*(['"])([A-Za-z_]\w*)\8([^\n]*)\n([\s\S]*?)\n[ \t]*\9[ \t]*(?=\n|$)`
// 0.5.0: a heredoc read by a command that only takes it as a message (git commit/tag/notes/merge
// -F -, gh pr|issue|release … --body-file -/-F -/--notes-file -) or by tee (a write).
const MSGDOC = String.raw`(?<=^|[\n;&|({)])([ \t]*(?:git(?:[ \t]+-[Cc][ \t]+\S+|[ \t]+--?[\w-]+(?:=\S+)?)*[ \t]+(?:commit|tag|notes[ \t]+\w+|merge|commit-tree)[^\n<;&|]*?[ \t](?:-F|--file)(?:[ \t]+|=)-|gh[ \t]+(?:pr|issue|release)[ \t]+[\w-]+[^\n<;&|]*?[ \t](?:--body-file|-F|--notes-file)(?:[ \t]+|=)-|tee((?:[ \t]+[^\s<;&|>]+)*)))[ \t]+<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\14([^\n]*)\n([\s\S]*?)\n[ \t]*\15[ \t]*(?=\n|$)`
const WRITES = new RegExp(`${WRITE_ANY.source}|${PYDOC}|${MSGDOC}`, 'g')
// 0.5.0: the substitutions an unquoted body runs, or undefined when it may run more (arithmetic,
// a parameter transform) or does not parse. Quotes in a body are text.
function liveSubs(body: string): string[] | undefined {
  const b = body.replace(/\\\n/g, '')
  if (/\$\(\(|\$\[|\$\{[^}]*@/.test(b)) return undefined
  const out: string[] = []
  for (let i = 0; i < b.length; i++) {
    const c = b[i]!
    if (c === '\\') { i++; continue }
    if (c === '$' && b[i + 1] === '(') { const e = closeOf(b, i + 1); if (e < 0) return undefined; out.push(b.slice(i + 2, e - 1)); i = e - 1; continue }
    if (c === '`') { let e = i + 1; while (e < b.length && b[e] !== '`') e += b[e] === '\\' ? 2 : 1; if (e >= b.length) return undefined; out.push(b.slice(i + 1, e).replace(/\\([`$\\])/g, '$1')); i = e; continue }
  }
  return out
}
const literalsIn = (body: string) => [...body.matchAll(/'([^'\n]{1,200})'|"([^"\n]{1,200})"/g)]
  .map(m => m[1] ?? m[2]!).filter(s => /[./]/.test(s) && !/\s/.test(s))
  // The first argument of open( or Path( is a file name whatever its shape (`open('run','w')`; PR #735 round 2).
  .concat([...body.matchAll(/(?:open|Path)\(\s*['"]([^'"\s]{1,200})['"]/g)].map(m => m[1]!))
// 0.5.0 shape A: `sh -c 'literal'` (bash, zsh, dash; -e -u -x -o pipefail) is read as a subshell
// holding the string. The string holds no `$`, backtick or backslash when double-quoted, and
// none of `$` or backtick when single-quoted, so trailing arguments are never read.
const SHELL_C = /^(\s*(?:(?:then|do|else|!|\{)\s+)*)(?:\/(?:usr\/)?bin\/)?(?:sh|bash|zsh|dash)(?:\s+(?:-[eux]+|-o\s+pipefail))*\s+-[eux]*c[eux]*(?:\s+-o\s+pipefail|\s+-[eux]+)*\s+(?:'([^'$`]*)'|"([^"$`\\]*)")(?:\s+[^\s'"$`;&|<>()]+)*(\s*(?:\d*(?:&>>?|>>?|<)[|&]?\s*[^\s;&|<>()'"$`]+\s*)*)$/
function splice(text: string): string {
  for (let round = 0; round < 4; round++) {
    const cmds = commands(text)
    if (cmds === undefined) return text
    let out = text
    let changed = false
    for (const c of [...cmds].reverse()) {
      if (c.subs.length > 0) continue
      const m = SHELL_C.exec(c.text)
      if (!m) continue
      const start = c.end - c.text.length
      out = `${out.slice(0, start)}${m[1]}(\n${m[2] ?? m[3]!}\n)${m[4]}${out.slice(c.end)}`
      changed = true
    }
    if (!changed) return text
    text = out
  }
  return text
}
type Vars = Map<string, { value: string; at: number }>
type Judged = { words: string[]; own: string[]; text: string; at: number }
type Reading = { whole: string[] } | { groups: Judged[]; vars: Vars; bag: string[]; values: string[]; loops: [number, number][] }
// namesDanger and neverRules read the same command back to back (register.tsx): keep the last
// reading, keyed by the text and the readers, so a large script is read once, not twice.
let last: { command: string; readers: string; r: Reading } | undefined
function wordsOf(command: string, readers: Readers): Reading {
  const key = JSON.stringify(readers)
  if (last !== undefined && last.command === command && last.readers === key) return last.r
  const r = reading(command, readers)
  last = { command, readers: key, r }
  return r
}
function reading(command: string, readers: Readers): Reading {
  const message = command.replace(MESSAGE, '-m MSG')
  // Drop every body; if a later command may run any written file, keep them all (a kept body
  // may run another written file). A body with no file prints to standard output (§3.3).
  const writes: { end: number; files: string[] }[] = []
  let shift = 0
  const stubbed = message.replace(WRITES, (m: string, ...g: any[]) => {
    const [before, quote, , after, body, , , , , rest, pbody, consumer, teeFiles, mquote, , mrest, mbody] = g as (string | undefined)[]
    const at = g[g.length - 2] as number
    // Inside a substitution the output is captured and may be run: keep it (§3.3).
    if (insideSub(message, at)) return m
    let stub: string
    let files: string[]
    let extra = ''
    if (pbody !== undefined) {
      if (PY_DENY.test(pbody) || pbody.split(/[\s'"(),[\]]+/).some(hook)) return m
      stub = `${/^[ \t]*/.exec(m)![0]}true${rest ?? ''}`
      files = /\.write\(|write_text|write_bytes|open\([^)]*['"][wax]|\.open\(['"][wax]|os\.(?:rename|replace)|shutil\./.test(pbody) ? literalsIn(pbody) : []
    } else if (mbody !== undefined) {
      if (mquote === '' && LIVE_BODY.test(mbody)) { const s = liveSubs(mbody); if (s === undefined) return m; if (s.length) extra = `\ntrue ${s.map(x => `"$(${x})"`).join(' ')}` }
      stub = `${consumer}${mrest ?? ''}`
      files = teeFiles === undefined ? [] : teeFiles.trim().split(/[ \t]+/).filter(w => w !== '' && !w.startsWith('-'))
    } else {
      if (quote === '' && LIVE_BODY.test(body!)) {
        const s = liveSubs(body!)
        if (s === undefined) return m
        if (s.length) extra = `\ntrue ${s.map(x => `"$(${x})"`).join(' ')}`
      }
      stub = m.slice(0, m.indexOf('\n')).replace(/<<-?[ \t]*['"]?\w+['"]?/, '')
      files = [before ?? after].filter((x): x is string => x !== undefined)
    }
    writes.push({ end: at - shift + stub.length, files })
    shift += m.length - stub.length - extra.length
    return stub + extra
  })
  const parts = commands(stubbed)
  const pg = parts === undefined ? undefined : groups(parts)
  const ctx0: Ctx = { resolve: resolver(parts ?? []), readers, gitRuns: configWritten(stubbed, parts ?? []) }
  let pl: ReturnType<typeof laters> | undefined
  const kept = parts === undefined || pg === undefined || writes.some(w => {
    const i = parts.findIndex(c => c.end >= w.end)
    // The stub keeps its own redirect: a Python or tee heredoc's stdout (`> run.sh`) is a write too.
    const t = [...w.files, ...pg[i]!.targets, ...targets(parts[i]!.bare)]
    pl ??= laters(parts, ctx0)
    return pipesOn(parts, i) || pg[i]!.pipe || (t.length > 0 && usedLater(t, pl.list, ctx0, pl.from[i + 1]))
  })
  const text = splice(kept ? message : stubbed)
  const parsed = commands(text)
  // Runners are looked for outside the dropped bodies: a message that says "bash" runs nothing.
  if (runs(text, parsed)) return { whole: split(command) }
  // A process substitution, a kept heredoc, or a function or alias defined in the text (it may
  // shadow an inert name: `echo() { "$@"; }`) keeps the whole bag; so does text whose commands
  // or groups do not parse. A backtick no longer does (0.5.0 cause 5).
  // The keywords are read with quotes and backslashes dropped, as Bash reads them (`a""lias`).
  // A name defined in the text (a command `alias` or `function`, or `()` outside quotes) may shadow
  // any trusted command, a message consumer or tee included, so the whole bag then holds the
  // dropped bodies too (PR #735 round 2). A `()` or the word in quoted prose only keeps the bag.
  if (parsed !== undefined && (/\([ \t]*\)/.test(unquoted(text)) || parsed.some(c => { const h = head(split(c.bare)); return h === 'alias' || h === 'function' })))
    return { whole: split(command) }
  const cmds = /<<|[<>]\(|\([ \t]*\)/.test(text) || /(?:^|[\s;&|(])(?:function|alias)[ \t]/.test(text.replace(/[\\'"]/g, '')) ? undefined : parsed
  const g = cmds === undefined ? undefined : groups(cmds)
  if (cmds === undefined || g === undefined) return { whole: split(text) }
  const ctx: Ctx = { resolve: resolver(cmds), readers, gitRuns: configWritten(text, cmds) }
  return { groups: judge(cmds, g, ctx), vars: literalVars(command, text, cmds), bag: split(text), values: flat(cmds).filter(c => assignOnly(c.bare)).flatMap(c => split(c.text)), loops: loops(cmds) }
}
// The words of parsed commands, one group per command: a command that is not inert keeps all its
// words, its substitutions' included; an inert one keeps them only when its output may be run (a
// pipe, or a target used later), and otherwise gives only its substitutions' commands, judged the
// same way. `at` is the top-level command a group belongs to.
function judge(cmds: readonly Command[], g: readonly Group[], ctx: Ctx, at?: number): Judged[] {
  let lt: ReturnType<typeof laters> | undefined
  return cmds.flatMap((c, i): Judged[] => {
    const k = at ?? i
    if ((!isInert(c.bare) && !assignOnly(c.bare)) || pipesOn(cmds, i) || g[i]!.pipe) {
      // A command that reads a pipe may run what it reads with its own words (`… | make -f - F=-f`):
      // it is judged with the pipeline's earlier stages (PR #735 round 2).
      let s = i
      while (s > 0 && cmds[s - 1]!.pipe) s--
      const span = !isInert(c.bare) && s < i ? cmds.slice(s, i + 1) : [c]
      return [{ words: span.flatMap(x => split(x.text)), own: span.flatMap(x => ownWords(x.text)), text: c.text.trim(), at: k }]
    }
    const to = [...targets(c.bare), ...g[i]!.targets, ...sedTargets(c.bare)]
    lt ??= to.length > 0 ? laters(cmds, ctx) : undefined
    if (to.length > 0 && usedLater(to, lt!.list, ctx, lt!.from[i + 1])) return [{ words: split(c.text), own: ownWords(c.text), text: c.text.trim(), at: k }]
    return c.subs.flatMap(s => {
      const inner = commands(s)
      const ig = inner === undefined ? undefined : groups(inner)
      // 0.5.1 (§1): a substitution that does not parse is text: it has no own words.
      return inner === undefined || ig === undefined ? [{ words: split(s), own: [], text: s.trim(), at: k }] : judge(inner, ig, ctx, k)
    })
  })
}
// The top-level command spans of each for, while, until or select loop, opener to `done`: a
// command late in the body runs before the early ones on the next pass (final review I2).
function loops(cmds: readonly Command[]): [number, number][] {
  const out: [number, number][] = []
  const stack: { at: number; kind: string }[] = []
  cmds.forEach((c, i) => {
    for (const w of unquoted(c.bare).trim().split(/\s+/)) {
      if (OPENER.has(w)) { stack.push({ at: i, kind: w }); continue }
      if (CLOSER.has(w)) { const s = stack.pop(); if (s !== undefined && /^(?:for|while|until|select)$/.test(s.kind)) out.push([s.at, i]); continue }
      if (w === 'then' || w === 'do' || w === 'else' || w === 'elif' || w === '!') continue
      break
    }
  })
  return out
}
// Inside a group at command i: an opener before it not yet closed, or a paren in it.
function depths(cmds: readonly Command[]): boolean[] {
  let d = 0
  return cmds.map(c => {
    const shape = unquoted(c.bare)
    for (const w of shape.trim().split(/\s+/)) {
      if (OPENER.has(w)) { d++; continue }
      if (CLOSER.has(w)) { d = Math.max(0, d - 1); continue }
      if (w === 'then' || w === 'do' || w === 'else' || w === 'elif' || w === '!') continue
      break
    }
    const inside = d > 0 || /[()]/.test(shape)
    d = Math.max(0, d + (shape.match(/\(/g) ?? []).length - (shape.match(/\)/g) ?? []).length)
    return inside
  })
}
// Section 1 variables: a name assigned exactly once, to a literal, as a whole top-level command
// that starts the text or follows `;` or a newline (never a pipe, `&&`, `||` or a group), and
// named nowhere else in the text except as `$N` or `${N}`. Its value holds after that command.
// `printf -v`, `read` or a nameref whose target is itself a variable may assign any name: read none.
const DYNAMIC = /(?:printf[ \t]+(?:-[A-Za-z]+[ \t]+)*-[A-Za-z]*v[ \t]*|read[ \t]+(?:-[A-Za-z]+[ \t]+(?:\S+[ \t]+)?)*|(?:declare|local|typeset)[ \t]+-[A-Za-z]*n[A-Za-z]*[ \t]+)["']?\$/
function literalVars(command: string, text: string, cmds: readonly Command[]): Vars {
  if (DYNAMIC.test(command)) return new Map()
  const sure = unconditional(text, cmds)
  const seen = new Map<string, { value: string; at: number; ok: boolean; n: number }>()
  cmds.forEach((c, i) => {
    const m = ASSIGN.exec(c.text)
    if (!m) return
    const ok = sure[i]!
    const s = seen.get(m[1]!)
    seen.set(m[1]!, { value: clean(m[2]!), at: i, ok: ok && s === undefined, n: (s?.n ?? 0) + 1 })
  })
  const out: Vars = new Map()
  for (const [name, v] of seen) {
    if (!v.ok || v.n !== 1) continue
    let bindings = 0
    for (const m of command.matchAll(new RegExp(`(?<![\\w])${name}(?![\\w])`, 'g'))) {
      const at = m.index!
      const use = command[at - 1] === '$' || (command[at - 1] === '{' && command[at - 2] === '$' && command[at + name.length] === '}')
      if (!use) bindings++
    }
    if (bindings === 1) out.set(name, { value: v.value, at: v.at })
  }
  return out
}

// A verb is the word itself, a path ending in it (/bin/rm), git's dashed executable (git-push),
// or a dashed path (./force-push, /usr/lib/git-core/git-push). Bare prose such as no-rm or
// force-push is not a verb (#693).
const isVerb = (w: string, verb: string) => !w.startsWith('-') &&
  (w === verb || w === `git-${verb}` || w.endsWith(`/${verb}`) || (w.includes('/') && w.endsWith(`-${verb}`)))
const PUSH = ['push', 'send-pack', 'http-push']
const isPush = (w: string) => PUSH.some(v => isVerb(w, v)) || w.includes('.push=')

// The letters of a short-flag cluster: -uf, -4f, -nF/tmp/m (letters up to the value).
const letters = (w: string): string => (/^-[A-Za-z0-9]/.test(w) ? /^-([A-Za-z0-9]+)/.exec(w)![1]! : '')
// git and GNU accept a unique prefix of a long option. min is the shortest prefix read: 3
// (`--r`, `--de`, `--mi`) reads every prefix the tools accept, and an ambiguous one the
// tools refuse is only an extra ask; --no-verify keeps 6 (`--no-` would match --no-edit).
const abbrev = (w: string, long: string, min: number) => { const n = w.split('=')[0]!; return n.length >= min && long.startsWith(n) }
// A flag word with a glob, a brace or a variable may be any flag (`--forc*`, `-$X`). For push
// and rm a bare variable may be one too (`git push $OPTS`); for branch and commit it is a
// Known limit, since a variable beside them is mostly a message or a path.
const flagLike = (w: string) => w.startsWith('-') && /[$*?[{]/.test(w)
const anyFlag = (w: string) => w.startsWith('$') || flagLike(w)
const opaque = (w: string) => /[$*?[{]/.test(w)

// cd, pushd, popd and git -C move to another directory unless the target is the session's
// own directory or the repo root. --git-dir, --work-tree and their variables always move.
function moves(words: readonly string[], where: Where): boolean {
  const same = (t: string | undefined) => {
    if (t === undefined) return false
    const p = t.replace(/(.)\/+$/, '$1')
    return p === '.' || p === where.cwd.replace(/(.)\/+$/, '$1') || p === where.root.replace(/(.)\/+$/, '$1')
  }
  return words.some((w, i) => ((w === 'cd' || w === 'pushd' || w === '-C') && !same(words[i + 1])) || w === 'popd' ||
    /^--(?:git-dir|work-tree)/.test(w) || /^GIT_(?:DIR|WORK_TREE)=/.test(w))
}

// Every word a rule may read: the whole bag, or each command's words with its variables read, and
// the values of assignment-only commands (an opaque verb reads them).
const allWords = (r: Reading) => ('whole' in r ? r.whole : [...r.groups.flatMap(g => [...g.words, ...substitute(g.words, r.vars, g.at)]), ...r.values])
const dangerWord = (w: string) => isPush(w) || isVerb(w, 'branch') || isVerb(w, 'commit') || isVerb(w, 'rm') || abbrev(w, '--no-verify', 6)
// The cheap pre-check: every rule needs one of these words, so a command without one runs no git.
export const namesDanger = (command: string, readers: Readers = DEFAULT_READERS): boolean =>
  allWords(wordsOf(command, readers)).some(dangerWord)

// Section 1: a group's words with each literal variable assigned before it read as its value.
function substitute(words: readonly string[], vars: Vars, at: number): string[] {
  return words.flatMap(w => {
    const r = w.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (v, a?: string, b?: string) => {
      const x = vars.get((a ?? b)!)
      return x !== undefined && x.at < at ? x.value : v
    })
    return r === w ? [w] : r.split(/\s+/).filter(x => x !== '')
  })
}
// A command whose verb is a variable or a glob may be any command (`$CMD x`, `git $V -f`,
// `sudo $C`): the floor reads it on the whole bag.
const WRAPS = new Set(['env', 'sudo', 'doas', 'nice', 'nohup', 'timeout', 'time', 'command', 'exec', 'builtin', 'stdbuf', 'ionice', 'chrt', 'taskset', 'setsid'])
function verbOpaque(ws: readonly string[]): boolean {
  let i = ws.findIndex(w => !KEYWORD.has(w) && !/^[A-Za-z_]\w*=/.test(w))
  while (i >= 0 && i < ws.length) {
    const w = ws[i]!
    if (opaque(w)) return true
    const b = base(w)
    if (WRAPS.has(b)) { i++; while (i < ws.length && (ws[i]!.startsWith('-') || /^[A-Za-z_]\w*=/.test(ws[i]!) || /^\d+[smhd]?$/.test(ws[i]!))) i++; continue }
    if (b === 'git') {
      i++
      while (i < ws.length && ws[i]!.startsWith('-')) { if (/^-[Cc]$|^--(?:git-dir|work-tree|namespace|exec-path|config-env)$/.test(ws[i]!)) i++; i++ }
      return i < ws.length && opaque(ws[i]!)
    }
    return false
  }
  return false
}
const isGit = (ws: readonly string[]) => ws.some(w => isVerb(w, 'git') || /^git-/.test(base(w)))
const READ_CONFIG = /^(?:--(?:get|get-all|get-regexp|get-urlmatch|get-color|get-colorbool|list|show-origin|show-scope|name-only|null|includes|type=\w+|global|local|system|worktree)|-[lz]+)$/
// Section 1: any git config that is not a plain read (one key, or a --get/--list form) is a write.
function writesConfig(ws: readonly string[]): boolean {
  const at = ws.findIndex(w => isVerb(w, 'config'))
  if (at < 0) return false
  const rest = ws.slice(at + 1)
  const flags = rest.filter(w => w.startsWith('-'))
  const args = rest.filter(w => !w.startsWith('-'))
  const read = flags.every(f => READ_CONFIG.test(f)) && (args.length <= 1 || ['get', 'list'].includes(args[0]!) || flags.some(f => /^--get/.test(f)))
  return !read
}

// 0.5.1 (§1): each finding has a level. `ask`: a parsed command's own words match, and the operator
// decides. `fork`: the match is only in text (the whole bag, words inside a quoted argument, or a
// command read over all words), and the fork judges with the finding in its prompt.
export type Finding = { rule: NeverRule; level: 'ask' | 'fork'; focus: string }
export type Floor = { findings: Finding[] }

export function neverRules(command: string, where: Where, readers: Readers = DEFAULT_READERS): NeverRule[] {
  return [...new Set(floorFindings(command, where, readers).findings.map(f => f.rule))]
}

export function floorFindings(command: string, where: Where, readers: Readers = DEFAULT_READERS): Floor {
  const r = wordsOf(command, readers)
  const out: Finding[] = []
  const add = (found: ReadonlySet<NeverRule>, level: Finding['level'], focus: string) => { for (const rule of found) out.push({ rule, level, focus }) }
  if ('whole' in r) {
    const found = new Set<NeverRule>()
    rulesOf(r.whole, where, moves(r.whole, where), false, found)
    add(found, 'fork', wholeFocus(command))
    return settle(out)
  }
  const all = [...r.groups.flatMap(g => g.words), ...r.values]
  const names = [...new Set([...(where.defaultBranch !== undefined ? [where.defaultBranch] : []), 'main', 'master'])]
  // What a command changes for every later one: a move, a git config write, a branch switch.
  const effects = r.groups.map(g => {
    const ws = substitute(g.words, r.vars, g.at)
    const git = isGit(ws)
    return { ws, git, move: ws.some(w => w === 'cd' || w === 'pushd' || w === 'popd') && moves(ws, where), config: (git && writesConfig(ws)) || ws.some(gitConfigFile),
      switches: (git && switchesTo(ws, names)) || ws.some(w => /(?:^|\/)\.git\/HEAD$/.test(clean(w))) }
  })
  // In a loop, an effect anywhere in the body holds from the loop's first command (final review I2).
  const lifted = { move: new Set<number>(), config: new Set<number>(), switches: new Set<number>() }
  r.groups.forEach((g, k) => {
    for (const [a, b] of r.loops) {
      if (g.at < a || g.at > b) continue
      for (const e of ['move', 'config', 'switches'] as const) if (effects[k]![e]) for (let t = a; t <= b; t++) lifted[e].add(t)
    }
  })
  // A variable the text binds anywhere but the floor cannot read (final review I1).
  const bound = (n: string) => new RegExp(`(?<![\\w$])(?<!\\$\\{)${n}(?!\\w)`).test(command)
  let moved = r.bag.some(w => /^GIT_(?:DIR|WORK_TREE)=/.test(w))
  let config = r.bag.some(w => /^GIT_CONFIG/.test(w))
  let switched = false
  r.groups.forEach((g, k) => {
    const { ws, git, move, config: writes, switches } = effects[k]!
    if (lifted.move.has(g.at)) moved = true
    if (lifted.config.has(g.at)) config = true
    if (lifted.switches.has(g.at)) switched = true
    // Beside commit or branch a bare variable is not a flag, so one the text binds but the floor
    // cannot read is judged on the whole bag, as 0.4.3 did (`export NV=-n; git commit $NV`).
    const loose = ws.some(w => isVerb(w, 'commit') || isVerb(w, 'branch')) &&
      ws.some(w => [...w.matchAll(/\$\{?([A-Za-z_]\w*)/g)].some(m => bound(m[1]!)))
    const away = moved || moves(ws, where)
    const own = new Set<NeverRule>()
    rulesOf(substitute(g.own, r.vars, g.at), where, away, true, own, switched)
    const text = new Set<NeverRule>()
    rulesOf((config && git) || verbOpaque(ws) || loose ? all : ws, where, away, true, text, switched)
    add(own, 'ask', g.text)
    add(new Set([...text].filter(x => !own.has(x))), 'fork', g.text)
    if (move) moved = true
    if (writes) config = true
    if (switches) switched = true
  })
  return settle(out)
}
// A rule one command shows at both levels is already `ask` only (the loop above drops its text
// finding). A text finding in another command stays beside it (PR #763 round 2).
function settle(found: readonly Finding[]): Floor {
  return { findings: [...found] }
}
// The top-level commands that surely run: at the start of the text or after `;` or a
// newline, not in the background, not piped, not inside a group or a loop. literalVars reads names by
// the same rule.
function unconditional(text: string, cmds: readonly Command[]): boolean[] {
  const inside = depths(cmds)
  return cmds.map((c, i) => {
    const start = c.end - c.text.length
    // The separator before it, past blanks and empty commands: `a &&\nB=x` follows `&&`. A newline
    // after `&`, `|` or a backslash continues that command; a lone `&` after it runs it apart.
    let p = start - 1
    let line = false
    while (p >= 0 && /\s/.test(text[p]!)) { if (text[p] === '\n') line = true; p-- }
    const prev = text[p]
    const first = p < 0 || (prev === ';' && text[p - 1] !== ';') || (line && !/[&|\\]/.test(prev!))
    const background = text[c.end] === '&' && text[c.end + 1] !== '&'
    return first && !background && !c.pipe && !inside[i]!
  })
}
// A whole-text finding's focus: the first line that holds a verb word (§6).
function wholeFocus(command: string): string {
  const lines = command.split('\n').map(l => l.trim()).filter(Boolean)
  return lines.find(l => split(l).some(dangerWord)) ?? lines[0] ?? command
}
// Final review C1: a checkout, switch, branch rename or copy, or symbolic-ref that names a
// default branch name or an opaque word may leave HEAD on the default branch for later pushes.
function switchesTo(ws: readonly string[], names: readonly string[]): boolean {
  const at = ws.findIndex(w => w === 'checkout' || w === 'switch' || w === 'symbolic-ref' || w === 'branch')
  if (at < 0) return false
  const rest = ws.slice(at + 1)
  if (ws[at] === 'branch' && !rest.some(w => /^-[A-Za-z]*[mMcC]/.test(w) || /^--(?:move|copy)$/.test(w))) return false
  return rest.some(w => opaque(w) || names.some(n => w === n || [':', '/', '='].some(s => w.endsWith(`${s}${n}`))))
}

// Cause 3, extended by 0.5.1 (§3): a push that names a remote and only literal destinations other
// than the default branch, main or master (never HEAD, @, empty or opaque) needs no default-branch
// ask, whatever the session's branch is.
// 0.5.1 (§3): -d/--delete and -f/--force take no value either; force-push and branch-delete are read on their own.
const NO_VALUE = /^(?:-[uqvndf]+|--(?:set-upstream|quiet|verbose|tags|follow-tags|atomic|porcelain|progress|no-progress|dry-run|thin|no-thin|delete|force))$/
function namedRefs(words: readonly string[], names: readonly string[], remote?: string): boolean {
  const at = words.findIndex(w => isVerb(w, 'push'))
  if (at < 0) return false
  const args: string[] = []
  for (const w of words.slice(at + 1)) {
    if (w.startsWith('-')) { if (!NO_VALUE.test(w)) return false; continue }
    args.push(w)
  }
  if (args.length < 2 || opaque(args[0]!) || (remote !== undefined && args[0] !== remote)) return false
  const all = [...new Set([...names, 'main', 'master'])]
  return args.slice(1).every(ref => {
    const r = ref.replace(/^\+/, '')
    // 0.5.1 (§3): an opaque source with a literal destination (`$C:refs/heads/proof/x`) is read by its
    // destination. A `:` inside a `${…}` expansion (`${BRANCH:-x}`) is no refspec separator, so the
    // word stays one opaque ref.
    const at = r.replace(/\$\{[^}]*\}/g, m => 'x'.repeat(m.length)).lastIndexOf(':')
    const dst = at < 0 ? r : r.slice(at + 1)
    if (opaque(dst)) return false
    if (dst === '' || dst === 'HEAD' || dst === '@') return false
    return !all.some(n => dst === n || dst.endsWith(`/${n}`) || r === n)
  })
}

function rulesOf(words: readonly string[], where: Where, moved: boolean, single: boolean, found: Set<NeverRule>, switched = false): void {
  const any = (f: (w: string) => boolean) => words.some(w => f(w) || anyFlag(w))
  const anyNamed = (f: (w: string) => boolean) => words.some(w => f(w) || flagLike(w))
  const short = (c: string) => (w: string) => letters(w).includes(c)

  if (words.some(isPush)) {
    if (any(w => short('f')(w) || abbrev(w, '--force-with-lease', 3) || abbrev(w, '--force-if-includes', 3) ||
      abbrev(w, '--mirror', 3) || w.startsWith('+'))) found.add('force-push')
    if (any(w => short('d')(w) || abbrev(w, '--delete', 3) || abbrev(w, '--prune', 3) || abbrev(w, '--mirror', 3) ||
      w.startsWith(':') || w.startsWith('+:'))) found.add('branch-delete')
    const names = where.defaultBranch !== undefined ? [where.defaultBranch] : ['main', 'master']
    // A leading + forces the update; the ref after it is still the destination (+main).
    const isDefault = (r: string) => { const w = r.replace(/^\+/, ''); return names.some(n => w === n || [':', '/', '='].some(s => w.endsWith(`${s}${n}`))) }
    // send-pack and http-push with no refspec update the matching refs, the default one included.
    const plumbing = words.some(w => isVerb(w, 'send-pack') || isVerb(w, 'http-push'))
    // 0.5.1 (§3): a push that names a remote and only literal non-default destinations, read on one
    // command, is no default-branch push whatever the session's branch is (detached, main, moved).
    // Outside a move, only a push to origin whose default branch is known (origin/HEAD) is read by its
    // destination: another remote's default is unknown here (PR #763 round 2). A moved push keeps 0.5.0's reading.
    const named = single && (moved || switched ? namedRefs(words, names) : where.defaultBranch !== undefined && namedRefs(words, names, 'origin'))
    if (plumbing || (!named && (where.branch === undefined || names.includes(where.branch) || moved || switched ||
      any(w => isDefault(w) || w === ':' || w === '+:' || opaque(w) || abbrev(w, '--all', 3) || abbrev(w, '--branches', 3) || abbrev(w, '--mirror', 3)))))
      found.add('default-branch-push')
  }
  // -D, or -d with a force flag; a plain -d refuses an unmerged branch (as seat-mods reads it).
  if (words.some(w => isVerb(w, 'branch'))) {
    const del = anyNamed(w => short('d')(w) || abbrev(w, '--delete', 3))
    if (anyNamed(short('D')) || (del && anyNamed(w => short('f')(w) || abbrev(w, '--force', 3)))) found.add('branch-delete')
  }
  if (words.some(w => abbrev(w, '--no-verify', 6)) || (words.some(w => isVerb(w, 'commit')) && anyNamed(short('n')))) found.add('no-verify')

  const rm = words.findIndex(w => isVerb(w, 'rm'))
  if (rm >= 0) {
    const after = words.slice(rm + 1)
    const recursive = after.some(w => /[rR]/.test(letters(w)) || abbrev(w, '--recursive', 3) || anyFlag(w))
    // Strictly below the root: nothing is below a worktree at /.
    const root = where.root.replace(/\/+$/, '')
    const below = (w: string) => root !== '' && w.startsWith(`${root}/`)
    // A variable, a brace or a glob on a dot name may reach `..`; a plain glob stays where it is.
    const unknown = (w: string) => /[${]/.test(w) || /(?:^|\/)\.[^/]*[*?[]/.test(w)
    const outside = (w: string) => (!w.startsWith('-') || w.includes('/')) &&
      (w.startsWith('~') || w.split('/').includes('..') || unknown(w) || (w.startsWith('/') && !below(w)))
    if (recursive && (moved || words.includes('xargs') || after.some(outside))) found.add('rm-outside')
  }
}
