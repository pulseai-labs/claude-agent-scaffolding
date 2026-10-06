// The shape of a command: what the never-approve path records in the committed ledger and
// every pain signal (PR #681 round 8). Verbs, a git subcommand and flag names are shown;
// every value is only counted, so no credential can be written, however it is spelled.
// The operator still sees the whole command in the permission dialog.

const TOKEN = /(&&|\|\||;|\||\n)|((?:"[^"]*"|'[^']*'|\\.|[^\s"'\;&|])+)/g
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/
// A command name is shown only when it is a known one: a value split off by a continuation or
// a newline can sit where a command name goes (round 9).
const NAMES = new Set(['git', 'gh', 'rm', 'cd', 'ls', 'cat', 'echo', 'printf', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno', 'node',
  'python', 'python3', 'pytest', 'uv', 'pip', 'make', 'cargo', 'go', 'curl', 'wget', 'mysql', 'psql', 'docker', 'kubectl',
  'bash', 'sh', 'zsh', 'find', 'xargs', 'sudo', 'env', 'grep', 'rg', 'sed', 'awk', 'cp', 'mv', 'mkdir', 'touch', 'chmod',
  'chown', 'tar', 'ssh', 'scp', 'rsync', 'jq', 'test', 'true', 'false', 'sleep', 'timeout', 'claude'])
const GIT_SUBS = new Set(['push', 'commit', 'branch', 'reset', 'clean', 'checkout', 'switch', 'restore', 'rebase', 'merge',
  'tag', 'fetch', 'pull', 'rm', 'stash', 'send-pack', 'http-push', 'add', 'status', 'log', 'diff'])

// A flag name is shown only when it is a known one: an option's value can start with - too (round 11).
const FLAGS = new Set(['-f', '-F', '-r', '-R', '-rf', '-fr', '-Rf', '-fR', '-rv', '-d', '-D', '-n', '-u', '-m', '-a', '-am', '-v', '-q',
  '-o', '-c', '-C', '-x', '-h', '--force', '--force-with-lease', '--force-if-includes', '--mirror', '--delete', '--prune', '--all',
  '--branches', '--tags', '--no-verify', '--dry-run', '--set-upstream', '--amend', '--recursive', '--verbose', '--quiet', '--message'])
function flag(t: string): string {
  const name = t.split('=')[0]!
  return FLAGS.has(name) ? name : '-?'
}

function segment(tokens: readonly string[]): string {
  const out: string[] = []
  let i = 0
  for (; i < tokens.length && ASSIGN.test(tokens[i]!); i++) out.push(`${tokens[i]!.split('=')[0]}=`)
  const head = tokens[i]
  if (head === undefined) return out.join(' ')
  const name = head.replace(/^.*\//, '')
  out.push(NAMES.has(name) ? name : '?')
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
  for (const m of command.replace(/\\\n/g, '').matchAll(TOKEN)) {
    if (m[1] !== undefined) {
      parts.push(segment(tokens), m[1] === '\n' ? ';' : m[1])
      tokens = []
    } else tokens.push(m[2]!)
  }
  parts.push(segment(tokens))
  return parts.filter(p => p !== '').join(' ').replace(/^[;&| ]+|[;&| ]+$/g, '').trim()
}
