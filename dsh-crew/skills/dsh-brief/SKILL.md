---
name: dsh-brief
description: The prompts a DeepSeek Harness spine session sends to its child tools (subagent_implementer, subagent_verifier) and the persona text each tool is configured with. Use when composing a child call for an ossify work item, its verification, or a correction, or when a child is told to load its brief. Not a workflow — ossify's work-item skill owns what the implementer does; this file only says how the child is addressed and what it must return.
---

# dsh brief — how a spine session addresses its children

## 1. You are here

A child in dsh is a fresh in-process agent: it inherits the spine session's working
directory, provider, model and effort, sees none of the spine session's conversation, and
carries the persona its tool instance was configured with (§5). Everything else it needs is
in the prompt. So every prompt below is the whole contract the child will ever see, and
angle brackets are slots: fill every slot, delete nothing else.

Paths are absolute. `cd` never persists in the dsh bash tool; the child uses the tool's
`workdir` field or `git -C <path>`.

## 2. Implementer prompt

Send as the `prompt` of `subagent_implementer`. The `description` is `work item
<work_item_id>`.

```text
ROLE: ossify work-item executor. Your first action is skill({ name: "work-item" }); its
body is your binding system prompt — pre-flight gates, RED gate, TDD loop, verification,
the report contract, the two return shapes and the NEVER list.

REQUEST (ossify external_execution_request, verbatim):
work_item_id: <work_item_id>
target_repo: <target_repo>
handoff_path: <handoff_path>
spec_path: <spec_path>
worktree_path: <worktree_path>
branch: <branch>
base_sha: <base_sha>

The handoff is the contract. Read it end to end before anything else.

PLACEMENT: work only inside <worktree_path>, on branch <branch>, base <base_sha>. Use the
bash tool's workdir field or git -C for every command; cd does not persist.

DONE: write report.md beside the spec, stage as the work-item skill's §8 says, and return
exactly ONE JSON object as your final message and nothing after it — one of the two
shapes from the work-item skill's returns contract (references/returns.md §1), verbatim,
unextended:
{"mode": "complete", "report_path": "<abs path to report.md>", "summary": "<one-line>", "stage_status": "all_staged | partial | none"}
or
{"mode": "gaps-surfaced", "gaps": [{"section": "<ref>", "question": "<concrete question>", "severity": "blocking | nice-to-have"}, ...]}

NEVER: commit, push, edit a file outside <worktree_path> other than report.md, write
ossify state, or start a subagent. If a tool refuses you, report it verbatim in summary
and stop that step.
```

## 3. Verifier prompt

Send as the `prompt` of `subagent_verifier`, foreground. The `description` is `verify
<work_item_id>`. CLAIMS are filled from the item's spec: one per acceptance criterion,
then the two fixed claims.

```text
ROLE: verifier, read-only.

PLACEMENT: <worktree_path>, branch <branch>. Read <spec_path>, <handoff_path> and
<report_path> end to end first. Use the bash tool's workdir field or git -C; cd does
not persist.

CLAIMS:
  1. <acceptance criterion>: <how to check>
  2. <acceptance criterion>: <how to check>
  N-1. The staged diff matches the requirement: read the requirement, then
       `git -C <worktree_path> diff --cached`.
  N. When the item adds or changes a test: that test fails when the item's implementation
     edits, not the test, are reverted in a disposable copy that carries the staged
     change (see NEVER); when no test is added or changed, delete this claim (never
     `cannot determine`).

DONE: return, as your final message and nothing after it:
  one line per claim — `<n>. <claim>: pass | fail | cannot determine — <evidence, commands
  and output verbatim>`
  then `VERDICT: PASS` or `VERDICT: FAIL`
  then, on FAIL, `FAILURES:` followed by one line per failing claim in the form
  `- <AC id or claim>: <what was observed>`.
`cannot determine` counts as fail.

NEVER: commit, push, stage, or edit a tracked file in <worktree_path>. The mutation
check in claim N works on a copy and never touches <worktree_path>. The change is staged,
not committed, so a copy cut at HEAD must be given it: remove a stale copy, if any, from an
earlier run (`git -C <worktree_path> worktree remove --force /tmp/verify-<work_item_id>`,
then `worktree prune`), `worktree add /tmp/verify-<work_item_id> --detach`, write the
staged diff with `git -C <worktree_path> diff --cached --binary >
/tmp/verify-<work_item_id>.patch` and `git -C /tmp/verify-<work_item_id> apply --index`
it there. Then revert the implementation edits in the copy, keep the test, run it, and
remove the copy. Any other write: stop and say so.
```

## 4. Correction prompt

Send as the `prompt` of `subagent_implementer` when the verifier returned FAIL. The
`description` is `correct <work_item_id>`. The packet is ossify's, verbatim
(`work-item/references/correction-continuation.md` §2); `failures` is the verifier's
FAILURES list, consolidated.

```text
ROLE: ossify work-item executor, continuing a run. Your first action is
skill({ name: "work-item" }); then read its references/correction-continuation.md and
follow its §3 in order — re-read the three documents, confirm the four identities below
and refuse on any mismatch, skip exactly the clean-tree pre-flight and the RED gate,
regression first, all corrections, every verification command, update the SAME
report.md, stage, return the complete shape.

OSSIFY CORRECTION CONTINUATION v1
handoff_path: <handoff_path>
work_item_id: <work_item_id>
expected_branch: <branch>
expected_head_sha: <head_oid from the rejected result>
expected_tree_oid: <tree_oid from the rejected result>
failures:
<one line per failure, from the verifier's FAILURES list>

DONE and NEVER: as in the implementer prompt — one JSON object as the final message,
never commit, never push, never a subagent.
```

## 5. Configured personas

These are the `persona` values of the two tool instances in the `crew-spine` preset
(`references/presets.md` in this plugin). A persona shadows the deployment persona for
that child alone; it is short because the prompt above carries the contract.

`subagent_implementer`:

```text
You are ossify's work-item executor. Load the `work-item` skill with the skill tool as
your first action; it is your binding system prompt. One handoff in, one JSON return out.
You never commit.
```

`subagent_verifier`:

```text
You are the crew's verifier for one ossify work item. Load the `dsh-brief` skill and
follow its verifier prompt as sent to you: read the spec, the handoff, the report and the
staged worktree; run the declared checks; return PASS or FAIL with the failing claims
named. You change no file and you never commit.
```
