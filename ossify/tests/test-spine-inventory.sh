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
rm -rf "$F/ws/docs/specs/r0"; inv "$F"; t_assert_rc 2 "R7: no release dir rc 2"
t_assert_contains "$T_OUT" "found 0" "R7: ...and the message says found 0"

# ---- item routes: one healthy spine fixture, mutated per scenario -------------
# fx: core hosts items; spine branch cut and parked; base recorded.
fx() { # $1=dir $2=number of items
  mkfix "$1"; local i=1
  while [ "$i" -le "$2" ]; do oss_in "$1" work_item_add r0.s1 "Item $i" core >/dev/null; i=$((i+1)); done
  git -C "$1/core" checkout -q -b spine/r0.s1-demo; oss_in "$1" spine_base_set r0.s1 core main >/dev/null
}
# spawn an item exactly as round-orchestration §3 does, through the real verbs.
spawn() { # $1=dir $2=wi-id $3=slug
  local wt; wt="$(oss_in "$1" worktree_add core "$2" "$3" spine/r0.s1-demo)"
  oss_in "$1" work_item_exec "$2" "$(git -C "$wt" rev-parse --abbrev-ref HEAD)" "$wt" "$(git -C "$wt" rev-parse HEAD)" >/dev/null
  oss_in "$1" work_item_status "$2" active >/dev/null
  printf '%s\n' "$wt"
}
# close an item exactly as work-item-close §4 does: commit, merge --no-ff, status.
close_item() { # $1=dir $2=wi-id $3=wt
  git -C "$3" commit -qm "close $2"
  git -C "$1/core" merge -q --no-ff "$(git -C "$3" rev-parse --abbrev-ref HEAD)" -m "merge $2"
  oss_in "$1" work_item_status "$2" complete >/dev/null
}
route() { field item "$1" 4; }

# S1 (#362): round 1 complete+merged, round 2 planned -> skip / spawn, rc 0.
F="$TMP/s1"; fx "$F" 2
WT1="$(spawn "$F" r0.s1.w1 one)"; echo a > "$WT1/a"; git -C "$WT1" add a; close_item "$F" r0.s1.w1 "$WT1"
inv "$F"
t_assert_eq "skip" "$(route r0.s1.w1)" "S1: a complete, merged item is skip"
t_assert_eq "spawn" "$(route r0.s1.w2)" "S1: an unspawned planned item is spawn"
t_assert_rc 0 "S1 (#362): the healthy barrier has no halt"

# S2: active, clean at base_sha -> redispatch (resume after a gap return).
F="$TMP/s2"; fx "$F" 1; spawn "$F" r0.s1.w1 one >/dev/null; inv "$F"
t_assert_eq "redispatch" "$(route r0.s1.w1)" "S2: a clean active item at its base is redispatch"

# S4: finished shape -> close-finished; S5 dirty variants -> halt (each its own fixture).
F="$TMP/s4"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
echo a > "$WT/a"; git -C "$WT" add a
mkdir -p "$F/ws/docs/specs/r0/r0.s1-demo/work-r0.s1.w1"
inv "$F"; t_assert_eq "halt:dirty-worktree" "$(route r0.s1.w1)" "S5a: staged but no report.md halts"
echo r > "$F/ws/docs/specs/r0/r0.s1-demo/work-r0.s1.w1/report.md"
inv "$F"; t_assert_eq "close-finished" "$(route r0.s1.w1)" "S4: staged + report.md is close-finished"
t_assert_rc 0 "S4: ...not a halt"
echo b > "$WT/b"; inv "$F"
t_assert_eq "halt:dirty-worktree" "$(route r0.s1.w1)" "S5b: an untracked file beside the staged result halts"
rm "$WT/b"; echo more >> "$WT/a"; inv "$F"
t_assert_eq "halt:dirty-worktree" "$(route r0.s1.w1)" "S5c: an unstaged edit on top of the staged result halts"
git -C "$WT" add a; inv "$F"
t_assert_eq "close-finished" "$(route r0.s1.w1)" "S5 control: re-staging restores close-finished"

# S6/S7/S8: deleted worktree.
F="$TMP/s6"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"; rm -rf "$WT"; inv "$F"
t_assert_eq "reattach" "$(route r0.s1.w1)" "S6: worktree gone, branch at base -> reattach"
F="$TMP/s7"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
echo a > "$WT/a"; git -C "$WT" add a; git -C "$WT" commit -qm c; rm -rf "$WT"; inv "$F"
t_assert_eq "reattach" "$(route r0.s1.w1)" "S7: worktree gone, branch ahead -> reattach"
git -C "$F/core" worktree prune; git -C "$F/core" branch -D work/r0.s1.w1-one -q; inv "$F"
t_assert_eq "halt:work-lost" "$(route r0.s1.w1)" "S8: worktree and branch both gone -> halt:work-lost"

# S9: committed, not merged -> finish-merge.
F="$TMP/s9"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
echo a > "$WT/a"; git -C "$WT" add a; git -C "$WT" commit -qm "close r0.s1.w1"; inv "$F"
t_assert_eq "finish-merge" "$(route r0.s1.w1)" "S9: a commit past base, unmerged -> finish-merge"

# S10: merged, status still active -> finish-status.
git -C "$F/core" merge -q --no-ff work/r0.s1.w1-one -m "merge r0.s1.w1"; inv "$F"
t_assert_eq "finish-status" "$(route r0.s1.w1)" "S10: merged while still active -> finish-status"

# S11: planned with a worktree (crash between worktree_add and work_item_exec) -> adopt.
F="$TMP/s11"; fx "$F" 2
WT2="$(oss_in "$F" worktree_add core r0.s1.w2 two spine/r0.s1-demo)"; inv "$F"
t_assert_eq "adopt" "$(route r0.s1.w2)" "S11: a planned item with a clean worktree at the tip -> adopt"
# S11b (Review Focus 3): a sibling merged since it spawned - still adopt, not a halt.
WT1="$(spawn "$F" r0.s1.w1 one)"; echo a > "$WT1/a"; git -C "$WT1" add a; close_item "$F" r0.s1.w1 "$WT1"; inv "$F"
t_assert_eq "adopt" "$(route r0.s1.w2)" "S11b: spawned before a sibling merged -> still adopt"
echo x > "$WT2/x"; inv "$F"
t_assert_eq "halt:planned-with-worktree" "$(route r0.s1.w2)" "S11c: a planned item's DIRTY worktree halts"

# S18 (fix round 1): a PLAIN DIRECTORY at the derived path is not a worktree. That path
# sits inside the hosting repo's own checkout, so --is-inside-work-tree is true for it;
# only the top level of a LINKED worktree may count. S11 above is the same-shape
# control: a real worktree at the same path routes adopt. A stray directory is not
# spawn-safe either - worktree_add refuses (rc 8) when the path exists.
F="$TMP/s18"; fx "$F" 1; mkdir -p "$F/core/.worktrees/r0.s1.w1"; inv "$F"
t_assert_eq "halt:planned-with-worktree" "$(route r0.s1.w1)" "S18: a plain dir at the derived path halts a planned item"
t_assert_rc 3 "S18: ...rc 3"

# S19 (fix rounds 1-2): an active item whose recorded worktree_path is a plain directory is
# not a live worktree - and must NOT route reattach either: that repair is for a directory
# that is GONE. worktree_reattach refuses rc 8 when the path exists, and the lane meets that
# refusal only after its earlier repairs have already mutated state (§3 step 5 runs item
# repairs after repo repairs), breaking "halts before any mutation". S6 above is the control:
# a truly gone directory routes reattach.
F="$TMP/s19"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"; rm -rf "$WT"; mkdir -p "$WT"; inv "$F"
t_assert_eq "halt:unclassified" "$(route r0.s1.w1)" "S19: a plain dir at the recorded path halts, not reattach"
t_assert_rc 3 "S19: ...rc 3 - the halt is reported before any mutation"

# S20 (fix round 2): the same shape for a PLANNED item that HAS an exec record - the crash
# a worktree_add + work_item_exec left behind, its directory then replaced by a plain dir.
F="$TMP/s20"; fx "$F" 1
WT="$(oss_in "$F" worktree_add core r0.s1.w1 one spine/r0.s1-demo)"
oss_in "$F" work_item_exec r0.s1.w1 "$(git -C "$WT" rev-parse --abbrev-ref HEAD)" "$WT" "$(git -C "$WT" rev-parse HEAD)" >/dev/null
rm -rf "$WT"; mkdir -p "$WT"; inv "$F"
t_assert_eq "halt:planned-with-worktree" "$(route r0.s1.w1)" "S20: a planned item with an exec record and a plain dir halts, not reattach"
t_assert_rc 3 "S20: ...rc 3"

# S21 (fix round 3): a MERGED active item routes finish-status even when the recorded path
# exists as a non-worktree directory: the existence check guards ONLY the reattach decision,
# and finish-status touches no worktree. S19 above stays the halt control (unmerged + plain
# dir); order: work-lost -> merged -> finish-status -> path exists -> reattach.
F="$TMP/s21"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
echo a > "$WT/a"; git -C "$WT" add a; git -C "$WT" commit -qm "close r0.s1.w1"
git -C "$F/core" merge -q --no-ff work/r0.s1.w1-one -m "merge r0.s1.w1"
rm -rf "$WT"; mkdir -p "$WT"; inv "$F"
t_assert_eq "finish-status" "$(route r0.s1.w1)" "S21: merged + a plain dir at the recorded path is finish-status"
t_assert_rc 0 "S21: ...rc 0 - not a halt"

# S12: complete but not merged -> halt:state-claims-merge (control: S1's merged item is skip).
F="$TMP/s12"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
echo a > "$WT/a"; git -C "$WT" add a; git -C "$WT" commit -qm c
oss_in "$F" work_item_status r0.s1.w1 complete >/dev/null; inv "$F"
t_assert_eq "halt:state-claims-merge" "$(route r0.s1.w1)" "S12: complete but unmerged halts"
t_assert_rc 3 "S12: ...rc 3"

# S13 (Review Focus 2): a decoy branch whose name only differs by the dots.
F="$TMP/s13"; fx "$F" 1; git -C "$F/core" branch work/r0s1w1-decoy; inv "$F"
t_assert_eq "spawn" "$(route r0.s1.w1)" "S13: work/r0s1w1-* is not this item's branch - still spawn"
git -C "$F/core" branch work/r0.s1.w1-stray; inv "$F"
t_assert_eq "halt:unclassified" "$(route r0.s1.w1)" "S13 control: a real work/r0.s1.w1-* branch with no exec record halts"

# S16: abandoned -> skip.
F="$TMP/s16"; fx "$F" 2; oss_in "$F" work_item_status r0.s1.w2 abandoned >/dev/null; inv "$F"
t_assert_eq "skip" "$(route r0.s1.w2)" "S16: abandoned is skip"

# S17: READ-ONLY PROOF - nothing changes, including on an rc-3 run.
# The state file is .ossify/project-state.json (measured in Task 1), not the brief's
# state.json. And the snapshot's own status takes --no-optional-locks: a plain
# `git status` refreshes the touched entry and rewrites <repo>/.git/index, so the
# FIRST snapshot would itself dirty the index the assertion compares (measured:
# cksum 738945841 -> 3633717726 across two plain snapshots). A read-only apparatus
# is what makes this snapshot a measurement; mutation (e) on _oss_inv_git proves
# it still catches a writing verb.
snap() { # $1=dir ; everything inventory could disturb
  { cksum < "$1/ws/.ossify/project-state.json"
    for r in core ui; do
      git -C "$1/$r" for-each-ref; git -C "$1/$r" worktree list --porcelain
      cksum < "$1/$r/.git/index"; git -C "$1/$r" --no-optional-locks status --porcelain
    done; } 2>/dev/null
}
F="$TMP/s17"; fx "$F" 2; WT="$(spawn "$F" r0.s1.w1 one)"; echo d > "$WT/d"
sleep 1; touch "$F/core/f"    # stale stat info: plain `git status` would rewrite the index
BEFORE="$(snap "$F")"; inv "$F"
t_assert_rc 3 "S17 setup: this run has a halt row (dirty worktree)"
t_assert_eq "$BEFORE" "$(snap "$F")" "S17: state, refs, worktrees, index and status are byte-identical after inventory"

# ---- the shipped §2 re-entry blocks, extracted and RUN (block-ledger O rows) ----
SKILLS="$HERE/../skills"
ROUND="$SKILLS/work-item/references/round-orchestration.md"
B_INV="$TMP/b-inv.sh"; oss_block_extract "$ROUND" 'spine_inventory "<spine-id>" >' "$B_INV"
# Anchored on `awk -F`, the brief's fallback: the literal `cut-missing` also
# occurs inside §2a's RECORD comment, so that anchor matches two blocks and is
# rightly refused as ambiguous.
B_CUT="$TMP/b-cut.sh"; oss_block_extract "$ROUND" 'awk -F' "$B_CUT"
for b in "$B_INV" "$B_CUT"; do [ -s "$b" ] && T_PASS=$((T_PASS+1)) || { T_FAIL=$((T_FAIL+1)); echo "FAIL: could not extract $b - the block tests below are vacuous"; }; done
# shim: answer the literal placeholders, forward everything else to the real oss.
mkshim() { # $1=shim dir
  mkdir -p "$1"
  printf '#!/usr/bin/env bash\ncase "$1" in\n  spine_inventory) shift; exec bash "%s" spine_inventory r0.s1 ;;\n  spine_base_get) exec bash "%s" spine_base_get r0.s1 "$3" ;;\n  branch_name) echo spine/r0.s1-demo ;;\n  *) exec bash "%s" "$@" ;;\nesac\n' "$OSS" "$OSS" "$OSS" > "$1/oss"
  chmod +x "$1/oss"
}
F="$TMP/b1"; fx "$F" 1; mkshim "$TMP/shim-b"
T_OUT="$(cd "$F/ws" && env "oss_bin=$TMP/shim-b/oss" bash -c "set -euo pipefail; . '$B_INV'" 2>&1)"; T_RC=$?
t_assert_rc 0 "B1: the read-out block passes a healthy spine"
t_assert_contains "$T_OUT" "$(printf 'item\tr0.s1.w1\tplanned\tspawn')" "B1: ...and PRINTS the inventory before anything else"
echo dirt > "$F/core/f"
T_OUT="$(cd "$F/ws" && env "oss_bin=$TMP/shim-b/oss" bash -c "set -euo pipefail; . '$B_INV'" 2>&1)"; T_RC=$?
t_assert_rc 1 "B1: a halt row halts the lane"
t_assert_contains "$T_OUT" "nothing was changed" "B1: ...saying nothing was mutated"
F="$TMP/b2"; mkfix "$F"; oss_in "$F" work_item_add r0.s1 One core >/dev/null; oss_in "$F" work_item_add r0.s1 Two ui >/dev/null
git -C "$F/core" checkout -q -b spine/r0.s1-demo
oss_in "$F" spine_base_set r0.s1 core main >/dev/null
# `ui` parks AHEAD of its recorded base (main) instead of on it: with HEAD ==
# main the "from the RECORDED base" assertion could not tell `checkout -b
# <branch>` from `checkout -b <branch> <base>` - dropping the `"$base"`
# argument would still cut at main's tip and stay green. Parking it elsewhere
# is what makes the assertion a measurement.
git -C "$F/ui" checkout -q -b ui-parked
echo p > "$F/ui/p"; git -C "$F/ui" add p; git -C "$F/ui" commit -qm parked
oss_in "$F" spine_base_set r0.s1 ui main >/dev/null
T_OUT="$(cd "$F/ws" && env "oss_bin=$TMP/shim-b/oss" bash -c "set -euo pipefail; . '$B_CUT'" 2>&1)"; T_RC=$?
t_assert_rc 0 "B2: the cut-missing repair runs"
t_assert_eq "spine/r0.s1-demo" "$(git -C "$F/ui" rev-parse --abbrev-ref HEAD)" "B2: ...cuts AND checks out the spine branch in the missing repo"
t_assert_eq "$(git -C "$F/ui" rev-parse main)" "$(git -C "$F/ui" rev-parse spine/r0.s1-demo)" "B2: ...from the RECORDED base"
t_assert_eq "spine/r0.s1-demo" "$(git -C "$F/core" rev-parse --abbrev-ref HEAD)" "B2: ...and leaves the already-cut repo alone"

t_summary
