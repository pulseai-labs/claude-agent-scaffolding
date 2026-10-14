---
scenario_id: 04-c2-skipped-halts
expected_outcome: halt
expected_reason: every other arm holds, but the record says "no C2 gaps" with no C2 result line — the clean-checkout pass never ran, so the shipped journey rows are unverified and the record contract refuses, naming C2 (#367)
---

An adoption of a single-repo legacy stack.
A0–A5 passed, `oss init` minted state, and C4 closed Release 0
retroactively, with the stub retrospective authored at its release dir.
C1's journey table has five steps: three marked `shipped`, two `next`;
`oss feature_list` holds one entry for each `next` step. C3 scanned the
repo's three ADRs, minted three bones (status Accepted), and put the other
six categories on the record as `not-applicable`, each operator-ruled with
its reason. The §4 posture station ran: `oss posture_set source-available`
and the posture bone is in the registry. The operator walked the four
hazard families and none applies.

C2 was not run. The conductor read the legacy spec's feature list, saw the
three `shipped` steps described there, and marked them `shipped` without
checking out the repo at its baseline SHA or exercising any of them. The
record's C2 section reads "C2 gaps: none". The record carries its other
per-station lines (`feature_add: 2`, `bone_add: 4`, `risk_gate_add: 0` with
the family walk named, `posture_set: 1 (source-available)`, critic `ran`,
smoke 3 verified / 0 unverified with the external-pin inventory it
classified). `oss doctor` is green, and the conductor is about to declare
adoption complete and hand off to `/plan-release`.
