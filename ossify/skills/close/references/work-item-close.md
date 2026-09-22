# Work-item close — the innermost layer

Depth for SKILL.md §4. Six steps in **binding order**: each step's output is the
next one's input, so running them out of order does not fail — it runs the gate
against paths nobody resolved and merges a branch nobody checked.

This layer is reached two ways and must work identically in both: from the
execution lane, holding a `complete` return (`work-item/references/round-orchestration.md`
§6), and standalone as `/close <wi-id>` with nothing else in scope.

---

## 1. Resolve the three absolute paths

You need **`spec.md`**, **`report.md`** and the **worktree**. Nothing in state
holds a spec path, a report path, or a slug — a work item is
`{spine, title, target_repo, status, created_at, id, branch, worktree_path,
base_sha}` — so the docs paths are reconstructed, and the reconstruction is where
this layer most easily goes silently wrong.

**The worktree is the easy one**: state holds it, written by the execution lane.

_Dispatcher invocations below are `"$oss_bin" …` — the calling skill resolves `oss_bin` once (recipe: the plugin's `rules/dispatcher-path.md`); if it is unset in your context, resolve it there first._

```bash
wi="<work-item id>"
st="$("$oss_bin" get ".work_items[] | select(.id==\"$wi\") | .status")"
if [ "$st" = "abandoned" ]; then
  echo "close: $wi is abandoned - it was minted and withdrawn BEFORE any dispatch, so it has no worktree by construction and nothing to close. This is NOT the skipped-work_item_exec case below, and nothing should be reconstructed for it: spine close skips an abandoned item, and the withdrawal's own two obligations live in DIFFERENT owners: the demo-ledger amendment it owes is plan-spine/references/decomposition.md §1, and the repo armed for its spine - restore its checkout, or record it as parked - is spine-close.md §3, which this standalone route never reaches. To reverse the withdrawal: \"$oss_bin\" work_item_status $wi planned - but if this item's spine is ALREADY closed, that alone is not the recovery: un-withdrawing leaves a planned item inside a closed spine, and release close's tag selector takes any non-abandoned item whose spine is closed, so a later release close would tag a repo whose work was never dispatched or landed. Reopening the spine does NOT re-enable it: work-item/references/round-orchestration.md §2 halts on an existing spine branch, which close leaves behind in every hosting repo (issue #133 is the open reconciliation). Carry the work into a NEW spine instead - \"$oss_bin\" spine_add <release> <name> <class> <target-repo>, then \"$oss_bin\" work_item_add it there (plan-spine/references/decomposition.md §1's whole-spine arm) - halt"
  exit 1
fi
wt="$("$oss_bin" get ".work_items[] | select(.id==\"$wi\") | .worktree_path")"
[ -n "$wt" ] && [ "$wt" != "null" ] && [ -d "$wt" ] \
  || { echo "close: no recorded worktree for $wi - halt"; exit 1; }
```

**Test for `null`, not just emptiness.** `"$oss_bin" get` is `jq -r`: a field that is
absent or JSON-null prints the four characters `null`, which is non-empty and
passes `[ -n … ]`. Every state read in this layer is guarded that way, and the
merge target in step 4 is the one where it matters most — `git merge null`
resolves nothing and the guard that was supposed to catch it already passed.

A missing `worktree_path` means the lane skipped `"$oss_bin" work_item_exec`. That is a
halt, not something to reconstruct: `"$oss_bin" worktree_resolve <target_repo> <wi>`
will happily echo a conventional path whether or not it is the one this item was
built in. **The block tests one other cause first**: an item withdrawn before any
dispatch is `abandoned`, and *that* is why it has no worktree — it was never
dispatched, so there is nothing to reconstruct and nothing to close. The two
cases want opposite actions (one is a broken lane, the other is a plan that
deliberately dropped the item), which is why the status is read before the
diagnosis rather than after it.

### Route A — in the round flow

The report's *content* is deliberately not in the return payload, but
`report_path` **is**, and it is guaranteed absolute and ending in `report.md`
(`work-item/references/returns.md` §2). `spec.md` is its sibling: `work-item/SKILL.md`
§7 authors the report next to `spec.md` and `handoff.md` in the work item's
directory.

```bash
report="<report_path from the complete return>"
spec="$(dirname "$report")/spec.md"
```

Route A gives you the paths and nothing else. Step 4 additionally needs the
**spine branch**, which a round-flow caller already holds — it cut and checked it
out before round 1 (`work-item/references/round-orchestration.md` §2). A standalone caller has neither,
and recovers both from Route B.

### Route B — standalone

Reconstruct from the id alone. The directory shape is the one the execution lane
writes the handoff into (`work-item/references/round-orchestration.md` §4) — the two must stay
byte-identical, because a drift between them has no runtime signal:

```text
<ai-workspace>/docs/specs/<release-id>/<spine-id>-<spine-slug>/work-<wi-id>/
```

The release and spine ids come out of
`"$oss_bin" id_parse`'s numeric components (`routing.md` §2); the **spine slug** does
not — nothing persists one (spines store `name`, work items store `title`), so it
is recovered by globbing the spine directory, exactly as the execution lane
recovers it for the spine branch.

```bash
parts="$("$oss_bin" id_parse "$wi")" || parts=""
rel_id="r$(printf '%s\n' "$parts" | awk '{print $2}')"
spine_id="$rel_id.s$(printf '%s\n' "$parts" | awk '{print $3}')"
rel_dir="$("$oss_bin" release_dir "$rel_id")"   # ABSOLUTE, ai_workspace-rooted

matches="$(find "$rel_dir" -maxdepth 1 -type d -name "$spine_id-*" 2>/dev/null)"
n="$(printf '%s\n' "$matches" | grep -c . || true)"
[ "$n" -eq 1 ] || { echo "close: expected exactly one spine dir for $spine_id, found $n - halt"; exit 1; }

spine_dir_abs="$matches"
spine_slug="$(basename "$spine_dir_abs")"; spine_slug="${spine_slug#"$spine_id-"}"
wi_dir="$spine_dir_abs/work-$wi"
spec="$wi_dir/spec.md"
report="$wi_dir/report.md"
```

Three things that look like shortcuts and are not:

- **`"$oss_bin" spine_dir` returns a RELATIVE path** — `docs/specs/<rel>/<spine>-<slug>`
  — and it takes the slug as an argument, so it cannot *find* the directory. Once
  the glob has recovered the slug it re-composes the same relative path, which
  makes it a useful cross-check against `$spine_dir_abs`; it is never the way in.
- **Do not recover the slug from `work_items[].branch`.** That carries the
  *work-item* slug (`work/<wi-id>-<slug>`). Feeding it to a spine path builds a
  directory name that has never existed.
- **`$n` must be exactly 1.** Zero means the spine was never planned here; two
  means a rename left a stale directory, and `head -1` would pick one at random.

### Both routes end the same way

```bash
[ -f "$spec" ] || { echo "close: no spec.md for $wi at $spec - halt"; exit 1; }
```

**A missing or wrong spec path is a halt, named.** `"$oss_bin" verify_acs` returns rc 2
on a spec it cannot find, and a silently wrong path therefore fails the gate for
the wrong reason — the run reports a verification problem when what it has is a
path problem, and the recovery menu sends someone to fix code that is fine.

Carry `$spec`, `$report` and `$wt` forward as absolute paths. Nothing below
re-derives them, and nothing anywhere in this layer `cd`s (SKILL.md §3).

---

## 2. The gate

Run the four-layer implementation gate per **`references/impl-check.md`**, using
the `$spec`, `$report` and `$wt` resolved above. Never a bare placeholder: a
gate invoked on `<spec path>` runs against a file called `<spec path>`.

**Layer 4 needs one input Layers 1–3 never touch: `handoff.md`.** `$spec`,
`$report` and `$wt` are already proven to exist by step 1 and Layer 1/2's own
reads; `handoff.md` (`$(dirname "$spec")/handoff.md`) is not, and nothing below
validates it before use. Check it exists and is readable **before** running the
lenses — a missing or unreadable handoff is a halt, named
(`close: no handoff.md for $wi at <path> - halt`), not a silent empty-findings
result from a pass that never opened the file. Skipping this check does not
fail loudly: a read that never happened still produces a clean-looking
findings list, and the gate reports green having verified nothing.

**Layer 4 runs inline — the close applies the three §4b lenses itself**
(`references/impl-check.md`), on every harness. Read the staged diff,
`spec.md`, `handoff.md`, report §7 and the patterns file
(`03-code-patterns.md`, resolved as Layer 3 resolved it), and emit findings in
the §4b schema. There is no selection step and no second engine: this pass is
Layer 4, on every close that reaches it.

Apply the §4b verdict rule to the findings: an undeclared `fidelity` finding
fires the `[fidelity]` halt. The advisory findings are written
to `<work-item-dir>/verify.md` — `$(dirname "$report")` on Route A, `$wi_dir` on
Route B — and echoed in the close summary.

**Every completed Layer 4 run overwrites `verify.md`, even when there are zero
advisory findings — delete the file rather than leave a stale one.** A work
item can reach this step more than once: a `[fidelity]` halt sends it back to
the recovery menu (§5), and Layer 4 runs again on the next attempt. If that
retry is clean, an old `verify.md` from the halted attempt is still sitting
there — code-review.md treats an existing file as current evidence and does
not re-judge it (its own text says so), so a stale file would carry forward
findings the retry already resolved. There is no "no run happened" state to
distinguish from "this run found nothing": every completed Layer 4 run writes
the current truth.

Green → step 3. Anything else → step 5.

---

## 3. Prove there is something to commit

The gate ran against the **working tree**; the commit runs against the **index**,
and they are not the same thing.

```bash
staged="$(git -C "$wt" diff --cached --name-only)"
[ -n "$staged" ] || { echo "close: gate is green but the index is empty in $wt - halt"; exit 1; }
```

The implementer also reports `stage_status` — `all_staged`, `partial`, or `none`
(`work-item/references/returns.md` §2):

| `stage_status` | Action |
|---|---|
| `all_staged` | proceed, once the index check above passes |
| `partial` | **halt** unless the report explains it in its blockers-and-advisories section |
| `none` | **halt** |

**Never `git add` on the implementer's behalf.** Staging is its job; a silent
re-stage hides the discrepancy and commits whatever the worktree happens to hold,
including files the gate never saw.

---

## 4. On green — commit, then merge

The commit boundary is the orchestrator's: the implementer stages, this layer
commits. The merge is what actually moves the work onto the spine.

```bash
# The item's OWN repo, read from state - never a bare "canonical". A spine can
# host items across several declared repos (round-orchestration.md §2 cuts the
# spine branch in every one of them); this layer closes ONE item, so it targets
# exactly the repo that item recorded at work_item_add time.
target_repo="$("$oss_bin" get ".work_items[] | select(.id==\"$wi\") | .target_repo")"
# `ai_workspace` BEFORE the resolver, because the resolver SUCCEEDS on it: it is
# the reserved alias for the process workspace, so treating resolution as proof
# of a hosting repo would route this close's commit and merge into the AI
# workspace itself. `oss work_item_add` refuses the key now, but a record
# written before that guard - or hand-edited state - still reaches here.
[ "$target_repo" != "ai_workspace" ] \
  || { echo "close: $wi targets 'ai_workspace', which is the process workspace, not a hosting repo - no ceremony governs that repo and nothing may be merged into it - halt"; exit 1; }
repo_root="$("$oss_bin" repo_root "$target_repo")" || { echo "close: $wi targets undeclared repo '$target_repo' - halt"; exit 1; }

# The merge target comes from STATE, written by the execution lane.
wi_branch="$("$oss_bin" get ".work_items[] | select(.id==\"$wi\") | .branch")"
[ -n "$wi_branch" ] && [ "$wi_branch" != "null" ] \
  || { echo "close: no recorded branch for $wi - halt"; exit 1; }

# The spine branch: in the round flow it is already in scope; standalone,
# recompose it from the slug step 1 recovered.
spine_branch="$("$oss_bin" branch_name "$spine_id" "$spine_slug")"
head_branch="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD)"
[ "$head_branch" = "$spine_branch" ] \
  || { echo "close: $target_repo is on '$head_branch', not '$spine_branch' - halt"; exit 1; }

git -C "$wt" commit -m "<message>"
wi_sha="$(git -C "$wt" rev-parse HEAD)"

git -C "$repo_root" merge --no-ff "$wi_branch" -m "merge $wi" || { echo "close: merge conflict - halt"; exit 1; }
git -C "$repo_root" merge-base --is-ancestor "$wi_sha" HEAD \
  || { echo "close: merge reported success but $wi_sha is not reachable from HEAD - halt"; exit 1; }

"$oss_bin" work_item_status "$wi" complete
```

**Read the branch from state; never re-derive it from a slug.** This layer is
invoked with an id only and derives its scope from the id's shape — it has no
work-item slug, and none is persisted. The execution lane writes the branch it
actually created into `work_items[].branch` precisely so this step can read it
back. `"$oss_bin" work_item_branch "$wi" "$slug"` needs a `$slug` that does not exist
here; it is the id grammar's name generator, not a lookup.

**Verify the merge target before merging.** `git merge` lands on whatever
`$target_repo` has checked out. The execution lane parks **every repo hosting
one of the spine's items** on the spine branch for the whole spine
(`round-orchestration.md` §2); if `rev-parse --abbrev-ref HEAD` in *this item's*
repo says anything else, **halt** — a merge onto the wrong branch **succeeds
silently at rc 0**, the work never reaches the spine, and the first thing that
notices is a cumulative demo measuring a tree assembled by accident.

**Status is set last, after the merge is verified landed.** Spine close reads
`complete` as "this item's work is on the spine branch" — it is the only signal
of that the status enum can carry (`planned|active|complete|abandoned`). Setting
it before the merge means a conflict halt leaves state asserting a merge that
never happened, and the next spine close believes it. **Work-item close never
sets `abandoned`.** That status belongs to an item withdrawn before any dispatch
(`plan-spine/references/decomposition.md` §1); an item that reached this
ceremony was dispatched, and its close lands or halts.

**A merge conflict halts.** Surface the conflicted paths verbatim and stop. Never
auto-resolve, never `--abort` on the user's behalf, and never `-X` a strategy
option to make it go away. If the operator says *resolve it*, the discipline is
`merge-conflict-resolution.md` — hunk by hunk, by each side's recorded intent.
Resuming after the human resolves means finishing
*this* step — the merge and its reachability check, then the status — not
re-running the layer: the commit already landed on the work-item branch, so a
re-run halts at step 3 with an empty index and reports the wrong problem.

**This merge is not optional bookkeeping.** Without it the commits live only on a
branch that spine close cannot delete — `"$oss_bin" worktree_remove` refuses an unmerged
branch (rc 8) — so the round halts at cleanup, *after* the cumulative demo has
already reported green against a tree in `$target_repo` that never received the
work.

---

## 5. On any failure — halt

Terminal, at every layer. No later step runs, no status is written, nothing is
recorded as closed.

1. Surface the errors with their **source tags** — `[AC]`,
   `[report cross-check]`, `[rule]`, `[fidelity]` (`impl-check.md`).
2. Present the **recovery menu**.
3. **Stop. No auto-select.** The user picks.

The disposition-triage policy that auto-applies spec-aligned recommendations
(SKILL.md §4) governs the *disposition rows* at spine close. It does not reach
here: a failed gate is a human decision, and the menu's options have different
costs and different blast radii.

---

## 6. Worktree cleanup does not happen here

It happens at **spine close, as the last step**, and the reason is the branch —
not the report.

`"$oss_bin" worktree_remove` refuses an unmerged branch at **rc 8**, so cleanup can
only succeed after step 4's merge — the full ordering argument, and the false
one it is often confused with, are in `harvest.md` §1.
