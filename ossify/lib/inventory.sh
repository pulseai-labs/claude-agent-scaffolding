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

  local repos repo root any=0 present head clean base verdict
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
    if _oss_inv_git -C "$root" show-ref --verify --quiet "refs/heads/$spine_branch"; then present=present; else present=absent; fi
    head="$(_oss_inv_git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null)" || head="-"
    [ "$head" = HEAD ] && head=DETACHED
    if [ -z "$(_oss_inv_git -C "$root" status --porcelain)" ]; then clean=yes; else clean=no; fi
    base="$(oss_entity_get_spine_base "$sf" "$spine" "$repo" 2>/dev/null)" || base=unrecorded
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
  local wi st repo br wtp bs dc root conv has_exec wt clean hab merged report tip route por cands
  while IFS="$(printf '\t')" read -r wi st repo br wtp bs dc; do
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
    [ -f "$spine_dir/work-$wi/report.md" ] && report=yes
    if [ "$st" = abandoned ]; then route=skip
    elif [ "$repo" = ai_workspace ] || ! root="$(_oss_repo_root "$repo" 2>/dev/null)"; then route=halt:undeclared-repo
    else
      conv="$root/.worktrees/$wi"
      has_exec=0; { [ -n "$br" ] || [ -n "$wtp" ] || [ -n "$bs" ]; } && has_exec=1
      [ -n "$wtp" ] || wtp="$conv"
      # A worktree is "present" only if the directory is a worktree on the recorded branch.
      if [ -d "$wtp" ] && _oss_inv_git -C "$wtp" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        wt=present
        por="$(_oss_inv_git -C "$wtp" status --porcelain)"
        if [ -z "$por" ]; then clean=yes; else clean=no; fi
      else wt=gone; fi
      if [ -n "$br" ] && _oss_inv_git -C "$root" show-ref --verify --quiet "refs/heads/$br"; then
        tip="$(_oss_inv_git -C "$root" rev-parse "refs/heads/$br")"
        if [ "$tip" = "$bs" ]; then hab=yes; else hab=no; fi
        if [ "$tip" != "$bs" ] && _oss_inv_git -C "$root" show-ref --verify --quiet "refs/heads/$sb" \
           && _oss_inv_git -C "$root" merge-base --is-ancestor "$tip" "refs/heads/$sb"; then merged=yes; else merged=no; fi
      fi
      case "$st" in
        complete)
          if [ "$merged" = yes ]; then route=skip; else route=halt:state-claims-merge; fi ;;
        planned)
          if [ "$wt" = present ]; then
            if [ "$clean" = yes ] && [ "$(_oss_inv_git -C "$wtp" rev-parse --abbrev-ref HEAD)" != HEAD ] \
               && _oss_inv_git -C "$root" merge-base --is-ancestor "$(_oss_inv_git -C "$wtp" rev-parse HEAD)" "refs/heads/$sb" 2>/dev/null; then
              route=adopt
            else route=halt:planned-with-worktree; fi
          elif [ "$has_exec" = 1 ]; then
            if [ "$hab" != - ] && [ "$wtp" = "$conv" ]; then route=reattach; else route=halt:unclassified; fi
          else
            # Exact prefix `work/<wi-id>-`: for-each-ref patterns are path globs, and
            # the awk index() check rejects a decoy like work/r0s1w1-x outright.
            cands="$(_oss_inv_git -C "$root" for-each-ref --format='%(refname:short)' 'refs/heads/work/' \
              | awk -v p="work/$wi-" 'index($0, p) == 1')"
            if [ -z "$cands" ]; then route=spawn; else route=halt:unclassified; fi
          fi ;;
        active)
          if [ "$has_exec" = 0 ]; then route=halt:unclassified
          elif [ "$wt" = present ]; then
            if [ "$(_oss_inv_git -C "$wtp" rev-parse --abbrev-ref HEAD)" != "$br" ]; then route=halt:unclassified
            elif [ "$merged" = yes ]; then
              if [ "$clean" = yes ]; then route=finish-status; else route=halt:unclassified; fi
            elif [ "$clean" = yes ]; then
              if [ "$hab" = yes ]; then route=redispatch
              elif _oss_inv_git -C "$root" merge-base --is-ancestor "$bs" "refs/heads/$br" 2>/dev/null; then route=finish-merge
              else route=halt:unclassified; fi
            elif [ "$hab" = yes ] && [ "$report" = yes ] \
                 && printf '%s\n' "$por" | awk 'substr($0,1,2)=="??" || substr($0,1,1)==" " || substr($0,2,1)!=" " {bad=1} END{exit bad}'; then
              route=close-finished
            else route=halt:dirty-worktree; fi
          elif [ "$hab" = - ]; then route=halt:work-lost
          elif [ "$merged" = yes ]; then route=finish-status
          elif [ "$wtp" = "$conv" ]; then route=reattach
          else route=halt:unclassified; fi ;;
        *) route=halt:unclassified ;;
      esac
    fi
    case "$route" in halt:*) halt=1 ;; esac
    printf 'item\t%s\t%s\t%s\trepo=%s wt=%s clean=%s head_at_base=%s merged=%s report=%s dispatches=%s\n' \
      "$wi" "$st" "$route" "$repo" "$wt" "$clean" "$hab" "$merged" "$report" "$dc"
  done <<EOF
$(jq -r --arg s "$spine" '.work_items[] | select(.spine == $s)
  | [.id, .status, .target_repo,
     (if (.branch // "") == "" then "-" else .branch end),
     (if (.worktree_path // "") == "" then "-" else .worktree_path end),
     (if (.base_sha // "") == "" then "-" else .base_sha end),
     (if has("dispatches") then (.dispatches | tostring) else "absent" end)] | @tsv' "$sf")
EOF
  [ "$halt" -eq 0 ]
}
