#!/usr/bin/env bash
# spines[].bases and work_items[].dispatches (#133): the two fields a respawned
# /run-spine session cannot recover from its own context. Driven through the REAL
# dispatcher (`bash "$OSS"`), which runs `set -euo pipefail` - a sourced-lib test
# cannot see an unbound "$1" (CLAUDE.md, shell gotchas).
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"
OSS="$HERE/../bin/oss"
TMP="$(mktemp -d)"
mkdir -p "$TMP/ws/.ossify" "$TMP/core" "$TMP/ui"
for r in core ui; do
  git -C "$TMP/$r" init -q -b main; git -C "$TMP/$r" config user.email t@t; git -C "$TMP/$r" config user.name t
  echo seed > "$TMP/$r/f"; git -C "$TMP/$r" add .; git -C "$TMP/$r" commit -qm seed
done
# The branches every base below names must EXIST (#673 D1: spine_base_set now
# journals only a local branch that is really there - `develop`, `other` and
# the fixture's default branch are each created for that reason).
git -C "$TMP/core" branch other
git -C "$TMP/ui" branch develop
cat > "$TMP/ws/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"core":{"root":"$TMP/core"},"ui":{"root":"$TMP/ui"}},"well_known_paths":{}}
JSON
cd "$TMP/ws"
bash "$OSS" init resume-demo >/dev/null 2>&1
bash "$OSS" release_add "R0" "goal" >/dev/null
bash "$OSS" spine_add r0 "Spine" bone core >/dev/null
t_capture bash "$OSS" get '.spines[0].id'
t_assert_eq "r0.s1" "$T_OUT" "setup: spine r0.s1 exists (every assertion below is vacuous without it)"

# --- spine_base_set / spine_base_get -----------------------------------------
t_capture bash "$OSS" spine_base_get r0.s1 core
t_assert_rc 1 "get: an unrecorded base is rc 1 (not-found)"
t_assert_eq "" "$(bash "$OSS" spine_base_get r0.s1 core 2>/dev/null)" "get: ...and prints nothing on stdout"

t_capture bash "$OSS" spine_base_set r0.s1 core main
t_assert_rc 0 "set: records a base"
t_capture bash "$OSS" spine_base_get r0.s1 core
t_assert_eq "main" "$T_OUT" "get: returns the recorded base"
t_capture bash "$OSS" get '.spines[0].bases.core'
t_assert_eq "main" "$T_OUT" "state shape: .spines[].bases.<repo>"

t_capture bash "$OSS" spine_base_set r0.s1 ui develop
t_capture bash "$OSS" get '.spines[0].bases | keys | join(",")'
t_assert_eq "core,ui" "$T_OUT" "set: a second repo adds a key and keeps the first"

t_capture bash "$OSS" spine_base_set r0.s1 core main
t_assert_rc 0 "set: re-setting the SAME value is rc 0 (an idempotent fresh-arm retry)"
N_BEFORE="$(bash "$OSS" get '.mutations | length')"
t_capture bash "$OSS" spine_base_set r0.s1 core other
t_assert_rc 7 "set: a DIFFERENT value for a recorded repo refuses rc 7 - a base is evidence"
t_assert_contains "$T_OUT" "already records" "set: ...naming the recorded value"
t_assert_eq "$N_BEFORE" "$(bash "$OSS" get '.mutations | length')" "set: ...and journals nothing"
t_assert_eq "main" "$(bash "$OSS" spine_base_get r0.s1 core)" "set: ...and the recorded value is unchanged"

t_capture bash "$OSS" spine_base_set r0.s1 nope main
t_assert_rc 2 "set: an undeclared repo is rc 2"
t_capture bash "$OSS" spine_base_set r0.s1 ai_workspace main
t_assert_rc 2 "set: ai_workspace is refused rc 2 - it resolves as a repo but hosts no spine"
t_capture bash "$OSS" spine_base_set r0.s1 ui HEAD
t_assert_rc 2 "set: HEAD is not a branch name - rc 2"
t_capture bash "$OSS" spine_base_set r0.s9 core main
t_assert_rc 7 "set: an unknown spine is rc 7"
t_capture bash "$OSS" spine_base_get r0.s9 core
t_assert_rc 7 "get: an unknown spine is rc 7, distinct from rc 1 unrecorded"
t_capture bash "$OSS" spine_base_set r0.s1 core
t_assert_rc 2 "set: too few args is the usage rc 2 under the dispatcher's set -u"

# --- #673 D1: validation + the sanctioned correction --------------------------
# A branch that does not exist locally is refused BEFORE anything is journaled:
# the legacy base-backfill path takes an operator-supplied value, and a typo
# used to be recorded as immutable evidence (retrying with the right value was
# then refused as an overwrite - a permanent wedge).
N_BEFORE="$(bash "$OSS" get '.mutations | length')"
t_capture bash "$OSS" spine_base_set r0.s1 core mian
t_assert_rc 2 "set: a branch that does not exist in the repo is refused rc 2"
t_assert_contains "$T_OUT" "no local branch 'mian'" "set: ...naming the missing branch"
t_capture bash "$OSS" spine_base_set r0.s1 core 'bad..name'
t_assert_rc 2 "set: an invalid ref name is refused rc 2"
t_assert_eq "$N_BEFORE" "$(bash "$OSS" get '.mutations | length')" "set: ...and nothing is journaled for either refusal"
t_assert_eq "main" "$(bash "$OSS" spine_base_get r0.s1 core)" "set: ...and the recorded value is untouched"

# The wedge case itself: a typo recorded on a repo with NO base yet (the
# legacy base-backfill shape) used to succeed rc 0 and become immutable.
bash "$OSS" spine_add r0 "Spine two" bone core >/dev/null
t_capture bash "$OSS" spine_base_set r0.s2 core mian
t_assert_rc 2 "set: a typo on an UNRECORDED repo is refused - the base-backfill wedge case"
t_capture bash "$OSS" spine_base_get r0.s2 core
t_assert_rc 1 "set: ...and nothing was recorded for it"

# The correction route: the rc-7 overwrite refusal names it, and it replaces a
# recorded base in one journaled op (the replay check below covers it).
t_capture bash "$OSS" spine_base_set r0.s1 core other
t_assert_rc 7 "reset setup: a different EXISTING branch still refuses rc 7 on the setter"
t_assert_contains "$T_OUT" "spine_base_reset r0.s1 core" "reset setup: ...and the refusal names the correction route"
t_capture bash "$OSS" spine_base_reset r0.s1 core other
t_assert_rc 0 "reset: the correction is accepted rc 0"
t_capture bash "$OSS" spine_base_get r0.s1 core
t_assert_eq "other" "$T_OUT" "reset: ...and the recorded base is replaced"
t_capture bash "$OSS" get '.spines[0].bases.core'
t_assert_eq "other" "$T_OUT" "reset: state shape: the map holds the corrected value"
t_capture bash "$OSS" spine_base_reset r0.s1 core mian
t_assert_rc 2 "reset: the correction validates too - a typo is refused"
t_assert_eq "other" "$(bash "$OSS" spine_base_get r0.s1 core)" "reset: ...and the corrected value survives the refusal"
t_capture bash "$OSS" spine_base_reset r0.s1 ai_workspace main
t_assert_rc 2 "reset: ai_workspace is refused rc 2"
t_capture bash "$OSS" spine_base_reset r0.s9 core main
t_assert_rc 7 "reset: an unknown spine is rc 7"
t_capture bash "$OSS" spine_base_reset r0.s1 core
t_assert_rc 2 "reset: too few args is the usage rc 2 under the dispatcher's set -u"
# Restore for the readers below that expect the original pair.
bash "$OSS" spine_base_reset r0.s1 core main >/dev/null

# Replay: the journal rebuilds the same bases (doctor's replay check).
t_capture bash "$OSS" doctor
t_assert_contains "$T_OUT" "replay" "doctor runs its replay check over the new op"
case "$T_OUT" in *"fail: replay"*) t_assert_eq "no replay failure" "replay failed" "replay over set_spine_base";; *) T_PASS=$((T_PASS+1));; esac

# --- work_item_dispatched ------------------------------------------------------
bash "$OSS" work_item_add r0.s1 "Item one" core >/dev/null
t_capture bash "$OSS" get '.work_items[0].dispatches // "absent"'
t_assert_eq "absent" "$T_OUT" "setup: a new item carries no dispatches field (legacy shape)"
t_capture bash "$OSS" work_item_dispatched r0.s1.w1
t_assert_rc 0 "dispatched: rc 0"
t_assert_eq "1" "$T_OUT" "dispatched: a missing field counts from 0, echoes 1"
t_capture bash "$OSS" work_item_dispatched r0.s1.w1
t_assert_eq "2" "$T_OUT" "dispatched: increments"
t_capture bash "$OSS" get '.work_items[0].dispatches'
t_assert_eq "2" "$T_OUT" "state shape: .work_items[].dispatches is the count"
t_capture bash "$OSS" work_item_dispatched r0.s1.w9
t_assert_rc 7 "dispatched: an unknown item is rc 7"
t_capture bash "$OSS" work_item_dispatched
t_assert_rc 2 "dispatched: no args is the usage rc 2"

# Review Focus 5: a non-integer field fails closed - never a silent reset.
SF="$(bash "$OSS" state_path 2>/dev/null || echo "$TMP/ws/.ossify/state.json")"
jq '.work_items[0].dispatches = "x"' "$SF" > "$SF.tmp" && mv "$SF.tmp" "$SF"
N_BEFORE="$(jq '.mutations | length' "$SF")"
t_capture bash "$OSS" work_item_dispatched r0.s1.w1
t_assert_rc 4 "dispatched: a non-integer field is an apply failure (rc 4)"
t_assert_eq '"x"' "$(jq -c '.work_items[0].dispatches' "$SF")" "dispatched: ...and the field is untouched"
t_assert_eq "$N_BEFORE" "$(jq '.mutations | length' "$SF")" "dispatched: ...and nothing is journaled"
jq '.work_items[0].dispatches = 2' "$SF" > "$SF.tmp" && mv "$SF.tmp" "$SF"

t_summary
