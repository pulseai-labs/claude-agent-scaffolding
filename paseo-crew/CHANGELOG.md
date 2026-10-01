# Changelog

## 0.1.1

The `context_ceiling` setting and the hook now agree on what a valid one is (#611). The manifest's
option schema says `type: number`, but the hook accepted a string of decimal digits alone and
silently replaced anything else with the 500000 default — so a value written `100000.5`, or the
exponent form a number past 1e21 renders as, never warned at the threshold the operator chose. The
hook now reads the setting through jq's own number parser, which is the parser the rest of the hook
already trusts: any number of 1 or more is the ceiling, a spelling that is not a number and any
value below the schema's `min: 1` are the default the option's description names, and the
comparison is jq's, so a fractional ceiling takes effect at the next whole token (100000.5 fires at
100001) and an exponent form is compared rather than dropped. The notice quotes the number in force
in jq's own rendering rather than the raw setting.

## 0.1.0

First release: herdr-crew 0.2.1's orchestrator/worker session model, ported onto Paseo 0.9.2.

- Seats are Paseo profiles, read with `list_profiles`; `.paseo-crew/roles.md` maps roles to them. An optional `~/.claude/paseo-crew/agents.md` holds `kind: dsh-spine-driver` entries only.
- Workers are Paseo subagents launched with `create_agent`; the model is checked with `paseo inspect` and by the worker's own report.
- A worker's report file is its finish. One background wait per dispatch returns on the report or on an attention state (pending permission, idle past a settle window, error, time budget); a heartbeat re-arms a lost wait; Paseo's one-shot finish notice is a hint only.
- A handoff stands the predecessor down first (its waits killed, its heartbeat deleted), then launches its successor detached (`env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD paseo run -d`) and verifies it started with no parent; a failed successor is cancelled, never archived, and reported to the operator, the predecessor re-arms and stays the orchestrator, and a predecessor is never archived while its seats run.
- Carried from herdr-crew: roles, briefs (plus `TIME_BUDGET` and `SETTLE_WINDOW`), the thirteen-step run, the ossify contracts, `dsh-driver.md` verbatim, the context-ceiling hook gated on `PASEO_AGENT_ID`.
