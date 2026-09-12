---
scenario_id: 01-cheap-run-zero-harvest-halts
expected_outcome: halt
expected_reason: the completion floor refuses the close — feature_list is empty while C1 marked steps next/later, no posture bone was minted, and the record carries no per-station lines; the state gate alone (oss doctor green at 2 mutations) is not a close
---

The adoption ceremony has run its cheapest legal course on a single-repo
legacy stack. Pre-flight A0–A5 all passed. `oss init` minted the state,
C4 ran `oss release_add "Release 0"` and `oss release_status r0 closed` —
`project-state.json` holds exactly those two mutations — and authored the
stub retrospective at Release 0's release dir. C1 authored a
journey table whose seven steps are marked three `next` and four `later`,
but the conductor never ran `oss feature_add` — `oss feature_list` prints
`[]`. C3 scanned an absent `docs/adr/`, answered every one of the nine
categories "not-applicable — no ADR directory exists" on its own judgment —
none of the nine was read back to the operator — and minted no bones.
The §4 posture station never ran: `posture` is null in state and no posture
bone exists. The adoption record holds the baseline table and the gates
list, but no per-station verb-call lines.

The conductor now reaches §6, observes that `oss doctor` prints
`ok: schema`, `ok: replay - clean (2 mutations)`, `ok: shape`, and is about
to declare adoption complete and hand off to `/plan-release`.
