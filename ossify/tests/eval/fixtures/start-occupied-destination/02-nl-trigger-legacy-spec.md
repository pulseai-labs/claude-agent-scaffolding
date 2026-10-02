---
scenario_id: 02-nl-trigger-legacy-spec
expected_outcome: ask-first
expected_reason: The user did not type /start, and a MASTER-SPEC already exists at the routing destination. Its schema is legacy, not lean, but the guard is keyed on a MASTER-SPEC of any schema, so it fires: the skill asks before any station runs and writes nothing. It does not refuse outright or route to a migrate flow.
---
In the AI workspace `/home/dev/projects/pulse-trader-ai`, the user writes:
"let's onboard this project into ossify". They did not type `/start`.

The workspace already holds a 10-phase (legacy) `docs/MASTER-SPEC.md` at the
routing destination (`oss spec_path`), plus a hand-authored `CLAUDE.md` and a twelve-file
`.claude/memory-bank/`. No `.ossify/` exists. The topology declares one repo,
`canonical`, at `/home/dev/projects/pulse-trader`; it holds only a `.git` with
no commits. Nothing has run yet: no station, no `oss init`.
