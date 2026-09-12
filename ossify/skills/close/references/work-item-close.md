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

```bash
wi="<work-item id>"
wt="$(oss get ".work_items[] | select(.id==\"$wi\") | .worktree_path")"
[ -n "$wt" ] && [ "$wt" != "null" ] && [ -d "$wt" ] \
  || { echo "close: no recorded worktree for $wi - halt"; exit 1; }
```

**Test for `null`, not just emptiness.** `oss get` is `jq -r`: a field that is
absent or JSON-null prints the four characters `null`, which is non-empty and
passes `[ -n … ]`. Every state read in this layer is guarded that way, and the
merge target in step 4 is the one where it matters most — `git merge null`
resolves nothing and the guard that was supposed to catch it already passed.

A missing `worktree_path` means the lane skipped `oss work_item_exec`. That is a
halt, not something to reconstruct: `oss worktree_resolve <target_repo> <wi>`
will happily echo a conventional path whether or not it is the one this item was
built in.

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
`oss id_parse`'s numeric components (`routing.md` §2); the **spine slug** does
not — nothing persists one (spines store `name`, work items store `title`), so it
is recovered by globbing the spine directory, exactly as the execution lane
recovers it for the spine branch.

```bash
parts="$(oss id_parse "$wi")" || parts=""
rel_id="r$(printf '%s\n' "$parts" | awk '{print $2}')"
spine_id="$rel_id.s$(printf '%s\n' "$parts" | awk '{print $3}')"
rel_dir="$(oss release_dir "$rel_id")"   # ABSOLUTE, ai_workspace-rooted

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

- **`oss spine_dir` returns a RELATIVE path** — `docs/specs/<rel>/<spine>-<slug>`
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

**A missing or wrong spec path is a halt, named.** `oss verify_acs` returns rc 2
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
reads; `handoff.md` (`$(dirname "$spec")/handoff.md`) is not, and neither path
below validates it before use. Check it exists and is readable **before**
choosing a path — a missing or unreadable handoff is a halt, named
(`close: no handoff.md for $wi at <path> - halt`), not a silent empty-findings
result from an agent that could not read what it was told to. Skipping this
check does not fail loudly: a reader or refuter can still return a
schema-valid empty `findings` object having never read the file, `agents_run`
still reaches 6, and the gate reports green having verified nothing.

**Layer 4 runs delegated where it can, inline where it cannot — and inline,
by choice, under external-executor mode.** If `OSSIFY_NO_WORKFLOWS` is unset, a
tool named `Workflow` is available, **the lane is not in external-executor mode**
(`work-item/references/external-executor.md` §6 — the caller has already put its
own reviewer on this item, so six delegated agents behind it buy a second review
nobody asked for; take the inline path, which is the same judgment with the
host's own context), **and
the staged diff is nonempty** (`git -C "$wt" diff --cached --name-only` —
step 3 below halts unconditionally on an empty index regardless of what
Layer 4 finds, so dispatching six agents first is pure waste; take the
inline path instead, which costs nothing extra here), first fingerprint the
three components whose mutation could turn a real halt into a silent pass —
the worktree's identity (the staged index and `HEAD`), `report.md`, and
`spec.md` (together they decide the halt: `spec.md` is the fidelity lens's
own comparison target, §4b's `fidelity` — diff vs `spec.md` — decides
whether a deviation exists at all, and `report.md`'s §7 decides
`declared_in_report_s7`) — the six delegated agents
get ordinary worktree and filesystem tool access, and the read-only
instruction in their prompts is prose, not enforcement (the accepted spec
residual R4); an injected instruction in the staged diff, `report.md`, or
`spec.md` could get one of them to mutate the staged index, move `HEAD`
without touching the index (`git reset --soft`, which `write-tree` alone
would not detect), edit `report.md` mid-review — turning a real
undeclared-fidelity finding into a silently advisory one by forging a §7
declaration — or edit `spec.md` mid-review to erase or manufacture a
fidelity deviation outright, and nothing downstream would notice.
`handoff.md` and `03-code-patterns.md` stay unfingerprinted: they feed only
`pattern`/`absence` findings, which are advisory by design (§4b) — the worst
a mutated copy costs is noise in `verify.md`, never a wrong or missed halt,
so they are an accepted residual (R4-style), not a gap in this guard:

```bash
handoff="$(dirname "$spec")/handoff.md"
tree_id="$(git -C "$wt" write-tree)" || { echo "close: could not capture the staged index's identity in $wt before the delegated call - halt"; exit 1; }
head_id="$(git -C "$wt" rev-parse HEAD)" || { echo "close: could not capture HEAD's identity in $wt before the delegated call - halt"; exit 1; }
report_id="$(git -C "$wt" hash-object "$report")" || { echo "close: could not fingerprint $report before the delegated call - halt"; exit 1; }
spec_id="$(git -C "$wt" hash-object "$spec")" || { echo "close: could not fingerprint $spec before the delegated call - halt"; exit 1; }
printf '%s:%s:%s:%s\n' "$tree_id" "$head_id" "$report_id" "$spec_id"
```

**The invariant this states in one sentence: the staged index (`write-tree`),
`HEAD` (closing the `git reset --soft` gap `write-tree` alone leaves),
`report.md` and `spec.md` (together they decide the halt — see above) are
fingerprinted across the run; `handoff.md` and `03-code-patterns.md` are
not, because they feed only advisory findings whose damage ceiling is
wasted reviewer attention, never a wrong or missed halt.**

**Hold this command's output as `pre_fp` and carry it forward as a literal
value, exactly as `$spec`/`$report`/`$wt` are carried (§1).** The Workflow call
below is a separate tool invocation, not more of this shell — nothing assigned
in a bash block survives into the block after it on its own, and there is no
shell between here and there to survive in anyway.

Then call it with `${CLAUDE_PLUGIN_ROOT}/workflows/verify-work-item.js` — **not** a
plugin-relative `ossify/workflows/…`: an installed close runs in the consumer
project's own directory, not the plugin's, so a bare relative path resolves
against whatever `ossify/` the consumer happens to have (usually none) and the
call errors on every normal install, silently taking the fallback every time
(the same reason `commands/close.md` reads its own SKILL.md through
`${CLAUDE_PLUGIN_ROOT}`, not a relative path) — passing in `args` the three §4b
lenses — `fidelity`, `pattern`, `absence` — each as `{id, text}` taken verbatim
from `impl-check.md` §4b, plus the input paths: `spec`, `report`, `handoff`
(the work item's, beside `spec`), `patterns` (the memory-bank
`03-code-patterns.md`, resolved as Layer 3 resolved it), and `wt`. On any error,
a null lens result, a `findings: null` return, or `agents_run` below 6: run the
inline path and print `layer 4: inline (workflow unavailable: <reason>)`. No
retry, no resume. A clean delegated run prints `layer 4: workflow (6 agents)`.
The close summary states which path ran.

**Whatever the outcome — clean, errored, or fallen back — immediately
re-derive the same fingerprint and compare, substituting the literal value you
are carrying for `pre_fp` below:**

```bash
pre_fp="<the fingerprint the capture above printed>"
tree_id="$(git -C "$wt" write-tree)" || { echo "close: could not re-derive the staged index's identity in $wt after the delegated call - halt"; exit 1; }
head_id="$(git -C "$wt" rev-parse HEAD)" || { echo "close: could not re-derive HEAD's identity in $wt after the delegated call - halt"; exit 1; }
report_id="$(git -C "$wt" hash-object "$report")" || { echo "close: could not re-fingerprint $report after the delegated call - halt"; exit 1; }
spec_id="$(git -C "$wt" hash-object "$spec")" || { echo "close: could not re-fingerprint $spec after the delegated call - halt"; exit 1; }
post_fp="$(printf '%s:%s:%s:%s\n' "$tree_id" "$head_id" "$report_id" "$spec_id")"
[ "$pre_fp" = "$post_fp" ] || { echo "close: a fingerprinted Layer 4 input (the staged index, HEAD, report.md, or spec.md) changed during the delegated call in $wt - possible injection; inspect 'git -C $wt status'/'diff --cached', 'git -C $wt log -1 HEAD', and diff report.md/spec.md against their pre-call state, revert or unstage whatever the review added, and re-run - halt"; exit 1; }
```

A mismatch means one of the six agents wrote to something this pass never
asked it to touch — the staged index, `HEAD`, `report.md`, or `spec.md`,
the last two of which would otherwise let an injected agent forge a §7
declaration (turning a real undeclared-fidelity finding into a silently
advisory one) or rewrite the spec itself (erasing or manufacturing a
fidelity deviation outright). This closes the mutation path across the
components whose damage ceiling is a wrong or missed halt — not
`handoff.md`/`03-code-patterns.md` (advisory-only inputs, the accepted
residual) or the working tree files a delegated agent can still touch
outside this list (an unfingerprinted neighbour file the `pattern` lens
inspects, say); that read-path exposure is R4's accepted remainder, not
this gate's job.

**What this guard claims, stated as a boundary, not left implicit: it
catches persistent mutation — an alteration still present when the
delegated call returns. It does not claim to police what an agent reads
mid-review or whether its returned judgment is honest; an agent that lies
in its return value, or that mutates a fingerprinted file and restores the
original bytes before returning, corrupts nothing this guard can see and
needed no file access to begin with — the judgment itself is the trust
boundary (R4), which is exactly why a halt lands on the operator's recovery
menu rather than auto-applying, and why `verify.md` is advisory input to a
human review, not a verdict.**

Apply the §4b verdict rule to the findings from whichever path ran: an undeclared
`fidelity` finding fires the `[fidelity]` halt; on the delegated path, so does
`fidelity_truncated: true` on its own, naming truncation as the reason, even
if every finding actually returned is declared — the reader could not certify
it saw every genuine deviation. The advisory findings are written
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
distinguish from "this run found nothing": every completed Layer 4 run,
delegated or inline, writes the current truth.

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
target_repo="$(oss get ".work_items[] | select(.id==\"$wi\") | .target_repo")"
# `ai_workspace` BEFORE the resolver, because the resolver SUCCEEDS on it: it is
# the reserved alias for the process workspace, so treating resolution as proof
# of a hosting repo would route this close's commit and merge into the AI
# workspace itself. `oss work_item_add` refuses the key now, but a record
# written before that guard - or hand-edited state - still reaches here.
[ "$target_repo" != "ai_workspace" ] \
  || { echo "close: $wi targets 'ai_workspace', which is the process workspace, not a hosting repo - no ceremony governs that repo and nothing may be merged into it - halt"; exit 1; }
repo_root="$(oss repo_root "$target_repo")" || { echo "close: $wi targets undeclared repo '$target_repo' - halt"; exit 1; }

# The merge target comes from STATE, written by the execution lane.
wi_branch="$(oss get ".work_items[] | select(.id==\"$wi\") | .branch")"
[ -n "$wi_branch" ] && [ "$wi_branch" != "null" ] \
  || { echo "close: no recorded branch for $wi - halt"; exit 1; }

# The spine branch: in the round flow it is already in scope; standalone,
# recompose it from the slug step 1 recovered.
spine_branch="$(oss branch_name "$spine_id" "$spine_slug")"
head_branch="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD)"
[ "$head_branch" = "$spine_branch" ] \
  || { echo "close: $target_repo is on '$head_branch', not '$spine_branch' - halt"; exit 1; }

git -C "$wt" commit -m "<message>"
wi_sha="$(git -C "$wt" rev-parse HEAD)"

git -C "$repo_root" merge --no-ff "$wi_branch" -m "merge $wi" || { echo "close: merge conflict - halt"; exit 1; }
git -C "$repo_root" merge-base --is-ancestor "$wi_sha" HEAD \
  || { echo "close: merge reported success but $wi_sha is not reachable from HEAD - halt"; exit 1; }

oss work_item_status "$wi" complete
```

**Read the branch from state; never re-derive it from a slug.** This layer is
invoked with an id only and derives its scope from the id's shape — it has no
work-item slug, and none is persisted. The execution lane writes the branch it
actually created into `work_items[].branch` precisely so this step can read it
back. `oss work_item_branch "$wi" "$slug"` needs a `$slug` that does not exist
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
the status enum can carry (`planned|active|complete`). Setting it before the
merge means a conflict halt leaves state asserting a merge that never happened,
and the next spine close believes it.

**A merge conflict halts.** Surface the conflicted paths verbatim and stop. Never
auto-resolve, never `--abort` on the user's behalf, and never `-X` a strategy
option to make it go away. If the operator says *resolve it*, the discipline is
`merge-conflict-resolution.md` — hunk by hunk, by each side's recorded intent.
Resuming after the human resolves means finishing
*this* step — the merge and its reachability check, then the status — not
re-running the layer: the commit already landed on the work-item branch, so a
re-run halts at step 3 with an empty index and reports the wrong problem.

**This merge is not optional bookkeeping.** Without it the commits live only on a
branch that spine close cannot delete — `oss worktree_remove` refuses an unmerged
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

`oss worktree_remove` refuses an unmerged branch at **rc 8**, so cleanup can
only succeed after step 4's merge — the full ordering argument, and the false
one it is often confused with, are in `harvest.md` §1.
