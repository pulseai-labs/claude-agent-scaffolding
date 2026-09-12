# Spine close — the middle layer

Depth for SKILL.md §5. Eleven steps in **binding order**: each step's output is
the next one's input, and the order is the whole content of the ceremony — the
demo measures a tree the merge assembled, the touch check reads the merge's own
diff, cleanup deletes branches the merge made deletable.

This layer is reached as `/close <spine-id>`, deliberately, once. The execution
lane never routes here: it hands work items to §4 one at a time and stops at the
round barrier (`work-item/references/round-orchestration.md` §7).

---

## 1. The class-scoped ceremony (spec §6.1)

| Row | Bone spine | Flesh spine |
|---|---|---|
| impl-check per work item | **core** (already run, per item, at §4) | **core** |
| Cumulative product demo | **core** | **core** |
| Bone-touch check | **core** | **core**, and a hit reclassifies the spine mid-flight |
| Memory-bank harvest | **core** | **core** |
| Handoff / state updates | **core** | **core** |
| Worktree + branch cleanup (only after harvest) | **core** | **core** |
| the adversarial audit (`challenge`) | full audit at close depth, external adversary per the ladder | one light host-only pass |
| Retrospective | full section set | lean section set |
| Grill gates (planning + fix-up replans) | offered | skipped |
| ADR check (a bone added or changed requires an ADR) | required | carried by the bone-touch row above |

**Core rows are never skippable in either class** (spec §6.1). Bone and flesh
differ in the **depth** of the optional rows — critic depth, retro length,
whether a grill gate is offered — never in whether a core row runs. That is the
structural "nothing forgotten" guarantee, and it is why this file is a fixed
checklist rather than a judgment call.

**Two of those rows have no step in the checklist below, and saying so beats a
row that reads as executed.** *Grill gates* are planning-time offers owned by
`plan-spine`; nothing here re-offers one, and a close is the wrong moment to. The
standalone *ADR check* row is **not shipped in this release**: on the bone path
the ADR obligation currently rides on step 5's reclassification reason and step
7's critic pass, which is weaker than its own checklist row. Recorded here as a
known gap rather than papered over.

---

## 2. Step 1 — every work item `complete`, or refuse and name the offender

`$spine_id` is the id `/close` was invoked with, carried from §2's routing.

```bash
open="$(oss get "[.work_items[] | select(.spine==\"$spine_id\" and .status != \"complete\") | .id] | join(\", \")")"
[ -z "$open" ] \
  || { echo "close: $spine_id has work items that are not complete: $open - halt"; exit 1; }
```

**Test the output, never the rc.** `oss get` is `jq -r` without `-e`: a `select`
matching nothing exits **0** with an empty string, so `oss get … || halt` never
fires and a spine with three unfinished items closes clean (`routing.md` §4).

`complete` means "this item's work is on the spine branch" — §4 sets it *last*,
after its merge is verified landed, precisely so this step can read it that way.

---

## 3. Step 2 — land each hosting repo: by PR where a remote exists, locally where none does

**Read `references/code-review.md` before this step's merge happens — before a
PR is opened, on the PR-armed repos.** It is the last moment the spine's
accumulated diff is reviewable as one thing, and the only reader in the ceremony
that judges *craft and fidelity* — impl-check verified the ACs pass and that no
**documented** pattern is violated; nothing has yet asked whether the code is
good, or whether it is the code the spine set out to write. Advisory: it
produces findings and a decision per finding, not a halt. Its findings are fixed
before the PR opens, which shrinks the review loop the PR then runs.

**This step repeats once per hosting repo** — the distinct `target_repo` values
across the spine's work items, the same set `round-orchestration.md` §2 looped to
cut the branch in before round 1. A spine confined to one repo loops once; a
cross-repo spine lands into every repo it touched, and none of them is optional
— a hosting repo left unlanded is work the spine did that never reached its base
branch, however green the repos that DID land make the close look.

**Which landing arm a repo takes is decided by evidence, never by taste, and the
rule is one line: a repo with a remote lands by PR; a repo without one merges
locally (#339).** The base branch of a remote repo is a *published* line — every
canonical this operator runs holds it under a ruleset with PR + review as the
merge gate — so a local `--no-ff` merge there produces a commit that can never
be pushed while every later step reports green. A no-remote repo has no such
line between itself and its base branch, and the local merge is correct there.
No protection sniffing: the ruleset API is admin-gated and the branch-protection
endpoint 404s, so a probe would be a guess where a decidable rule exists, and a
PR onto an unprotected remote is valid everywhere `gh` reaches. **The third leg
is a halt, never a re-route: a remote exists but `gh` cannot operate on it — a
non-GitHub remote, or gh unauthenticated/unreachable — halts naming the two
remedies (fix gh: auth, or the remote's actual host; or an operator-decided
local merge, recorded as such). Silently falling back to the local arm on a
published line is exactly the defect this step exists to prevent.**

**The step runs as two passes with prose between them.** Pass one arms every
hosting repo: local repos merge now, remote repos push their spine branch and
open a PR against that repo's base branch. The prose between the passes hands
each open PR to `/ossify:work-pr`. Pass two records the merged PRs against
freshly fetched refs. `$merge_shas` — the `repo:sha` pairs §6's touch check
reads — accumulates across both passes.

The two facts this step needs are not in state and are recovered, not guessed:

- **The spine slug**, once, from the spine directory's name, exactly as the
  execution lane recovers it (`work-item/references/round-orchestration.md` §2).
  Nothing persists a slug, and it is the same slug in every repo.
- **`base_branch`, once per hosting repo.** The primary source is that repo's own
  handoffs' `## 2. Spine context` `base_branch:` lines
  (`work-item/references/handoff-contract.md` §2) — the lane records there the
  branch *that repo* was ACTUALLY on when it cut the spine branch — with
  `SPINE.md`'s spine-context **base-branch table**
  (`plan-spine/references/spec-authoring.md` §1), where `plan-spine` authored
  one planned base **per hosting repo** at planning time, as the cross-check —
  read that repo's row, never a single spine-wide value. **If the two disagree for a repo, halt and name both, and the
  repo** — the lane cuts from HEAD (issue 133), so a planned base that never
  matched the cut base is exactly the wrong-merge hazard, repo by repo. **If
  either cannot be resolved for a repo, halt** — guessing the default branch
  lands that repo's share of the spine into the wrong line of development, and
  every downstream step then reports green.

```bash
# $spine_slug is NOT ambient — nothing in state holds it. Recover it from the
# spine directory's name with the ambiguity guard, exactly as `harvest.md` §2
# does in this same skill, and hoist it once for the whole ceremony:
#   spine_dir="$(…the glob…)"; spine_slug="${spine_dir##*/}"; spine_slug="${spine_slug#$spine_id-}"
# Using it unset under `set -u` aborts the close here, before any of the guards
# below can report anything.

# DERIVE the spine branch; never read it off HEAD. HEAD is durable git state
# that a session boundary, a hotfix or a halted close can move. One value for
# every hosting repo - the branch name carries no repo in it.
spine_branch="$(oss branch_name "$spine_id" "$spine_slug")"

# $repo_base_branches is NOT ambient either: one "<repo>:<base_branch>" pair per
# line, one line per hosting repo, recovered by the cross-check above and
# hoisted once, same as the slug. Branch names cannot contain ":" (git refuses
# it), so splitting each line on the first colon is unambiguous.

# THE REPO SET IS READ AS AN ASSIGNMENT, never from a process substitution
# (round 5 sweep): a selector failure inside `< <(...)` is invisible - the
# loop receives zero repos and the pass succeeds having landed nothing.
landing_repos="$(oss get ".work_items[] | select(.spine==\"$spine_id\") | .target_repo" | sort -u)" \
  || { echo "close: the hosting-repo set could not be read from state - halt"; exit 1; }

merge_shas=""
pr_lines=""
while IFS= read -r repo; do
  [ -n "$repo" ] || continue

  repo_root="$(oss repo_root "$repo")" \
    || { echo "close: $spine_id names undeclared repo '$repo' - halt"; exit 1; }
  _bases="$(printf '%s\n' "$repo_base_branches" | awk -F: -v r="$repo" '$1==r{print $2}' | sort -u)"
  _nbases="$(printf '%s\n' "$_bases" | awk 'END{print NR}')"
  # UNAMBIGUOUS per repo (round 5 sweep, T16's class): first-wins silently
  # lands into whichever base sorted first.
  if [ "$_nbases" -gt 1 ]; then
    echo "close: conflicting base branches recorded for $spine_id in $repo: $(printf '%s' "$_bases" | tr '\n' ' ')- a human decides which line - halt"; exit 1
  fi
  base_branch="$_bases"
  [ -n "$base_branch" ] \
    || { echo "close: no base_branch recorded for $spine_id in $repo - halt"; exit 1; }
  pre="$(git -C "$repo_root" rev-parse "$spine_branch")" \
    || { echo "close: cannot resolve '$spine_branch' in $repo - halt"; exit 1; }

  # RESOLVE THE REMOTE (round 10, T36): a SINGLE remote is used whatever its
  # name; SEVERAL remotes halt naming them, origin preference included - in a
  # fork checkout origin is the FORK and upstream the canonical repo, and
  # preferring origin would open and merge the PR against the fork.
  remotes="$(git -C "$repo_root" remote)"
  remote_name="$(printf '%s\n' "$remotes" | awk 'NR==1{first=$0} END{if(NR==1) print first; else print ""}')"

  if [ -z "$remotes" ]; then
    # LOCAL ARM — no remote: nothing stands between this repo and its own base
    # branch, so the merge is local.
    #
    # ALREADY LANDED? This is the resume arm, and it lives inside the merge loop
    # rather than in a probe of its own: a separate probe can only report, and
    # step 2 would still halt on its own HEAD assertion the moment it ran.
    # Against $base_branch, NOT HEAD. On a first close HEAD *is* $spine_branch,
    # so the tip is trivially its own ancestor and this arm would fire every
    # time, skipping the merge and leaving the repo parked on the spine branch.
    if git -C "$repo_root" merge-base --is-ancestor "$pre" "$base_branch" 2>/dev/null; then
      # Recover this repo's merge commit from history - the commit on this branch
      # whose SECOND parent is the spine tip. $merge_shas is a shell variable that
      # does not outlive the invocation, and §6's touch check needs every pair, so
      # a resumed close has to reconstruct what the first one recorded.
      merges="$(git -C "$repo_root" log --format='%H %P' --merges "$base_branch")"
      merge_sha="$(printf '%s\n' "$merges" \
        | awk -v t="$pre" 'found=="" { for (i = 3; i <= NF; i++) if ($i == t) found = $1 } END { print found }')"
      [ -n "$merge_sha" ] \
        || { echo "close: $base_branch in $repo already contains $spine_branch but no merge commit has it as a second parent - a fast-forward or a rebase landed it, and §6 cannot compute this repo's first-parent diff - halt"; exit 1; }
      git -C "$repo_root" checkout -q "$base_branch" \
        || { echo "close: $repo already landed but cannot check out '$base_branch' - halt"; exit 1; }
      echo "close: $repo already landed at $merge_sha - not re-merging"
    else
      head_branch="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD)"
      [ "$head_branch" = "$spine_branch" ] \
        || { echo "close: $repo is on '$head_branch', not '$spine_branch', and does not contain $spine_branch - halt"; exit 1; }

      git -C "$repo_root" checkout -q "$base_branch" \
        || { echo "close: cannot check out base branch '$base_branch' in $repo - halt"; exit 1; }
      now_on="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD)"
      [ "$now_on" = "$base_branch" ] \
        || { echo "close: switch-back left $repo on '$now_on', not '$base_branch' - halt"; exit 1; }

      git -C "$repo_root" merge --no-ff "$spine_branch" -m "merge $spine_id" \
        || { echo "close: merge conflict in $repo - halt"; exit 1; }
      git -C "$repo_root" merge-base --is-ancestor "$pre" HEAD \
        || { echo "close: merge reported success but $pre is not reachable from HEAD in $repo - halt"; exit 1; }
      merge_sha="$(git -C "$repo_root" rev-parse HEAD)"
    fi
    merge_shas="$merge_shas
$repo:$merge_sha"
  elif [ -z "$remote_name" ]; then
    echo "close: $repo has several remotes ($(printf '%s' "$remotes" | tr '\n' ' '))- a fork checkout's origin is the fork, so no preference is safe - name the remote to land through and re-run - halt"; exit 1
  else
    # PR ARM — the base branch is a published line: the merge goes by PR, and
    # the record pass below finishes it after work-pr drives the loop.
    #
    # Pin every gh call to THIS repo's remote with --repo (derived from the
    # resolved remote's own URL): gh otherwise follows its configured default
    # repository, which a checkout can point at another remote entirely - and a
    # same-number PR in the wrong repository is indistinguishable from this
    # one until something lands somewhere it should not.
    # Host-aware: a GitHub Enterprise remote must pin gh to ITS host or the
    # selector silently resolves on gh's default. github.com is omitted (the
    # default); a ported ssh:// URL yields a selector gh refuses, loudly.
    pr_slug="$(git -C "$repo_root" config "remote.$remote_name.url" | awk '
      /\.git$/ { sub(/\.git$/, "") }
      {
        if (match($0, /@[^:\/]+[:\/]/)) host = substr($0, RSTART+1, RLENGTH-2)
        else if (match($0, /https?:\/\/[^\/]+\//)) { host = substr($0, RSTART, RLENGTH-1); sub(/^https?:\/\//, "", host) }
        n = split($0, a, /[:\/]/)
        sel = a[n-1] "/" a[n]
        if (host == "") sel = ""
        else if (host != "github.com") sel = host "/" sel
        print sel
      }')"
    [ -n "$pr_slug" ] \
      || { echo "close: cannot derive an owner/repo from remote '$remote_name' in $repo - halt"; exit 1; }
    #
    # RESUME PROBE FIRST, and gh inoperability is a halt on either gh call —
    # never a silent fall-through to the local arm. The probe looks for a PR
    # headed by the spine branch INTO THIS BASE BRANCH, in ANY state: an OPEN
    # one resumes the loop, a MERGED one resumes the record pass, and only the
    # absence of one pushes and opens (a merged PR may have had its branch
    # auto-deleted on the remote; the probe is by head name, which survives the
    # deletion). The --base filter is what keeps a same-headed PR targeting some
    # OTHER branch out of this arm's hands - accepting one by head alone would
    # hand work-pr a PR whose merge lands in the wrong branch, and the record
    # pass's baseRefName check would only catch it afterwards.
    # OPEN and MERGED resume; CLOSED-unmerged does NOT (round 5, T20): a
    # closed PR suppresses neither the push nor a replacement PR - resuming it
    # wedges the close between work-pr's refusal and the record pass's.
    probe="$( (cd "$repo_root" && gh --repo "$pr_slug" pr list --head "$spine_branch" --base "$base_branch" --state all --json number,state --limit 5) 2>&1 )" \
      || { echo "close: gh cannot operate on $repo's remote ($probe) - fix gh (auth, host) or record an operator-decided local merge - never a silent local fall-through - halt"; exit 1; }
    pr_num="$(printf '%s\n' "$probe" | jq -r 'map(select(.state == "OPEN" or .state == "MERGED")) | .[0].number // ""')"
    if [ -n "$pr_num" ]; then
      # A RESUMED PR is this ceremony's PR only if its head DESCENDS from the
      # tip this close pushed - proven HERE, before the handoff, because the
      # record pass would catch a force-pushed or foreign head only after the
      # operator has merged it. A PR with no pushed-tip body line is not this
      # close's PR at all, whatever its head branch is named.
      prj="$( (cd "$repo_root" && gh --repo "$pr_slug" pr view "$pr_num" --json state,headRefOid,body) 2>&1 )" \
        || { echo "close: gh cannot read PR #$pr_num in $repo ($prj) - halt"; exit 1; }
      res_head="$(printf '%s\n' "$prj" | jq -r '.headRefOid')"
      res_tip="$(printf '%s\n' "$prj" | jq -r '.body' | awk '/^pushed-tip: /{print $2; exit}')"
      [ -n "$res_tip" ] \
        || { echo "close: $repo PR #$pr_num carries no pushed-tip body line - it is not this close's PR - halt"; exit 1; }
      # The reported head may exist only remotely (round 7, T27): work-pr or a
      # hand-driven loop can have pushed fix commits from ANOTHER checkout, and
      # gh reporting an object does not install it here. Fetch it best-effort -
      # if it truly cannot be fetched, the lineage check below fails and halts
      # naming it; it must never fail as an "unknown revision" on a legitimate
      # resume.
      git -C "$repo_root" fetch "$remote_name" "$res_head" >/dev/null 2>&1 || true
      git -C "$repo_root" merge-base --is-ancestor "$res_tip" "$res_head" \
        || { echo "close: $repo PR #$pr_num's head does not descend from the tip this close pushed ($res_tip) - the branch was rewritten or diverged - a human decides - halt"; exit 1; }
      # AND the CURRENT local tip is contained (round 8, T32): proving only the
      # pushed tip lets a locally-advanced branch merge the OLD PR and close
      # the spine while silently omitting the newer commits. A halt naming
      # both tips - which to keep is not this ceremony's guess.
      git -C "$repo_root" merge-base --is-ancestor "$pre" "$res_head" \
        || { echo "close: $repo's local spine tip ($pre) advanced past what PR #$pr_num contains - push the branch and update the PR, or re-open - halt"; exit 1; }
      echo "close: $repo already has PR #$pr_num for $spine_branch - not re-pushing, not re-opening"
    else
      git -C "$repo_root" push -u "$remote_name" "$spine_branch" \
        || { echo "close: cannot push '$spine_branch' to '$remote_name' in $repo - halt"; exit 1; }
      # The body carries the pushed tip: the lineage guard's durable input.
      # It lives on the PR, so it survives the halt/resume boundary and session
      # death - no shell state is trusted across the loop. --head pins the PR to
      # the branch this pass just pushed: gh defaults it to the CURRENT branch,
      # which after a resume or a work-pr loop is not necessarily the spine's.
      pr_body="spine close $spine_id -> $base_branch in $repo
pushed-tip: $pre"
      pr_num="$( (cd "$repo_root" && gh --repo "$pr_slug" pr create --base "$base_branch" --head "$spine_branch" \
        --title "merge $spine_id" --body "$pr_body") 2>&1 )" \
        || { echo "close: gh cannot open the PR in $repo ($pr_num) - fix gh (auth, host) or record an operator-decided local merge - never a silent local fall-through - halt"; exit 1; }
      echo "close: $repo PR #$pr_num opened against $base_branch - hand it to /ossify:work-pr"
    fi
    pr_lines="$pr_lines
$repo:$pr_num"
  fi
done <<EOF
$landing_repos
EOF
```

**The local arm keeps its four guards, and every one of them exists because the
failure it catches is rc 0 all the way to a green close.**

- **Derive the spine branch and assert HEAD matches it, in this repo.** Reading
  it off HEAD instead makes the switch-back a no-op and the merge "Already up to
  date" in that repo — the spine's share of work there never lands, and steps
  3-11 still run green against a tree that repo never reached. §4 ships the same
  assertion for the same reason (`work-item-close.md` §4): *a merge onto the
  wrong branch succeeds silently at rc 0.*
- **Require this repo's `base_branch` to be non-empty, and check the checkout's
  rc.** An empty one makes `git checkout -q ""` fail at rc 128; unguarded, the
  ceremony continues with that repo still on the spine branch and merges it into
  itself.
- **Assert HEAD actually moved, in this repo.** This is a separate guard from
  the rc check and catches what the rc check cannot: `base_branch` resolving to
  a **tracked file name** rather than a branch. `git checkout -q <tracked-file>`
  restores that file and exits **0** without moving HEAD, so the rc guard passes
  and the self-merge runs anyway.
- **Check reachability after the merge, in this repo**, which catches a merge
  that reports success without landing the tip. It cannot replace the branch
  assertion: on a self-merge `$pre` is trivially its own ancestor, so
  `--is-ancestor` returns 0. Both legs, always, every repo.

**A merge conflict halts — in whichever repo it happens, and
the PR arm is not exempt: a conflict the remote reports blocks the PR exactly as
a local conflict blocks the local arm.** Surface the conflicted paths verbatim,
leave them for the human — locally, the merge in progress; on a PR, the PR's own
conflict state — and run **no** later step in any repo, including one this loop
has not reached yet. Never `--abort` on the user's behalf, never auto-resolve,
never `-X` a strategy option. If the operator says *resolve it*, the discipline
is `merge-conflict-resolution.md` — hunk by hunk, by each side's recorded
intent. Resuming means finishing *this* repo's landing and continuing from
there, not re-running the layer or restarting a repo that already landed.

**Between the passes: hand every open PR to `/ossify:work-pr`, one at a time** — each
in its own session where the caller supplies one.
The invocation states, in full: the spine context (this PR *is* the spine's
accumulated diff landing — the smallest independently meaningful diff, which is
why the tier sits here and not at the work item, whose merges stay local); the
**merge convention is a merge commit** — a rebase or squash landing cannot feed
§6's first-parent diff and is turned away at the record pass below; and that
deferrals land as tracked issues **in that repo**, linked from the spine's
retrospective (§8). **Review-fix commits are not re-gated** (#377): they land
after every work item's acceptance and impl-check gates have passed and the
items were marked complete; this ceremony's coverage of them is the cumulative
demo (§5) and the touch check (§6), and re-gating the fix lane is a tracked
design question, not a hidden behavior. **History rewrites are not available on a spine PR**:
work-pr's second exit — unclaiming by rewrite and force-with-lease — is
REPLACED here by unclaiming in a follow-up commit, because the record pass's
lineage guard binds to the pushed tip and a rewritten head cannot be recorded;
if a rewrite has already happened, re-land the PR from the pushed tip or
record an operator decision. The merge is the operator's explicit call inside work-pr —
this ceremony does not ack on anyone's behalf. **If the operator leaves any PR
open, the close halts here, recording nothing**: surface the PR URLs, say which
steps remain, and stop. That is the named halt state; re-invoke `/close
<spine-id>` once the PR has merged.

**On a surface that does not carry `/ossify:work-pr` — OpenCode today, where the
utility commands are a Claude Code-only surface (#131) — the operator drives the
review-fix-merge loop by their own means and says so.** What this ceremony
REQUIRES is a merge-commit landing of the PR it opened; who drove the loop to
that merge is the operator's affair. The record pass below still proves the
landing — identity, lineage, base — against fetched refs, so a hand-driven loop
gets exactly the same verification a work-pr-driven one does. The port of the
work-pr lane to the remaining surfaces is #131's scope, not this step's.

```bash
# SECOND PASS — record the PR-armed repos. work-pr has driven each PR to an
# operator-acked merge; every guard binds to the PR's MERGED headRefOid from
# gh, evaluated against freshly fetched refs - never to a tip recorded at push
# time. work-pr lands fix commits ON the spine branch during the loop, so the
# merged head is a DESCENDANT of what this ceremony pushed, not the same
# commit, and any guard shaped as equality fails on every legitimately-merged
# PR that had one fix round.
while IFS=: read -r repo pr_num; do
  [ -n "$repo" ] || continue
  repo_root="$(oss repo_root "$repo")" \
    || { echo "close: pr_lines names undeclared repo '$repo' - halt"; exit 1; }
  _bases="$(printf '%s\n' "$repo_base_branches" | awk -F: -v r="$repo" '$1==r{print $2}' | sort -u)"
  _nbases="$(printf '%s\n' "$_bases" | awk 'END{print NR}')"
  # UNAMBIGUOUS per repo (round 5 sweep, T16's class): first-wins silently
  # lands into whichever base sorted first.
  if [ "$_nbases" -gt 1 ]; then
    echo "close: conflicting base branches recorded for $spine_id in $repo: $(printf '%s' "$_bases" | tr '\n' ' ')- a human decides which line - halt"; exit 1
  fi
  base_branch="$_bases"
  [ -n "$base_branch" ] \
    || { echo "close: no base_branch recorded for $spine_id in $repo - halt"; exit 1; }

  # Same single-remote-or-halt rule the landing pass uses (T36): several
  # remotes halt, origin preference included.
  remote_name="$(printf '%s\n' "$(git -C "$repo_root" remote)" | awk 'NR==1{first=$0} END{if(NR==1) print first; else print ""}')"
  [ -n "$remote_name" ] \
    || { echo "close: $repo has several remotes (fork shapes included) - the PR was opened through one of them; name it and re-run - halt"; exit 1; }
  # Host-aware (T24): a GitHub Enterprise remote must pin gh to ITS host.
  pr_slug="$(git -C "$repo_root" config "remote.$remote_name.url" | awk '
      /\.git$/ { sub(/\.git$/, "") }
      {
        if (match($0, /@[^:\/]+[:\/]/)) host = substr($0, RSTART+1, RLENGTH-2)
        else if (match($0, /https?:\/\/[^\/]+\//)) { host = substr($0, RSTART, RLENGTH-1); sub(/^https?:\/\//, "", host) }
        n = split($0, a, /[:\/]/)
        sel = a[n-1] "/" a[n]
        if (host == "") sel = ""
        else if (host != "github.com") sel = host "/" sel
        print sel
      }')"
    [ -n "$pr_slug" ] \
    || { echo "close: cannot derive an owner/repo from remote '$remote_name' in $repo - halt"; exit 1; }

  pr_json="$( (cd "$repo_root" && gh --repo "$pr_slug" pr view "$pr_num" --json state,baseRefName,mergeCommit,headRefOid,body) 2>&1 )" \
    || { echo "close: gh cannot read PR #$pr_num in $repo ($pr_json) - halt"; exit 1; }
  pr_state="$(printf '%s\n' "$pr_json" | jq -r '.state')"
  case "$pr_state" in
    MERGED) ;;
    OPEN) echo "close: $repo PR #$pr_num is still open - hand it to /ossify:work-pr and merge on the operator's ack, then re-invoke close - halt"; exit 1 ;;
    *) echo "close: $repo PR #$pr_num is $pr_state, not MERGED - the spine's work never landed in $repo - halt"; exit 1 ;;
  esac
  # BASE IDENTITY - a PR merged into some OTHER branch is not this repo's
  # landing, whatever its merge commit goes on to reach. The probe filtered by
  # base at discovery; this re-proves it at record time, because a PR's base
  # can be retargeted between the two.
  pr_base="$(printf '%s\n' "$pr_json" | jq -r '.baseRefName')"
  [ "$pr_base" = "$base_branch" ] \
    || { echo "close: $repo PR #$pr_num targets '$pr_base', not '$base_branch' - the merge landed in the wrong branch - halt"; exit 1; }
  merge_sha="$(printf '%s\n' "$pr_json" | jq -r '.mergeCommit.oid // .mergeCommit')"
  head_oid="$(printf '%s\n' "$pr_json" | jq -r '.headRefOid')"
  pushed_tip="$(printf '%s\n' "$pr_json" | jq -r '.body' | awk '/^pushed-tip: /{print $2; exit}')"
  [ -n "$merge_sha" ] && [ -n "$head_oid" ] && [ -n "$pushed_tip" ] \
    || { echo "close: PR #$pr_num in $repo is missing its mergeCommit, headRefOid, or pushed-tip body line - halt"; exit 1; }

  git -C "$repo_root" fetch "$remote_name" "$base_branch" \
    || { echo "close: cannot fetch '$base_branch' from '$remote_name' in $repo - halt"; exit 1; }

  # THE STRANDED-MERGE GUARD. A local base branch with commits the remote lacks
  # is the signature of the pre-PR ceremony (#339): a local merge that could
  # never be pushed. The repair is named, never run - resetting is a
  # destructive call on durable state and belongs to the operator.
  if ! git -C "$repo_root" merge-base --is-ancestor "$base_branch" "$remote_name/$base_branch"; then
    echo "close: $repo's local '$base_branch' has commits $remote_name lacks (a stranded pre-PR merge?) - repair: verify 'git merge-base --is-ancestor $spine_branch $base_branch' holds, then 'git reset --hard $remote_name/$base_branch' (the PR re-lands the content); if it does not hold, a human decides - halt"
    exit 1
  fi

  head_branch="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD)"
  if [ "$head_branch" != "$base_branch" ]; then
    git -C "$repo_root" checkout -q "$base_branch" \
      || { echo "close: cannot check out base branch '$base_branch' in $repo - halt"; exit 1; }
  fi
  git -C "$repo_root" merge --ff-only "$remote_name/$base_branch" \
    || { echo "close: local '$base_branch' cannot fast-forward to $remote_name in $repo - halt"; exit 1; }

  # HEAD IDENTITY - the merge merged exactly the PR's reviewed head. A rebase-
  # or squash-landed PR fails HERE, at record time with the method named,
  # instead of obscurely in §6's touch check.
  [ "$(git -C "$repo_root" rev-parse "$merge_sha^2" 2>/dev/null)" = "$head_oid" ] \
    || { echo "close: $repo PR #$pr_num did not land as a two-parent merge commit - a rebase or squash merge cannot feed step 5's first-parent diff - halt"; exit 1; }

  # LINEAGE - the merged head DESCENDS from what this close pushed. Ancestry,
  # not equality: work-pr's fix commits sit on top of the pushed tip. A
  # rewritten or diverged head fails.
  git -C "$repo_root" merge-base --is-ancestor "$pushed_tip" "$head_oid" \
    || { echo "close: $repo PR #$pr_num's merged head does not descend from the tip this close pushed ($pushed_tip) - the branch was rewritten or diverged (work-pr's rewrite exit is not available on a spine PR) - re-land from the pushed tip or record an operator decision - halt"; exit 1; }

  # BASE LANDED - the fetched base contains the merge commit gh reported.
  git -C "$repo_root" merge-base --is-ancestor "$merge_sha" "$base_branch" \
    || { echo "close: $base_branch in $repo does not contain merge commit $merge_sha - halt"; exit 1; }

  merge_shas="$merge_shas
$repo:$merge_sha"
  echo "close: $repo landed PR #$pr_num at $merge_sha"
done <<EOF
$pr_lines
EOF
```

**Resuming a halted spine close.** A halt at steps 4-11 leaves step 2's landing
already done in **every** hosting repo. A halt **inside** step 2 is the other
case a cross-repo spine introduces: the loop may have landed one or two hosting
repos before a later one failed — or opened one or two PRs before the operator
deferred a merge — so "already landed" is a per-repo question, not one yes/no
for the whole step. The PR-open halt adds its own resume state: **PRs open, no
merge yet.** Nothing is recorded for it, so re-invoking after the merge is the
whole recovery.

**Both loops above are themselves the resume path — there is no separate probe.**
An earlier draft had one: a loop that tested containment and printed
`already landed` / `NOT landed` per repo, next to a step 2 that still asserted
`HEAD == $spine_branch`. Nothing consumed the probe's result, so a resumed close
read a correct report and then halted in the very next step on a repo the report
had just called finished. The containment test now lives in the landing loops
and decides what that iteration does — and the PR arm's probe is the PR's own
existence, by head branch, in any state — which also means `$merge_shas` comes
out populated for **every** repo, reconstructed for the ones that already
landed, rather than only for the ones this invocation happened to land.

Re-invoke `/close <spine-id>` and let step 2 run. Local repos re-merge only if
they have not landed, and never re-merge one that has; PR repos re-probe, skip
the push and the create, and record a MERGED PR or halt on an OPEN one. Step 2
is complete only once **every** hosting repo is landed; then continue at the
first unfinished step, saying which. Restart properties, one line each: the demo
(§5) re-runs whole; the touch check (§6) re-runs from `$merge_shas`, which step
2 has just rebuilt; the critic (§7) re-runs; the retro (§8) is **amended, never
re-authored** (the same rule `release-close.md` §8 states); the harvest is
idempotent by `harvest.md` §7's skip-identical rule, and cleanup is idempotent
(both §9).

The one resume this cannot serve is a spine whose branch was already deleted by
§9's cleanup — then the tip is unresolvable and step 2 halts naming it. That is
a completed close, not a halted one.

**The resume policy, stated once and deliberately narrow (#339 round 8):** each
resume arm recovers its ONE straightforward case — the case its fixture drives
(a landed repo, an existing OPEN/MERGED PR carrying this close's pushed tip and
containing the current tip, a matching tag). Every state outside those cases
halts, names the state it found, and names the manual remedy — the stranded-base
discipline. Automatic recovery across every halt edge is explicitly NOT
claimed; the edges reviewers have enumerated across this PR's review history
are tracked as one follow-up issue rather than grown here, because each new
auto-recovery edge has been a new review finding in its own right.

Issue #133 is the execution-lane counterpart, not a substitute for
this.

---

## 4. Step 3 — apply the pending demo amendments

```bash
oss ledger_apply_pending "$spine_id"
```

`supersede` and `retire` are **planning** verbs: they record intent and leave the
line live, so a sibling spine closing first still runs the flow. This is where
the intent becomes real, and it runs **after the merge and before the demo** so
the demo measures the amended line set against a product where the replaced flow
really is gone. Applying it before the merge measures a promise; applying it
after the demo measures the wrong set.

An unknown spine id is rc 7 with a message, not a silent no-op.

---

## 5. Step 4 — the cumulative demo

`oss demo_run` for every active `auto:` line, then walk
`oss demo_user_lines "$spine_id"` — **this spine's own `user:` lines only** — with
the human. Full detail, the §6.1-vs-§6.2 scoping, quarantine handling and the
ledger's wall-clock budget in **`references/cumulative-demo.md`**.

**Halt on the first failure, and the halt is terminal**: no touch check, no
critic, no retro, no harvest, no cleanup, no status write. A demo failure is the
product telling you the spine is not closeable; recording it closed anyway is how
the cumulative ledger stops meaning anything.

---

## 6. Step 5 — the changed-path list, then the touch check

**Compute the path list first — it is every hosting repo's own first-parent
diff, concatenated into ONE call.** §3 merges once per hosting repo, and each
merge is a separate commit in a separate repository — there is no single
`$merge_sha` any more, so this step reads `$merge_shas`, the `repo:sha` pairs §3
recorded at each repo's own merge step, and computes each repo's diff the exact
same way §3's single-repo predecessor did: the merge commit against its **first
parent**.

```bash
# Collect into a FILE, and let each repo's failure halt on the spot. The earlier
# form nested the per-repo loop in a process substitution: the outer `while`
# consumed only its stdout and never saw its exit status, so a repo whose
# `oss repo_root` or `git diff` failed AFTER another repo had already emitted
# paths contributed nothing and said nothing. `$#` was then non-zero, the guard
# below passed, and `touch_check` ran over a partial list - which is how a bone
# or risk-gate hit in the failing repo goes unreported and the close continues
# looking clean. A partial list is the INCONCLUSIVE case, not the clean one.
paths="$(mktemp)"; : > "$paths"
while IFS=: read -r repo sha; do
  [ -n "$repo" ] || continue
  root="$(oss repo_root "$repo")" \
    || { echo "close: \$merge_shas names undeclared repo '$repo' - the changed-path list would be INCOMPLETE - halt"; exit 1; }
  git -C "$root" diff --name-only "$sha^1" "$sha" >> "$paths" \
    || { echo "close: cannot diff $sha against its first parent in $repo - the changed-path list would be INCOMPLETE - halt"; exit 1; }
done <<EOF
$merge_shas
EOF

set --
while IFS= read -r p; do
  [ -n "$p" ] || continue
  set -- "$@" "$p"
done < "$paths"

[ "$#" -gt 0 ] \
  || { echo "close: the merge changed no paths in any hosting repo - the touch check is INCONCLUSIVE, not clean - halt"; exit 1; }

tc=0; touch_hits="$(oss touch_check "$@")" || tc=$?
case "$tc" in
  0) printf '%s\n' "$touch_hits" ;;          # HIT - §7 and §8 act on these lines
  1) echo "touch check: clean" ;;            # clean - change nothing, record nothing
  *) echo "close: touch_check could not run (rc $tc) - INCONCLUSIVE, not clean - halt"; exit 1 ;;
esac
```

**Known limitation, tracked as #348: the union carries no repo identity.** Bone
and risk-gate records hold repo-relative globs with no owning repo, so two
hosting repos that both contain `src/adapters/foo` cross-match — a change in one
can fire a bone authored for the other. It fails SAFE: the union is a superset,
so a bone is never MISSED, only spuriously hit, and a spurious hit routes the
spine to extra scrutiny rather than past it. When a hit looks wrong for the
spine at hand, check which repo actually changed the path before acting on it.

**One `oss touch_check` call over the union of every repo's paths, never one call
per repo.** A bone or a risk gate is a project-wide surface, not a per-repo one,
and `touch_check`'s own rc contract (0 = HIT, 1 = clean, 2 = could-not-check) has
no way to combine three separate verdicts into one close decision. Calling it
once per repo and OR-ing the results by hand is the associative-array trap in a
different shape: it works until someone reads it back the wrong way. Build the
full path list first, across every repo, and let the one call judge all of it —
the same discipline §3's loop already established for the merge itself.

**The inner loop, never a bash associative array.** `$merge_shas` is a flat
`repo:sha` list, one pair per line — exactly what §3 built, one line appended
per repo at that repo's own merge. A single `while IFS=: read -r repo sha` loop
splits each line on its first colon (git ref names cannot contain `:`, so the
split is unambiguous) and calls `oss repo_root` fresh for each — there is no
`$merge_sha_by_repo[$repo]`-style lookup anywhere in this file, because bash 3.2
has no associative arrays to hold one. The outer `while IFS= read -r p` loop is
unchanged from the single-repo form: it still collects one path per line into
`"$@"`, it merely now reads from a pipeline that visits every hosting repo
instead of one `git diff` on a single `$canonical`.

**`$merge_shas`'s pairs, not `$base_branch..$spine_branch`, and per repo for the
same reason the single-repo form gave.** The range form looks right and is wrong
in both directions, in every repo it is tried in: after the merge, `git diff
A..B` is just `git diff A B` — a comparison of two *trees*, not a range — and
the base branch's tree now already contains the spine. When the base never
moved, the two trees are identical and that repo's list comes back **empty**.
When the base *did* move, that repo's list names the files the **other** work
changed and omits the spine's own. The first-parent diff is the only form that
answers "what did this merge bring in," per repo, and it is stable whether or
not that repo's base moved. **This holds identically for a PR-landed repo: its
pair's SHA is the remote merge commit, and the first-parent diff of the fetched
merge commit — planned changes and review-fix commits alike — is that repo's
list.** Fix commits are not filtered out and are not compared against the
spine's declared surfaces: nothing in steps 3-11 performs a plan-scope
comparison, so a test file or version surface a fix commit moved is simply part
of the union `touch_check` judges. A fix commit that hits a registered bone or
risk-gate surface escalates through §6.1/§6.2 below exactly as a planned change
would — the guard working, not a false halt.

**Feed one argument per path, still.** `set --` plus `"$@"` does that without
breaking on a path containing a space and without depending on `$IFS` — true of
the aggregate list exactly as it was true of a single repo's. An **array** is
the obvious alternative and is worse here: under `set -u`, expanding an empty
one is a fatal *unbound variable* abort on the bash macOS ships (3.2), so the
empty case (every hosting repo's merge genuinely changed nothing) would die
before reaching the halt that explains it.

**rc 0 = HIT, rc 1 = clean, rc 2 = could-not-check.** Reading that backwards
inverts the judge and reclassifies exactly the wrong spines — the single most
consequential mistake available in this file. **rc 2 is not clean.** It means no
paths were passed, or the registries were unreadable; the state is broken exactly
when degrading to the permissive answer is least acceptable, so it halts. The
empty-list guard above fires first so the two causes get different messages.

Full glob semantics and the path-selection discipline are in
`plan-release/references/bone-touch-judge.md` §3 — the same judge, run here at
the third of spec §6.1's three detection points (release planning, critic pass,
close-time check).

### 6.1 On a bone hit — reclassify mid-flight

```bash
oss class_set "$spine_id" bone "bone-touch at close: <ADR-ref> (<matched surface>)"
```

**Three arguments; the reason is required** and is the audit trail for a class
change made mid-ceremony. Take `<ADR-ref>` from the `bone <adr>` line
`touch_check` just printed — not from memory, not from the spine's plan.

**The reclassification takes effect for every remaining row, including this one.**
Re-read this step on the bone column, then continue forward. **Do not re-run the
touch check**: it will hit again, and a second `class_set` records a `bone`→`bone`
transition that never happened. Nothing above this step is class-scoped — steps
1-4 are core rows identical in both columns — which is why the re-entry is a
re-read and not a rewind.

### 6.2 Step 6 — risk-gate escalation

**Distinguish the two hit kinds by the printed prefix**, never by assuming a hit
is a bone. `touch_check` prints `bone <adr>` for a bone and `risk_gate <name>`
for a gate. A gate hit escalates to the bone path **plus that gate's controls**,
*regardless of class* — harm is orthogonal to reversibility, and a flesh-class
one-liner inside a guarded surface is still a Risk event.

```bash
oss get '.risk_gates[] | select(.name=="<name>") | .controls'
```

Those are the `controls` recorded when the gate was registered. **Walk each one
as a checklist row** — they are required work, not advice. A single path can hit
both a bone and a gate; then both apply.

---

## 7. Step 7 — the adversarial audit, and the depth differs by class

Run ossify's own audit — `challenge` in audit mode. Read
`${CLAUDE_PLUGIN_ROOT}/skills/challenge/references/audit.md` end to end and
follow it. The audit always runs; there is no plugin whose absence skips it,
and nothing here blocks the close on an adversary that is not configured.

**The depth differs by class, and one call cannot serve both:**

- **bone** — close depth. The adversary ladder
  (`challenge/references/adversaries.md`) decides whether an external
  fresh-frame adversary joins; the audit's summary names what ran.
- **flesh** — the light host-only pass: the same reference, shallow depth.

The artifact is the spine's `SPINE.md` under
`oss spine_dir "<release-id>" "<spine-id>" "<slug>"` — the same artifact
`plan-spine` hands the audit (`plan-spine/references/spec-authoring.md` §6).
That verb returns a **relative** path, so prefix it with
`oss repo_root ai_workspace`; the audit wants one absolute path.

The findings come back as **disposition rows**, and this is where spec §6.1's
triage policy applies: spec-aligned recommendations auto-apply, and only
load-bearing escalations reach the user. Record a class-moving disposition with
`oss veto_add "$spine_id" "<finding>" auto-bone|override|escalate "<reason>"`.

---

## 8. Step 8 — the retrospective

Authored against a **fixed section contract**, full for bone and lean for flesh.
Both section sets, verbatim, in **`references/retrospective.md`**. It is the only
copy; do not invent a heading per spine.

---

## 9. Steps 9-11 — harvest, then cleanup, then the state writes

**Step 9 — memory-bank harvest, always before cleanup.** Enumerate this spine's
work items, read each `report.md`'s `## 9. Suggestions for memory bank` and each
per-work-item `handoff.md`, surface the candidates for accept/edit/reject, and
apply the accepted set in **one** pass. There is no `oss` verb for any of it:
the bank is manifest-routed and you perform the appends yourself.

The full ceremony — how the candidates are enumerated, the `[report]`/`[handoff]`
tagging, the entry shape, the two-file allowlist, where the bank is, the append
rules (whole-set validation before a single write; an all-skipped apply is
honest, not a failure to re-run) and where the outcomes are recorded — is in
**`references/harvest.md`** §2 and §5-§8. It is the only copy.

**Step 10 — worktree + branch cleanup, per work item, and only now:**

```bash
oss worktree_remove "$(oss get ".work_items[] | select(.id==\"$wi\") | .target_repo")" "$wi"
```

**Already per repo, because the target is per item.** Walking every work item
in the spine and reading each one's own `target_repo` runs this in whichever
repo that item actually lives in — the same repo §3 merged its branch into and
§4 already closed it from. A spine hosted across two repos removes worktrees
and branches from both, one call per item, with no separate per-repo loop of
its own: the loop is already the walk over work items.

**Cleanup is last because of the branch, not the report** — the full ordering
argument, and the false one it is often confused with, are in `harvest.md` §1.

**Step 11 — state updates:**

```bash
oss spine_status "$spine_id" closed
oss demo_record spine "$spine_id" "<true|false>" "<line-count>" "<notes>"
```

`demo_record` takes `passed` as the literal `true` or `false` and rejects
anything else at rc 2.

**The session-handoff half of spec §6.1's "handoff / state updates" row stays
unwired.** `/ossify:handoff` exists as a standalone utility, but offering it at
the spine boundary is a deliberate non-wiring: handoff belongs to no ceremony —
a session handoff is written when context runs out, not because a spine closed
— and its design left close-wiring an open call. Saying so beats leaving the
row looking complete.

---

## 10. What has no executable surface

Stated plainly so nobody infers coverage that does not exist.

**"Apply-pending runs before the demo" and "a failing demo halts before the
critic, the harvest and cleanup" are orderings of prose steps with no executable
surface.** A bash script that calls apply-pending and then the demo runner
asserts nothing about the ceremony — it tests a fixture written to pass. The
harness checks that every `oss` verb this file names resolves; beyond that these
orderings have no automated coverage in this release.

The mechanical seams **are** covered in `tests/test-close.sh`: the derived-branch
assertion, the `base_branch` guards, the switch-back's HEAD assertion, the
first-parent changed-path computation, and all three of `touch_check`'s exit
codes across the four cases `tests/test-close.sh` E6 drives: zero paths, a hit,
clean, and an unreadable registry.

---

## 11. Anti-patterns

- **Reading the spine branch off HEAD** instead of deriving it with
  `oss branch_name` and asserting the match (§3).
- **Merging without switching back** — the spine merges into itself at rc 0.
- **Trusting the checkout's rc alone.** A tracked file name checks out clean and
  leaves HEAD where it was (§3).
- **Guessing the default branch** when `base_branch` cannot be resolved.
- **Merging canonical alone and calling the spine closed** when other repos
  host the spine's items too. Every hosting repo needs its own landing —
  switch-back and merge for the local arm, PR push and record-pass proof for
  the remote arm (§3) — a partially-merged spine that only canonical's share
  reached is not a closed spine, however green the close otherwise looks.
- **Computing the changed paths as `$base_branch..$spine_branch`** after the
  merge. Empty when the base never moved, wrong when it did (§6).
- **Calling `touch_check` once per repo and combining the verdicts by hand**
  instead of building one aggregated path list and calling it once. A bone or
  risk gate is a project-wide surface; the touch check judges the union, not a
  repo at a time (§6).
- **Folding `touch_check`'s rc 2 into clean**, or reading rc 0 as clean (§6).
- **Calling `oss class_set` with two arguments.** The reason is required, and a
  missing one is a crash, not a default (§6.1).
- **Assuming a touch hit is a bone.** Read the printed prefix (§6.2).
- **Carrying close depth onto the flesh path** — the light host-only pass is
  the flesh contract (§7).
- **Running the flesh pass at close depth**, or the bone pass at shallow depth (§7).
- **Reading the audit reference halfway** — the depth (close or shallow) and the artifact path both arrive in the invoking prose (§7).
- **Cleaning up before the harvest**, or before the merge (§9).
- **Writing `spine_status closed` after any halt.** A halt records nothing.
- **Re-running the touch check after a mid-flight reclassification** (§6.1).
- **Merging a remote-backed repo locally** instead of the PR arm — the local
  merge commits to a published line that can never be pushed, and every later
  step reports green against a landing that never reaches anyone (§3).
- **Falling through to the local arm when `gh` cannot operate on the remote.**
  The third leg halts, naming both remedies — fix gh, or an operator-decided
  local merge (§3).
- **Treating an unmerged PR as landed**, or recording a merge SHA gh reported
  without proving it locally — identity, lineage, and base-contained, against
  freshly fetched refs (§3).
- **Binding the record guards to the push-time tip.** work-pr lands fix commits
  on the spine branch; the merged head is a *descendant* of the pushed tip, and
  an equality-shaped guard fails every PR that had one fix round (§3).
- **Accepting a rebase- or squash-landed PR.** §6's first-parent diff needs a
  two-parent merge commit; the record pass turns the landing away at record
  time (§3).
- **Running the stranded-merge repair automatically.** The halt names
  `git reset --hard <remote>/<base>` and its containment precondition; resetting
  is the operator's call (§3).
- **Pushing the base branch directly** — the base branch of a remote repo
  lands by PR, full stop; the ceremony never pushes it (§3).
