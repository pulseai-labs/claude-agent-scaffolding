#!/usr/bin/env bash
# ossify ID grammar — single owner (spec §9.2 / OQ7). No VS- shapes.

# The WHOLE argument must match, so `[[ =~ ]]` and not `printf | grep`: grep
# anchors per LINE, and a value such as $'r0.s1.w1\n/../../victim' passed because
# its first line did - the worktree verbs then built a path out of the rest
# (#120, found in PR #601's review).
oss_id_valid_release()   { [[ "$1" =~ ^r[0-9]+$ ]]; }
oss_id_valid_spine()     { [[ "$1" =~ ^r[0-9]+\.s[0-9]+$ ]]; }
oss_id_valid_work_item() { [[ "$1" =~ ^r[0-9]+\.s[0-9]+\.w[0-9]+$ ]]; }

oss_id_parse() {
  local id="$1"
  if oss_id_valid_release "$id"; then
    echo "release ${id#r}"
  elif oss_id_valid_spine "$id"; then
    local r="${id%%.*}" s="${id##*.s}"
    echo "spine ${r#r} ${s}"
  elif oss_id_valid_work_item "$id"; then
    local r rest s w
    r="${id%%.*}"
    rest="${id#*.s}"
    s="${rest%%.*}"
    w="${id##*.w}"
    echo "work_item ${r#r} ${s} ${w}"
  else
    return 1
  fi
}

oss_id_branch_name() { echo "spine/$1-$2"; }
# The RELATIVE half, kept pure and testable. Callers want the absolute path -
# see `oss_cmd_release_dir`, which prefixes the ai_workspace root. Handing this
# relative form to a reader is the defect round-orchestration.md §1 had: every
# sibling consumer prefixes `oss repo_root ai_workspace`, so one that does not
# resolves against whatever directory the agent happens to be standing in.
oss_id_release_dir() { echo "docs/specs/$1"; }

# Work items get their OWN branch namespace. Sharing `spine/<id>-<slug>` would
# make N concurrent work-item worktrees fight over one ref.
oss_id_work_item_branch() { echo "work/$1-$2"; }
oss_id_spine_dir()        { echo "docs/specs/$1/$2-$3"; }

_oss_id_max_plus_one() { # $1=jq array path, $2=strip-prefix regex, $3=state file
  { jq -r "$1[].id" "$3" 2>/dev/null || true; } \
    | { grep -E "$2" || true; } \
    | sed -E "s/$2//" \
    | sort -n | tail -1 | awk '{print $1+1}'
}

oss_id_next_release() {
  local n
  n="$(_oss_id_max_plus_one '.releases' '^r' "$1")"
  echo "r${n:-0}"
}
oss_id_next_spine() { # $1=state $2=release-id
  local n
  n="$({ jq -r '.spines[].id' "$1" 2>/dev/null || true; } \
    | { grep -E "^$2\.s[0-9]+$" || true; } \
    | sed -E 's/^.*\.s//' | sort -n | tail -1 | awk '{print $1+1}')"
  echo "$2.s${n:-1}"
}
oss_id_next_work_item() { # $1=state $2=spine-id
  local n
  n="$({ jq -r '.work_items[].id' "$1" 2>/dev/null || true; } \
    | { grep -E "^$2\.w[0-9]+$" || true; } \
    | sed -E 's/^.*\.w//' | sort -n | tail -1 | awk '{print $1+1}')"
  echo "$2.w${n:-1}"
}
