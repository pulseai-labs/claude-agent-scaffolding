import type { Mode } from './records'

// The mode switch (spec §1, D4): an env var per spawn, or /autopilot. The fail direction
// is manual: a broken setting gives more asks, never fewer.

export function parseEnvMode(v: string | undefined): { mode: Mode; invalid?: string } {
  const t = (v ?? '').trim()
  if (t === 'autopilot') return { mode: 'autopilot' }
  if (t === '' || t === 'manual') return { mode: 'manual' }
  return { mode: 'manual', invalid: t }
}

export type Command = { kind: 'on'; scope: string[] } | { kind: 'off' } | { kind: 'status' } | { kind: 'usage' }

// Words as a shell splits them: quotes and a backslash keep a space inside a path.
function words(args: string): string[] {
  const out: string[] = []
  for (const m of args.matchAll(/(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|\\(.)|([^\s"'\\]+))+/g)) {
    out.push(m[0].replace(/"((?:[^"\\]|\\.)*)"|'([^']*)'|\\(.)/g, (_, d, s, e) => d !== undefined ? d.replace(/\\(.)/g, '$1') : s ?? e))
  }
  return out
}

export function parseCommand(args: string): Command {
  const [word, ...rest] = words(args)
  if (word === 'on') return { kind: 'on', scope: rest }
  if (word === 'off' && rest.length === 0) return { kind: 'off' }
  if (word === 'status' && rest.length === 0) return { kind: 'status' }
  return { kind: 'usage' }
}

export function resolveDoc(path: string, cwd: string, home: string): string {
  if (path.startsWith('~/')) return `${home}/${path.slice(2)}`
  if (path.startsWith('/')) return path
  return `${cwd.replace(/\/+$/, '')}/${path}`
}

export function statusText(s: { mode: Mode; problem?: string; invalid?: string }): string {
  if (s.problem !== undefined) return `autopilot: ${s.problem}`
  if (s.invalid !== undefined) return `manual (AUTONOMIC_MODE="${s.invalid}" is not a mode)`
  return s.mode
}
