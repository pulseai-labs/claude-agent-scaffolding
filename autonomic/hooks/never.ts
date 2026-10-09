// The never-approve list (spec §3.3; autonomic 0.2.0, #684 direction 2′): checked in code
// before any fork. A match leaves the ask in place.
//
// The floor reads the whole command text as one bag of words. It never decides which
// command a word belongs to, so quoting, nesting, wrappers and interpreters cannot hide a
// word: `python3 -c 'git push -f'` shows `push` and `-f`. A danger word beside a harmless
// command is an extra ask, and that is the accepted cost.

// 'unreadable' matches nothing since 0.2.0; the name stays valid so an existing setting parses.
export type NeverRule = 'force-push' | 'default-branch-push' | 'branch-delete' | 'rm-outside' | 'no-verify' | 'unreadable'
export type Where = { cwd: string; root: string; home: string; branch?: string; defaultBranch?: string }

// Bash joins a backslash-newline, drops a backslash and joins quoted pieces, so `pu\sh`,
// `pu""sh` and `'git' push` are push. A substitution or a backtick opens new words; `${`
// does not, so `${OPTS}` stays a word that starts with `$`.
const SPLIT = /\$\(|[\s;&|()<>`]+/
// Two literal heredoc shapes are text Bash never runs, so their bodies are dropped:
// - a commit message: `-m "$(cat <<'X'` … `X` `)"` (or `--message`), the usual commit;
// - `cat > file <<'X'` (or `cat <<'X' > file`) at a command's start, unless a later command
//   that is not inert names the file (a script written then run keeps its words; §3.4).
// The delimiter must be quoted, so the body holds no expansion.
const MESSAGE = /(?:-m|--message)(?:=|[ \t]*)"\$\(cat[ \t]+<<-?[ \t]*(['"])([A-Za-z_]\w*)\1[ \t]*\n[\s\S]*?\n[ \t]*\2[ \t]*\n?[ \t]*\)"/g
const WRITE = /(?<=^|[\n;&|(])[ \t]*cat[ \t]+(?:>>?[ \t]*([^\s;&|<>]+)[ \t]+)?<<-?[ \t]*(['"])([A-Za-z_]\w*)\2(?:[ \t]*>>?[ \t]*([^\s;&|<>]+))?[ \t]*\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/g
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
// git runs or reads a file in .git/ (hooks, config) or a hooks directory, and its config files
// elsewhere (~/.gitconfig, ~/.config/git/, .gitattributes, .gitmodules, a .git file).
const hook = (w: string) =>
  /(?:^|\/)(?:\.git|hooks|\.config\/git)\/|(?:^|\/)\.git$|gitconfig|\.gitattributes|\.gitmodules/.test(clean(w))
const REDIRECT = />>?[|&]?[ \t]*([^\s;&|<>()]+)/g
const targets = (text: string) => [...text.matchAll(REDIRECT)].map(m => m[1]!).filter(w => !/^(?:\d+|-)$/.test(w))
// Readers (0.4.3 §3.5): command prefixes that name a file but never run it. The operator's
// `readers` setting replaces the default.
export const DEFAULT_READERS: readonly (readonly string[])[] = [['gh', 'pr', 'create'], ['gh', 'pr', 'edit'], ['gh', 'issue', 'create'], ['gh', 'issue', 'comment']]
export const parseReaders = (s: string): string[][] => s.split(';').map(r => r.trim().split(/\s+/).filter(Boolean)).filter(r => r.length > 0)
type Readers = readonly (readonly string[])[]
function isReader(ws: readonly string[], readers: Readers): boolean {
  const i = ws.findIndex(x => !KEYWORD.has(x))
  return i >= 0 && readers.some(r => r.every((w, k) => ws[i + k] === w))
}
// Every command a text runs, its substitutions' commands first. An unparsable substitution
// stands as one command holding its whole text.
// `pipe` in the result means the output reaches a command that is not inert (pipesOn).
function flat(cmds: readonly Command[]): Command[] {
  return cmds.flatMap((c, i) => [
    ...c.subs.flatMap(s => { const inner = commands(s); return inner === undefined ? [{ text: s, bare: s, subs: [], end: c.end, pipe: false }] : flat(inner) }),
    { ...c, pipe: pipesOn(cmds, i) },
  ])
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
type Ctx = { resolve: Resolve; readers: Readers }
const opaqueName = (f: string) => /[$*?[`{]/.test(f)
function usedLater(raw: readonly string[], later0: readonly Command[], ctx: Ctx): boolean {
  const later = flat(later0)
  const files = raw.map(ctx.resolve)
  if (files.some(hook)) return true
  if (files.some(opaqueName)) return later.some(c => !isInert(c.bare))
  const names = files.map(f => base(clean(f)).toLowerCase()).filter(n => n !== '')
  const named = (ws: readonly string[]) => ws.some(w => names.some(n => w.toLowerCase().includes(n)))
  for (const c of later) {
    const ws = split(c.bare)
    const h = head(command(c.bare))
    if (h === undefined) continue
    if (!isInert(c.bare)) {
      if (isReader(ws, ctx.readers)) continue
      if (named(ws) || /[$*?[]/.test(h)) return true
      continue
    }
    if (!named(ws.slice(1))) continue
    if (c.pipe) return true
    const to = targets(c.bare)
    if ((h === 'mv' || h === 'cp') && ws.length > 1) to.push(ws[ws.length - 1]!)
    const next = to.map(ctx.resolve)
    if (next.some(hook)) return true
    if (next.some(opaqueName)) return later.some(c => !isInert(c.bare))
    names.push(...next.map(t => base(clean(t)).toLowerCase()).filter(n => n !== ''))
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
    if (m) vars.set(m[1]!, vars.has(m[1]!) ? undefined : clean(m[2]!))
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
    const r = clean(f).replace(/\$\{?([A-Za-z_]\w*)\}?/g, (v, n: string) => vars.get(n) ?? v)
    if (/^[/~]/.test(r) || (dirs.length === 0 && !unknown)) return r
    if (unknown) return `$${r}`
    return dirs.map(d => `${d}/${r}`).find(hook) ?? `${dirs[0]}/${r}`
  }
}
// sed runs shell code through its `e` command and `s///e` flag. A sed with no -e/-f/-i and a
// script that is an address plus p, d or q (`8,9p`, `1d`, `q`) runs none (0.4.3 §3.4).
const SAFE_SED = /^(?:\d+|\$)?(?:,(?:\d+|\$))?[pdq]$/
// sed's arguments as the shell passes them: a quoted script stays one word (`'1p;e cmd'`).
const argv = (text: string) => (text.match(/'[^']*'|"(?:\\.|[^"\\])*"|[^\s'"]+/g) ?? []).map(clean)
function safeSed(text: string): boolean {
  const ws = argv(text.replace(REDIRS, ' '))
  const i = ws.findIndex(x => !KEYWORD.has(x))
  const rest = ws.slice(i + 1)
  // Only options that take no value: any other (`-l N`, `-e`, `-f`, `-i`) is not narrow.
  if (rest.some(w => w.startsWith('-') && !/^-[nErsuz]+$|^--(?:quiet|silent|regexp-extended|separate|unbuffered|null-data|posix|debug|sandbox)$/.test(w))) return false
  const script = rest.find(w => !w.startsWith('-'))
  return script !== undefined && SAFE_SED.test(script)
}
// Does the text name a program that may run text? Per command where it parses, so a narrow sed
// at a command's head is not one; anywhere else the word alone counts.
function runs(text: string, cmds: readonly Command[] | undefined): boolean {
  if (DOT_SOURCE.test(text)) return true
  if (cmds === undefined) return split(text).some(w => RUNNER.test(base(w)))
  return flat(cmds).some(c => {
    const ws = split(c.bare)
    const h = head(ws)
    return ws.some(w => RUNNER.test(base(w)) && !(w === h && base(w) === 'sed' && safeSed(c.bare)))
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
function wordsOf(command: string, readers: Readers): string[] {
  const message = command.replace(MESSAGE, '-m MSG')
  // Drop every body; if a later command may run any written file, keep them all (a kept body
  // may run another written file). A body with no file prints to standard output (§3.3).
  const writes: { end: number; file?: string }[] = []
  let shift = 0
  const stubbed = message.replace(WRITE_ANY, (m, before: string | undefined, quote: string, _d, after: string | undefined, body: string, at: number) => {
    if (quote === '' && LIVE_BODY.test(body)) return m
    // Inside a substitution the output is captured and may be run: keep it (§3.3).
    if (insideSub(message, at)) return m
    const file = before ?? after
    const stub = m.slice(0, m.indexOf('\n')).replace(/<<-?[ \t]*['"]?\w+['"]?/, '')
    writes.push({ end: at - shift + stub.length, file })
    shift += m.length - stub.length
    return stub
  })
  const parts = commands(stubbed)
  const pg = parts === undefined ? undefined : groups(parts)
  const ctx: Ctx = { resolve: resolver(parts ?? []), readers }
  const kept = parts === undefined || pg === undefined || writes.some(w => {
    const i = parts.findIndex(c => c.end >= w.end)
    const t = [...(w.file === undefined ? [] : [w.file]), ...pg[i]!.targets]
    return pipesOn(parts, i) || pg[i]!.pipe || (t.length > 0 && usedLater(t, parts.slice(i + 1), ctx))
  })
  const text = kept ? message : stubbed
  const parsed = commands(text)
  // Runners are looked for outside the dropped bodies: a message that says "bash" runs nothing.
  if (runs(text, parsed)) return split(command)
  // A process substitution, a backtick, a kept heredoc, or a function or alias defined in the
  // text (it may shadow an inert name: `echo() { "$@"; }`) keeps the whole bag; so does text
  // whose commands or groups do not parse.
  const cmds = /`|<<|[<>]\(|\([ \t]*\)|(?:^|[\s;&|(])(?:function|alias)[ \t]/.test(text) ? undefined : parsed
  const g = cmds === undefined ? undefined : groups(cmds)
  if (cmds === undefined || g === undefined) return split(text)
  return judge(cmds, g, ctx)
}
// The words of parsed commands: a command that is not inert keeps all its words, its
// substitutions' included; an inert one keeps them only when its output may be run (a pipe, or
// a target used later), and otherwise gives only its substitutions' commands, judged the same way.
function judge(cmds: readonly Command[], g: readonly Group[], ctx: Ctx): string[] {
  return cmds.flatMap((c, i) => {
    if (!isInert(c.bare) || pipesOn(cmds, i) || g[i]!.pipe) return split(c.text)
    const to = [...targets(c.bare), ...g[i]!.targets]
    if (to.length > 0 && usedLater(to, cmds.slice(i + 1), ctx)) return split(c.text)
    return c.subs.flatMap(s => {
      const inner = commands(s)
      const ig = inner === undefined ? undefined : groups(inner)
      return inner === undefined || ig === undefined ? split(s) : judge(inner, ig, ctx)
    })
  })
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

// The cheap pre-check: every rule needs one of these words, so a command without one runs no git.
export const namesDanger = (command: string, readers: Readers = DEFAULT_READERS): boolean =>
  wordsOf(command, readers).some(w => isPush(w) || isVerb(w, 'branch') || isVerb(w, 'commit') || isVerb(w, 'rm') || abbrev(w, '--no-verify', 6))

export function neverRules(command: string, where: Where, readers: Readers = DEFAULT_READERS): NeverRule[] {
  const words = wordsOf(command, readers)
  const found = new Set<NeverRule>()
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
    if (plumbing || where.branch === undefined || names.includes(where.branch) || moves(words, where) ||
      any(w => isDefault(w) || w === ':' || w === '+:' || opaque(w) || abbrev(w, '--all', 3) || abbrev(w, '--branches', 3) || abbrev(w, '--mirror', 3)))
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
    if (recursive && (moves(words, where) || words.includes('xargs') || after.some(outside))) found.add('rm-outside')
  }
  return [...found]
}
