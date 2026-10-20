// seat-mods' files: the one record of another plugin it reads, and its own log. Every path
// is under ~/.claude/state, keyed by session id; the id must be a plain name to be a file
// name. autonomicPath and parseAutonomic are molt's, copied byte for byte; tests/
// test-mod-shell-parity.sh holds the pair identical.

const STATE = '.claude/state'

export const autonomicPath = (home: string, id: string) => `${home}/${STATE}/autonomic/sessions/${id}.json`

export const seatLogPath = (home: string) => `${home}/${STATE}/seat-mods/seat-mods.log`

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
