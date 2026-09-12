# Roles

One session owns each active role. A session's name or suffix is not its identity: when
resuming, ask each candidate to state its role and assignment and wait for the reply
before sending work.

| Role | Alias | Effort | Lifetime | Class |
|---|---|---|---|---|
| Orchestrator | `claude` (Fable) or `claude-sol` | alias default | one per Run; the operator launches it | |
| Implementer, planned | `claude-glm` | high by default; `--effort max` when the plan (spine plan or decompose) marks the item, or a prior attempt on it failed | retained across work items and the PR's fix rounds, to the threshold below | `contract`: an interface, schema, contract, or architectural change, or a plan gate; the default when the item is not `bounded` |
| Implementer, fast | `claude-glm-flash` | alias default | retained if a fix round follows, else released | `bounded` only when the item is one-file, mechanical, or read-only |
| Reviewer | `claude-glm-flash` — once per PR; first task `/code-review <PR>`; never implements | alias default | disposable; released after `worker_done` validates | |
| Verifier | `claude-glm` — the work-item verify; `claude-glm-flash` for read-only probes and mechanical runs outside it (a suite, a count, a fact) | high | retained until its item passes or escalates to the operator | |
| Operator | the human — the merge word, and decisions no session can own | | | |

## The launch

**Alias, never `--model`.** Bare `claude --model glm-*` routes to the Anthropic default
and fails or silently serves the wrong model. `worker-start --agent claude` launches bare
`claude` and takes no custom alias. The launch is therefore this sequence, and it is the
one Orca mechanic this skill states itself (take the exact flags from
`orca skills get orchestration`):

```bash
orca terminal create --worktree <selector> --command "<alias> [--effort max]" --json
orca terminal wait --for tui-idle --terminal <handle> --json
orca terminal read --terminal <handle> --json
orca orchestration dispatch --task <task_id> --to <handle> --inject --json
```

Read `agentTerminalHandle` (or `startupTerminal.handle` on older runtimes) from the
create receipt for `--to`. The `wait` parks until the banner is up; the single `read`
of that banner confirms the model before anything is dispatched. Every brief also asks
the worker to state its model in its first reply — a second check, not the only one.
A wrong model is a failed launch: release the terminal and report it. Do not correct
it with `--model`.

## Retention follows artifacts

The session that built the PR fixes the PR, and an implementer is retained across
consecutive work items. Attach its next task with `worker-start --task <next>
--terminal <handle>` so Orca transfers ownership. At each task boundary send
`/context` to the live terminal and read the one reply — the orchestrator's one
context source: past half its window, as `/context` reports, or an auto-compact, the
next item goes to a fresh implementer. The implementer returns its handoff inputs in
`worker_done`; the orchestrator writes the handoff into the next brief. Rotation
happens between work items, never mid-PR: the retained implementer finishes the PR's
fix rounds unless the harness auto-compacts. The reviewer
owns nothing durable and is released the moment its `worker_done` is processed; the
verifier seat is retained across a fail-and-fix cycle on the same item — the re-check
attaches its task to the same verifier — and is released only when the item passes or
goes to the operator. If `worker-release` retains a terminal you created with `terminal create`,
close it with `orca terminal close`; read the release receipt rather than assuming.

## The activated-ossify-spine exception

On a spine this session planned (`ossify-execution.md`), two rows above are
superseded **for that spine's work items only**: the implementer and the verifier
are launched from the operator-ratified sidecar row, whose value may be a native
`claude --model <id> --effort <level>` command rather than an alias; the model is
confirmed from the banner and the first reply exactly as *The launch* requires; and
each item gets a
**fresh** pair, retained across that item's corrections and released when it closes or
escalates. A pair never crosses work items there.

Everything else on this page — the class routing, the retention rule, the placement
and writer rules, and the budget below — is unchanged and still governs every session
outside such a spine. The spine session itself is launched
**from the ratified spine_session block** in that spine's sidecar — a block beside the
item table, never a row in it — so the generic lane-driver policy does not select it.

## Session budget

One implementer seat and one verifier seat per work item; one reviewer per PR. A fix
round may re-use the verifier seat, and a context-rotation replacement occupies the
seat it replaces. Any session outside those seats is a planning defect: stop and
re-plan the item. A further read-only question goes to the existing verifier or
implementer by `send`, never to a new session.

**Activated ossify spines add three seats, all outside the per-item budget above:
the spine session, one per spine, launched from its ratified sidecar block; a close
session, a fresh terminal per close dispatch; and a work-PR session, one per returned
PR.** The work-PR session owns the reviewer and the PR-fix seat inside a child Run of
its own, so those two are budgeted there rather than here — the top decides both
profiles at the PR transition and injects them, and neither survives the merge. No
implementer is retained into a spine PR: every item pair was released at its item's
close. None of these seats exists anywhere else.

## Placement

In a dual-repo workspace, the orchestrator and implementers launch from the AI workspace
and address canonical worktrees explicitly, because a session launched inside the
canonical repo never loads the workspace's rules, memory, or handoffs. Reviewer and
verifier may launch inside a canonical worktree for a fresh frame, which is why their
briefs are self-contained. Single-repo projects launch everything in the repo or a
worktree of it.

## Writers

- **One writer per artifact.** A correction to a peer's file travels as `send`, never as
  a direct edit.
- **One implementer per worktree.** Two writers never share a checkout. Parallel items
  get parallel worktrees.
- **The orchestrator writes briefs, dispositions, and handoffs.** It writes no product
  file.
