// seat-mods' files: molt's stage record it reads, and its own log. Every path is under
// ~/.claude/state, keyed by session id; the id must be a plain name to be a file name.

const STATE = '.claude/state'

// molt's stage file (#929): the same path molt's stagePath builds. tests/test-mod-shell-parity.sh
// holds the definition line to molt's (#933).
export const moltStagePath = (home: string, id: string) => `${home}/${STATE}/molt/stage/${id}`

export const seatLogPath = (home: string) => `${home}/${STATE}/seat-mods/seat-mods.log`
