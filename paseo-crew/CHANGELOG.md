# Changelog

## 0.1.3

The 0.1.2 delta's own loose ends, found by review and by the pilot (#622, #629, #609).

The report exit no longer treats a stale or in-progress file as the dispatch's final one (#622). It
fires only once the seat that wrote the file has settled — `idle`, `error` or `closed` — so a worker
that reports and then keeps working is not finished, and the handling reads the body against the
dispatch it was sent before acting on it, so an earlier dispatch's body gets the missing-report
correction rather than a handling. Teardown's account of a first-write exit and of the
`SETTLE_WINDOW` wait around it is deleted, the condition it worked around having moved into the exit.

A seat that fails its model check is cancelled and reported to the operator, never archived (#629,
J2 and J3). It may already have started children, and the archive cascades into them, so the site no
longer routes its release through a no-longer-working precondition whose wait would be a report and
a `SETTLE_WINDOW` that a launch failure never has. Step 12's release routes to Teardown's
settled-status gate and the operator's tab confirmation, as steps 3 and 6 already do (D2), and the
nested-run reference no longer scopes the spine session's own teardown as "the pairs and any
workspace they used": a coordinator seat archives no workspace and lists the ones it leaves (D1).

The handoff's successor launch passes `--thinking <thinkingOptionId>` whenever the materialised
profile sets one — a requirement, not a comment a launch copying the command line drops (D6).

The implementer is released when its retention ends, which `roles.md` owns, not at every item's
step-12 merge (#609) — an ordinary run with consecutive work items no longer archives the seat the
next item is dispatched to.

The `ossify-spine-execution` eval keys agree with the current contract: fixture 02's key has the
spine session releasing its pairs and listing the workspaces it leaves, fixture 12's key cancels the
mismatched seat and lists archiving it among the wrong answers, and the rubric's teardown line says
the same (D3-D5).

## 0.1.2

Three gaps the 0.1.0 pilot found, all of them in what the run does to a seat rather than in the
seats themselves (#620, #621).

The seat launch no longer says a profile with no `modeId` "passes none" (#621). Paseo refuses a
launch with no mode when the caller's mode is not one the target provider offers, and modes are
provider-specific, so there is nothing to pass and nothing to inherit. A profile with no `modeId` is
now the same kind of gap as a profile with no `model`: the launch reads the provider's mode ids
(`inspect_provider` carries them as `{id, label}` pairs, and the refusal itself lists them) and halts,
naming the profile to fix and listing them. It never picks a mode
the operator did not — the handoff's successor materialisation carries the gap too, and the
command's `allowed-tools` gains `mcp__paseo__inspect_provider` for the read.

Teardown now waits for the seat to stop working (#620). A seat's `report` exit fires on its first
write, so a seat that woke the waiter may still be running — the pilot's verifier was archived
mid-rewrite — and a release reads `paseo inspect <id> --json` and requires `idle`, `error` or
`closed` after the report rather than the report alone: a seat that escalated on `error` or was
cancelled on `closed` never reaches `idle`, and one still working past the dispatch's
`SETTLE_WINDOW` is escalated to the operator, whose call the cancel is.

Before `archive_workspace` removes a run-created worktree, Teardown names the operator every seat in
that workspace by its title and agent id, asks for those tabs to be closed in any connected client
app, and archives only on the operator's confirmation (#620). That archive removes the cwd out from
under a client that still holds a tab on the agent, and such a client keeps asking the daemon to
resume it. That is why the minimum daemon is now 0.10.2, checked as an orient precondition
(`lifecycle.md` step 1) — 0.9.2 crash-loops on exactly that resume, where 0.10.2 logs and keeps
running.

## 0.1.1

The `context_ceiling` setting and the hook now agree on what a valid one is (#611). The manifest's
option schema says `type: number`, but the hook accepted a string of decimal digits alone and
silently replaced anything else with the 500000 default — so a value written `100000.5`, or the
exponent form a number past 1e21 renders as, never warned at the threshold the operator chose.

The hook now decides the setting in `jq`, whose number parser the rest of it already trusts: a JSON
number of 1 or more is the ceiling, a spelling that is not a JSON number and any value below the
schema's `min: 1` are the default the option's description names, and the comparison is `jq`'s too,
so a fractional ceiling takes effect at the next whole token rather than being floored (100000.5
fires at 100001). The accepted spelling is stated in the hook rather than left to the installed
`jq`, which is more permissive than the schema and is not the same in every build.

Where `jq` cannot run at all — no `jq` on `PATH`, or a `jq` that fails — nothing was compared, and
the notice names the setting itself when every character of it is one a number may carry, no ceiling
at all when it is not, and never the 500000 default, which is a ceiling the operator did not set.

## 0.1.0

First release: herdr-crew 0.2.1's orchestrator/worker session model, ported onto Paseo 0.9.2.

- Seats are Paseo profiles, read with `list_profiles`; `.paseo-crew/roles.md` maps roles to them. An optional `~/.claude/paseo-crew/agents.md` holds `kind: dsh-spine-driver` entries only.
- Workers are Paseo subagents launched with `create_agent`; the model is checked with `paseo inspect` and by the worker's own report.
- A worker's report file is its finish. One background wait per dispatch returns on the report or on an attention state (pending permission, idle past a settle window, error, time budget); a heartbeat re-arms a lost wait; Paseo's one-shot finish notice is a hint only.
- A handoff stands the predecessor down first (its waits killed, its heartbeat deleted), then launches its successor detached (`env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD paseo run -d`) and verifies it started with no parent; a failed successor is cancelled, never archived, and reported to the operator, the predecessor re-arms and stays the orchestrator, and a predecessor is never archived while its seats run.
- Carried from herdr-crew: roles, briefs (plus `TIME_BUDGET` and `SETTLE_WINDOW`), the thirteen-step run, the ossify contracts, `dsh-driver.md` verbatim, the context-ceiling hook gated on `PASEO_AGENT_ID`.
