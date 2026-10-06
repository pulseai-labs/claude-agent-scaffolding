// The shape of a command: what the never-approve path records in the committed ledger and
// every pain signal (PR #681 round 8). Verbs, a git subcommand and flag names are shown;
// every value is only counted, so no credential can be written, however it is spelled.
// The operator still sees the whole command in the permission dialog.

const TOKEN = /(&&|\|\||;|\||\n)|((?:"[^"]*"|'[^']*'|\\.|[^\s"'\;&|])+)/g
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/
const WORD = /^[A-Za-z][A-Za-z0-9._+-]*$/
const GIT_SUBS = new Set(['push', 'commit', 'branch', 'reset', 'clean', 'checkout', 'switch', 'restore', 'rebase', 'merge',
  'tag', 'fetch', 'pull', 'rm', 'stash', 'send-pack', 'http-push', 'add', 'status', 'log', 'diff'])

function flag(t: string): string {
  const name = t.split('=')[0]!
  return /^--[A-Za-z][A-Za-z0-9-]*$/.test(name) || /^-[A-Za-z]{1,3}$/.test(name) ? name : '-?'
}

function segment(tokens: readonly string[]): string {
  const out: string[] = []
  let i = 0
  for (; i < tokens.length && ASSIGN.test(tokens[i]!); i++) out.push(`${tokens[i]!.split('=')[0]}=`)
  const head = tokens[i]
  if (head === undefined) return out.join(' ')
  const name = head.replace(/^.*\//, '')
  out.push(WORD.test(name) ? name : '?')
  const rest = tokens.slice(i + 1)
  const sub = name === 'git' ? rest.findIndex(t => GIT_SUBS.has(t)) : -1
  if (sub >= 0) out.push(rest[sub]!)
  let args = 0
  rest.forEach((t, k) => {
    if (k === sub) return
    if (t.startsWith('-')) out.push(flag(t))
    else args += 1
  })
  return args > 0 ? `${out.join(' ')} (+${args} args)` : out.join(' ')
}

export function shape(command: string): string {
  const parts: string[] = []
  let tokens: string[] = []
  for (const m of command.matchAll(TOKEN)) {
    if (m[1] !== undefined) {
      parts.push(segment(tokens), m[1] === '\n' ? ';' : m[1])
      tokens = []
    } else tokens.push(m[2]!)
  }
  parts.push(segment(tokens))
  return parts.filter(p => p !== '').join(' ').replace(/^[;&| ]+|[;&| ]+$/g, '').trim()
}
