---
scenario_id: 02-all-shipped-waiver-closes
expected_outcome: proceed
expected_reason: the floor is anti-unasked, not anti-thin — every journey step is shipped, the operator confirmed on the record that nothing is left to harvest, the posture bone is minted, and the record carries its per-station lines, so the zero-feature close is a legitimate waived close
---

A small but genuinely complete adoption on a single-repo legacy stack.
A0–A5 passed, `oss init` minted state, and C4 closed Release 0
retroactively, with the stub retrospective authored at its release dir. C1's journey table has four steps, every one marked
`shipped` — the product is in maintenance with no planned work. The
conductor read the empty harvest back to the operator, who confirmed there
is nothing to harvest, and the record carries the waiver line: "all
steps shipped; zero harvest confirmed by operator". C3 scanned the repo's
two ADRs, minted two bones (status Accepted), and put the remaining seven
categories on the record as `not-applicable` with reasons about the
categories, each marked operator-ruled. The §4 posture station ran:
`oss posture_set fully-private` and the posture bone is in the registry.
`oss risk_gate_add` was called zero times — the operator walked the four
hazard families and none applies; the record shows `risk_gate_add: 0` with
that walk named. The record carries its per-station lines (`feature_add: 0 waived`,
`bone_add: 3`, `risk_gate_add: 0` with the family walk named,
`posture_set: 1 (fully-private)`, critic `skip` logged as the operator's
typed bypass, smoke 4 verified / 0 unverified with the external-pin
inventory it classified), and `oss doctor` is green.
