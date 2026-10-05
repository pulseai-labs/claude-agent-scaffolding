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

# Task 5 replaces this stub. Returns 1 when any item row is a halt.
_oss_inv_items() { return 0; }
