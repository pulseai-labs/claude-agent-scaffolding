# Records — quoted from ossify

Every block below is ossify's, quoted from `ossify/skills/work-item/references/`
(`external-executor.md` §3, §4, §5a, §5b; `returns.md` §2, §3; `correction-continuation.md`
§2) at ossify 1.11.2. Quoted prose is set as a blockquote, with its source named. This
file adds no field and widens no enum. When ossify changes a record, this file changes
with it and `tests/test-ossify-contract.sh` says so.

## The request record (one per work item; every field required, none added)

`external-executor.md` §3:

```yaml
external_execution_request:
  work_item_id: r7.s2.w1
  target_repo: canonical
  handoff_path: /abs/docs/specs/r7/r7.s2-schema/work-r7.s2.w1/handoff.md
  spec_path: /abs/docs/specs/r7/r7.s2-schema/work-r7.s2.w1/spec.md
  worktree_path: /abs/project/.worktrees/r7.s2.w1-schema
  branch: work/r7.s2.w1-schema
  base_sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

## The result record (a finished item)

`external-executor.md` §4:

```yaml
external_execution_result:
  work_item_id: r7.s2.w1
  coordinator_verdict: accepted
  implementer_return:
    mode: complete
    report_path: /abs/docs/specs/r7/r7.s2-schema/work-r7.s2.w1/report.md
    summary: All declared acceptance criteria pass
    stage_status: all_staged
  tree_oid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  head_oid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  report_oid: cccccccccccccccccccccccccccccccccccccccc
  spec_oid: dddddddddddddddddddddddddddddddddddddddd
```

> `implementer_return` is ossify's **existing** complete-return object
> (`references/returns.md` §2), unextended. External mode adds no third return
> mode and widens no enum; a caller that needs to say something else says it
> in `summary` and in the report, exactly as every implementer does.
>
> — `external-executor.md` §4

> 1. **Field parity.** Every field in §4 and no other, `implementer_return` carrying
>    exactly the complete return's four keys (`references/returns.md` §2):
>    `mode`, `report_path`, `summary`, `stage_status`.
>
> — `external-executor.md` §5a

> | `stage_status` | Exactly one of `"all_staged"`, `"partial"`, `"none"` (SKILL.md §8). |
>
> — `returns.md` §2

## The gaps record (an item whose pre-flight stopped it)

`external-executor.md` §5b:

```yaml
external_execution_gaps:
  work_item_id: r7.s2.w1
  coordinator_verdict: accepted
  implementer_return:
    mode: gaps-surfaced
    gaps:
      - section: AC-2
        question: Does an exhausted budget raise, or return a sentinel?
        severity: blocking
```

> **It is validated before it routes.** Exactly those three fields and no other;
> `coordinator_verdict` is `accepted`; `mode` is `gaps-surfaced`; `gaps` is
> non-empty and every element carries `section`, `question` and `severity`. A
> malformed gaps record halts like any other malformed envelope — only a valid one
> routes.
>
> — `external-executor.md` §5b

> | `severity` | Exactly `"blocking"` or `"nice-to-have"` — never `high`, `low`, or `critical` (preamble). |
>
> — `returns.md` §3

## The correction packet (sent back to the same executor after a rejection)

`correction-continuation.md` §2:

```text
OSSIFY CORRECTION CONTINUATION v1
handoff_path: /abs/docs/specs/r7/r7.s2-schema/work-r7.s2.w1/handoff.md
work_item_id: r7.s2.w1
expected_branch: work/r7.s2.w1-schema
expected_head_sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
expected_tree_oid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
failures:
- AC-2 fails when the persisted record is reloaded after restart
```

> Six fields, all required. `expected_branch` is the `branch` the item's execution
> request carried (`references/external-executor.md` §3); `expected_head_sha` and
> `expected_tree_oid` are the `head_oid` and `tree_oid` its result declared (§4),
> carried back unchanged. **All four identities the check in §3 compares are in the
> packet** — that is the point of carrying them rather than re-deriving them.
> `failures` is the **consolidated** list — every finding from the rejection in one
> packet, not one packet per finding.
>
> — `correction-continuation.md` §2

## The identity table ossify recomputes on a result record (§5a check 4)

`external-executor.md` §5a, check 4:

| Recomputed | Must equal |
|---|---|
| the checked-out branch | the request's `branch` |
| `HEAD` | the request's `base_sha`, **and** the declared `head_oid` — an executor that commits and then stages again agrees with itself while having crossed the commit boundary that belongs to close |
| the staged tree (`write-tree`) | the declared `tree_oid` |
| `git status --porcelain` | staged entries only, no unstaged and no untracked — so `stage_status: all_staged` is **recomputed here, never trusted** |
| the report's path | the `report.md` beside the request's `spec_path` and `handoff_path`, not any file that happens to hash right |
| that report's and that spec's blob ids | the declared `report_oid` and `spec_oid` |

> A malformed, non-accepted or moved record halts the round — never a degrade into
> the nested path, no stop-and-reinvoke step, and the operator owns the recovery.
>
> — `external-executor.md` §5a
