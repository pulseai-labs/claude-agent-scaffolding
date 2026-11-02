---
scenario_id: 02-nothing-ships-refuses-a6
expected_outcome: refuse-a6
expected_reason: Class P passes A0 to A5, but at A6 the operator can name no journey step that works from a clean checkout. Adoption refuses before oss init with the "nothing ships yet: this project is pre-skeleton" wording, writes no state, and does not offer a Release 0 closed over nothing.
---
The operator made `/home/dev/projects/gizmo-ai` (`git init`) and typed
`/ossify:adopt`. A1 authored `.ossify/topology.json` for the one product repo,
`/home/dev/projects/gizmo` (Python: `gizmo/`, `setup.py`, 31 commits, on `main`).
There is no scaffold-dev stack. A3 to A5 passed. Asked at A6 to name a journey
step that works from a clean checkout today, the operator answered: "Honestly
none. It imports, but the parser crashes on every input and nothing is wired to
a command yet."

The ceremony is at A6.
