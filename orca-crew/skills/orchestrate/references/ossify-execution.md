# ossify spine execution — assignments, seats, and who owns what

A spine's work items each deserve their own model and effort; one dispatched lane driver
cannot give them that, because whatever it spawns inherits its runtime.

> **Editing note.** This file, `ossify-nested-run.md` and `ossify-briefs.md` are asserted
> to hold no subagent invocation form and to stay under 200 lines. Never paste the
> call shape.

## 1. Activation

Four facts, **all** of them, and each about the session you are in right now:

1. orca-crew is the current top orchestrator;
2. a parent Run is bound;
3. this session has just completed `/ossify:plan-spine`;
4. a concrete spine directory exists on disk.

Absent any one, this file does not apply and ossify runs as `SKILL.md` §6 says.
**None of these activates it**: orca-crew or ossify merely installed; an environment
variable; an `orca-execution.md` on disk; a `/plan-spine` in a session that is not the
top. Discovery is not authority — the phase begins because *this* session planned
*this* spine.

## 2. Four seats, one voice

| Layer | Owns | Never |
|---|---|---|
| **Top orchestrator** (you) | ratifying one implementer/verifier profile per item and the spine session's own seat, writing the sidecar, launching the spine terminal from `spine_command` with its model confirmed from the banner and first reply and `spine_effort` passed as the launch argument — a mismatch is a failed launch, exactly as for an item row — approving or amending each relayed worker plan, deciding the reviewer and PR-fix seats at the PR transition, dispatching the close and one work-PR session per returned PR, relaying the merge word, dispatching the record pass, and the teardown | launching or supervising an item terminal; reading raw child completion traffic; reviewing, fixing or merging a spine PR itself |
| **Spine session** | the ossify lane, a nested child Run, launching and supervising both item terminals per item, relaying plans up, item-local corrections | changing any ossify contract; moving item tasks into the parent Run |
| **Item terminals** | one item each: implement, verify | crossing into another item |
| **Close session** | one dispatch of `/ossify:close`, returning every PR it opened | creating any terminal; driving a PR it opened |
| **Work-PR session** | one returned PR: the reviewer seat, the PR-fix seat, dispositions, ledgers, and the merge on the top's relayed word | talking to the operator; merging without that word |

ossify owns worktrees, handoffs, closes, merges and the round barrier, and knows
nothing about the above.

**Only the top talks to the operator; every other seat asks upward, one hop per
layer.** And every dispatched session returns a checkable artifact — a PR list, a
ledger comment id, a merge SHA — never narrative.

The nested Run's mechanics — depth, routing, the round procedure and the close — are
in `references/ossify-nested-run.md`.

## 3. The sidecar

`$SPINE_DIR/orca-execution.md`. **You are its only writer.**

```markdown
# Orca execution assignments

schema: orca-execution/v1
spine_id: r7.s2
spine_plan: ./SPINE.md
spine_plan_oid: 1111111111111111111111111111111111111111
ratification: operator-approved
ratified_in_run: run_parent123

## Spine session

spine_command: claude-glm --effort max
spine_expected_model: glm-5.3
spine_effort: max
spine_profile_reason: lane-driver default; this driver coordinates, it does not write.

## Fixed procedures

implementation_plan_gate: worker-authored/top-orchestrator-approved
implementer_entrypoint: /ossify:work-item <handoff path>
verifier_procedure: all-claims-work-item-verify/v1

## Binding assignments

| work_item_id | implementer_terminal_command | implementer_expected_model | implementer_effort | verifier_terminal_command | verifier_expected_model | verifier_effort |
|---|---|---|---|---|---|---|
| r7.s2.w1 | claude --model claude-opus-5 --effort xhigh | claude-opus-5 | xhigh | claude-glm --effort high | glm-5.3 | high |

## Recommendation record

- r7.s2.w1 — interface work justifies Opus 5 xhigh; GLM high checks it independently.
- spine session — the lane-driver default, ratified as recommended.

## Excluded decisions

Reviewer profile and `/code-review` level are selected when the spine PR reaches
review.
```

**Only the terminal command, expected model and effort vary.** The three procedures
above are fixed for every item on every spine, recorded so the spine session can check
them rather than choose among them. No reviewer row — §5 says why; the spine
session is a block beside the table, never a row in it.

**Authoring it.** After `/plan-spine`, recommend one implementer and one verifier
profile per item from its scope, risk and cost. Present **every** row to the operator in
one ratification phase and write nothing until every row is decided — a half-ratified
sidecar looks binding and is not. Record the recommendation and any override.
**On writing the ratified file, hash it** — `git hash-object` on the sidecar — and keep
that value: the brief injects it as `SIDECAR_OID` and the spine session proves equality
before it does anything. A child that sampled its own baseline after launch would
adopt an edit made between your ratification and its first read;
**the top records that blob id as SIDECAR_OID**, so the baseline is the operator-approved file.

**Reading it.** Before dispatching the spine session, and again before every
item launch, the reader checks: the plan's blob id **at its real path** —
`git hash-object "$(dirname "$ORCA_EXECUTION_PATH")/SPINE.md"`, which resolves
`spine_plan` against the sidecar's own directory exactly as authoring did — equals
`spine_plan_oid`; every planned item has exactly one complete row; no row names
an item the plan does not; `ratification` reads exactly `operator-approved`;
`ratified_in_run` equals the injected `PARENT_RUN_ID`; `spine_id` equals the
spine being run. **Those last three are value checks, not presence checks** — a field
that merely exists admits `rejected`, another Run's ratification, and another spine's
sidecar, each reading as authority it never had. Any failure halts; a profile that needs
to change is a new operator decision and a rewrite by you, never a substitution. **Those
checks establish validity, not identity** — an edited but still-valid row passes every
one — so the spine session also pins the sidecar's own blob id at step 1 and requires it
unchanged at each launch (`ossify-nested-run.md` §3).

**The `## Spine session` block is read the same way** — its four keys value-checked
beside the item rows, and **its absence halts on an activated spine**. It is
recommended and **ratified with the item rows in the same phase**, and it changes
nothing about the item-set equality check above: the block sits beside the table,
never as a row in it.

## 4. Scope of the fresh-pair rule

Fresh-per-item pairs are scoped to **activated ossify spines**. Outside them
`roles.md`'s class routing and retention remain authoritative — a retained implementer
across ordinary consecutive work items is still correct.

The single exception inside a spine is a *replace* decision at the first-failure ask
(`ossify-nested-run.md` §3): the old pair is released before its replacement exists, so
one-pair-per-item is preserved by that ordering rather than broken by the exception. The
replacement starts from a worktree reset to the request's `base_sha`, so it is an
ordinary first run of the item, not an inheritance of the rejected work.

## 5. Two profiles are chosen at the PR, not before

Reviewer profile is absent from spine planning and from the sidecar on purpose: the PR
does not exist yet, and a profile chosen before there is a diff to read is a guess
recorded as a decision. At the PR transition ask for the reviewer's command, expected
model, effort and `/code-review` level, and put **all four** into the **work-PR
session's** brief (`ossify-pr-briefs.md`) — that session creates the reviewer from the
decided command and confirms its model from the banner and first reply exactly as an
item row is; step 8's `claude-glm-flash` is the default only outside such a spine.
Neither the spine session nor the sidecar selects it.

**Decide the PR-fix implementer in the same breath.** Every item pair was released at
its item's close and the spine session was a coordinator, not a writer — so step 10's
*retained implementer* does not exist here. Ask for one PR-fix profile (command,
expected model, effort) alongside the reviewer's, and inject it into the same work-PR
brief. The seat is **decided** by you and **created and dispatched by the work-PR
session**, only once its disposition ledger exists, on `briefs.md`'s **fix-round
brief** rather than the planned-implementer brief, whose DONE opens a new PR: it works
the PR that already exists. One seat per PR, released at merge.

## 6. Briefs

The spine and item briefs are in `references/ossify-briefs.md`, the close and work-PR
briefs in `references/ossify-pr-briefs.md`; `references/briefs.md`'s templates are
unchanged and still apply elsewhere, its fix-round brief included (§5).
