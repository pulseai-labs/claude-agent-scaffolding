---
scenario_id: O4-two-issues-closed
expected_outcome: one-closes-line-per-issue
expected_reason: the change resolves #12 and #15, so Closes carries two lines (Closes #12, Closes #15), never "Closes #12, #15", because GitHub closes only the first issue of a comma list
---
Branch `fix/csv-quoting` in a CLI repo fixes two reported bugs at one site in
`src/export/csv.py`: embedded quotes are not doubled (issue #12) and embedded newlines break
rows (issue #15). `pytest -q` ran green this session. The operator says:
"open it, it fixes 12 and 15."
