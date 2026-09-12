# orca-crew

The orchestrator/worker session model over Orca orchestration. One prose skill, no
runtime library.

One orchestrator session (`claude` on Fable, or `claude-sol`) keeps its context for
decisions and dispatches everything else to GLM sessions launched by alias through Orca.
`claude-glm` implements planned work, `claude-glm-flash` implements bounded work, one
`claude-glm-flash` session runs `/code-review` once per PR and returns findings through
`worker_done`, the retained implementer works GitHub threads to zero, and the merge waits
for the operator's word.

## Skill

| Skill | What it does |
|---|---|
| `orchestrate` | The playbook for the orchestrator session: the delegation floor and its decidable test, the role table, the thirteen-step run, five dispatched brief templates plus a correction-request message template, the ossify seam — including the spine execution-assignment phase and its six further briefs — and the refusals. Defers every other Orca command to `orca skills get orchestration`. |

## Command

| Command | Skill |
|---|---|
| `/orca-crew:orchestrate [objective]` | `orchestrate` |

## The delegation floor

The orchestrator's own turns take these kinds of action, and no others: single-command
probes; writing briefs, dispositions, and the handoff; reading `worker_done` bodies;
deciding; conversing with the operator and workers; executing single authorized
mutations. If an answer needs more than one command's output, it is dispatched to a
verifier session.

## Roles

| Role | Alias | Class |
|---|---|---|
| Orchestrator | `claude` or `claude-sol` | |
| Implementer, planned | `claude-glm` (high; `--effort max` on demand) | `contract`, and the default when unclassified |
| Implementer, fast | `claude-glm-flash` | `bounded` |
| Reviewer | `claude-glm-flash`, `/code-review <PR>` once | |
| Verifier | `claude-glm` at high — the work-item verify; `claude-glm-flash` for read-only probes and mechanical runs outside it. Read-only | |
| Operator | the human: the merge word | |

Aliases are shell profiles that carry provider routing and pinned defaults. The skill
never substitutes `claude --model`.

## Session budget

One implementer seat and one verifier seat per work item; one reviewer per PR. A fix
round may re-use the verifier seat, and a context-rotation replacement occupies the
seat it replaces; any session outside those seats is a planning defect, and the
orchestrator stops to re-plan the item. The authority is the skill's `roles.md`.
The implementer is retained across consecutive work items until it passes half its
context window (checked by `/context` at each task boundary) or the harness
auto-compacts; the next item starts fresh with the handoff the orchestrator writes
from the inputs in its `worker_done`.

## With ossify

ossify's ceremonies (`start`, `adopt`, `plan-release`, `plan-spine`, `wayfinder`,
`challenge`, `handoff`, `handoff-resume`) run in the orchestrator session. Its execution lanes
(`run-spine`, `work-item`, `close`, `work-pr`, `doctor`) are dispatched to Orca sessions.
No ossify contract changes.

## Spine execution assignments (0.3.0, amended 0.4.0)

When this session has just planned an ossify spine — and only then; installation, an
environment variable, or a sidecar found on disk activate nothing — the run takes three
layers instead of one dispatched lane driver:

1. The **top orchestrator** recommends one implementer and one verifier profile per work
   item, has the operator ratify every row in a single phase, writes
   `$SPINE_DIR/orca-execution.md` (`orca-execution/v1`), and starts one spine session. It
   approves each relayed worker plan and later chooses the reviewer. It launches no item
   terminal.
2. The **spine session** runs the ossify lane in external-executor mode and creates a
   child Run of its own, which keeps item plan traffic and item completions out of the
   parent inbox. It launches and supervises both terminals for each item.
3. Each **work item** gets a fresh implementer terminal and a fresh verifier terminal at
   its exact ratified command, model and effort. A pair is retained across that item's
   corrections and never crosses work items.

Sidecar rows vary only the terminal command, the expected model, and the effort. The
implementation-plan gate, the implementer entry point (`/ossify:work-item`) and the
verifier procedure are fixed. There is no reviewer row and no whole-spine profile: the
reviewer is chosen when the spine's PR reaches review, because before that there is no
diff to choose against.

**Nested worker depth must be `2`.** No CLI read exposes that setting, so the operator
confirms it before launch and the first child dispatch is the proof. On
`nested_worker_depth_exceeded` the spine session stays alive and asks — it never falls
back to an inherited-runtime subagent, to the parent Run, or to restarting the lane. No
Agent or Task subagent runs anywhere in this path.

Outside an activated spine, the role table, complexity-class routing and retention above
are unchanged.

**0.4.0 amends the seats, not the activation.** The sidecar gains a `## Spine session`
block beside the item table — command, expected model, effort, reason — ratified with
the item rows and halting on its absence (D24), and it is revalidated immediately before
**every** item launch rather than once at the start (D28). The first verifier failure no
longer resolves itself: it sends one blocking `ask` carrying the verifier's summary and
three options — correct with the same pair, replace the pair, halt — and *replace*
releases the old pair before creating its successor (D25). The close and every PR loop
leave the top's session: the close always runs in a fresh terminal and returns every PR
it opened, each returned PR gets its own work-PR session owning the reviewer and PR-fix
seats and merging on the word the top relays, and only the top talks to the operator
(D26). The record pass that follows is conditional and single — dispatched only after a
first close that halted naming PRs, and only once all of them have merged (D27). The
phase's prose is three references now: `ossify-execution.md` (the contract),
`ossify-nested-run.md` (the mechanics) and `ossify-pr-briefs.md` (the close and work-PR
briefs).

## Requirements

- Orca running with the orchestration feature enabled.
- The aliases `claude-glm` and `claude-glm-flash` defined in the shell Orca's terminals
  inherit.
- The `/code-review` skill available to the reviewer session. If it is unavailable, the
  reviewer reports that in its `worker_done` and the operator decides.
- The target repository's ruleset requires conversation resolution before merge, so
  GitHub itself refuses a merge while any review thread is open.

## Tests

```bash
bash orca-crew/run-tests.sh
```

Frontmatter lint (skill, command, and Codex posture agree) and five fidelity pins.
