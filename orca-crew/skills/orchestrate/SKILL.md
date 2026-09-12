---
name: orchestrate
description: The orchestrator/worker session model over Orca — one orchestrator session (claude on Fable, or claude-sol) that spends its context on decisions and dispatches everything else to GLM worker sessions launched by alias (claude-glm, claude-glm-flash) through Orca orchestration. One /code-review per PR in a flash session, findings returned by worker_done, GitHub threads worked to zero, merge only on the operator's word. On a spine this session just planned, it ratifies a per-item implementer/verifier profile into an orca-execution sidecar and starts one spine session that runs the items in fresh external terminals. Use when the user says orchestrator session, spawn a worker, dispatch to a session, claude-glm, claude-glm-flash, orca worker, review this PR in a session, execution assignments for a spine, or runs /orca-crew:orchestrate. Not Orca's command reference (orca skills get orchestration owns that), and not a PR loop of its own where ossify's work-pr is installed.
---

# Orchestrate — the orchestrator/worker session model

## 1. You are here

You are the orchestrator session. Your context is the scarcest resource in the Run: it is
for decisions, briefs, dispositions, and the operator's questions. Every other kind of
work goes to an Orca worker session launched by alias.

Your first Orca command is `orca skills get orchestration`; take every command's
syntax from that guide, not from this skill. This skill states one Orca mechanic
itself — the alias launch in `references/roles.md` — because the guide's
`worker-start` cannot express it. Everything else here says what to do, and the guide
says how to type it.

If you were invoked with an objective, bind or create the Run for it, then follow
`references/lifecycle.md` from step 1. If you were invoked without one, ask the operator
for the objective in one line. Do not start probing first.

## 2. The delegation floor

Your own turns take these kinds of action, and no others:

1. Probe live state with single commands: `git status`, `gh pr view`,
   `orca orchestration task-list`, `orca status`.
2. Write briefs from the templates in `references/briefs.md`, `references/ossify-briefs.md`
   and `references/ossify-pr-briefs.md`, dispositions, the handoff, and — on an activated
   ossify spine — the `orca-execution.md` sidecar.
3. Read `worker_done` bodies.
4. Decide.
5. Converse: operator questions, `reply`/`ask` with workers.
6. Execute single authorized mutations: worktree and terminal creation, dispatch,
   the PR comment, the merge — and, after it, the teardown: releasing workers,
   closing terminals and the Run, and the verified branch delete.

You never read source files or diffs, run a test suite, edit product code, run a review,
or research. **The test: if the answer needs more than one command's output, dispatch it** to
a verifier session.

How many sessions may exist is the session budget in `references/roles.md` — one
implementer seat and one verifier seat per work item, one reviewer per PR — stated
once there; any session outside those seats is a planning defect. A malformed or
incomplete report is corrected by the correction-request template in
`references/briefs.md` — one bounded `send` to the live session that wrote it; a
correction session is never created.

Three consequences:

- **No `Agent` tool from the orchestrator.** Subagents spend orchestrator-tier tokens and
  leave no Orca provenance. Every helper is an Orca session.
- **`worker-read` only on `escalation` or a failed `worker_done`**, never to watch
  progress. Rolling `check --wait` is the wait primitive. A timeout is a checkpoint, not a
  failure. A heartbeat means alive, not done. Beyond those `worker-read` cases, the only
  bounded reads are the launch-banner `terminal read` in `roles.md` and the one
  `/context` reply at each task boundary.
- **Verifying a worker's claim is a verifier dispatch**, not an orchestrator read. "Tests
  pass" in a `worker_done` is a claim until CI on that head SHA, or a verifier, says so.
  One narrow exception: lifecycle step 6's PR gate — `gh pr view` for identity and
  state, and the CI read for the named SHA (`commits/<sha>/check-runs`, plus commit
  statuses on repos whose CI reports through the Status API) — is the floor's probe
  kind, bounded to those reads; comparing outputs, judging a failure, or reading a diff
  past them is a dispatch.

## 3. Roles

`references/roles.md` is the table. In one line each:

- **Orchestrator** — you: `claude` (Fable) or `claude-sol`. One per Run.
- **Implementer, planned** — `claude-glm` at high, `--effort max` on demand; the
  `contract` class and the default when unclassified.
- **Implementer, fast** — `claude-glm-flash`; the `bounded` class (one-file,
  mechanical, read-heavy).
- **Reviewer** — `claude-glm-flash` running `/code-review <PR>` once per PR. Disposable.
- **Verifier** — `claude-glm` at high, read-only: it runs the work-item verify, whose
  claims include judgment. `claude-glm-flash` covers read-only probes and mechanical
  runs outside that verify. Retained until its item passes or escalates.
- **Operator** — the human. The merge word, and every decision no session can own.

Every worker is launched by its alias, never by `claude --model`. A work item's
complexity class is assigned at plan time and read at dispatch, so picking the alias
is a lookup, not a judgment. The mechanic and the retention, placement, and
single-writer rules are in the reference.

One phase overrides that lookup: on an **activated ossify spine** (§6) the item's
implementer and verifier come from an operator-ratified sidecar row rather than from
its complexity class, a native `claude --model … --effort …` command is a legitimate
row value there, and each pair is fresh per item. That scope is exactly the activated
spine; everywhere else the table above is unchanged.

## 4. The run

`references/lifecycle.md` is the thirteen-step run: orient, decompose, launch, plan
gate, wait, implementer done, verify, review, disposition, fix rounds, stopping rule,
merge gate, handoff. One Run per objective. You drive the steps and nothing else.

## 5. Briefs

`references/briefs.md` ships five dispatched briefs — planned implementer, fast
implementer, fix round, reviewer, verifier — plus the correction-request message
template, which is a `send`, not a session. A brief is the whole contract the worker
will ever see, because a worker session has no orchestration context and may be
launched somewhere its project rules do not load. Every brief asks the worker to
state its model in its first reply, and you read that line before sending anything
else.

## 6. With ossify

ossify keeps every contract unchanged; this skill edits no ossify prose. Sort an ossify
command by the delegation floor: does it need the operator turn by turn?

- **Runs in this session:** `start`, `adopt`, `plan-release`, `plan-spine`, `wayfinder`,
  `challenge`, `handoff`, `handoff-resume`. These are dialogue and decisions.
- **Dispatched to an Orca session:** `run-spine`, `work-item`, `close`, `work-pr`,
  `doctor`.

Two cases are named because they look like clashes and are not:

- **`run-spine`, by default.** Dispatch `/ossify:run-spine <id>` to one
  `claude-glm --effort max` session, the lane driver. From ossify's point of view that
  session is its orchestrator: it holds the state lock, spawns
  `ossify:implementer-agent` subagents through the `Agent` tool, commits at each close,
  merges at the barrier. The `Agent`-tool ban in §2 applies to this session only. You
  wait on one `worker_done` per spine.
- **`run-spine`, when this session just planned the spine.** Then the items deserve
  their own models, and inherited-runtime subagents cannot give them that.
  **Read `references/ossify-execution.md` and follow it**: you ratify one
  implementer/verifier profile per item with the operator, write the
  `orca-execution/v1` sidecar, and start one spine session that creates a child Run
  and drives fresh external terminals per item — no subagent anywhere in that path.
  Its four briefs are in `references/ossify-briefs.md`. Activation needs all four facts
  that file lists; installation alone is not one of them, so an ossify spine you did
  not plan here stays on the bullet above. The nested Run's mechanics — depth, routing,
  the round procedure and the close — are in `references/ossify-nested-run.md`.
- **`work-pr`.** After the single reviewer dispatch and your disposition, the fix dispatch
  to the retained implementer is `/ossify:work-pr <PR> --repo-root <worktree holding the
  PR branch>` with the disposition list embedded as a third finding signal — work-pr
  targets the invoking repository unless told otherwise, and the retained implementer
  often sits elsewhere. `work-pr`'s "re-review on the new head" means re-fetching
  GitHub signals after a push, so no second `/code-review` occurs. The worker stops at
  `work-pr`'s merge ask and returns its ledger in `worker_done`; you relay the ask to the
  operator and merge on the word with one `gh` command.

## 7. Refusals

- **Orca is not running** (`orca status --json` fails): say so and stop. Do not fall back
  to the `Agent` tool or to doing the work inline.
- **An alias is missing** (the worker's first reply names the wrong model, or the terminal
  shows `command not found`): report it to the operator and stop that dispatch. Never
  substitute `claude --model`.
- **A worker refuses on policy:** report the refusal verbatim. Do not retry it around, and
  do not rephrase the brief to slip past it.
- **`/code-review` is unavailable in the reviewer session:** the reviewer reports that in
  its `worker_done` and the operator decides what reviews the PR. Do not run the review
  inline.
