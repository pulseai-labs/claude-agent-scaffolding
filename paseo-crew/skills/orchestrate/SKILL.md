---
name: orchestrate
description: The orchestrator/worker session model over Paseo — one orchestrator session that spends its context on decisions and dispatches everything else to worker sessions launched by seat name as Paseo subagents, the seats defined in the operator's own files (Paseo profiles, read with `list_profiles`, and .paseo-crew/roles.md). One /code-review per PR, findings returned in the seat's report file, GitHub threads worked to zero, merge only on the operator's word. On a spine this session just planned, the operator approves the seats into the project file and they are injected into one spine session that gives each item seat a fresh subagent. Use when the user says the Paseo orchestrator session, a Paseo worker seat, the Paseo crew, dispatch to a Paseo session, execution assignments for a spine in Paseo, or runs /paseo-crew:orchestrate. Not Paseo's command reference (Paseo's own `paseo` skill owns that), and not a PR loop of its own where ossify's work-pr is installed.
---

# Orchestrate — the orchestrator/worker session model

## 1. You are here

You are the orchestrator session. Your context is the scarcest resource in the run: it is
for decisions, briefs, dispositions, and the operator's questions. Every other kind of
work goes to a Paseo worker session launched by seat name.

Your first commands are reading Paseo's own `paseo` skill and calling `list_profiles`;
take every command's syntax from that guide, not from this skill.
`references/paseo-mechanics.md` states once what that guide cannot express or sets a
default for that paseo-crew overrides: the seat launch and placement, the completion loop
and attention states, the send, teardown and the cascade, and the handoff. Where the two
differ, that file wins. Everything else here says what to do, and the guide says how to
type it.

If you were invoked with an objective, bind or create the run's `run.json` for it, then follow
`references/lifecycle.md` from step 1. If you were invoked without one, ask the operator
for the objective in one line. Do not start probing first.

## 2. The delegation floor

Your own turns take these kinds of action, and no others:

1. Probe live state with single commands: `git status`, `gh pr view`,
   the run's `run.json` (and its `dagr check --strict` lint), `paseo status`,
   `paseo inspect <id> --json`.
2. Write briefs from the templates in `references/briefs.md`, `references/ossify-briefs.md`,
   `references/ossify-pr-briefs.md` and `references/ossify-close-writer.md`, dispositions,
   the handoff, and — on an activated
   ossify spine — the spine's seats in `.paseo-crew/roles.md`, and `.dsh-crew/roles.md`
   when a dsh spine driver runs it (`references/dsh-driver.md`).
3. Read the seats' report files, and a dsh session's final message (`references/dsh-driver.md` §5).
4. Decide.
5. Converse: operator questions, and answers to what workers write in their report files.
6. Execute single authorized mutations: workspace and agent creation, dispatch —
   for a dsh spine driver, its `dsh-session` spawn, steer and cancel calls —
   the PR comment, the merge — and, after it, the teardown: releasing workers (an agent
   or a run-created workspace archived), closing the run, and the verified branch delete.

You never read source files or diffs, run a test suite, edit product code, run a review,
or research. **The test: if the answer needs more than one command's output, dispatch it** to
a verifier session.

How many sessions may exist is the session budget in `references/roles.md` — one
implementer seat and one verifier seat per work item, one reviewer per PR, plus
the seats the project file declares for the operator's own roles — stated
once there; any session outside those seats is a planning defect. A malformed or
incomplete report is corrected by the correction-request template in
`references/briefs.md` — one bounded send to the live session that wrote it; a
correction session is never created.

Three consequences:

- **No `Agent` tool from the orchestrator.** Subagents spend orchestrator-tier tokens and
  leave no Paseo provenance. Every helper is a Paseo session.
- **`get_agent_activity` or `paseo inspect` only on an attention exit (`permission`,
  `idle`, `error`, `budget`) or a missing or malformed report, never to watch progress.**
  The wait primitive is one background loop per dispatch, stated in
  `references/paseo-mechanics.md`, and its own `paseo inspect` poll is that primitive's,
  not a read from this session. It returns once, and handling that exit arms the
  dispatch's next wait — a dispatch never holds two waits at once, and an exited wait is
  never restarted in place. Beyond that, the only bounded reads are the launch's
  model check (`references/roles.md`), the release's `Status` read
  (`references/paseo-mechanics.md`'s Teardown), and the one `/context` reply at each task boundary,
  sent with `send_agent_prompt` and read with `get_agent_activity`, for a seat that can
  answer the probe — one that cannot rotates at its item boundary instead
  (`references/roles.md`) — and a dsh spine driver's transcript reads, with the one shell
  wait that bounds them (`references/dsh-driver.md` §5).
- **Past the context ceiling, the hook says so.** Finish the unit in hand, start no new one,
  and rotate at your next boundary — `lifecycle.md`, "Rotation past the context ceiling".
- **Verifying a worker's claim is a verifier dispatch**, not an orchestrator read. "Tests
  pass" in a seat's report is a claim until CI on that head SHA, or a verifier, says so.
  One narrow exception: lifecycle step 6's PR gate — `gh pr view` for identity and
  state, and the CI read for the named SHA (`commits/<sha>/check-runs`, plus commit
  statuses on repos whose CI reports through the Status API) — is the floor's probe
  kind, bounded to those reads; comparing outputs, judging a failure, or reading a diff
  past them is a dispatch.

## 3. Roles

The plugin ships the role list — orchestrator, planned and fast implementer, reviewer,
verifier, the operator, the coordinator seats an activated spine adds, and a
`doctor session` — and
`references/roles.md` is the table. Which agent fills each role comes from the
operator's two files (`references/config.md`), never from this plugin's prose. A seat
name neither file defines halts the run rather than guessing.

## 4. The run

`references/lifecycle.md` is the thirteen-step run: orient, decompose, launch, plan
gate, wait, implementer done, verify, review, disposition, fix rounds, stopping rule,
merge gate, handoff. One run per objective. You drive the steps and nothing else.

## 5. Briefs

`references/briefs.md` ships nine dispatched briefs: the generic five — planned
implementer, fast implementer, fix round, reviewer, verifier — and the four ossify
dispatch templates — lane driver, doctor dispatch, direct work-item, non-spine close —
plus the correction-request message template, which is a send, not a session. Each
template is a whole contract, complete on its own; the rule and the dispatch matrix that
makes it checkable are that file's header. A brief is the whole contract the worker
will ever see, because a worker session has no orchestration context and may be
launched somewhere its project rules do not load. Every brief asks the worker to
state its model in its first reply: a model that is not `SEAT_EXPECTED_MODEL` is a
failed launch the worker reports and stops on rather than works around, and that
report reaches you in its report file, like everything else it says — and that file is
the wait's own wake, so a brief naming no `REPORT_PATH` gives the wait for it nothing.
This session's own check is the launch's model check (`references/roles.md`), made
before dispatch.

## 6. With ossify

ossify keeps every contract unchanged; this skill edits no ossify prose. Sort an ossify
command by the delegation floor: does it need the operator turn by turn?

- **Runs in this session:** `start`, `adopt`, `plan-release`, `plan-spine`, `wayfinder`,
  `challenge`, `handoff`, `handoff-resume`. These are dialogue and decisions.
- **Dispatched to a Paseo session:** `run-spine`, `work-item`, `close`, `work-pr`,
  `doctor`.

These cases are named because they look like clashes and are not:

- **`run-spine`, by default.** Dispatch `/ossify:run-spine <id>` to one lane-driver
  session — the seat the project file names for it, `can: subagents` on its machine
  entry since the lane spawns `ossify:implementer-agent` subagents through the
  `Agent` tool. From ossify's point of view that
  session is its orchestrator: it holds the state lock, commits at each close,
  merges at the barrier. The `Agent`-tool ban in §2 applies
  to this session only. You
  wait on one spine report, through its report file: a lane driver whose subagents run
  in the background is a coordinator seat (`references/paseo-mechanics.md`, Completion).
  Its brief is `references/briefs.md`'s lane-driver template, filled: that template carries
  its own ROLE, PLACEMENT, TASK, completion body and NEVER line, so none of them is
  assembled from another template's. When its barrier lands, the close transition
  `lifecycle.md` step 1b defines is this path's too: dispatch `/ossify:close <spine-id>` to a
  fresh close session, then a work-PR session per returned PR, then the record pass — otherwise
  a successful default lane has no defined next step and nothing records what it opened.
- **`run-spine`, when this session just planned the spine.** Then the items deserve
  their own models, and inherited-runtime subagents cannot give them that.
  **Read `references/ossify-execution.md` and follow it**: the seats for the spine are
  written into the project file and approved by the operator, and you inject them into
  one spine session's brief — that session creates a nested `run.json` it owns and
  drives a fresh subagent per item seat, no `Agent`-tool subagent anywhere in that path.
  Its four briefs are in `references/ossify-briefs.md`. Activation needs all four facts
  that file lists; installation alone is not one of them, so an ossify spine you did
  not plan here stays on the bullet above. The nested `run.json`'s mechanics — depth,
  routing, the round procedure and the close — are in `references/ossify-nested-run.md`.
- **A directly requested `work-item` or a non-spine `close`.** No template for the
  activated path fits either: that item brief is the spine's (a SEATS row, an injected request)
  and the spine close brief names `SPINE_ID`. Dispatch them from `references/briefs.md`'s own —
  the direct work-item template, or the non-spine close one — filled: the TASK is the operator's
  command verbatim and the DONE body that command's own result, so the seat has a `REPORT_PATH` and
  a body, and never the implementer's commit/push line where the unit is read-only.
- **`doctor`.** One fresh subagent per dispatch, launched from the project-file
  `doctor session` seat and released on return (`references/roles.md`). Its brief is
  `references/briefs.md`'s doctor-dispatch template, filled: the TASK is the operator's dispatch
  verbatim, its surface arguments included, and the DONE line carries that dispatch's own result
  rather than `commit …; push; open the PR`. What that dispatch may write is ossify's contract,
  not this file's, and that template does not adjudicate it.
- **`work-pr`.** Its brief carries the child templates it will construct, verbatim:
  `references/briefs.md`'s reviewer template for the
  review, and that file's fix-round and correction bodies for what follows — a work-PR session
  builds those child briefs, and a dispatched brief is the whole contract its worker ever sees.
  After the single reviewer dispatch and your disposition, the fix dispatch
  to the retained implementer is `/ossify:work-pr <PR> --repo-root <worktree holding the
  PR branch>` with the disposition list embedded as a third finding signal — work-pr
  targets the invoking repository unless told otherwise, and the retained implementer
  often sits elsewhere. `work-pr`'s "re-review on the new head" means the signals are
  re-fetched after a push, and where none covers the new head the scoped delta pass runs —
  never a second whole-PR review. The worker stops at
  `work-pr`'s merge ask and returns its ledger in its report file; you relay the ask to the
  operator, and the merge lands under the brief's `MERGE_EXECUTOR` assignment — this
  session's or the operator's — bound to the named SHA, never as a squash.

## 7. Refusals

- **Paseo's daemon is not reachable** (`paseo status` fails) **or is older than
  `lifecycle.md` step 1 requires**: say so and stop. No fallback to the `Agent` tool or to
  inline work.
- **This session is not a Paseo agent** (`PASEO_AGENT_ID` is absent): say so and stop.
  The context-ceiling hook is gated on it and goes inert, and no seat could be this
  session's subagent.
- **A seat is undefined or its agent is missing** (the seat name is neither a Paseo
  profile nor a `kind: dsh-spine-driver` entry, `paseo inspect` shows a model other than the
  expected model, the profile carries no `modeId`, or it carries no `model` and no default
  can be read for its provider — `references/paseo-mechanics.md`'s The seat launch): report
  it to the operator and stop that dispatch. Never substitute a guessed provider/model or a
  guessed mode.
- **A worker refuses on policy:** report the refusal verbatim. Do not retry it around, and
  do not rephrase the brief to slip past it.
- **`/code-review` is unavailable in the reviewer session:** the reviewer reports that in
  its report file and the operator decides what reviews the PR. Do not run the review
  inline.
