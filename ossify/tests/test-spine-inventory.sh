#!/usr/bin/env bash
# oss spine_inventory (#133, #362): the read-only classifier the re-entry arm of
# round-orchestration.md §2 prints before it mutates anything. Real git repos,
# real state, the real dispatcher.
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"
. "$HERE/lib/blocks.sh"
OSS="$HERE/../bin/oss"
TMP="$(mktemp -d)"

# fixture: AI workspace ws, two hosting repos core + ui, spine r0.s1 "demo".
mkfix() { # $1=dir ; fresh fixture
  local F="$1"; rm -rf "$F"; mkdir -p "$F/ws/.ossify" "$F/core" "$F/ui"
  for r in core ui; do
    git -C "$F/$r" init -q -b main; git -C "$F/$r" config user.email t@t; git -C "$F/$r" config user.name t
    echo seed > "$F/$r/f"; git -C "$F/$r" add .; git -C "$F/$r" commit -qm seed
  done
  cat > "$F/ws/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"core":{"root":"$F/core"},"ui":{"root":"$F/ui"}},"well_known_paths":{}}
JSON
  ( cd "$F/ws" && bash "$OSS" init inv >/dev/null 2>&1 && bash "$OSS" release_add R0 g >/dev/null \
    && bash "$OSS" spine_add r0 Demo bone core >/dev/null )
  mkdir -p "$F/ws/docs/specs/r0/r0.s1-demo"
}
oss_in() { ( cd "$1/ws" && shift && bash "$OSS" "$@" ); }   # $1=fixture, rest = verb args
inv() { T_OUT="$(cd "$1/ws" && bash "$OSS" spine_inventory r0.s1 2>&1)"; T_RC=$?; }
row() { printf '%s\n' "$T_OUT" | awk -F'\t' -v k="$1" -v id="$2" '$1==k && $2==id'; }  # $1=repo|item $2=key
field() { row "$1" "$2" | cut -f"$3"; }

# --- R1: no spine branch anywhere -> every repo `fresh`, rc 0 (Review Focus 4)
F="$TMP/r1"; mkfix "$F"
oss_in "$F" work_item_add r0.s1 One core >/dev/null
inv "$F"
t_assert_rc 0 "R1: a spine with no branch anywhere is not a halt"
t_assert_eq "fresh" "$(field repo core 3)" "R1: core verdict fresh"
t_assert_eq "branch=absent" "$(field repo core 4)" "R1: ...facts name the absent branch"

# --- R2: healthy - cut in core, parked, clean, base recorded -> ok
F="$TMP/r2"; mkfix "$F"
oss_in "$F" work_item_add r0.s1 One core >/dev/null
git -C "$F/core" checkout -q -b spine/r0.s1-demo
oss_in "$F" spine_base_set r0.s1 core main >/dev/null
inv "$F"
t_assert_rc 0 "R2: healthy repo rc 0"
t_assert_eq "ok" "$(field repo core 3)" "R2: verdict ok"
t_assert_eq "base=main" "$(field repo core 7)" "R2: ...recorded base shown"

# --- R3: legacy - healthy but no recorded base -> base-backfill (not a halt)
F3="$TMP/r3"; mkfix "$F3"
oss_in "$F3" work_item_add r0.s1 One core >/dev/null
git -C "$F3/core" checkout -q -b spine/r0.s1-demo
inv "$F3"
t_assert_rc 0 "R3: a legacy spine with no recorded base is not a halt"
t_assert_eq "base-backfill" "$(field repo core 3)" "R3: verdict base-backfill"

# --- R4: two hosting repos, branch cut in core only -> ui cut-missing / halt:base-unknown
F="$TMP/r4"; mkfix "$F"
oss_in "$F" work_item_add r0.s1 One core >/dev/null; oss_in "$F" work_item_add r0.s1 Two ui >/dev/null
git -C "$F/core" checkout -q -b spine/r0.s1-demo
oss_in "$F" spine_base_set r0.s1 core main >/dev/null
inv "$F"
t_assert_eq "halt:base-unknown" "$(field repo ui 3)" "R4: ui absent with no recorded base halts"
t_assert_rc 3 "R4: ...rc 3"
oss_in "$F" spine_base_set r0.s1 ui main >/dev/null
inv "$F"
t_assert_eq "cut-missing" "$(field repo ui 3)" "R4: ui absent with a recorded base is cut-missing"
t_assert_rc 0 "R4: ...rc 0 - cut-missing is a repair, not a halt"

# --- R5: halts - dirty, detached, parked elsewhere (each with a non-halt control)
F="$TMP/r5"; mkfix "$F"
oss_in "$F" work_item_add r0.s1 One core >/dev/null
git -C "$F/core" checkout -q -b spine/r0.s1-demo; oss_in "$F" spine_base_set r0.s1 core main >/dev/null
echo dirt > "$F/core/f"; inv "$F"
t_assert_eq "halt:dirty" "$(field repo core 3)" "R5: dirty repo halts"; t_assert_rc 3 "R5: dirty rc 3"
git -C "$F/core" checkout -q -- f; inv "$F"
t_assert_eq "ok" "$(field repo core 3)" "R5 control: the same repo clean is ok"
git -C "$F/core" checkout -q --detach; inv "$F"
t_assert_eq "halt:detached" "$(field repo core 3)" "R5: detached HEAD halts"
git -C "$F/core" checkout -q main; inv "$F"
t_assert_eq "halt:parked-elsewhere" "$(field repo core 3)" "R5: branch present but parked on main halts"
git -C "$F/core" checkout -q spine/r0.s1-demo

# --- R6: abandoned items' repos are not hosting repos
F="$TMP/r6"; mkfix "$F"
oss_in "$F" work_item_add r0.s1 One core >/dev/null; oss_in "$F" work_item_add r0.s1 Two ui >/dev/null
oss_in "$F" work_item_status r0.s1.w2 abandoned >/dev/null
inv "$F"
t_assert_eq "" "$(row repo ui)" "R6: a repo only an abandoned item names gets no row"

# --- R7: usage
inv_bad() { T_OUT="$(cd "$1/ws" && bash "$OSS" spine_inventory "$2" 2>&1)"; T_RC=$?; }
inv_bad "$F" r0.s9; t_assert_rc 2 "R7: unknown spine rc 2"
rm -rf "$F/ws/docs/specs/r0/r0.s1-demo"; inv "$F"; t_assert_rc 2 "R7: no spine dir rc 2"

t_summary
