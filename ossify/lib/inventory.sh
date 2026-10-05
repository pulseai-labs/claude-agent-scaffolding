#!/usr/bin/env bash
# Spine re-entry inventory (#133, #362). READ-ONLY: it reads state and git and
# writes nothing - no state op, no lock, no ref, no index refresh (every git
# call is --no-optional-locks), no fetch. round-orchestration.md §2's re-entry
# arm prints this output as the reconcile read-out BEFORE any mutation, so a
# write here would break the one property that makes the read-out honest.
#
# rc 0 no halt row · rc 3 one or more `halt:` rows (output still complete) ·
# rc 2 usage, unknown spine, or the spine directory is not exactly one.
# rc 3 here is NOT the taxonomy's lock rc: this verb never takes the lock.

_oss_inv_git() { git --no-optional-locks "$@"; }

# #673 G2/J1: the durable rejection record is read TRI-STATE, never as a bare
# match. `grep -qF` says 0 (found) and 1 (no finding) - but 2 means it could
# not read the file at all, and that must not degrade to the benign "no
# rejection" the merge arms act on: the record gates MERGES. A MISSING file is
# not an error, though: every completed Layer 4 run overwrites or deletes
# verify.md (work-item-close §2), so absence means no rejection stands. Only a
# path that IS there and cannot be read is the halt case - and a broken
# symlink counts as there: `-e` follows the link and fails, `-L` does not.
_oss_inv_rejection() { # $1=verify.md ; rc 0 rejected · rc 1 no record · rc 2 unreadable
  local rc=0
  [ -e "$1" ] || [ -L "$1" ] || return 1
  grep -qF '[fidelity]' "$1" 2>/dev/null || rc=$?
  [ "$rc" -le 1 ] || rc=2
  return "$rc"
}

oss_spine_inventory() { # $1=state $2=spine-id
  local sf="$1" spine="$2" rel ai rel_dir matches n slug spine_dir spine_branch halt=0
  _oss_entity_require_single "$sf" '.spines[] | select(.id == $v)' "spine" "$spine" >/dev/null 2>&1 \
    || { echo "oss: spine_inventory: unknown or unreadable spine '$spine'" >&2; return 2; }
  rel="r$(oss_id_parse "$spine" | awk '{print $2}')"
  ai="$(_oss_repo_root ai_workspace)" || return 2
  rel_dir="$ai/$(oss_id_release_dir "$rel")"
  # `|| true`: a missing rel_dir makes find exit 1, and the dispatcher's set -e
  # would abort at rc 1 with no output - the count guard below is the decider.
  matches="$(find "$rel_dir" -maxdepth 1 -type d -name "$spine-*" 2>/dev/null || true)"
  n="$(printf '%s\n' "$matches" | grep -c . || true)"
  [ "$n" -eq 1 ] || { echo "oss: spine_inventory: expected exactly one spine dir for $spine under $rel_dir, found $n" >&2; return 2; }
  spine_dir="$matches"; slug="${spine_dir##*/}"; slug="${slug#$spine-}"
  spine_branch="$(oss_id_branch_name "$spine" "$slug")"

  local repos repo root any=0 present head clean base verdict repo_por
  repos="$(jq -r --arg s "$spine" '[.work_items[] | select(.spine == $s and .status != "abandoned") | .target_repo] | unique[]' "$sf")" || return 2
  # Pass 1: does the spine branch exist in ANY hosting repo? That decides fresh.
  while IFS= read -r repo; do
    [ -n "$repo" ] || continue
    root="$(_oss_repo_root "$repo" 2>/dev/null)" || continue
    _oss_inv_git -C "$root" show-ref --verify --quiet "refs/heads/$spine_branch" && any=1
  done <<EOF
$repos
EOF
  # Pass 2: one row per hosting repo.
  while IFS= read -r repo; do
    [ -n "$repo" ] || continue
    if ! root="$(_oss_repo_root "$repo" 2>/dev/null)" || [ "$repo" = ai_workspace ]; then
      printf 'repo\t%s\thalt:undeclared\tbranch=-\thead=-\tclean=-\tbase=-\n' "$repo"; halt=1; continue
    fi
    # A CONFIGURED ROOT THAT IS NOT THERE HAS NOT BEEN INSPECTED (#673 A3):
    # `_oss_repo_root` validates the manifest VALUE, never the directory - so a
    # missing or unmounted hosting repo walked straight past this guard and
    # classified as the routine, repairable `cut-missing` (or `fresh`), a benign
    # row for a repo nothing ever opened. Halt instead; the lane repairs nothing
    # from a row that was never read.
    if [ ! -d "$root" ]; then
      printf 'repo\t%s\thalt:unreadable\tbranch=-\thead=-\tclean=-\tbase=-\n' "$repo"; halt=1; continue
    fi
    if _oss_inv_git -C "$root" show-ref --verify --quiet "refs/heads/$spine_branch"; then present=present; else present=absent; fi
    head="$(_oss_inv_git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null)" || head="-"
    [ "$head" = HEAD ] && head=DETACHED
    # A FAILED status command HAS NOT ESTABLISHED clean (#673 A3). The pre-fix
    # form read an unreadable index as empty output and recorded clean=yes -
    # a failed read degraded to the benign value every downstream verdict
    # (`ok`, `base-backfill`, `cut-missing`, `fresh`) stands on. Halt instead.
    if repo_por="$(_oss_inv_git -C "$root" status --porcelain 2>/dev/null)"; then
      if [ -z "$repo_por" ]; then clean=yes; else clean=no; fi
    else
      printf 'repo\t%s\thalt:unreadable\tbranch=%s\thead=%s\tclean=-\tbase=-\n' "$repo" "$present" "$head"; halt=1; continue
    fi
    base="$(oss_entity_get_spine_base "$sf" "$spine" "$repo" 2>/dev/null)" || base=unrecorded
    # #673 G3: a RECORDED base that no longer resolves must halt the read-out.
    # §2b runs its repo repairs before its item repairs, so with several repos
    # needing `cut-missing` it would create and check out the spine branch in
    # the earlier repos and only then fail `git checkout -b ... "$base"` in
    # this one - a partial mutation despite the pre-mutation reconciliation
    # guarantee. `spine_base_set` validates the branch EXISTS at record time,
    # so a missing ref here means the base was renamed or deleted afterwards;
    # no repair may guess a replacement (that is the operator's call).
    if [ "$base" != unrecorded ] && ! _oss_inv_git -C "$root" show-ref --verify --quiet "refs/heads/$base"; then
      printf 'repo\t%s\thalt:base-unresolved\tbranch=%s\thead=%s\tclean=%s\tbase=%s\n' "$repo" "$present" "$head" "$clean" "$base"
      halt=1; continue
    fi
    if [ "$any" -eq 0 ]; then verdict=fresh
    elif [ "$clean" = no ]; then verdict=halt:dirty
    elif [ "$head" = DETACHED ]; then verdict=halt:detached
    elif [ "$present" = present ] && [ "$head" != "$spine_branch" ]; then verdict=halt:parked-elsewhere
    elif [ "$present" = present ]; then
      if [ "$base" = unrecorded ]; then verdict=base-backfill; else verdict=ok; fi
    elif [ "$base" = unrecorded ]; then verdict=halt:base-unknown
    else verdict=cut-missing
    fi
    case "$verdict" in halt:*) halt=1 ;; esac
    printf 'repo\t%s\t%s\tbranch=%s\thead=%s\tclean=%s\tbase=%s\n' "$repo" "$verdict" "$present" "$head" "$clean" "$base"
  done <<EOF
$repos
EOF
  _oss_inv_items "$sf" "$spine" "$spine_dir" "$spine_branch" || halt=1
  [ "$halt" -eq 0 ] || return 3
}

# One route per item. Pure function of state + git; see the spec's routing table
# (AI workspace docs/superpowers/specs/2026-10-05-ossify-spine-resume-design.md §2).
# "merged" = tip != base_sha AND tip is an ancestor of the spine branch: a branch
# still AT base_sha is trivially an ancestor and has merged nothing.
_oss_inv_items() { # $1=state $2=spine $3=spine-dir $4=spine-branch ; rc 1 if any halt
  local sf="$1" spine="$2" spine_dir="$3" sb="$4" halt=0
  local wi st repo br wtp bs dc root conv has_exec wt clean hab merged report tip route por cands wtp_phys top_phys held holders hp adopt_br brx feed feed_rc=0 gr
  # The feed's own rc is caught, and each item renders inside a `try`/`catch`
  # (#673 A2): one unrenderable field used to collapse the WHOLE stream - the
  # shell read a partial feed with no error channel, the empty-field skip
  # dropped the remnant, and the inventory returned rc 0 with the corrupt item
  # and every successor silently missing. A caught render emits `!<id>`; the
  # loop fails closed on it, naming the item. A non-zero jq is the structural
  # arm (`.work_items` not iterable, unreadable state): one halt row, no feed.
  feed="$(jq -r --arg s "$spine" '
    .work_items[] | select(.spine == $s)
    | (.id? // "?") as $id
    | try ([.id, .status, .target_repo,
       (if (.branch // "") == "" then "-" else .branch end),
       (if (.worktree_path // "") == "" then "-" else .worktree_path end),
       (if (.base_sha // "") == "" then "-" else .base_sha end),
       (if has("dispatches") then (.dispatches | tostring) else "absent" end)] | @tsv)
      catch "!\($id)"' "$sf")" || feed_rc=$?
  if [ "$feed_rc" -ne 0 ]; then
    echo "oss: spine_inventory: cannot render the work-item feed from $sf" >&2
    printf 'item\t-\t-\thalt:unreadable\trepo=-\twt=-\tclean=-\thead_at_base=-\tmerged=-\treport=-\tdispatches=-\n'
    halt=1
    feed=""
  fi
  while IFS="$(printf '\t')" read -r wi st repo br wtp bs dc; do
    # A `!<id>` line is the caught render above, not a record: fail closed on
    # the item it names. Work-item ids cannot start with `!` (lib/id.sh owns
    # the grammar), so this cannot shadow a real row.
    case "$wi" in
      '!'*) printf 'item\t%s\t-\thalt:unreadable\trepo=-\twt=-\tclean=-\thead_at_base=-\tmerged=-\treport=-\tdispatches=-\n' "${wi#!}"; halt=1; continue ;;
    esac
    # `read` folds a RUN of empty fields when IFS holds only whitespace, and tab
    # IS whitespace: a planned item's three empty exec fields collapsed into one,
    # the dispatch count slid into $br, and a never-dispatched item read as
    # dispatched (halt:unclassified instead of spawn). jq therefore emits `-`
    # for an absent exec field - the same vocabulary the facts line uses - so no
    # field is ever empty; unwrap the three BEFORE has_exec reads them.
    [ "$br" = "-" ] && br=""
    [ "$wtp" = "-" ] && wtp=""
    [ "$bs" = "-" ] && bs=""
    [ -n "$wi" ] || continue
    wt=-; clean=-; hab=-; merged=-; report=no; route=""
    held=0; brx=no
    [ -f "$spine_dir/work-$wi/report.md" ] && report=yes
    if [ "$st" = abandoned ]; then route=skip
    elif [ "$repo" = ai_workspace ] || ! root="$(_oss_repo_root "$repo" 2>/dev/null)"; then route=halt:undeclared-repo
    else
      conv="$root/.worktrees/$wi"
      has_exec=0; { [ -n "$br" ] || [ -n "$wtp" ] || [ -n "$bs" ]; } && has_exec=1
      [ -n "$wtp" ] || wtp="$conv"
      # A worktree counts as present only as the TOP LEVEL of a LINKED worktree.
      # `-d` plus `--is-inside-work-tree` alone is true for a PLAIN directory at
      # the derived path, because that path sits inside the hosting repo's own
      # checkout: a planned item then routed `adopt` and the lane adopted the
      # SPINE CHECKOUT as the item's worktree (review round 1). Required here:
      # show-toplevel IS this directory - compared physically, since git prints
      # symlink-resolved paths (macOS /tmp) - and the git dir is a per-worktree
      # admin dir rather than the common one.
      wt=gone
      if [ -d "$wtp" ]; then
        wtp_phys="$(cd -P "$wtp" 2>/dev/null && pwd)" || wtp_phys=""
        top_phys="$(_oss_inv_git -C "$wtp" rev-parse --show-toplevel 2>/dev/null || true)"
        if [ -n "$top_phys" ]; then top_phys="$(cd -P "$top_phys" 2>/dev/null && pwd || true)"; fi
        if [ -n "$wtp_phys" ] && [ "$wtp_phys" = "$top_phys" ] \
           && [ "$(_oss_inv_git -C "$wtp" rev-parse --path-format=absolute --git-dir 2>/dev/null)" \
                != "$(_oss_inv_git -C "$wtp" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" ]; then
          wt=present
          # A FAILED status is not an empty one (#673 A3): the same unchecked
          # command substitution the repo loop carried. cleanliness was never
          # established, so no route may act on it - fail closed, naming the item.
          if por="$(_oss_inv_git -C "$wtp" status --porcelain 2>/dev/null)"; then
            if [ -z "$por" ]; then clean=yes; else clean=no; fi
          else
            printf 'item\t%s\t%s\thalt:unreadable\trepo=%s\twt=present\tclean=-\thead_at_base=-\tmerged=-\treport=%s\tdispatches=%s\n' "$wi" "$st" "$repo" "$report" "$dc"
            halt=1; continue
          fi
        fi
      fi
      if [ -n "$br" ] && _oss_inv_git -C "$root" show-ref --verify --quiet "refs/heads/$br"; then
        brx=yes
        tip="$(_oss_inv_git -C "$root" rev-parse "refs/heads/$br")"
        if [ "$tip" = "$bs" ]; then hab=yes; else hab=no; fi
        # "merged" REQUIRES a recorded base (#673 A1). With base_sha unrecorded
        # ("-" unwrapped to ""), `tip != bs` is trivially true and a branch still
        # AT its cut point - which IS an ancestor of the spine branch - read as
        # merged with nothing merged: a `complete` item routed skip and an active
        # one finish-status, marked done with nothing landed.
        if [ -n "$bs" ] && [ "$tip" != "$bs" ] \
           && _oss_inv_git -C "$root" show-ref --verify --quiet "refs/heads/$sb" \
           && _oss_inv_git -C "$root" merge-base --is-ancestor "$tip" "refs/heads/$sb"; then merged=yes; else merged=no; fi
        # #673 A4: who holds this branch? §2b runs its REPO repairs before its
        # ITEM repairs, so a reattach that would be refused (rc 8) because the
        # branch is checked out in another live worktree must be found HERE, in
        # the read-out, before anything mutates. `held=1` unless every holder is
        # this item's own stale registration - `…/.worktrees/<wi>` (any root
        # spelling of this repo's own path) whose directory is gone.
        # #673 G1: an unreadable holder list reads exactly like "no holders".
        # `|| holders=""` converted a failed pipeline (bin/oss runs under
        # `pipefail`) into the benign empty list, so a planned item with a
        # recorded branch and a missing derived worktree path routed `reattach`
        # instead of halting - and reattach would have to re-discover the
        # unreadable state one mutation later. Fail closed: the list failing
        # means the branch is treated as HELD, and the route that consults
        # `held` halts with a repair the operator can run (`git worktree list`).
        if ! holders="$(_oss_inv_git -C "$root" worktree list --porcelain | awk -v b="refs/heads/$br" '
          /^worktree /{if (hit) print p; p=substr($0,10); hit=0; next}
          $0=="branch " b {hit=1}
          END{if (hit) print p}')"; then
          held=1; holders=""
        fi
        while IFS= read -r hp; do
          [ -n "$hp" ] || continue
          case "$hp" in
            */.worktrees/"$wi") if [ -e "$hp" ]; then held=1; fi ;;
            *) held=1 ;;
          esac
        done <<HOLD
$holders
HOLD
      fi
      case "$st" in
        complete)
          # A branch that no longer exists is the POST-CLEANUP shape (#673 A5):
          # spine close step 10's `worktree_remove` deletes it with `git branch
          # -d`, which REFUSES an unmerged branch - so a deleted work branch is
          # one that WAS merged, and merged-ness cannot be recomputed from what
          # is gone. Halting here (the pre-fix route) left the `halt` with no
          # owning repair and made the hand-over-to-close arm unreachable for
          # exactly the cleanup-finished spine it describes. `skip`; the close
          # cleanup now tolerates the missing branch and a stale registration.
          if [ "$brx" = no ]; then route=skip
          elif [ "$merged" = yes ]; then route=skip
          # A recorded-branch/absent-base half-write cannot be classified: the
          # row stays non-benign (#673 A1).
          elif [ -z "$bs" ]; then route=halt:base-unknown
          # At its own cut point: no commits past the base, so there is no
          # merge to reconstruct and no repair that could make the claim true.
          elif [ "$hab" = yes ]; then route=halt:state-claims-merge
          # The branch still holds the item's commits but the spine branch does
          # not contain them: the merge the state claims is missing. Re-land it
          # through close's §4 merge-onward (the owning repair for this shape).
          else route=finish-merge; fi ;;
        planned)
          if [ "$wt" = present ]; then
            adopt_br="$(_oss_inv_git -C "$wtp" rev-parse --abbrev-ref HEAD)"
            # Adopt ONLY a branch this item owns: exact `work/<wi-id>-` prefix,
            # the same awk index() predicate the spawn arm uses (#673 B1). Any
            # other branch is a worktree this item does not own - `main` above
            # all, whose HEAD is trivially an ancestor of the spine branch: the
            # pre-fix check adopted it, journaled `main` as the item's branch,
            # dispatched commits onto the base branch itself, and left spine
            # close's worktree_remove to try `git branch -d main`.
            if [ "$clean" = yes ] && [ -n "$adopt_br" ] && [ "$adopt_br" != HEAD ] \
               && printf '%s\n' "$adopt_br" | awk -v p="work/$wi-" 'index($0, p) == 1 {ok=1} END{exit !ok}' \
               && _oss_inv_git -C "$root" merge-base --is-ancestor "$(_oss_inv_git -C "$wtp" rev-parse HEAD)" "refs/heads/$sb" 2>/dev/null; then
              route=adopt
            else route=halt:planned-with-worktree; fi
          elif [ "$has_exec" = 1 ]; then
            # Same guard as the active arm: a path that exists is not a
            # `reattach` - worktree_reattach would refuse rc 8 after earlier
            # repairs had mutated state. A planned item's stray path at the
            # recorded location is the planned-with-worktree shape.
            if [ -e "$wtp" ]; then route=halt:planned-with-worktree
            elif [ "$hab" != - ] && [ "$wtp" = "$conv" ]; then
              if [ "$held" = 1 ]; then route=halt:worktree-held; else route=reattach; fi
            else route=halt:unclassified; fi
          else
            # A stray path at the derived worktree location is not spawn-safe
            # either: worktree_add refuses (rc 8) when the path exists, so
            # `spawn` would stop the lane one step later, with a worse message.
            # It is not a worktree (the presence check above proved that) and
            # not nothing - halt:planned-with-worktree names the real shape.
            if [ -e "$conv" ]; then route=halt:planned-with-worktree
            else
              # Exact prefix `work/<wi-id>-`: for-each-ref patterns are path globs, and
              # the awk index() check rejects a decoy like work/r0s1w1-x outright.
              cands="$(_oss_inv_git -C "$root" for-each-ref --format='%(refname:short)' 'refs/heads/work/' \
                | awk -v p="work/$wi-" 'index($0, p) == 1')"
              if [ -z "$cands" ]; then route=spawn; else route=halt:unclassified; fi
            fi
          fi ;;
        active)
          if [ "$has_exec" = 0 ]; then route=halt:unclassified
          # Recorded branch, absent base_sha: nothing downstream is computable
          # (hab, merged, finish-merge's ancestry all need it), so stay
          # non-benign before any repair (#673 A1).
          elif [ "$brx" = yes ] && [ -z "$bs" ]; then route=halt:base-unknown
          elif [ "$wt" = present ]; then
            if [ "$(_oss_inv_git -C "$wtp" rev-parse --abbrev-ref HEAD)" != "$br" ]; then route=halt:unclassified
            elif [ "$merged" = yes ]; then
              if [ "$clean" = yes ]; then route=finish-status; else route=halt:unclassified; fi
            elif [ "$clean" = yes ]; then
              if [ "$hab" = yes ]; then route=redispatch
              # A commit on the work branch is NOT self-evidently gated (#673
              # C1): an implementer that violates stage-never-commit leaves the
              # same shape as a close that crashed after its post-gate commit,
              # and the pre-fix route merged it with no gate ever run. The
              # sibling close-finished route's evidence - report.md - is
              # required here too; without it the route is REFUSED, never
              # guessed: a human decides whether the commit is gated work.
              elif ! _oss_inv_git -C "$root" merge-base --is-ancestor "$bs" "refs/heads/$br" 2>/dev/null; then route=halt:unclassified
              elif [ "$report" = yes ]; then route=finish-merge
              else route=halt:unverified-merge; fi
            elif [ "$hab" = yes ] && [ "$report" = yes ] \
                 && printf '%s\n' "$por" | awk 'substr($0,1,2)=="??" || substr($0,1,1)==" " || substr($0,2,1)!=" " {bad=1} END{exit bad}'; then
              # #673 C2: a staged result whose LAST COMPLETED gate run recorded
              # a [fidelity] finding is a rejected result or a correction in
              # flight - durable evidence the close wrote at rejection time
              # (impl-check §4b). Byte-identical to a close-finished result
              # otherwise, and re-entry must not hand the rejected result back
              # to a stochastic gate: the correction has to complete first.
              # #673 G2: the read is TRI-state via _oss_inv_rejection - an
              # unreadable record is NOT an absent one, and halts rather than
              # routing the rejected result close-finished.
              gr=0; _oss_inv_rejection "$spine_dir/work-$wi/verify.md" || gr=$?
              case "$gr" in
                0) route=halt:close-rejected ;;
                1) route=close-finished ;;
                *) route=halt:unreadable ;;
              esac
            else route=halt:dirty-worktree; fi
          elif [ "$hab" = - ]; then route=halt:work-lost
          elif [ "$merged" = yes ]; then route=finish-status
          # reattach is a repair for a directory that is GONE (spec §2); when a
          # path exists but is not a linked worktree, `oss worktree_reattach`
          # refuses (rc 8) - and the lane meets that refusal only after its
          # earlier repairs have already mutated state (§3 step 5 runs item
          # repairs after repo repairs), breaking "halts before any mutation".
          # The check guards ONLY the reattach decision (round 3): a merged
          # item's repair is finish-status, which touches no worktree.
          # A branch held elsewhere (#673 A4) is the same class: reattach can
          # only clear THIS item's own stale registration, so a live holder (or
          # a holder at any other path) halts now rather than mid-repair.
          elif [ -e "$wtp" ]; then route=halt:unclassified
          elif [ "$wtp" = "$conv" ]; then
            if [ "$held" = 1 ]; then route=halt:worktree-held; else route=reattach; fi
          else route=halt:unclassified; fi ;;
        *) route=halt:unclassified ;;
      esac
    fi
    case "$route" in halt:*) halt=1 ;; esac
    printf 'item\t%s\t%s\t%s\trepo=%s wt=%s clean=%s head_at_base=%s merged=%s report=%s dispatches=%s\n' \
      "$wi" "$st" "$route" "$repo" "$wt" "$clean" "$hab" "$merged" "$report" "$dc"
  done <<EOF
$feed
EOF
  [ "$halt" -eq 0 ]
}
