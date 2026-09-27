# Changelog

## 0.1.0

First release: herdr-crew 0.2.1's orchestrator/worker session model, ported onto Paseo 0.9.2.

- Seats are Paseo profiles, read with `list_profiles`; `.paseo-crew/roles.md` maps roles to them. An optional `~/.claude/paseo-crew/agents.md` holds `kind: dsh-spine-driver` entries only.
- Workers are Paseo subagents launched with `create_agent`; the model is checked with `paseo inspect` and by the worker's own report.
- A worker's report file is its finish. One background wait per dispatch returns on the report or on an attention state (pending permission, idle past a settle window, error, time budget); a heartbeat re-arms a lost wait; Paseo's one-shot finish notice is a hint only.
- A handoff launches its successor detached (`env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD paseo run -d`) and verifies it has no parent; a predecessor is never archived while its seats run.
- Carried from herdr-crew: roles, briefs (plus `TIME_BUDGET` and `SETTLE_WINDOW`), the thirteen-step run, the ossify contracts, `dsh-driver.md` verbatim, the context-ceiling hook gated on `PASEO_AGENT_ID`.
