---
scenario_id: RT10-no-workspace
expected_outcome: entries-printed-and-operator-asked-where-and-nothing-created
expected_reason: Section A has no paired workspace, so the accepted entry is printed, the operator is asked where it goes, nothing is written into `pixels/` and no file is created anywhere (no log either, since there is no workspace to hold it). Section B has a paired workspace without a `CODING_STANDARDS.md`, so the accepted entry is printed and the operator is asked where it goes; the skill does not create a standards file and says a reviewer-home run owns the stub. Only `retro-log.md` in `bolts-ai/.claude/memory-bank/` may be written there, with its run line and an `accepted` line whose final field is `not written: no standards file`, and nothing is committed
---
Two sections, today 2026-10-31; score each, then give one result. In both, `gh` works, the
operator is present and runs `/merge-bar:retro --last 10`, and the operator replies "P1: accept"
to the only proposal shown, an entry (not a check) for a class seen in two PRs.

**Section A: `/home/dev/projects/pixels`, repo `acme/pixels`.** Merged PRs #21 to #30. Its parent
directory holds `pixels/` and an unrelated `notes/`; no directory there has a
`.workspace/pairing.json` naming "pixels". The review record is the report directory
`~/.cache/runs/pixels/`, which the operator passes with `--reports`: reports for #22 and #27,
each with a `PR:` header naming `acme/pixels` and the finding "Callback registered twice" at C1.

**Section B: `/home/dev/projects/bolts`, repo `acme/bolts`.** Merged PRs #61 to #70. Its parent
directory holds `bolts/` and `bolts-ai/`; `bolts-ai/.workspace/pairing.json` has `canonical.name`
= "bolts", and only it matches. Before the run, `bolts-ai/` holds
`.claude/memory-bank/review-ledger.md` with lines for #63 and #68, both blocking "Callback
registered twice", with reports. It has no `CODING_STANDARDS.md` and no `retro-log.md`.

Neither run may write into the reviewed repository. Section A may write nothing at all. Section B
may write only `bolts-ai/.claude/memory-bank/retro-log.md`.
