// The kill rail alone (#1099), as seat-mods' ambient OMP entry: package.json's `omp` manifest names this file, so
// a plain omp session loads it (#1102). The role guard stays in extension.ts, loaded only by omp-seat with -e.
// This entry calls the guard's own killCheck, so the two cannot drift. It ignores SEAT_MODS_ROLE and the agent kind:
// it reads bash's command and eval's string literals, and it only refuses. A miss returns undefined and the call goes
// on to the next handler and the model. An unreadable bash command is refused with KILL_UNCHECKED, as free roles are; an unreadable eval string
// literal passes, because a literal is not necessarily shell and a miss goes on to the next judge (C1, PR #1119).
// Under omp-seat it runs a second time beside the guard: it only refuses and the first block wins. The one visible
// difference: for a bash command the rail cannot read, a guarded seat gets this rail's KILL_UNCHECKED stop first, not its
// role's own deny text.
import { KILL_UNCHECKED } from '../hooks/rules'
import { killCheck } from './extension'

export default function (pi: any) {
  pi.on('tool_call', (e: any) => {
    const check = killCheck(String(e?.toolName), (e?.input ?? {}) as Record<string, unknown>)
    return check.deny !== undefined ? { block: true, reason: check.deny } : check.unread && e?.toolName === 'bash' ? { block: true, reason: KILL_UNCHECKED } : undefined
  })
}
