# orca-crew

The orchestrator/worker session model over Orca orchestration. One prose skill, no
runtime library.

One orchestrator session keeps its context for
decisions and dispatches everything else to worker sessions launched by seat name through
Orca — the seats defined in the operator's own files, not in this plugin. A planned-work
seat and a bounded-work seat implement by complexity class, one reviewer seat runs
`/code-review` once per PR and returns findings through `worker_done`, the retained
implementer works GitHub threads to zero, and the merge waits for the operator's word.

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

| Role | Seat | Class |
|---|---|---|
| Orchestrator | this session — the operator launches it | |
| Implementer, planned | a seat the project file names | `contract`, and the default when unclassified |
| Implementer, fast | a seat the project file names | `bounded` |
| Reviewer | a seat with `slash-commands`, `/code-review <PR>` once | |
| Verifier | a seat the project file names — the work-item verify; read-only probes and mechanical runs may take a lighter one. Read-only | |
| Operator | the human: the merge word | |

Seats are names the operator's two configuration files define — `config.md` in the
skill's references is the authority. The skill never substitutes `claude --model`.

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

## Spine execution assignments (0.3.0, amended 0.4.0 and 0.5.0)

When this session has just planned an ossify spine — and only then; installation, an
environment variable, or a `.orca-crew/roles.md` found on disk activate nothing — the
run takes three layers instead of one dispatched lane driver:

1. The **top orchestrator** recommends one implementer and one verifier seat per work
   item — the three coordinator seats beside them — presents the whole set to the
   operator in one approval phase, writes the decided set into the project file, and
   starts one spine session whose brief carries the approved set as its SEATS block. It
   approves each relayed worker plan and later chooses the reviewer. It launches no item
   terminal.
2. The **spine session** runs the ossify lane in external-executor mode and creates a
   child Run of its own, which keeps item plan traffic and item completions out of the
   parent inbox. It launches and supervises both terminals for each item.
3. Each **work item** gets a fresh implementer terminal and a fresh verifier terminal
   from its approved SEATS row, verbatim. A pair is retained across that item's
   corrections and never crosses work items.

SEATS rows carry each seat's resolved profile (`config.md`). The
implementation-plan gate, the implementer entry point (`/ossify:work-item`) and the
verifier procedure are fixed. There is no reviewer row: the
reviewer is chosen when the spine's PR reaches review, because before that there is no
diff to choose against.

**Nested worker depth must be `2`.** No CLI read exposes that setting, so the operator
confirms it before launch and the first child dispatch is the proof. On
`nested_worker_depth_exceeded` the spine session stays alive and asks — it never falls
back to an inherited-runtime subagent, to the parent Run, or to restarting the lane. No
Agent or Task subagent runs anywhere in this path.

Outside an activated spine, the role table, complexity-class routing and retention above
are unchanged.

**0.4.0 amends the seats, not the activation.** The approved set gains the spine
session's own seat — its resolved profile and reason — approved with the
item seats and halting on its absence (D24), and every item launch spends its own
row verbatim rather than re-reading the file (D28). The first verifier failure no
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

**0.5.0 amends the coordinator contracts.** The approved set gains the `close
session` and `work-PR session` seats beside the spine session's — coordinator seats
the operator approves with the rest, never defaults the plugin picks. The spine
session closes each item through the lane — gate, commit, merge — before the barrier, and
an item still active there is a halt, not a completion. A `fix now` close-review finding
halts the close with its ledger; the top asks for a writer profile, dispatches fresh
writers — one per affected hosting repo — then a fresh close re-reviews. Clean delegated reviews carry their reviewed head;
a left-open PR resumes on `PRIOR_REVIEW` — branched before any reviewer exists, zero
additional reviews, fresh dispatch identities. The merge executor is the top's explicit
`MERGE_EXECUTOR` assignment, never inferred or probed. Brief lifecycle identities come
from the injected Orca preamble, never from pre-filled slots; alias-launched item
terminals are closed explicitly and their absence verified at teardown; the PR seats are
exempt from the record-pass hold; and the close's PR list covers remote product
hosting repos only — a remote-less repo lands locally and is never a PR; an
AI-workspace record arm is not one.

## Context ceiling (0.6.0)

A coordinator seat — the top, a spine session, a work-PR session — cannot see its own
context figure. `hooks-handlers/context-ceiling.sh` reads it from the transcript Claude Code
names and, once it reaches the `context_ceiling` setting (default 500000 tokens), adds one
line to that seat's context: finish the unit in hand, start no new one, rotate at the next
boundary. The rotation itself is prose (`skills/orchestrate/references/lifecycle.md`,
"Rotation past the context ceiling"). The hook runs only inside Orca terminals, never
blocks a command, and says so when it cannot read the figure. Set `context_ceiling` in the
plugin's configuration.

## Configuration

Two operator-owned markdown files, read as prose — nothing parses them.
`~/.claude/orca-crew/agents.md` is the machine file: the agents this machine can launch, one block each — `command`, `expected_model`, `effort`, `model_shows`, `brief_delivery`, `can`, `note`; the field table in `skills/orchestrate/references/config.md` says what each means and where it travels.
`<project root>/.orca-crew/roles.md` is the project file: which agent fills each role,
the operator's own roles, and the conditions that choose between seats — it wins for
anything it names. With neither file the session's own work needs no setup, and the
first delegated dispatch halts naming the file to add; a seat name neither defines
halts the run. The contract and field
reference are `skills/orchestrate/references/config.md`.

## Requirements

- Orca running with the orchestration feature enabled.
- `jq` on PATH for the context-ceiling hook; without it the hook reports the figure as unavailable.
- The agents named in `~/.claude/orca-crew/agents.md` resolvable in the shell Orca's
  terminals inherit.
- The `/code-review` skill available to the reviewer session. If it is unavailable, the
  reviewer reports that in its `worker_done` and the operator decides.
- The target repository's ruleset requires conversation resolution before merge, so
  GitHub itself refuses a merge while any review thread is open.

## Tests

```bash
bash orca-crew/run-tests.sh
```

Frontmatter lint (skill, command, and Codex posture agree), five fidelity pins, the spine-execution contract, and the context-ceiling hook's behaviour.
