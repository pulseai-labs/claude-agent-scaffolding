# Roles

One session owns each active role. A session's name or suffix is not its identity: when
resuming, ask each candidate to state its role and assignment and wait for the reply
before sending work.

The seat names below are examples: the project file (`.herdr-crew/roles.md`,
`references/config.md`) is the authority for which agent fills each role.

| Role | Seat | Effort | Lifetime | Class |
|---|---|---|---|---|
| Orchestrator | you — the operator launched this session | | one per run | |
| Implementer, planned | `strong-coder` | the seat's — a marked item or a retry fills a higher-effort seat the project file's conditions name, and the machine entry is the only source of effort: never the same command edited | retained across work items and the PR's fix rounds, to the threshold below | `contract`: an interface, schema, contract, or architectural change, or a plan gate; the default when the item is not `bounded` |
| Implementer, fast | `fast-coder` | the seat's | retained if a fix round follows, else released | `bounded` only when the item is one-file, mechanical, or read-only |
| Reviewer | `sonnet-review` — once per PR; first task `/code-review <PR>`; never implements | the seat's | disposable; released after its report file validates | |
| Verifier | `strong-coder` — the work-item verify; `fast-coder` for read-only probes and mechanical runs outside it (a suite, a count, a fact) | the seat's | retained until its item passes or escalates to the operator | |
| Operator | the human — the merge word, and decisions no session can own | | | |

## The launch

A seat is a name, never `--model`. The command it resolves to lives in the operator's
machine file; run-time surfaces carry the name only, and a name neither file defines
halts the run. No single herdr call creates a seat, launches its command and delivers
its brief, so the launch is this sequence (take exact flag syntax from `herdr
--skill`):

```bash
herdr workspace create --cwd <path> --label "run: <objective>"   # once per run, not per seat
herdr tab create --workspace <id> --cwd <path> --label "seat: <role> (<agent>)"
herdr pane run <pane> "<command:>"
herdr agent wait <pane> --until done --until idle --until blocked --timeout <ms>
herdr pane read <pane>                      # confirm expected_model: before dispatch
herdr agent prompt <pane> "<brief>"         # or brief_delivery: file
```

`references/herdr-mechanics.md` holds the full sequence and the flags this block leaves
out. The first seat takes the workspace's own tab rather than a new one; a seat that
needs a new worktree opens it with `herdr worktree create`, whose options are in its
`--help`; and a seat herdr does not detect waits on its screen and is prompted through
the pane, never with the block's two `agent` lines. This file states only the role table
and retention.
Acceptance of input is not the start of a turn: after dispatch, confirm the turn
actually started before the next `herdr agent wait`; if it did not, `herdr pane
send-keys <pane> enter` submits what is sitting in the composer. Every brief also asks
the worker to state its model in its first reply — a second check, not the only one. A
wrong model is a failed launch: release the pane and report it.

## Retention follows artifacts

The session that built the PR fixes the PR, and an implementer is retained across
consecutive work items. herdr has no ownership transfer: retain a seat by keeping its
pane and prompting it again with the next task's brief, `herdr agent prompt <pane>
"<next task's brief>"`. At each task boundary run `herdr agent prompt <pane>
"/context"` and read the one reply with `herdr pane read <pane>` — the
orchestrator's one context source: past half its window, as `/context`
reports, or an auto-compact, the next item goes to a fresh implementer. The
implementer returns its handoff inputs in its report file; the orchestrator writes the
handoff into the next brief. Rotation happens between work items, never mid-PR: the
retained implementer finishes the PR's fix rounds unless the harness auto-compacts.
The reviewer owns nothing durable and is released the moment its report file is
processed; the verifier seat is retained across a fail-and-fix cycle on the same item
— the re-check attaches its task to the same verifier — and is released only when the
item passes or goes to the operator. When a seat is released, close its pane with
`herdr pane close <pane>`; the run's own workspace closes at teardown, with `herdr
workspace close <id>`. Read the close receipt rather than assuming it succeeded.

## The activated-ossify-spine exception

On a spine this session planned (`ossify-execution.md`), two rows above are
superseded **for that spine's work items only**: the implementer and the verifier
are launched from the spine's operator-approved SEATS rows, whose values may name
a native `claude --model <id> --effort <level>` command rather than an alias; the
model is confirmed as the row's `model_shows` says and from the first reply, exactly as *The launch*
requires; and each item gets a
**fresh** pair, retained across that item's corrections and released when it closes or
escalates. A pair never crosses work items there.

Everything else on this page — the class routing, the retention rule, the placement
and writer rules, and the budget below — is unchanged and still governs every session
outside such a spine. The spine session itself is launched **from the `spine session` seat the project file names**
for that spine, so the generic lane-driver policy does not select it.

## Session budget

One implementer seat and one verifier seat per work item; one reviewer per PR. A fix
round may re-use the verifier seat, and a context-rotation replacement occupies the
seat it replaces. Any session outside those seats is a planning defect: stop and
re-plan the item. A further read-only question goes to the existing verifier or
implementer by `send`, never to a new session.

One further seat the budget admits on declaration, and only for its declared span:
a role the operator pins to a named point occupies a seat for that point's
dispatch — launched when the run reaches the point, released when the role
returns, blocking or advisory — and an `at: on-demand` role occupies a seat for
the dispatch it was wanted for, against the allowance the project file declares,
one at once by default. A declared role past that allowance, or a declared-role
seat lingering past its span, is the planning defect the rule still catches.

**Activated ossify spines add four seats, all outside the per-item budget above:
the spine session, one per spine; a close
session, a fresh tab and pane per close dispatch; a work-PR session, one per returned
PR — each launched from its own seat in the project file (`spine session`,
`close session`, `work-PR session`), the model confirmed as its profile's
`model_shows` says and from the first reply, as an item row's is — and a close-review writer, one per affected
hosting repo at a `halted: close-review`, launched from the profile the operator
names at that halt (`ossify-close-writer.md`), never a seat the file pre-defines.** The
work-PR session owns the reviewer and the
PR-fix seat inside a child run of
its own, so those two are budgeted there rather than here — the top decides both
profiles at the PR transition and injects them, and neither survives the merge. No
implementer is retained into a spine PR: every item pair was released at its item's
close. None of these seats exists anywhere else. A `doctor session` — one fresh
tab and pane per `/ossify:doctor` dispatch, released on return — sits outside the
budget too, launched from the project-file seat of the same name.

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
