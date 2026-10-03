# Paseo mechanics

## What this file is for

Paseo's bundled `paseo` skill, the MCP tool descriptions and `paseo <cmd> --help` are the
command reference. This file states only what they cannot: how paseo-crew composes those
calls into a seat, a finish, a send, a release and a handoff. Role, retention and run
decisions stay in `roles.md`, `lifecycle.md` and `config.md`. Where this file overrides
Paseo's own guidance it says so, and three overrides run through it: Paseo's `paseo-handoff`
skill, whose successor is a subagent (Handoff), and its "don't poll" and "the notification
will tell you" advice, since the notice is one-shot (Completion). Read every id from the
response that made it, never from a list or a guess.

## The seat launch

A seat is a Paseo profile, resolved from `list_profiles` as `config.md` states, and
materialised into one `create_agent` call as Paseo's skill maps it: `provider` + `model` →
`provider: "<provider>/<model>"`, `modeId` → `settings.modeId`, `thinkingOptionId` →
`settings.thinkingOptionId`, `featureValues` → `settings.features`. Two gaps in that map:

- **A profile with no `model`.** `create_agent` rejects a bare provider string. The launch
  reads that provider's default model id from `list_models` and materialises
  `<provider>/<default id>`. If no default can be read, the launch halts and names the
  profile to fix (add `model`). Never a guessed id.
- **A profile with no `modeId`.** It is a launch gap, never a mode to omit: Paseo refuses a
  launch with no mode when the caller's mode is not one the target provider offers, and
  modes are provider-specific — they do not carry across providers. Handle it as the
  no-`model` gap: `inspect_provider` carries the provider's modes as `{id, label}` pairs,
  and the refusal lists them too; read the ids there, then halt naming the profile to fix
  (add `modeId`), listing them.

**The expected model** is the id the launch materialised (the profile's `model`, or that
default id), matched exactly by step 3's `inspect` check. A brief's `SEAT_EXPECTED_MODEL`
(`SPINE_EXPECTED_MODEL` in the spine brief) and the worker's own check carry only its model
segment, never Paseo's encoded string, which no worker can be expected to echo:
`deepseek-v4.1-flash` of `m:custom_provider%3Aopencode-go:deepseek-v4.1-flash:v:thinking`.

`<seat label>` is `seat: <role> (<profile id>)`. The launch is four steps:

1. **Placement.** A seat that works in the orchestrator's tree runs in the orchestrator's
   workspace: omit `workspaceId`. A seat that needs its own worktree gets a workspace from
   `create_workspace` with `isolation: "worktree"`, `path: <the source repo>` and the mode
   its PLACEMENT needs: `branch-off` with `branchName` and an explicit `baseBranch` — the
   placement's own base ref, `origin/main` unless the run names another, never an implied
   base (Paseo's ref rule); `checkout-branch` with `branch` for one that works an existing
   branch; `checkout-pr` with `prNumber` for one that works a PR's head — the reviewer's
   step-8 worktree. A seat in an
   existing tree gets `isolation: "local"` with that `path`. In the dual-repo case an
   implementer in a canonical worktree is a `worktree` workspace whose `path` is the
   canonical checkout.
2. **Create.** `create_agent` with `title: "<seat label>"`, the materialised profile,
   `workspaceId` where step 1 made one, `labels: {"paseo-crew.run": "<run id>",
   "paseo-crew.role": "<role>"}`, `notifyOnFinish: true` (a hint only, per Completion), and
   the brief as `initialPrompt`. There is no readiness wait: the agent returned has already
   taken its brief, and there is no TUI to wait on. The seat is the caller's subagent, drawn
   in Paseo's subagent track.
3. **Model check.** `paseo inspect <id> --json`: `Model` must equal the expected model's full
   id. A mismatch is a failed launch: the seat took its brief as `initialPrompt` and may
   already have written, so read its activity and reconcile anything it touched — never adopt
   its artifacts — then `cancel_agent` it and report it to the operator, as Handoff's
   failed-successor rule directs: never archived here, and its release is the operator's.
   The brief's "state your model in your first reply" is the second check, against the
   model segment, and the one that catches a lane whose provider silently reroutes, because
   `inspect` reports what Paseo asked for, not what answered.
4. **Note the pair and arm the wait**, as Completion states.

The orchestrator never runs `paseo run` for a worker. That command arms no finish notice,
and from inside an agent it still makes the new agent the caller's child. Its one use is the
successor launch in Handoff.

## Completion

A seat's result is its report file, at the `REPORT_PATH=` its brief names. Every file the run
keeps is placed outside every seat's worktree, so archiving a workspace never takes one.
`Status` carries no body, so the file is the contract; the exit table below says when a
change to it is a report.
The worker writes everything it says to the orchestrator there (a plan, a question, an
escalation, a late finding, its report) and replaces the file whole (`briefs.md`). The noted
pair is the file's hash (`git hash-object <path>`, empty if absent) and its identity — the
inode, which a replacement always changes: writing a temp file and renaming it over the path
mints a new one. Never `mtime` alone: an atomic replacement inside the filesystem's timestamp
granularity can hold both the old hash and the old `mtime`.
Both are compared, not merely recorded, so a byte-identical replacement (a retained verifier
repeating the same failure, a blocker restated after a clarification) still wakes the wait:
same hash, new identity.
The pair is re-taken when the handler has read the body at `REPORT_PATH` — a report or plan
handled, a question answered, an `error` reconciliation — and kept when it has not: a
permission answer, the budget grace's status request, an idle false-wake re-arm, a lost wait
or a handoff, so a read body cannot be the next `report` and a pending body is not hidden.

**The wait** is one background shell call (Claude Code: the Bash tool's `run_in_background`)
that polls inside itself and returns once, with one exit reason. The orchestrator writes it
per dispatch; it is not shipped code. A round's N items are N such waits, one per seat: each
is one call over a different seat and none is restarted after it exits, so this is not the
loop of waits `lifecycle.md` forbids. `paseo wait` is not used: it returns on the seat's first
idle, which a seat running background work of its own reaches long before it finishes.

| Exit | Condition, checked on every poll |
|---|---|
| `report` | `REPORT_PATH`'s hash **or** identity differs from the noted pair, and `Status` is `idle` — `error` and `closed` settle at the `error` exit, and a body written by a seat that still runs is not yet a report |
| `permission` | `PendingPermissions` in `paseo inspect <id> --json` is non-empty |
| `error` | `Status` is `error` or `closed` — taken at once, except by a wait armed while the seat was already at `error`: that one takes it only once it has seen the seat leave `error` |
| `idle` | `Status` has been `idle` without a break, timed by the loop from when it first saw it, for longer than the brief's `SETTLE_WINDOW`, and no report has arrived |
| `budget` | time since the dispatch's `DISPATCHED_AT` exceeds the brief's `TIME_BUDGET` |

`Status` takes `initializing`, `idle`, `running`, `error` or `closed`; any other value is a
Paseo change, reported to the operator rather than guessed at. One illustrative shape, which
the orchestrator adapts and does not copy:

```
# one background call per dispatch; returns once with the exit reason
while :; do
  s=$(paseo inspect <id> --json)
  <.Status is error or closed, per the `error` row>    && { echo error; break; }
  <report changed and Status is idle>                  && { echo report; break; }
  <.PendingPermissions non-empty>                      && { echo permission; break; }
  <idle continuously > SETTLE_WINDOW, unless dropped>  && { echo idle; break; }
  <now - DISPATCHED_AT > TIME_BUDGET>                  && { echo budget; break; }
  sleep 30
done
```

**Handling each exit.**

- `report`: read it against this dispatch — the round, head SHA or task it was sent — before
  acting on it: a body that is an earlier dispatch's is not this dispatch's report, and gets
  the missing-report correction below. A plan, a question or a late finding gets the seat's
  next message and one fresh wait. An escalation goes to the operator.
- `permission`: read the request with `list_pending_permissions`. Within the brief's scope,
  allow it with `respond_to_permission` and arm one fresh wait, keeping `DISPATCHED_AT`;
  otherwise put it to the operator, give the answer the same way, and arm one fresh wait —
  that answer restarts `DISPATCHED_AT`; the pair is kept either way (`Completion`).
- `idle`: read the seat's last message (`get_agent_activity`, limit 1). A question the brief
  answers is answered, with one fresh wait; one it does not answer goes to the operator. A
  seat that says it is waiting on its own background work is a false wake, not a finish: arm
  one fresh wait with the `idle` exit dropped for the rest of that dispatch, the pair kept
  (`Completion`), so `report`, `permission`, `error` and `budget` remain — but a reviewer's
  first idle with no report takes one bounded request, to consolidate the review's returned
  candidates into `REPORT_PATH`, before that same drop (its fork returns before its finders
  do). An idle whose last message is neither — a completion written only to its activity, or
  no message at all — is the missing-report case: one bounded correction request asking it to
  write `REPORT_PATH`, and one fresh wait; a second such idle escalates.
  Coordinator seats — Teardown's coordinator clause names them — are armed that way from the
  start, because their idle is not a finish.
- `error`: read its activity, its pending permissions, its durable artifacts and its `REPORT_PATH`
  first — a pending request is answered as the `permission` handler directs, before the route
  sends — `error` does not say that nothing landed, and a changed body there is evidence for this
  reconciliation, never a `report`. A dispatch that may have mutated anything (a commit, a push,
  a PR, a close) is never replayed: send a recovery instruction that names what already exists,
  or escalate. Only a dispatch that cannot have mutated is re-sent once on the same seat, one
  fresh wait, the pair re-taken over the body read above (`Completion`; the guard is the `error`
  row's); a second `error` escalates. On `closed` the seat is gone: escalate, with no retry.
- `budget`: send one status request and arm one wait whose budget is a short grace, counted
  from that request, the pair kept (`Completion`). If the grace expires with no report,
  `cancel_agent`, record the seat's last message, and escalate. A timeout is a checkpoint,
  never a silent re-arm: more time is the operator's decision.

**The finish notice is a hint.** When `<paseo-system>Agent X finished …</paseo-system>`
arrives, check that seat's report file. A change that meets the `report` exit above is
handled as `report`, once, by whichever of the notice, the heartbeat and the wait reaches
it first, and that handler kills the dispatch's still-armed wait before arming the next: no
seat ever has two waiters. Otherwise, do nothing: the wait is still armed. Paseo sends the
notice once, on the seat's first idle after running, and loses it on a daemon restart, so it
is never the only thing that can wake the run.

**The heartbeat backstop.** While any dispatch is live, the orchestrator holds exactly one
heartbeat, made with `create_heartbeat` (`cron` default `*/15 * * * *`, `expiresIn` at least
the latest budget end among live dispatches, `DISPATCHED_AT` plus `TIME_BUDGET`, plus one
cron interval and the `budget` exit's grace). Its prompt tells the session to check each live
dispatch's report file and whether that dispatch's background wait is still running. A change is
read only as the `report` exit above allows, once, by the finish notice's rule. A wait that is
gone without having exited (a session or daemon restart, host sleep) is re-armed, once per
loss, and the re-arm is recorded. Otherwise the heartbeat's turn does nothing. A heartbeat
cannot be updated, so replacing it is tied to arming: whenever a wait is armed that the
heartbeat's expiry does not cover by that rule, replace the heartbeat, `delete_heartbeat`
first and then a new one. When the last dispatch settles, the orchestrator calls `delete_heartbeat`.

`TIME_BUDGET` and `SETTLE_WINDOW` (default 10 minutes) are brief fields (`briefs.md`), stated
at dispatch. A dispatch's elapsed time runs from its start, recorded as `DISPATCHED_AT`: the
brief's send, and again whenever a wait on the orchestrator or the operator resolves — a send
that follows it (a plan approval, an answer, a fix task) or a permission answer that reached
the operator — because that wait is not the worker's time. An involuntary re-arm, after a
heartbeat catch, a handoff, a lost wait or an `error` retry, keeps that start, so a re-arm
never silently extends the budget.

## Sending a seat a message

This is the one statement of how the orchestrator sends a seat anything after its brief (a
fix task, an answer, a plan approval, a correction); other files say "send" and mean this.
`send_agent_prompt` with `background: true` and `notifyOnFinish: true`. The text arrives
whole, so nothing fragments it and no pointer file is needed. Note the pair first
(`Completion`), then arm one fresh wait. There is no turn-start check: a send that never
opened a turn surfaces as `idle` with no report. A seat with a pending permission is answered
with `respond_to_permission` before anything else is sent to it.

**The `/context` probe.** At a task boundary, a seat whose `can:` includes slash commands is
sent `/context` with `send_agent_prompt` and `background: false`, the one exception to the
send rule above (the form Probe P4 passed in), with no wait armed, and its one reply is read
with `get_agent_activity`. The token figure in that reply is the reading. `LastUsage` in
`paseo inspect` is not one: its token fields read zero after a real turn. A seat that cannot
answer the probe rotates at its item boundary (`roles.md`).

## Placement

The orchestrator stays in the agent the operator launched it in, and paseo-crew never moves
it. Seats are its subagents, in its own workspace or in a workspace the run created for a
worktree (The seat launch, step 1). Paseo draws that grouping and gives each agent its own
tab, so there is no layout rule to state. A seat's tree is its workspace's `path`, so in the
dual-repo case a seat may sit in the canonical repository while the orchestrator stays in
the AI workspace.

Every seat runs on the daemon the orchestrator talks to; cross-machine seats are out of scope.

## Teardown

A seat is released with `archive_agent` once its artifacts are safe and it is no longer
working — `paseo inspect <id> --json` reads `idle`, `error` or `closed`, never `running` or
`initializing`: the implementer when its retention ends (`roles.md`), the reviewer once the
review is final (step 8), the verifier at pass or escalation.
Only the session that holds the operator archives a run-created workspace with `archive_workspace`,
once every seat in it is archived — Paseo then removes the worktree, once no active workspace
references it. A client tab on it is the daemon's to handle (`lifecycle.md` step 1 sets the floor).
A coordinator seat (a spine or work-PR session, a lane driver with subagents) holds no operator
channel: it archives its own seats as above, and lists in its report every run-created workspace
it leaves — id, path, and each seat's title and agent id — for the top to archive.
Close only what the run created: the orchestrator's own workspace, and any the operator
opened, are never archived by the run.

**The cascade.** Archiving an agent archives its same-workspace children that have no open
tab and detaches the rest, recursively. So Teardown's coordinator seat is archived only
after it reports its own children released, never for its item seats. A predecessor
orchestrator is Handoff's case.

Read every receipt, and confirm with `list_agents` / `list_workspaces`, never assume: an
archive may take more than its target, and one that finds its target already gone is
information, not failure.

## Handoff

The orchestrator's own rotation keeps its boundary: a fully acknowledged delivery with no
operator question in flight. Paseo's `paseo-handoff` skill is not used, because it makes the
successor a subagent of the session about to stand down. Write the handoff (`/ossify:handoff`
with ossify installed, the same file by hand without), recording every live seat's agent id,
`REPORT_PATH`, noted hash and identity, `DISPATCHED_AT`, `TIME_BUDGET` and `SETTLE_WINDOW`.
Then, in this order, so that no seat ever has two waiters and one report wakes one
orchestrator:

0. **Materialise the successor's profile first** — The seat launch's two gaps included — so
   that a halt there leaves this session the orchestrator with nothing stood down.
1. **Stand down.** Kill this session's armed background waits and `delete_heartbeat`,
   and take no further dispatch action. From here every wake (a child seat's finish notice,
   a heartbeat turn that raced the deletion, a wait that fires anyway) is read and handed on,
   never acted on, unless step 3's failure branch re-arms. The gap loses nothing: reports
   persist on disk, and a re-armed wait compares against the pair the handoff noted, so a
   report written in the gap wakes it at once.
2. **Launch the successor detached**, from this session's own profile, materialised as The
   seat launch states and already resolved in step 0 — so `--mode` is always passed, from
   the profile's `modeId`, and `--thinking <thinkingOptionId>` whenever that materialised
   profile sets one — the bracketed placeholder below, dropped for a profile that sets
   none. Its launch prompt, `<resume>`, is `/ossify:handoff-resume <path>` with ossify
   installed, and the handoff path as its first instruction without; it takes no second
   resume message:

       env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD paseo run -d --json --title "<run>: orchestrator" --workspace <current> --provider <provider>/<model> --mode <modeId> [--thinking <thinkingOptionId>] "<resume>"

   Both variables are unset because `paseo run` inside an agent reads its caller from them
   and makes the new agent that caller's child. `paseo run` takes no feature values, so a
   profile that sets them hands on without them: the handoff names every such value as the
   loss it is, and the trade is the operator's — The seat launch materialises them, but it
   parents the successor to this session.
3. **Verify** that the launch returned an agent id, then with `paseo inspect <new id> --json`
   that `Status` is `idle` or `running` — an `initializing` launch is polled until it settles,
   bounded — and `ParentAgentId` is `null` (a non-null parent is a tree, its successor already
   resuming). A launch that settles on `error` or `closed`, is still `initializing` when the
   bound expires, or returns no agent id is a failure.
   **A failed successor is cancelled with `cancel_agent`, never archived** — the archive
   cascades into anything it started. This session re-arms its own waits and a fresh heartbeat
   from the handoff it just wrote, stays the orchestrator, and reports the failed successor's
   agent id to the operator, who decides what to do with it and anything it started.
4. **On success**, tell the operator which agent is now the orchestrator.
   Never archive a predecessor while a subagent in its workspace runs: the successor shares the
   workspace, every live seat is still this session's child, and the cascade would take them.
   This session stays unarchived until the run's inherited seats are gone; the operator
   archives it then. The successor re-arms one wait per live dispatch the handoff lists, each
   keeping its `DISPATCHED_AT`, plus a fresh heartbeat.

A spine or work-PR session's rotation (`rotate:` / `open:` returns) keeps its shape. Its
parent launches the successor as an ordinary subagent through The seat launch, not
detached, because the parent is alive and is the one that waits; the old session is
released as Teardown's coordinator rule states.
