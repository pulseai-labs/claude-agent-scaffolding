# External-executor mode — the caller-supplied execution seam

Depth for `round-orchestration.md` §5. Reached **only** from
`/run-spine <spine-id> --external-executor`. Without the flag none of this
applies and the lane dispatches its own nested implementer exactly as it always
has; that path is not deprecated, not degraded, and not the fallback for
anything here.

This mode is **provider-neutral by construction.** It names no orchestrator, no
product, no terminal, no model and no alias. It defines two records and a
handshake; who executes the work between them is entirely the caller's business,
and ossify neither knows nor asks. If you find yourself about to write the name
of a specific tool into this file, you have started designing the caller.

> **Editing note.** This file is asserted to contain no subagent *invocation*
> form — the `Task` tool's call syntax, an `Agent` call, or the argument that
> names a registered subagent. That is deliberate and it is checked
> (`tests/test-external-executor-contract.sh`). State the prohibition in words;
> do not paste the call shape you are prohibiting.

---

## 1. What changes, and what does not

External mode replaces **one step** of the lane: the dispatch in
`round-orchestration.md` §5. Everything on either side of that step is the same
document it was.

| Still owned by the lane, unchanged | Handed to the caller |
|---|---|
| the spine-branch cut and checkout (§2) | executing one work item against its handoff |
| the per-item worktree, `oss work_item_exec`, `oss work_item_status` (§3) | |
| authoring every `handoff.md` (§4) | |
| the return contract it accepts back (`references/returns.md`) | |
| the close, the commit, the merge, the round barrier (§7) | |
| the 3-iteration cap and the gap loop (§6) | |
| operator ownership of every recovery choice | |

**The lane does not call a subagent in this mode**, and it does not fall back to
calling one. The caller's procedure is a requirement, not a preference: a
`--external-executor` run with no caller-supplied procedure in scope is a
refusal before the spine-branch cut, not a run that quietly reverts to the
default.

---

## 2. Round sequencing

Do all of §3 and §4 for **every item in the round, in declared decomposition
order, before building any request.** Worktrees created and journaled, handoffs
authored, specs confirmed to parse — the whole round's preparation lands first.

Then build one request per item, still in declared order, and invoke the
caller-supplied procedure **once for the round**, handing it the whole set.

The caller may execute the round's requests concurrently; nothing here requires
otherwise, and §7's note that items within a round are parallel by construction
is exactly as true through this seam as through the default one. What stays
serial is everything after the returns — see §5a.

---

## 3. The request record

One per work item, every field required, no field optional and none added:

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

Every value comes from what §3 and §4 just did — `worktree_path` and `branch`
are read back off the worktree, never re-derived, for the same reason §3 gives.
Paths are absolute. The request carries no instructions: the handoff is the
contract, and restating rules here would create a third copy that drifts from
both it and the implementer's own body.

---

## 4. The result record

The caller returns exactly one of these per request:

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

`implementer_return` is ossify's **existing** complete-return object
(`references/returns.md` §2), unextended. External mode adds no third return
mode and widens no enum; a caller that needs to say something else says it
in `summary` and in the report, exactly as every implementer does.

`coordinator_verdict` is the caller's own statement that it accepted the work it
is handing back. It is not a gate ossify delegates — the gate is still
`close`'s — it is the caller declaring that what follows is a result rather
than a fragment.

The four `*_oid` values are the item's identity at the moment the caller
finished: the staged index (`git write-tree`), `HEAD`, and the blob ids of
`report.md` and `spec.md`. They are the same four components
`close/references/work-item-close.md` §2 fingerprints, and for the same reason.

---

## 5a. A complete result

**First, across both envelopes.** Exactly one envelope per request — §4 and §5b
records counted together, no missing, extra or duplicate `work_item_id` — and
only then does each reach its own list; a round failing this halts before either.

The §4 record is what a **finished** item returns. Four checks, all terminal:

1. **Field parity.** Every field in §4 and no other, `implementer_return` carrying
   exactly the complete return's four keys (`references/returns.md` §2):
   `mode`, `report_path`, `summary`, `stage_status`.
2. **`coordinator_verdict` is `accepted`** — not a softer accept that reads like one.
3. **`mode` is `complete`.** An item that surfaced gaps did not finish and comes
   back as §5b's record; any other `mode` here is malformed.
4. **The item is the request's worktree, unmoved, fully staged, with the
   request's documents.** Recompute every row — against the **request** (§3),
   not only against the record — and halt naming any row that fails:

   | Recomputed | Must equal |
   |---|---|
   | the checked-out branch | the request's `branch` |
   | `HEAD` | the request's `base_sha`, **and** the declared `head_oid` — an executor that commits and then stages again agrees with itself while having crossed the commit boundary that belongs to close |
   | the staged tree (`write-tree`) | the declared `tree_oid` |
   | `git status --porcelain` | staged entries only, no unstaged and no untracked — so `stage_status: all_staged` is **recomputed here, never trusted** |
   | the report's path | the `report.md` beside the request's `spec_path` and `handoff_path`, not any file that happens to hash right |
   | that report's and that spec's blob ids | the declared `report_oid` and `spec_oid` |

A malformed, non-accepted or moved record halts the round — never a degrade into
the nested path, no stop-and-reinvoke step, and the operator owns the recovery.

Records that pass are fed into close **in declared decomposition order, never
arrival order** — `round-orchestration.md` §7's rule, unchanged and doubly
relevant here because a concurrent caller makes out-of-order arrival the normal
case. Closes and merges stay serial; the round barrier is untouched.

---

## 5b. A gaps-surfaced return

An item whose pre-flight stopped it never produced a report, a staged tree or a
commit, so it has no fingerprint to carry and returns a **different, smaller
record** under its own marker:

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

Three fields, and **no `*_oid` of any kind** — there is nothing to fingerprint,
and a record that carries one is describing work that happened. `coordinator_verdict`
is still `accepted`: the caller accepted the *return*, not a finished item.
`implementer_return` is ossify's existing gaps shape (`references/returns.md`
§3), unextended — `mode`, and a non-empty `gaps` whose every element carries
`section`, `question` and `severity`.

**It is validated before it routes.** Exactly those three fields and no other;
`coordinator_verdict` is `accepted`; `mode` is `gaps-surfaced`; `gaps` is
non-empty and every element carries `section`, `question` and `severity`. A
malformed gaps record halts like any other malformed envelope — only a valid one
routes.

**And the worktree is checked before the replacement request goes out**, because
this record carries no identity of its own: `git status --porcelain` must be
empty, `HEAD` must equal the request's `base_sha`, and the checked-out branch
must equal the request's `branch` — a pre-flight that stopped leaves nothing
behind, so anything there means something else ran. **The replacement request
(§3) carries the original request's `branch` and `worktree_path` unchanged**,
read off that request and never re-read from the worktree, so an executor that
left the worktree on some other branch cannot have that branch become the
expected one on the retry.

**A valid record routes; it never halts and it never reaches close.** The item
enters `round-orchestration.md` §6's gap loop with **one step replaced**: the
lane surfaces the gaps and appends the clarifications to that item's handoff
exactly as §6 says, and then — instead of §6's own dispatch — builds **one new
single-item request** (§3) for that item and issues it through the
caller-supplied procedure. It counts against the same 3-iteration cap. The lane
dispatches nothing itself in this mode and does not say which executor the
caller uses: reuse is the caller's business, not ossify's. When the item
finishes, it comes back as a §4 record and goes through §5a.

---

## 6. Layer 4 under this mode

External mode **runs Layer 4 inline** — the lenses applied by the close itself,
per `close/references/impl-check.md` §4b's inline path — even where the
delegated path's own conditions would otherwise be satisfied. The reason is
arithmetic, not doctrine: the caller has already put a reviewer of its own on
this item, and following it with a fan-out of hidden delegated agents spends a
second review nobody asked for on a diff that has just been read.

The lenses, the finding schema and the verdict rule are `impl-check.md`'s and do
not change. Nothing about the default no-flag path changes either — it keeps
choosing the delegated path under exactly the conditions it chose it under
before.

---

## 7. Correcting an item without re-running the command

A result that close rejects cannot simply be re-dispatched: ordinary
`/work-item` begins with a clean-tree pre-flight that correctly refuses a
worktree holding staged output. `references/correction-continuation.md` is the
provider-neutral continuation for that case, and it goes to the **same**
executor the caller used for that item. **What comes back is a fresh §4 record
that passes the whole of §5a again, identity table included** — the
continuation's own `complete` shape is never accepted on its own, because a
repaired item has moved and its identity has to be re-established, not carried
over. Everything else about recovery —
who chooses, what the menu offers, the second-failure escalation — is
`close/references/impl-check.md` §6's and stays there.
