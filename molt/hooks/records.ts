// molt's files. Every path is under
// ~/.claude/state, keyed by session id; the id must be a plain name to be a file name.

const STATE = '.claude/state'

export const lineagePath = (home: string, id: string) => `${home}/${STATE}/molt/lineage/${id}.json`
export const activePath = (home: string, id: string) => `${home}/${STATE}/molt/active/${id}`
export const stagePath = (home: string, id: string) => `${home}/${STATE}/molt/stage/${id}`
export const fallbackPath = (home: string, id: string) => `${home}/${STATE}/molt/briefs/${id}.md`
export const successorPath = (home: string, id: string) => `${home}/${STATE}/molt/successor/${id}.json`
export const sdkHandoffPath = (home: string, id: string) => `${home}/${STATE}/molt/sdk-handoff/${id}`
export const logPath = (home: string) => `${home}/${STATE}/molt/molt.log`

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

// Written at a seed, keyed by the session that molted: a later resume of that session is stale (#901).
export type Successor = { successor: string; handoff: string; at: string }

export function parseSuccessor(text: string | undefined): Successor | undefined {
  try {
    const v = JSON.parse(text ?? '') as Partial<Successor>
    if (typeof v.successor === 'string' && typeof v.handoff === 'string' && typeof v.at === 'string')
      return { successor: v.successor, handoff: v.handoff, at: v.at }
  } catch {}
  return undefined
}
