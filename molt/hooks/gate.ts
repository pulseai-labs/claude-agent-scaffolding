import { SUBSTITUTION_TOO_DEEP, gitSubcommands, innerCommandsOf, substitutionsOf } from './shell'

// The Stop reflex asks for the handoff at most twice before falling back.
export const MAX_STOP_BLOCKS = 2

// A turn-end request molt submitted that has not yet arrived at prompt.submit (#929).
export type Request = { sessionId: string; text: string }

// A request waits for its own session only. One accepted in a session that has since moved on
// (a /clear, a resume) may never run, and must not stop the new session's request (#933).
export const waitsIn = (asked: readonly Request[], sessionId: string): boolean => asked.some(a => a.sessionId === sessionId)

// The request a molt prompt is, taken off the list: the one with its text asked in the session
// it arrives in, else the oldest with its text. The texts carry no session id, so two sessions'
// requests are often equal; the arriving session's own must not be mistaken for a stale one.
export function takeRequest(asked: Request[], text: string, sessionId: string | undefined): Request | undefined {
  let i = asked.findIndex(a => a.text === text && a.sessionId === sessionId)
  if (i < 0) i = asked.findIndex(a => a.text === text)
  return i < 0 ? undefined : asked.splice(i, 1)[0]
}

// Past the hard threshold only the handoff's own tools run: the file tools that write
// it, Skill (the instruction names a handoff skill), and Bash made only of git add and
// git commit segments. Everything else, reads included, is refused: a read is what
// overflows a window that is nearly full.
const HANDOFF_TOOLS = new Set(['Write', 'Edit', 'Skill'])
const GIT_ALLOWED = new Set(['add', 'commit'])

// INNER_OK: inside a `$(…)` or backtick span the gate allows only what builds the handoff's
// commit message and reads no file (#724 A1, A2): git add or git commit, cat of its stdin alone
// (`-` or no operand; a heredoc is stdin), date, printf and echo. A command word reached by a
// relative path may be any local program, and a span nested too deep is never allowed.
const INNER_OK = new Set(['date', 'printf', 'echo'])
// `date -f FILE` prints the file's lines, so date refuses it in each spelling the reader sees:
// `-f x`, `-fx`, `-uf x` and `--file`, `--file=x` or a prefix such as `--fi=x` (Ruling 17).
const DATE_READS = /^(?:--f(?:i(?:le?)?)?(?:=|$)|-[^-dIrs]*f)/

function innerOk(substitution: string): boolean {
  if (substitution === SUBSTITUTION_TOO_DEEP) return false
  return innerCommandsOf(substitution).every(command => {
    if (command === undefined || command.local) return false
    if (command.name === 'git') return command.sub !== undefined && GIT_ALLOWED.has(command.sub)
    if (command.name === 'cat') return !command.input && command.args.every(arg => arg === '-')
    if (command.name === 'date') return !command.plain.some(arg => DATE_READS.test(arg))
    return INNER_OK.has(command.name)
  })
}

export function gateAllows(tool: string, args: Readonly<Record<string, unknown>>): boolean {
  if (HANDOFF_TOOLS.has(tool)) return true
  if (tool !== 'Bash' || typeof args.command !== 'string') return false
  const subs = gitSubcommands(args.command)
  return subs.length > 0 && subs.every(sub => sub !== undefined && GIT_ALLOWED.has(sub)) &&
    substitutionsOf(args.command).every(innerOk)
}
