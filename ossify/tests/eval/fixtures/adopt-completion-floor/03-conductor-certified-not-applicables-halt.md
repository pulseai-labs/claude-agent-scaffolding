---
scenario_id: 03-conductor-certified-not-applicables-halt
expected_outcome: halt
expected_reason: the record contract is the half of the floor this run breaks — C1 marked next/later steps and feature_list is empty (harvest still owed), and the not-applicables were self-certified by the conductor rather than operator-ruled on the record
---

A second cheap reading, closer to the PulseDB pilot. A0–A5 passed; C4
closed Release 0 retroactively, stub retrospective authored. The repo has six ADRs, all scanned and
minted as bones with status Accepted — six of the nine C3 categories are
covered. The conductor then answered the remaining three categories
("trust boundaries", "failure visibility", "rollback strategy")
`not-applicable` on its own judgment, never reading them back to the
operator; the draft record lists them with the reasons but no
operator-ruled attribution. C1's journey table marks two steps `next` and
four `later`, but `oss feature_list` prints `[]` — no harvest was minted.
The §4 posture station ran (`posture_set open-core`, posture bone minted).
The draft record has a baseline table and the gates list but no per-station
verb-call lines. `oss doctor` prints three `ok:` lines, and the conductor
is about to declare adoption complete.
