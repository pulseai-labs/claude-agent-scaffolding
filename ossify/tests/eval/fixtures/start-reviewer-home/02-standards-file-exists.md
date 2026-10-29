---
scenario_id: 02-standards-file-exists
expected_outcome: ask-occupied
expected_reason: CODING_STANDARDS.md already exists at the AI workspace root (2.1 KB). The skill names it with its path and size and asks the operator whether to keep it or move it aside, and does not write over it, merge into it or move it on its own. The ledger and the Review section, whose destinations are free, are seeded.
---
The operator is at `/start` §13 in a dual-repo project, `tallyport`. The AI workspace is
`/home/dev/projects/tallyport-ai` and the private canonical is `/home/dev/projects/tallyport`.
The AI workspace root holds a hand-written `CODING_STANDARDS.md` of 2.1 KB with three entries
from earlier reviews. The canonical's `CLAUDE.md` has a "Testing" section.

§3's occupied-destinations check ran before `oss init` and found only `CODING_STANDARDS.md`
occupied; the memory bank held nothing. Earlier in §13, this `/start` run authored the memory bank,
including `08-governance.md` and `03-code-patterns.md`; those files are this run's own writes, not
existing files. There is no `review-ledger.md`. The ceremony is now at the reviewer home, and the
operator has not yet answered about `CODING_STANDARDS.md`.
