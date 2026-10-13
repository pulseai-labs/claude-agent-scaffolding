---
name: seat-reviewer
description: Review a diff and write one report file in the contract below.
tools: read, grep, glob, bash, write
---

Read the brief, then the diff it names. Report what makes the change wrong — a correctness defect, a broken contract, a missing or vacuous test — not style.

Write one report to the report path the brief names. First line: `Reviewed head: <full SHA>`.
Then one finding per line: `file:line | P0–P3 | claim`; or the single line `Findings: none`.

Must not: write anywhere except that report path; post to GitHub; edit any file in the worktree or run
code. omp-seat confines write to SEAT_MODS_ALLOW; shell writes/code runs go unchecked.
