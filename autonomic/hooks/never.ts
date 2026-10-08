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
// `pipe` marks a command whose output goes on to the next one. An open quote returns undefined.
type Command = { text: string; end: number; pipe: boolean }
function commands(text: string): Command[] | undefined {
  const out: Command[] = []
  let from = 0
  let q: string | undefined
  const cut = (i: number, next: number, pipe: boolean) => { out.push({ text: text.slice(from, i), end: i, pipe }); from = next }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (q === "'") { if (c === "'") q = undefined; continue }
    if (c === '\\') { i++; continue }
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
  out.push({ text: text.slice(from), end: text.length, pipe: false })
  return out
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
// `printf -v NAME` (or a cluster such as -vV) assigns a variable, so it is not inert.
function isInert(text: string): boolean {
  const ws = split(text)
  const h = head(ws)
  if (h === undefined) return true
  return INERT.has(h) && !DEFINES.test(text) && !(h === 'printf' && ws.some(w => /^-[A-Za-z]*v/.test(w)))
}
// git runs a file in .git/ (hooks, config) or a hooks directory.
const hook = (w: string) => /(?:^|\/)(?:\.git|hooks)\//.test(clean(w))
const REDIRECT = />>?[|&]?[ \t]*([^\s;&|<>()]+)/g
const targets = (text: string) => [...text.matchAll(REDIRECT)].map(m => m[1]!).filter(w => !/^(?:\d+|-)$/.test(w))
// Is a written file run (or read by a program that may run it) later? A file in .git/ or
// hooks/ is. So is one a later command that is not inert names, and every file when that
// command's own name is a variable or a glob (`./$T.sh`, `./x*`). An inert command that names
// the file passes the name on to what it writes (mv, cp, a redirect), and a pipe from it counts
// as run. A name matches inside any word, whatever its case, so `./X.SH` names x.sh.
// A file name holding a variable the text assigns once is read with its value; one that stays
// opaque may be any file (.git/config included), so any later command that is not inert counts.
type Resolve = (f: string) => string
const opaqueName = (f: string) => /[$*?[`{]/.test(f)
function usedLater(raw: readonly string[], later: readonly Command[], resolve: Resolve): boolean {
  const files = raw.map(resolve)
  if (files.some(hook)) return true
  if (files.some(opaqueName)) return later.some(c => !isInert(c.text))
  const names = files.map(f => base(clean(f)).toLowerCase()).filter(n => n !== '')
  const named = (ws: readonly string[]) => ws.some(w => names.some(n => w.toLowerCase().includes(n)))
  for (const c of later) {
    const ws = split(c.text)
    const h = head(ws)
    if (h === undefined) continue
    if (!isInert(c.text)) { if (named(ws) || /[$*?[]/.test(h)) return true; continue }
    if (!named(ws.slice(1))) continue
    if (c.pipe) return true
    const to = targets(c.text)
    if ((h === 'mv' || h === 'cp') && ws.length > 1) to.push(ws[ws.length - 1]!)
    const next = to.map(resolve)
    if (next.some(hook)) return true
    if (next.some(opaqueName)) return later.some(c => !isInert(c.text))
    names.push(...next.map(t => base(clean(t)).toLowerCase()).filter(n => n !== ''))
  }
  return false
}
// Assignments that are a whole command (`T=/s/r.md.tmp`). A name assigned twice stays opaque.
const ASSIGN = /^[ \t]*([A-Za-z_]\w*)=("[^"$`]*"|'[^']*'|[^\s;&|<>"'$`]*)[ \t]*$/
function resolver(parts: readonly Command[]): Resolve {
  const vars = new Map<string, string | undefined>()
  for (const c of parts) {
    const m = ASSIGN.exec(c.text)
    if (m) vars.set(m[1]!, vars.has(m[1]!) ? undefined : clean(m[2]!))
  }
  return f => clean(f).replace(/\$\{?([A-Za-z_]\w*)\}?/g, (v, n: string) => vars.get(n) ?? v)
}
function wordsOf(command: string): string[] {
  const message = command.replace(MESSAGE, '-m MSG')
  // Drop every body; if a later command may run any written file, keep them all (a kept body
  // may run another written file).
  const writes: { end: number; file: string }[] = []
  let shift = 0
  const stubbed = message.replace(WRITE, (m, before: string | undefined, _q, _d, after: string | undefined, at: number) => {
    const file = before ?? after
    if (file === undefined) return m
    const stub = m.slice(0, m.indexOf('\n')).replace(/<<-?[ \t]*['"]\w+['"]/, '')
    writes.push({ end: at - shift + stub.length, file })
    shift += m.length - stub.length
    return stub
  })
  const parts = commands(stubbed)
  const resolve = resolver(parts ?? [])
  const kept = parts === undefined || writes.some(w => usedLater([w.file], parts.filter(c => c.end > w.end), resolve))
  const text = kept ? message : stubbed
  // Runners are looked for outside the dropped bodies: a message that says "bash" runs nothing.
  if (DOT_SOURCE.test(text) || split(text).some(w => RUNNER.test(base(w)))) return split(command)
  // A substitution, a process substitution, a backtick or a kept heredoc keeps the whole bag.
  const cmds = /\$\(|`|<<|[<>]\(/.test(text) ? undefined : commands(text)
  if (cmds === undefined) return split(text)
  return cmds.flatMap((c, i) => {
    if (!isInert(c.text) || c.pipe) return split(c.text)
    const to = targets(c.text)
    return to.length > 0 && usedLater(to, cmds.slice(i + 1), resolve) ? split(c.text) : []
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
export const namesDanger = (command: string): boolean =>
  wordsOf(command).some(w => isPush(w) || isVerb(w, 'branch') || isVerb(w, 'commit') || isVerb(w, 'rm') || abbrev(w, '--no-verify', 6))

export function neverRules(command: string, where: Where): NeverRule[] {
  const words = wordsOf(command)
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
