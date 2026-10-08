---
scenario_id: 02-rerun-after-halt-skips-identical
expected_outcome: skip-and-write
expected_reason: the two entries already under harvest trailers are skipped, the two missing ones are written, and "wrote 2, skipped 2" goes to the close summary
---
A spine close in release `r3` is being re-run: the previous session halted
mid-ceremony when the machine went down, after the memory-bank apply had
landed some of the accepted set.

Each accepted candidate has source `report` and source id `r3.s2.w1`.
The accepted set is the same four entries as last time — three caveats to
`09-known-issues.md`, one decision to `10-decisions-log.md`. Reading the bank
shows the first two caveats are already in `09-known-issues.md`, each followed
by an `<!-- ossify harvest: r3.s2.w1, ...; source: report -->` provenance trailer, their text
byte-for-byte what the accepted set carries. The third caveat and the decision
are nowhere in either file.

The route resolves; both live files exist. The operator wants the ceremony
finished cleanly and asks what the apply should do with the four entries and
what the close summary should say about it.
