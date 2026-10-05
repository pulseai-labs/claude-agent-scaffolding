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
  git -C "$TMP/$r" init -q; git -C "$TMP/$r" config user.email t@t; git -C "$TMP/$r" config user.name t
  echo seed > "$TMP/$r/f"; git -C "$TMP/$r" add .; git -C "$TMP/$r" commit -qm seed
done
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

# Replay: the journal rebuilds the same bases (doctor's replay check).
t_capture bash "$OSS" doctor
t_assert_contains "$T_OUT" "replay" "doctor runs its replay check over the new op"
case "$T_OUT" in *"fail: replay"*) t_assert_eq "no replay failure" "replay failed" "replay over set_spine_base";; *) T_PASS=$((T_PASS+1));; esac

t_summary
