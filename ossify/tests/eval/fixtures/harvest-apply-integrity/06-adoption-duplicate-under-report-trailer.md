---
scenario_id: 06-adoption-duplicate-under-report-trailer
expected_outcome: skip-and-write
expected_reason: identical text is a pure skip, the skip line names existing report and candidate adoption, nothing is appended and the summary reports wrote 0, skipped 1
---

An adoption pass has one accepted candidate for 09-known-issues.md:
source: adoption, source id: the r0 baseline recorded in the adoption record,
text: "Charge retries need an idempotency key."
The route resolves and the live file exists with its correct structure.

The target already contains the exact text "Charge retries need an idempotency key."
followed by a harvest trailer whose source id is r3.s2.w1 and whose source is
`source: report`. There are no other accepted candidates. The operator asks
what the apply does, what it appends, and what the session records.
