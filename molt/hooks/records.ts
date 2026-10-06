// molt's files, and the one file of another plugin it reads. Every path is under
// ~/.claude/state, keyed by session id; the id must be a plain name to be a file name.

const STATE = '.claude/state'

export const lineagePath = (home: string, id: string) => `${home}/${STATE}/molt/lineage/${id}.json`
export const activePath = (home: string, id: string) => `${home}/${STATE}/molt/active/${id}`
export const stagePath = (home: string, id: string) => `${home}/${STATE}/molt/stage/${id}`
export const fallbackPath = (home: string, id: string) => `${home}/${STATE}/molt/briefs/${id}.md`
export const logPath = (home: string) => `${home}/${STATE}/molt/molt.log`
export const autonomicPath = (home: string, id: string) => `${home}/${STATE}/autonomic/sessions/${id}.json`

export const safeSessionId = (id: string): boolean => /^[A-Za-z0-9_-]+$/.test(id)

export type Lineage = { from: string; chain: string; depth: number; handoff: string }

export function parseLineage(text: string | undefined): Lineage | undefined {
  try {
    const v = JSON.parse(text ?? '') as Partial<Lineage>
    if (typeof v.from === 'string' && typeof v.chain === 'string' && typeof v.depth === 'number' && typeof v.handoff === 'string')
      return { from: v.from, chain: v.chain, depth: v.depth, handoff: v.handoff }
  } catch {}
  return undefined
}

export type Autonomic = { mode: 'manual' | 'autopilot'; bell?: string }

// The autonomic plugin's session record (spec §1). Anything unreadable is manual: the
// fail direction gives the operator more asks, never fewer.
export function parseAutonomic(text: string | undefined): Autonomic {
  try {
    const v = JSON.parse(text ?? '') as { mode?: unknown; bell?: unknown }
    if (v.mode !== 'autopilot') return { mode: 'manual' }
    return typeof v.bell === 'string' && v.bell.trim() !== '' ? { mode: 'autopilot', bell: v.bell } : { mode: 'autopilot' }
  } catch {
    return { mode: 'manual' }
  }
}
