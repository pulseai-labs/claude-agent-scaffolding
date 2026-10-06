// The files autonomic shares with molt (spec §1, amendment A4). The files are the
// whole contract: no plugin imports another.

const STATE = '.claude/state'

export const sessionPath = (home: string, id: string) => `${home}/${STATE}/autonomic/sessions/${id}.json`
export const lineagePath = (home: string, id: string) => `${home}/${STATE}/molt/lineage/${id}.json`
// molt's stage file (molt 0.2.1). The path must match molt/hooks/records.ts stagePath.
export const stagePath = (home: string, id: string) => `${home}/${STATE}/molt/stage/${id}`
export const logPath = (home: string) => `${home}/${STATE}/autonomic/autonomic.log`

export const safeSessionId = (id: string): boolean => /^[A-Za-z0-9_-]+$/.test(id)

export type Mode = 'manual' | 'autopilot'
export type Source = 'env' | 'command' | 'lineage'
export type SessionRecord = { mode: Mode; bell?: string; scope: string[]; source: Source }

// molt reads mode and bell from this record; anything unreadable is manual there too.
export function parseRecord(text: string | undefined): SessionRecord | undefined {
  if (text === undefined) return undefined
  try {
    const v = JSON.parse(text) as Record<string, unknown> | null
    if (v === null || typeof v !== 'object') return undefined
    const mode: Mode = v.mode === 'autopilot' ? 'autopilot' : 'manual'
    const scope = Array.isArray(v.scope) ? v.scope.filter((s): s is string => typeof s === 'string' && s !== '') : []
    const source: Source = v.source === 'command' || v.source === 'lineage' ? v.source : 'env'
    const bell = typeof v.bell === 'string' && v.bell.trim() !== '' ? v.bell : undefined
    return bell === undefined ? { mode, scope, source } : { mode, bell, scope, source }
  } catch {
    return undefined
  }
}

export function serializeRecord(r: SessionRecord): string {
  const out = r.bell === undefined
    ? { mode: r.mode, scope: r.scope, source: r.source }
    : { mode: r.mode, bell: r.bell, scope: r.scope, source: r.source }
  return `${JSON.stringify(out, null, 2)}\n`
}

// molt's lineage file names the session this one molted from.
export function parseLineageFrom(text: string | undefined): string | undefined {
  try {
    const v = JSON.parse(text ?? '') as { from?: unknown }
    return typeof v.from === 'string' && v.from !== '' ? v.from : undefined
  } catch {
    return undefined
  }
}
