---
name: orchestrate
description: The orchestrator/worker session model over herdr — one orchestrator session that spends its context on decisions and dispatches everything else to worker sessions launched by seat name through herdr, the seats defined in the operator's own files (~/.claude/herdr-crew/agents.md, .herdr-crew/roles.md). One /code-review per PR, findings returned in the seat's report file, GitHub threads worked to zero, merge only on the operator's word. On a spine this session just planned, the operator approves the seats into the project file and they are injected into one spine session that gives each item seat a fresh tab and pane. Use when the user says orchestrator session, spawn a worker, dispatch to a session, the seat, review this PR in a session, execution assignments for a spine, or runs /herdr-crew:orchestrate. Not herdr's command reference (`herdr --skill` owns that), and not a PR loop of its own where ossify's work-pr is installed.
---

# Orchestrate — the orchestrator/worker session model

## 1. You are here

You are the orchestrator session. Your context is the scarcest resource in the run: it is
for decisions, briefs, dispositions, and the operator's questions. Every other kind of
work goes to a herdr worker session launched by seat name.

Your first herdr command is `herdr --skill`; take every command's syntax from that guide,
not from this skill. `references/herdr-mechanics.md` states once what that guide cannot
express or sets a default for that herdr-crew overrides: the seat launch and placement
(one tab per seat, never the guide's default split), the readiness and completion waits,
how a seat is sent a message, teardown, and machines. Where the two differ, that file
wins. Everything else here says what to do, and the guide says how to type it.

If you were invoked with an objective, bind or create the run's `run.json` for it, then follow
`references/lifecycle.md` from step 1. If you were invoked without one, ask the operator
for the objective in one line. Do not start probing first.

## 2. The delegation floor

Your own turns take these kinds of action, and no others:

1. Probe live state with single commands: `git status`, `gh pr view`,
   the run's `run.json` (and its `dagr check --strict` lint), `herdr status`.
2. Write briefs from the templates in `references/briefs.md`, `references/ossify-briefs.md`,
   `references/ossify-pr-briefs.md` and `references/ossify-close-writer.md`, dispositions,
   the handoff, and — on an activated
   ossify spine — the spine's seats in `.herdr-crew/roles.md`.
3. Read the seats' report files.
4. Decide.
5. Converse: operator questions, and answers to what workers write in their report files.
6. Execute single authorized mutations: worktree, tab and pane creation, dispatch,
   the PR comment, the merge — and, after it, the teardown: releasing workers (a pane
   closed, or a worktree removed), closing the run, and the verified branch delete.

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
  leave no herdr provenance. Every helper is a herdr session.
- **`herdr pane read` only on a `blocked` wake, a missing or malformed report, or a
  timeout's checkpoint**, never to watch progress. A single bounded `herdr agent wait`, on
  the state set `references/herdr-mechanics.md` states and always with a `--timeout`, is
  the wait primitive for a detected seat that is not a coordinator, over a typed state
  (`idle｜working｜blocked｜done｜unknown`); a seat herdr does not detect, and a coordinator
  seat, wait on their report files instead, with no keepalive and no re-entry. The two dead
  ends — a timeout, and a wake with nothing new in the report while the seat still works —
  are that file's, and it names the next action for each. A loop of waits, and restarting a
  wait after an empty timeout, stays forbidden. Beyond those `herdr pane read` cases, the only
  bounded reads are the launch-banner `pane read` in `roles.md`, the readiness
  `pane wait-output` of a seat herdr does not detect, and the one `/context` reply at
  each task boundary.
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

`references/briefs.md` ships five dispatched briefs — planned implementer, fast
implementer, fix round, reviewer, verifier — plus the correction-request message
template, which is a send, not a session. A brief is the whole contract the worker
will ever see, because a worker session has no orchestration context and may be
launched somewhere its project rules do not load. Every brief asks the worker to
state its model in its first reply, and you read that line before sending anything
else.

## 6. With ossify

ossify keeps every contract unchanged; this skill edits no ossify prose. Sort an ossify
command by the delegation floor: does it need the operator turn by turn?

- **Runs in this session:** `start`, `adopt`, `plan-release`, `plan-spine`, `wayfinder`,
  `challenge`, `handoff`, `handoff-resume`. These are dialogue and decisions.
- **Dispatched to a herdr session:** `run-spine`, `work-item`, `close`, `work-pr`,
  `doctor`.

Two cases are named because they look like clashes and are not:

- **`run-spine`, by default.** Dispatch `/ossify:run-spine <id>` to one lane-driver
  session — the seat the project file names for it, `can: subagents` on its machine
  entry since the lane spawns `ossify:implementer-agent` subagents through the
  `Agent` tool. From ossify's point of view that
  session is its orchestrator: it holds the state lock, commits at each close,
  merges at the barrier. The `Agent`-tool ban in §2 applies
  to this session only. You
  wait on one spine report, through its report file: a lane driver whose subagents run
  in the background is a coordinator seat (`references/herdr-mechanics.md`, Completion).
- **`run-spine`, when this session just planned the spine.** Then the items deserve
  their own models, and inherited-runtime subagents cannot give them that.
  **Read `references/ossify-execution.md` and follow it**: the seats for the spine are
  written into the project file and approved by the operator, and you inject them into
  one spine session's brief — that session creates a nested `run.json` it owns and
  drives a fresh tab and pane per item seat, no subagent anywhere in that path.
  Its four briefs are in `references/ossify-briefs.md`. Activation needs all four facts
  that file lists; installation alone is not one of them, so an ossify spine you did
  not plan here stays on the bullet above. The nested `run.json`'s mechanics — depth,
  routing, the round procedure and the close — are in `references/ossify-nested-run.md`.
- **`work-pr`.** After the single reviewer dispatch and your disposition, the fix dispatch
  to the retained implementer is `/ossify:work-pr <PR> --repo-root <worktree holding the
  PR branch>` with the disposition list embedded as a third finding signal — work-pr
  targets the invoking repository unless told otherwise, and the retained implementer
  often sits elsewhere. `work-pr`'s "re-review on the new head" means re-fetching
  GitHub signals after a push, so no second `/code-review` occurs. The worker stops at
  `work-pr`'s merge ask and returns its ledger in its report file; you relay the ask to the
  operator and merge on the word with one `gh` command.

## 7. Refusals

- **herdr is not running** (`herdr status` fails): say so and stop. Do not fall back
  to the `Agent` tool or to doing the work inline.
- **A seat is undefined or its agent is missing** (the seat name is in neither file, the
  pane shows `command not found`, or the first reply names the wrong model): report
  it to the operator and stop that dispatch. Never substitute `claude --model`.
- **A worker refuses on policy:** report the refusal verbatim. Do not retry it around, and
  do not rephrase the brief to slip past it.
- **`/code-review` is unavailable in the reviewer session:** the reviewer reports that in
  its report file and the operator decides what reviews the PR. Do not run the review
  inline.
