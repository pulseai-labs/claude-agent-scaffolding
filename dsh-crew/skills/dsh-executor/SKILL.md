---
name: dsh-executor
description: The caller-supplied execution procedure for ossify's run-spine --external-executor when the caller is a DeepSeek Harness spine session on the crew-spine preset. Turns each request record into a subagent_implementer call, verifies the return with a subagent_verifier call, sends one correction on FAIL, computes ossify's result record from git and hands the round back. Use when run-spine hands you a round's request records. Defers every rule to ossify's external-executor.md and adds nothing to its contract.
---

# dsh executor — the round, as a dsh spine session runs it

## 1. You are here

You are the spine session, on the `crew-spine` preset or the headless `crew` profile, cwd
inside the AI workspace, `oss` on the PATH of the bash tool. `run-spine <spine-id>
--external-executor` (ossify) has prepared every item in the round (the spine-branch cut,
the per-item worktrees and the handoffs: `work-item/references/round-orchestration.md`
§2–§4), built one request per item (`work-item/references/external-executor.md` §2–§3),
and now hands you the round's request records, one per item, in declared decomposition
order.
Your tools for this: `subagent_implementer`, `subagent_verifier`, `list_subagent_models`,
`subagent_reviewer` (optional, §9), `job_output`, `job_list`, `job_kill`, `bash`, `skill`.
Prompts come from the `dsh-brief` skill (§2 the implementer prompt, §3 the verifier prompt,
§4 the correction prompt, §6 the reviewer prompt).

ossify state is the single authority. You write nothing into `.ossify/` except through
`oss`, and you never commit, never push. The records you produce are ossify's, unextended,
and this skill quotes them in its **own** `references/records.md`: the file beside this
SKILL.md, in the `dsh-executor` skill directory, not under ossify's `work-item/`.

## 2. Dispatch the round

Take the round in this order — every baseline first, then the dispatches:

0. Resolve the roles, once per round, before anything else. Read `.dsh-crew/roles.md` at the
   AI workspace root (`references/presets.md` §9 in this plugin gives its shape). The
   `crew-spine` persona also runs this step's checks once before run-spine's first mutation,
   and before a continuation reconciles, so a stale preset or an unusable file stops the
   session with nothing changed. The operator then fixes the cause and sends the same first
   message to a fresh session.
   - **Your tools first.** Confirm `subagent_implementer` and `subagent_verifier` are both
     among your tools, whatever the file says. A missing one means a stale `crew-spine` is
     installed (a 0.3.0 preset has no `subagent_verifier`; `references/presets.md` §2). Stop,
     and tell the operator to copy the plugin's `crew-spine` again, or for the headless
     `crew` profile to re-apply `references/presets.md` §5's rows, and to start a fresh
     session.
   - **No file:** there is no selection this round. Send no `provider`, `model` or
     `reasoning_effort` on any child call; every child runs your route and effort. Say so once
     in the hand-back (§7).
   - **A file:** it must hold exactly one `## Roles` table with one row each for
     `implementer`, `verifier` and `reviewer`. A missing row means no selection for that role.
     A duplicate row, or a role name outside those three, stops the round here: report the
     file and the row to the operator, and never pick one of the rows.
   - **Checking the rows:**
     1. For the implementer route, call `list_subagent_models` with that `provider` and
        `model`. Confirm the route is offered and the row's effort is among its efforts. It
        answers `is not allowed for this Session` for a route outside the allow-list, and
        otherwise lists the model's reasoning efforts.
     2. A verifier row must read route `driver` and effort `(driver)`. The verifier tool is not
        selectable (`references/presets.md` §2), so a verifier always runs your route and
        effort. A row naming anything else asks for a route dsh cannot give it. Name the row
        and say that it must read `driver`.
     3. For a reviewer row other than `driver`, confirm `subagent_reviewer` is among your
        tools.
     4. Any failure stops the round before the first dispatch. Report the file, the row and
        what was missing to the operator. It is not a gap and not a record. dsh's allow-list
        would refuse the call anyway; this fails early and names why.
1. Baseline the two documents no child may touch — the blob ids of **every** request's
   `spec_path` and `handoff_path` (`git hash-object`) — all of them, before the first
   dispatch. The round is parallel, so a child already running can edit a sibling's spec, and
   a baseline taken after that dispatch cannot see it. This is the only comparison that can
   see a child editing its own contract at all: ossify recomputes the spec's oid from the
   same file at §5a, so a weakened spec agrees with itself and passes.
2. Then, for every request in declared order: fill the implementer prompt (`dsh-brief` §2)
   with the seven request fields, verbatim, and call `subagent_implementer` with
   `description: "work item <work_item_id>"`, that prompt, and `run_in_background: true`.
   Note the job id it returns against the item. When step 0 resolved an implementer route,
   the call also carries `provider`, `model` and `reasoning_effort` from that row, copied,
   never chosen.

Items within a round are parallel by construction; dispatch them all, then wait.

## 3. Collect the returns

Loop: `job_list()`; for each item's job not yet settled, `job_output(job_id, wait: true,
timeout_ms: 600000)`. When a job settles, the child's return is the LAST JSON object in
its final text (text before it is allowed, `returns.md` §5). It is usable only if it is
exactly one of `returns.md` §1's two shapes — every key present, no extra key, each enum
value one of ossify's, a non-empty `gaps` whose every element carries exactly `section`,
`question` and `severity`:

- `mode: complete` → go to §4 for this item.
- `mode: gaps-surfaced` → go to §6 for this item.
- anything else, or a stop reason other than completed (error, refusal, max-tokens,
  killed) → the stop rule, below. Nothing is retried in v0.

**The stop rule.** Every child return that is not a usable result ends the same way: write
no record for that item; let the round's other jobs settle and take them through §4–§6, so
no child is left running; then stop before §7 and report to the operator the item, its job
id, the stop reason and the last output. The round is not handed back; the operator owns
recovery. `job_kill` only on the operator's word.

### 3a. The route check — every child, when it settles

Before you use any child's return — implementer, correction or verifier — confirm the route it
actually ran on, from its own transcript, never from its words:

1. **Find your own session.** Your session id is `$DSH_SESSION_ID` in the bash tool, and your
   directory is `ls -d "${DSH_HOME:-$HOME/.dsh}"/sessions/*/"$DSH_SESSION_ID"`. Its `subagent/catalog` events
   list every child you started: `data.childId`, and `data.label`, which is the `description`
   you sent (`work item <id>`, `verify <id>`, `correct <id>`).
2. **Find the child.** Take the newest child whose catalog label is this call's description.
   Its transcript is `session.v3.jsonl.zstd` (read it with `zstd -dc`) in the `<childId>`
   directory beside yours, and it must pass three checks:
   - its first line, the `session` line, carries `"origin":"subagent"`;
   - that line's `"parentSession"` equals your session id;
   - its first `user/message` names this item's `handoff_path`.

   A successor's directory sits beside its predecessor's and that predecessor's children, so
   the `parentSession` match is what keeps a predecessor's child for the same item out.
3. **Read its route.** Its newest `request/header` gives `data.header.config`: `provider`,
   `model`, `reasoningEffort`.
4. **Compare it with the expected route:**
   - an implementer or a correction: the implementer row from §2 step 0, or your own route
     when there is no row;
   - a verifier: always your own route.

   Your own route is your newest `request/header`, all three fields.
5. **On a mismatch, stop.** No such transcript, or any difference, is the stop rule (§3): no
   record for the item, and the report names the expected route and the one the child ran.

## 4. Verify a complete return

Foreground, one item at a time, in declared order:

1. Resolve the return's `report_path` first: it must be `report.md` beside the request's
   `spec_path` and `handoff_path`. The request's documents are ossify's; that one path is the
   child's, and nothing downstream — the fingerprint below, or the verifier's read — may
   touch a path the request did not name. Any other path is the stop rule (§3).
2. Fingerprint the item: `head_oid` (`git -C <worktree_path> rev-parse HEAD`), `tree_oid`
   (`git -C <worktree_path> write-tree`), `git -C <worktree_path> status --porcelain`, and the
   blob ids of the report, the spec and the handoff (`git hash-object`) — the handoff sits
   outside the worktree, so nothing else in this procedure covers it, and the spec's and the
   handoff's must still equal §2 step 1's baseline.
3. Fill the verifier prompt (`dsh-brief` §3): CLAIMS from the item's spec (`dsh-brief` §3 —
   one per `auto:` AC, none for a `user:` row), the two fixed claims, the four paths.
4. Call `subagent_verifier` with `description: "verify <work_item_id>"` and that prompt.
   The call names no `provider`, `model` or `reasoning_effort`: the verifier tool is not
   selectable, so it runs your route and effort, and a call naming one is refused
   (`child model selection is disabled for this tool instance`).
5. Fingerprint again. Any difference means the verifier changed the item: the stop rule (§3).
6. Gate the worktree, whatever the verdict turns out to be: the three rows §5's block reads —
   the branch, `HEAD` against the request's `base_sha`, and the staged-only status — each
   against the request. Any disagreement is the stop rule (§3) — never a correction, never a
   record, and never a packet built from the state that failed the gate.
7. Read the reply. PASS only when every claim you issued has exactly one line and each says
   `pass`, followed by `VERDICT: PASS` → §5. A well-formed reply naming a `fail` or
   `cannot determine`, with `VERDICT: FAIL` → §4a. A reply missing a claim, repeating one, or
   whose verdict contradicts its lines is not a verification: the stop rule (§3).

### 4a. One correction, then the operator

1. The fingerprint from §4 step 2 is the rejected result's identity, and §4 step 6 has
   already confirmed it against the request — so the packet can never encode a state that
   gate would have refused: `head_oid` and `tree_oid` go into the packet. A correction is a
   dispatch of the item and counts against ossify's cap of three dispatches
   (`correction-continuation.md` §4, `round-orchestration.md` §6) — the original, every gaps
   replacement, every correction.
   If this correction would be the fourth, it is not sent: the stop rule (§3).
2. Fill the correction prompt (`dsh-brief` §4) with the packet: `handoff_path`,
   `work_item_id`, `expected_branch` = the request's `branch`, `expected_head_sha`,
   `expected_tree_oid`, `failures` = the verifier's FAILURES lines.
3. Call `subagent_implementer` with `description: "correct <work_item_id>"`, foreground,
   with the implementer row's `provider`, `model` and `reasoning_effort`, as in §2.
4. On a return that passes §3's usability test and is `complete`, verify again (§4, once);
   PASS → §5. A second FAIL (report both verifier outputs), a refusal
   (`correction-continuation.md` §3 step 2), a return that fails §3's usability test, or any
   other return → the stop rule (§3).
   Never a third attempt.

A corrected item's result record is computed afresh in §5 and must pass the whole identity
table again (`external-executor.md` §7); the continuation's own return is never carried over.
A correction packet ossify's close sends back after rejecting an item (`external-executor.md`
§7, "to the same executor") is a new invocation of this procedure, run as a round of one:
`dsh-brief` §4 with that packet, then §4 verify, then §5 afresh, then §7 — resolving the roles
(§2 step 0) and baselining that item's spec and handoff (§2 step 1) immediately before the
correction is dispatched, since this path enters at §4 and never runs §2. The
one-correction limit above counts attempts within one invocation; ossify's three-dispatch
cap (step 1) counts across them and applies to a close-sent packet as to any correction.
How many close rejections an item gets is ossify's (`close/references/impl-check.md` §6),
not this skill's.

## 5. Compute the result record

All values are read from the worktree and the documents, never from the child's words — the
same rows §4 step 6 gated on, read again here to build the record:

```bash
WT="<worktree_path>"; REPORT="<report_path from the return>"; SPEC="<spec_path>"
git -C "$WT" rev-parse --abbrev-ref HEAD      # must equal the request's branch
git -C "$WT" rev-parse HEAD                   # head_oid; must equal the request's base_sha
git -C "$WT" write-tree                       # tree_oid
git -C "$WT" status --porcelain               # every line must start with a staged code (M, A, D, R, C, T in column 1) and have a space in column 2; no '??'
git hash-object "$REPORT"                     # report_oid
git hash-object "$SPEC"                       # spec_oid
```

Also check `REPORT` is `report.md` in the same directory as `spec_path` and
`handoff_path`. If the branch, `HEAD` or the status check disagree with the request, do not
build a record: name the row that disagreed and apply the stop rule (§3) — ossify's §5a
would halt on it anyway, and a record that hides it is worse than none.

Write the record in ossify's shape (this skill's `references/records.md`, "The result
record"): `coordinator_verdict: accepted`, `implementer_return` copied unextended from the return,
the four oids. `stage_status` is copied from the return; ossify recomputes it, never trusts
it.

## 6. A gaps return

Before anything else, check the worktree is untouched: `git -C <worktree_path> status
--porcelain` is empty, `rev-parse HEAD` equals the request's `base_sha`, `rev-parse
--abbrev-ref HEAD` equals the request's `branch`, and the spec's and the handoff's blob ids
still equal §2 step 1's baseline — a child that edited its own contract is the same defect
here as anywhere else. Anything else means something else ran:
the stop rule (§3). Otherwise write the gaps record (this skill's `references/records.md`,
"The gaps record") with the child's `gaps` copied unextended; it goes back through §7 with the
round's other records. It routes; it never reaches close. After §7, ossify's lane surfaces
the gaps, appends clarifications to the handoff, and invokes this procedure again with one
new single-item request (same `branch` and `worktree_path`, read off the original
request); run that through §2–§7 as a round of one.

## 7. Hand the round back

Write every record — results and gaps, one per request, no missing, extra or duplicate
`work_item_id` — as YAML blocks into
`<spine spec dir>/round-<n>-external-records.yaml`, then continue `run-spine`'s lane at
`external-executor.md` §5a with that file as the caller's return. Every scalar copied from a
child — `summary`, and a gap's `question` and `section` — is model-written text and must be
written as a quoted YAML string, so a `: `, a leading indicator or an embedded newline
cannot change the file's parse or a value's type. Records are fed to close
in declared decomposition order, never arrival order; closes and merges stay serial; the
round barrier is untouched.

Then tell the operator, in chat, every child's route as §3a read it (each implementer,
verifier and correction), or that no `roles.md` was in force. The records file carries no route: its fields are ossify's.

A follow-up invocation never overwrites an earlier records file: a gaps replacement (§6)
writes `<spine spec dir>/round-<n>-<work_item_id>-gaps-<k>-external-records.yaml` and a
close-sent correction (§4a) writes
`<spine spec dir>/round-<n>-<work_item_id>-correction-<k>-external-records.yaml`, where `k`
is that item's gap or correction iteration.

## 9. At close — the reviewer's second pass

ossify's close runs its own code review, in your session, as `close/references/code-review.md`
says. That review is never handed to another agent. At close, resolve the file before
close's first step, reading it again as §2 step 0 does: close may run in a session that
dispatched no round.

Only a defect that bears on the reviewer's pass gates it: a duplicate or unknown row, or a
reviewer row other than `driver` whose `subagent_reviewer` tool you lack. Post any other
step 0 failure in chat as a warning, since it will stop a correction the close sends back,
and go on. On a gating defect, before close's first step:
- post the file and the row in chat;
- ask the operator, with `ask_user_question`, whether close continues without the reviewer's
  pass;
- on yes, close runs without it, and its report says the pass was skipped and why;
- on no, stop with nothing done and reply `halted: roles — <file> <row>`. It is never
  `halted: close-review`, because no review has run.

When the file names a reviewer other than `driver` and the pass is not skipped, add one
independent pass during close review:

1. After close's Axis A and Axis B findings are written down, and before their dispositions,
   call `subagent_reviewer` once, in the foreground, with the reviewer prompt (`dsh-brief` §6)
   for each hosting repo's spine diff: the same `repo_root`, `base_branch` and `spine_branch`
   close resolved for its own review.
2. Before and after each call, in that repo, take `git -C <repo_root> status --porcelain`,
   `git -C <repo_root> rev-parse HEAD` and `git -C <repo_root> rev-parse <spine_branch>`. The
   reviewer's tools are not restricted, so its read-only role is only its prompt. Any
   difference means it changed the tree: report the difference to the operator, and close
   does not continue on that tree without the operator's word.
3. Take the **last JSON array** in its reply. A code fence around it is normal. Each element
   must carry exactly `file`, `line`, `severity` and `claim`. Anything else is reported to the
   operator verbatim, and close continues on its own findings.
4. Add every finding to close's findings, marked as the reviewer's, and disposition them all
   under close's rules. The reviewer's severity is advice, and close's rules decide.
5. Record the reply's final `MODEL:` line in close's report. The claude-code provider keeps no
   transcript, so §3a cannot check it; the profile's pinned row is the control.

## 10. What you never do

You never commit, never push, never edit a worktree yourself, never write `.ossify/`
except through `oss`, never start a third attempt on an item within one invocation, never soften
`coordinator_verdict`, and never invent a field. If a tool refuses you, report it verbatim
and stop that step. Recovery beyond one correction is the operator's.
