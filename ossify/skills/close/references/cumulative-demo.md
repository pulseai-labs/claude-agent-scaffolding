# The cumulative demo

Depth for SKILL.md §5, step 4 (`spine-close.md` §5). The demo is the spine's
proof that the *product* still works, not that the spine's own diff compiles —
which is why it runs the whole accumulated ledger and not just this spine's
contribution.

It is an **operated asset** (spec §6.1): every `auto:` line binds to a runnable
command at authoring time, the set has a wall-clock budget, and a line that fails
for reasons unrelated to any open spine gets parked with a ticket rather than
shrugged off.

---

## 1. Two halves, two different scopes

```bash
oss demo_run                        # every ACTIVE auto: line, from every spine
oss demo_user_lines "$spine_id"     # THIS spine's own user: lines
```

**The `auto:` half is cumulative; the `user:` half is scoped.** That asymmetry is
the spec's, not an optimization:

| | Spine close (§6.1) | Release close (§6.2) |
|---|---|---|
| `auto:` lines | all accumulated, every run | all accumulated |
| `user:` lines | **this spine's own contribution only** | **every** accumulated line, grouped by feature |
| Who drives the `user:` half | the human, here, now | the human, at the release gate |

One verb serves both: `oss demo_user_lines` **with** a spine argument filters to
`source_spine == <spine>`; **without** one it returns every active `user:` line.
Passing no argument at spine close silently turns a spine gate into a release
walkthrough — the run gets longer and longer, and the release gate stops being
the first place anyone notices a regression in an older journey.

Both halves run against **composition-root post-merge state**, which is why the
demo is step 4 and the merge is step 2. The runner resolves its working directory itself:
the declared composition root when the project has one, the sole declared
repo's root otherwise — refusing rather than guessing under more than one
declared repo (#272/#310 Task 4), never a literal `canonical`. Do not `cd` to
help it — the manifest walk starts at `$PWD` and a `cd`
re-points every later state read (SKILL.md §3).

---

## 2. Halt on the first failure, and the halt is terminal

`oss demo_run` stops at the first failing line and returns non-zero. It prints
the failing line's id and text, why it failed, and the **last five lines of that
command's output**:

```text
FAIL d4 - a saved query survives a restart (rc=1, wanted 0)
```

The ceremony halts there. **No later step runs** — no touch check, no critic, no
retrospective, no harvest, no cleanup, and no `spine_status closed`. Surface the
failing line verbatim and stop.

Three failure modes fail **closed**, deliberately, because the ledger is
append-only and a line written by an older validator is re-run forever:

- an `exit:` expectation whose operand is not digits-only,
- an `expected` the grammar does not recognize at all (`exit:<n>` and
  `contains:<str>` are the whole grammar),
- a **vacuous green** — a recognized test runner that executed zero tests, on a
  line expecting `exit:0`. It is checked only for a success expectation: a line
  legitimately expecting a non-zero exit from a runner is not vacuous.

On success the runner prints `PASS <n> lines`, where `<n>` counts the lines it
actually **ran**. Quarantined lines are not in that count.

**Never edit a line to make it pass.** You run the ledger; `plan-spine` authors
it. A criterion that is genuinely wrong goes back there, recorded, with this
close halted meanwhile.

---

## 3. The `user:` walk

`oss demo_user_lines "$spine_id"` returns a JSON array; each element carries the
line's `id`, its `text` (the journey, phrased as something a user does for value)
and its `outcome` (what they should observe).

Walk them **with the human, one at a time, in the order they come back**. Read
the text, let them perform it against the merged product, and ask whether the
outcome matched. A line the human reports as not matching is a **failure**, and
it halts exactly like an `auto:` failure — there is no "note it and move on" tier
here.

You may not perform a `user:` line on the human's behalf and mark it passed. The
whole reason the ledger keeps a `user:` half is that some outcomes are only
visible to a person using the thing.

---

## 4. Quarantine — a parking ticket, not a shrug

A line that fails for causes **unrelated to any open spine** may be quarantined:

```bash
oss ledger_quarantine "<line-id>" "<why it is unrelated to this spine>" "<release-id>"
```

The runner then prints `SKIP <line-id> (quarantined) - <text>` and continues; the
line stays in the ledger, stays visible in the doctor read-out, and is **still
owed**.
Spec §6.1 is explicit: a quarantined line must be **fixed or retired by the next
release close**. The release is recorded on the quarantine precisely so the
expiry has an anchor.

Two ways to abuse this, both of which convert a regression into a permanent
blind spot:

- **Quarantining a line this spine broke.** Then the spine closes green over its
  own regression. If the cause is in scope, fix it or halt.
- **Quarantining to get past a red demo under time pressure.** The ticket is
  cheap to write and expensive to owe; write it only when the "unrelated" claim
  would survive being read aloud at the release close.

### Establishing "unrelated" — the check, not the feeling

The read-aloud test above catches the obvious abuse. It does not *establish*
innocence, and the abuse it misses is the sincere one: an agent that genuinely
believes the failure is unrelated and is wrong. There is a mechanical check —
run it from the same workdir the runner resolved (§1 — the composition root,
which is required and absolute once more than one repo is declared, and the sole
declared repo's root when exactly one is):

```bash
# $wd is NOT ambient. `oss demo_run` resolves its workdir internally and never
# exports it, and neither spine-close.md nor this file ever assigned it - so
# under the close's `set -u` this block aborted on the first reference, and
# without it BOTH runs did `cd ""`, failed identically, and the matching output
# read as "already broken" - manufacturing the quarantine evidence. Bind it
# from the same resolution the runner uses before either invocation.
wd="$(oss demo_workdir)" \
  || { echo "halt: cannot resolve the demo working directory - see cumulative-demo.md section 1; the comparison is void without it"; exit 1; }
[ -d "$wd" ] || { echo "halt: resolved demo workdir '$wd' does not exist"; exit 1; }

# same command, both trees, and diff the OUTPUT before believing the rc
cmd="$(oss get ".demo_ledger[] | select(.id==\"<line-id>\") | .command")"
( cd "$wd" && bash -c "$cmd" ) > /tmp/oss-head.txt 2>&1; echo "head rc=$?"

# EVERY hosting repo to its own first parent - not just the one $wd sits in.
# $wd is the composition ROOT, which may be in any hosting repo or none of the
# ones this line exercises, and the spine changed every repo $merge_shas names.
# Detaching one and leaving the rest at post-merge state compares a tree that is
# half before and half after this spine, and both wrong answers - "already
# broken" and "this spine broke it" - come back looking like evidence.
pairs="$(mktemp)"; restore="$(mktemp)"
printf '%s\n' "$merge_shas" > "$pairs"
# The restore runs on EVERY exit path, not just the happy one. Without the trap
# a repo that cannot reach its first parent halts here with the repos ahead of
# it still detached - a diagnostic check leaving the workspace half rolled back,
# which is worse than the failure it was reporting.
# A failed restore is a HALT, not a warning. `checkout || echo` returns zero, so
# a repo whose checkout refuses - the parent demo run dirtied a file that
# differs on the base branch is the ordinary way - left the trap satisfied, the
# trap cleared, and the close continuing with that repo detached at a first
# parent. Every repo is still ATTEMPTED before the halt, so one stuck repo does
# not strand the rest.
_oss_restore_failed=0
_oss_restore_checkouts() {
  while IFS="$(printf '\t')" read -r r w; do
    [ -n "$r" ] || continue
    git -C "$r" checkout -q "$w" || {
      echo "close: cannot restore $r to '$w' - it is left detached; resolve it by hand"
      _oss_restore_failed=1
    }
  done < "$restore"
  [ "$_oss_restore_failed" -eq 0 ]
}
trap _oss_restore_checkouts EXIT
while IFS=: read -r repo sha; do
  [ -n "$repo" ] || continue
  root="$(oss repo_root "$repo")" \
    || { echo "halt: \$merge_shas names undeclared repo '$repo'"; exit 1; }
  # Record the branch BEFORE detaching. `git checkout -` cannot restore N repos:
  # it is per-repo and only remembers one step, and a second detach in the same
  # repo would lose the original.
  printf '%s\t%s\n' "$root" "$(git -C "$root" rev-parse --abbrev-ref HEAD)" >> "$restore"
  git -C "$root" checkout --detach "$sha^1" \
    || { echo "halt: cannot reach $sha^1 in $repo - the comparison is void"; exit 1; }
done < "$pairs"

( cd "$wd" && bash -c "$cmd" ) > /tmp/oss-parent.txt 2>&1; echo "parent rc=$?"

# Restore every checkout before judging anything. A repo left detached is a
# close that continues against a tree nobody meant to be on.
_oss_restore_checkouts \
  || { echo "close: the quarantine comparison left a repo detached - HALT before judging anything, the workspace is not in the state this check assumes"; exit 1; }
trap - EXIT

diff /tmp/oss-head.txt /tmp/oss-parent.txt
```

- **Passes at the first parent** → **this spine broke it.** Not a quarantine
  candidate at all, whatever the read-aloud test said. Fix it or halt.
- **Fails at the first parent for the SAME reason** → the line was already
  broken. Genuinely unrelated to this spine, and the quarantine is honest.
- **Fails at the first parent for a DIFFERENT reason** → **the comparison is
  void; this proves nothing.** Do not quarantine on it.

**The third case is the one that will bite you, and it is not rare.** If this
spine introduced the demo line, its command, or the file that command runs, then
at `$merge_sha^1` that command is *absent* — it fails with "no such file",
"unknown subcommand", an import error. Read as a bare nonzero rc that is
indistinguishable from "already broken", and a regression this spine caused gets
quarantined and closes green. Compare the **failure**, not the exit code — the
block above diffs both outputs for exactly that reason.

If the parent's output says the command or its target does not exist, the parent
run was never **invocable** and the check has not run. You are back to judgment
with one fact established: the line is new, so "already broken" is not available
as an explanation.

Do this before writing the ticket. It converts "unrelated" from a claim into an
observation, and it takes one checkout.

**A worked legitimate case.** The ledger carries `d7 — fetch the daily bar series
and see yesterday's close`, whose command hits a vendor endpoint. Spine `r2.s3`
touched only the local strategy store. `d7` fails; at `$merge_sha^1` it fails
identically, and the vendor's status page shows an outage. That is a quarantine:
recorded against `r2`, owed at the next release close, and expected to clear on
its own — but still owed, because the ledger does not care why a line is red.

---

## 5. The wall-clock budget

The ledger's cost is bounded by a budget set at release planning:

```bash
oss get ".releases[] | select(.id==\"<release-id>\") | .ledger_budget"
```

Exceeding it forces a **prune / parallelize / deepen** decision at release
planning — never silent growth, and never a quiet decision here. This layer's job
is to *notice and say so*: surface an overshoot with the close's result and point
at `plan-release`. Do not prune the ledger to fit; dropping a line is a coverage
decision with an owner, and that owner is not the close ceremony.

**Measure it — `oss demo_run` emits no timing of its own.** There is no verb for
this and none is needed; the shell already has one, so "visibly overshoots" does
not have to mean "felt slow":

```bash
budget="$(oss get ".releases[] | select(.id==\"<release-id>\") | .ledger_budget")"
start=$(date +%s)
demo_rc=0
oss demo_run || demo_rc=$?
elapsed=$(( $(date +%s) - start ))
secs="${budget%s}"
case "$secs" in
  ''|*[!0-9]*) echo "demo: ${elapsed}s (no budget recorded for this release)" ;;
  *) [ "$elapsed" -gt "$secs" ] \
       && echo "demo: ${elapsed}s - OVER the ${secs}s budget; take it to plan-release" \
       || echo "demo: ${elapsed}s (within the ${secs}s budget)" ;;
esac
[ "$demo_rc" -eq 0 ] \
  || { echo "demo: FAILED rc $demo_rc - the close gate does not pass"; exit "$demo_rc"; }
```

**Capture the runner's status and re-raise it last.** Timing is advisory; the
demo result is the **gate**. Written as a bare `oss demo_run` with the budget
report after it, the block's exit status becomes the status of that trailing
`echo` — so in any shell without `errexit` a **failing** cumulative demo returns
**0** and the close walks straight past the one gate it must not. `|| demo_rc=$?`
keeps the status across the measurement without arming `errexit` mid-block, and
the final check re-raises it after the time has been reported.

Report the number either way. A budget nobody measures is the one that drifts,
and `${budget%s}` degrading to the no-budget arm is deliberate: a release planned
before budgets existed records nothing, and that is not a failure to report.

The budget is a wall-clock string as planning recorded it (for example `600s`),
and it may be absent on a release planned before one was set — an absent budget
is a fact to state in one line, not a reason to invent one.

---

## 6. Recording the result

The demo's outcome is written at **step 11**, not here, and only if every step
between reached the end:

```bash
oss demo_record spine "$spine_id" "<true|false>" "<line-count>" "<notes>"
```

`passed` is the literal `true` or `false` — anything else is rc 2. Because a
failing demo **halts** before step 11, the `false` case is reached only by a
close the user deliberately resumes to record the failure; a halt on its own
records nothing at all.

---

## 7. Anti-patterns

- **Calling `oss demo_user_lines` with no spine argument at spine close.** That
  is the release scope (§1).
- **Running only this spine's `auto:` lines.** The cumulative half is the point;
  a spine that passes its own lines and breaks an older one has broken the
  product.
- **Treating a `user:` line's mismatch as advisory** (§3).
- **Marking a `user:` line passed without the human** (§3).
- **Editing a demo line, its command, or its expectation to get past a failure**
  (§2).
- **Quarantining a line this spine broke** (§4).
- **Pruning the ledger to fit the budget here** (§5).
- **`cd`-ing to the composition root before running the demo.** The runner
  resolves its own working directory (§1).
- **Continuing to the critic or the harvest after a failed line** (§2).
