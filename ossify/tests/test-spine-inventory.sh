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

# S9 (#673 K1, superseding C1): neither a commit on the work branch nor a
# present report.md is proof the close gate ran - the item skill authors the
# report BEFORE staging - so the classifier infers nothing from either: the
# finish-merge row re-runs close §2's gate on the committed tree before
# merging, and a red re-run halts there. Both shapes route finish-merge; the
# report fact still renders for the close-finished arm, which needs a report
# to hand to close.
F="$TMP/s9"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
echo a > "$WT/a"; git -C "$WT" add a; git -C "$WT" commit -qm "close r0.s1.w1"; inv "$F"
t_assert_eq "finish-merge" "$(route r0.s1.w1)" "S9: a commit past base with NO report.md routes finish-merge (the gate re-runs at the merge)"
t_assert_contains "$(row item r0.s1.w1)" "report=no" "S9: ...while the report fact still renders for the close-finished arm"
t_assert_rc 0 "S9: ...rc 0"
mkdir -p "$F/ws/docs/specs/r0/r0.s1-demo/work-r0.s1.w1"
echo r > "$F/ws/docs/specs/r0/r0.s1-demo/work-r0.s1.w1/report.md"; inv "$F"
t_assert_eq "finish-merge" "$(route r0.s1.w1)" "S9b: ...and with report.md the route is unchanged"
t_assert_contains "$(row item r0.s1.w1)" "report=yes" "S9b: ...and the fact flips to yes"

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

# S12 (#673 A5): state says complete and the branch still holds unmerged
# commits - the merge the state claims is missing, so the row ROUTES the repair
# (close's merge-onward) rather than halting with no owning repair. S12b keeps
# the one shape no repair can make true: a branch sitting at its base.
F="$TMP/s12"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
echo a > "$WT/a"; git -C "$WT" add a; git -C "$WT" commit -qm c
oss_in "$F" work_item_status r0.s1.w1 complete >/dev/null; inv "$F"
t_assert_eq "finish-merge" "$(route r0.s1.w1)" "S12: complete + unmerged commits -> finish-merge (re-land the claim)"
t_assert_rc 0 "S12: ...rc 0 - a repairable shape, not a halt"
# Resetting the CHECKED-OUT branch back to its cut point (branch -f refuses a
# checked-out branch; the worktree owns it here).
git -C "$WT" reset -q --hard "$(git -C "$F/core" rev-parse spine/r0.s1-demo)"; inv "$F"
t_assert_eq "halt:state-claims-merge" "$(route r0.s1.w1)" "S12b: complete but the branch sits at its base -> halt:state-claims-merge"
t_assert_rc 3 "S12b: ...rc 3"

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
      # #673 A4/A6 added a `git worktree list` to the classifier; its admin
      # files are part of what "read-only" means, so snapshot them FIRST
      # (before the list calls below, which are themselves under test).
      find "$1/$r/.git/worktrees" -type f -exec cksum {} + 2>/dev/null | sort
      git -C "$1/$r" for-each-ref; git -C "$1/$r" worktree list --porcelain
      cksum < "$1/$r/.git/index"; git -C "$1/$r" --no-optional-locks status --porcelain
    done; } 2>/dev/null
}
F="$TMP/s17"; fx "$F" 2; WT="$(spawn "$F" r0.s1.w1 one)"; echo d > "$WT/d"
sleep 1; touch "$F/core/f"    # stale stat info: plain `git status` would rewrite the index
BEFORE="$(snap "$F")"; inv "$F"
t_assert_rc 3 "S17 setup: this run has a halt row (dirty worktree)"
t_assert_eq "$BEFORE" "$(snap "$F")" "S17: state, refs, worktrees, index and status are byte-identical after inventory"

# ---- fix-round scenarios (#673 A1-A5, B1, C2) ---------------------------------

# S22 (#673 A1): merged-ness REQUIRES a recorded base. An empty base_sha made
# `tip != bs` trivially true, so a branch AT its cut point - an ancestor of the
# spine branch - read as merged and a `complete` item routed skip, marked done
# with nothing merged. The row must stay non-benign instead.
F="$TMP/s22"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
oss_in "$F" work_item_exec r0.s1.w1 "work/r0.s1.w1-one" "$WT" "" >/dev/null
oss_in "$F" work_item_status r0.s1.w1 complete >/dev/null; inv "$F"
t_assert_eq "halt:base-unknown" "$(route r0.s1.w1)" "S22: an unrecorded base_sha must never read as merged - the row halts"
t_assert_rc 3 "S22: ...rc 3"
# S22b: the ACTIVE variant, worktree gone - the old inversion's finish-status.
F="$TMP/s22b"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
oss_in "$F" work_item_exec r0.s1.w1 "work/r0.s1.w1-one" "$WT" "" >/dev/null
rm -rf "$WT"; inv "$F"
t_assert_eq "halt:base-unknown" "$(route r0.s1.w1)" "S22b: active + unrecorded base_sha halts before any reattach"
# S22c (control): with the base recorded, the same at-base branch is still a
# non-benign halt - never skip - and S1 (merged, recorded base) stays skip.
F="$TMP/s22c"; fx "$F" 1; spawn "$F" r0.s1.w1 one >/dev/null
oss_in "$F" work_item_status r0.s1.w1 complete >/dev/null; inv "$F"
t_assert_eq "halt:state-claims-merge" "$(route r0.s1.w1)" "S22c control: recorded base, branch at it -> halt, not skip"

# S23 (#673 A2): one unrenderable field must not collapse the feed. A status
# that is an object used to kill the whole jq stream - the corrupt item AND
# its successor silently vanished, at rc 0. Now: a halt row naming the item,
# the sibling rows still printed, rc 3.
F="$TMP/s23"; fx "$F" 2
SF23="$F/ws/.ossify/project-state.json"
jq '.work_items[0].status = {"oops":true}' "$SF23" > "$SF23.tmp" && mv "$SF23.tmp" "$SF23"
inv "$F"
t_assert_eq "halt:unreadable" "$(route r0.s1.w1)" "S23: an unrenderable item fails closed, naming the item"
t_assert_rc 3 "S23: ...rc 3, not rc 0 on a partial stream"
t_assert_eq "spawn" "$(route r0.s1.w2)" "S23: ...and the successor still prints"

# S24 (#673 A3): a failed `git status` must halt, never degrade to clean=yes.
F="$TMP/s24"; fx "$F" 1
printf 'garbage' > "$F/core/.git/index"
inv "$F"
t_assert_eq "halt:unreadable" "$(field repo core 3)" "S24: an unreadable repo index halts the repo row"
t_assert_rc 3 "S24: ...rc 3"
# S24b: a configured root that does not exist is not `fresh`/`cut-missing`.
F="$TMP/s24b"; fx "$F" 1
jq --arg r "$F/gone" '.repos.core.root = $r' "$F/ws/.ossify/topology.json" > "$F/ws/.ossify/topology.json.tmp" && mv "$F/ws/.ossify/topology.json.tmp" "$F/ws/.ossify/topology.json"
inv "$F"
t_assert_eq "halt:unreadable" "$(field repo core 3)" "S24b: a missing hosting-repo root halts, not a benign verdict"
# The two unreadable arms write different facts; pin the ROOT arm's row (all
# facts `-`, nothing read) so this assertion cannot silently pass off the
# status guard catching the same fixture (which reports branch=absent).
t_assert_eq "branch=-" "$(field repo core 4)" "S24b: ...the root itself was found missing (the row read nothing)"
# S24c: the item-side unchecked status - corrupt the WORKTREE's index.
F="$TMP/s24c"; fx "$F" 1; spawn "$F" r0.s1.w1 one >/dev/null
printf 'garbage' > "$F/core/.git/worktrees/r0.s1.w1/index"
inv "$F"
t_assert_eq "halt:unreadable" "$(route r0.s1.w1)" "S24c: an unreadable worktree index halts the item row"

# S25 (#673 A4): an active item whose recorded dir is gone but whose branch is
# LIVE in another worktree must halt in the READ-OUT - §2b mutates repos before
# item repairs, so meeting the refusal at reattach would be too late. The
# pre-fix suffix guard would have re-added here, leaving two holders.
F="$TMP/s25"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
mkdir -p "$F/elsewhere/.worktrees"
git -C "$F/core" worktree move "$WT" "$F/elsewhere/.worktrees/r0.s1.w1"
inv "$F"
t_assert_eq "halt:worktree-held" "$(route r0.s1.w1)" "S25: the branch is held elsewhere - halt before any repair"
t_assert_rc 3 "S25: ...rc 3"

# S26 (#673 A5): a complete item whose branch was deleted - spine-close step
# 10's `git branch -d`, which refuses an unmerged branch, so the deletion is
# the post-merge cleanup shape. merged-ness cannot be recomputed from what is
# gone; halting here made the hand-over-to-close arm unreachable. skip, and
# the close cleanup tolerates the missing branch (test-worktree.sh).
F="$TMP/s26"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
echo a > "$WT/a"; git -C "$WT" add a; git -C "$WT" commit -qm "close r0.s1.w1"
git -C "$F/core" merge -q --no-ff work/r0.s1.w1-one -m "merge r0.s1.w1"
oss_in "$F" work_item_status r0.s1.w1 complete >/dev/null
git -C "$F/core" worktree remove --force "$WT" >/dev/null 2>&1 || true
rm -rf "$WT"
git -C "$F/core" branch -d work/r0.s1.w1-one >/dev/null 2>&1
inv "$F"
t_assert_eq "skip" "$(route r0.s1.w1)" "S26: complete + branch deleted -> skip (the cleanup-finished shape)"
t_assert_rc 0 "S26: ...rc 0 - the hand-over-to-close arm stays reachable"

# S27 (#673 B1): adopt must take only a branch this item OWNS. A clean
# worktree at the derived path on `main` - whose HEAD is trivially an ancestor
# of the spine branch - used to be journaled as the item's branch: dispatch
# would commit onto main, and spine-close's worktree_remove would try
# `git branch -d main`. S11 above is the same-shape control (an item's OWN
# work/ branch) that still adopts.
F="$TMP/s27"; fx "$F" 2
git -C "$F/core" worktree add -q "$F/core/.worktrees/r0.s1.w2" main
inv "$F"
t_assert_eq "halt:planned-with-worktree" "$(route r0.s1.w2)" "S27: a worktree on main at the derived path halts, never adopts"
t_assert_rc 3 "S27: ...rc 3"

# S28 (#673 C2): a close-REJECTED staged result is durably distinguishable
# from a close-finished one. The rejection record is the `[fidelity]` finding
# the halting gate run wrote to verify.md; the sibling control proves the
# check keys on that finding, not on the file's mere existence (advisory
# findings are written there by passing runs too, and those must stay
# close-finished).
F="$TMP/s28"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
echo a > "$WT/a"; git -C "$WT" add a
mkdir -p "$F/ws/docs/specs/r0/r0.s1-demo/work-r0.s1.w1"
echo r > "$F/ws/docs/specs/r0/r0.s1-demo/work-r0.s1.w1/report.md"
printf '[pattern] advisory only\n' > "$F/ws/docs/specs/r0/r0.s1-demo/work-r0.s1.w1/verify.md"
inv "$F"
t_assert_eq "close-finished" "$(route r0.s1.w1)" "S28 control: verify.md without a [fidelity] line stays close-finished"
printf '[fidelity] src/x.ts:3 - the diff deviates from spec.md; report 7 does not declare it\n' >> "$F/ws/docs/specs/r0/r0.s1-demo/work-r0.s1.w1/verify.md"
inv "$F"
t_assert_eq "halt:close-rejected" "$(route r0.s1.w1)" "S28: a recorded [fidelity] rejection halts re-entry"
t_assert_rc 3 "S28: ...rc 3"

# S29 (#673 G3): a RECORDED base that no longer resolves halts the read-out -
# a repo row naming it - instead of classifying `cut-missing` and failing
# mid-repair after the earlier repos were already cut. The control (same
# fixture, base still present) is R4's cut-missing / rc 0 above.
F="$TMP/s29"; mkfix "$F"
oss_in "$F" work_item_add r0.s1 One core >/dev/null; oss_in "$F" work_item_add r0.s1 Two ui >/dev/null
git -C "$F/core" checkout -q -b spine/r0.s1-demo
oss_in "$F" spine_base_set r0.s1 core main >/dev/null
oss_in "$F" spine_base_set r0.s1 ui main >/dev/null
inv "$F"
t_assert_eq "cut-missing" "$(field repo ui 3)" "S29 control: ui's base resolves -> cut-missing, not a halt"
t_assert_rc 0 "S29 control: ...rc 0 - the repairable shape stays repairable"
git -C "$F/ui" branch -m main main-renamed
inv "$F"
t_assert_eq "halt:base-unresolved" "$(field repo ui 3)" "S29: a recorded base renamed after the fact halts the read-out"
t_assert_eq "base=main" "$(field repo ui 7)" "S29: ...naming the recorded base that no longer resolves"
t_assert_eq "ok" "$(field repo core 3)" "S29: ...while the healthy repo's row is untouched"
t_assert_rc 3 "S29: ...rc 3, before any repo repair can cut elsewhere"

# S30 (#673 G2): a rejection record that EXISTS but cannot be read is not an
# absent one - the staged result must halt, not route close-finished into the
# stochastic gate. Two controls: S4 (no verify.md at all = no record, still
# close-finished) and S28's first half (readable, no [fidelity] = cleared).
F="$TMP/s30"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
echo a > "$WT/a"; git -C "$WT" add a
mkdir -p "$F/ws/docs/specs/r0/r0.s1-demo/work-r0.s1.w1"
echo r > "$F/ws/docs/specs/r0/r0.s1-demo/work-r0.s1.w1/report.md"
inv "$F"
t_assert_eq "close-finished" "$(route r0.s1.w1)" "S30 control: no verify.md at all is the cleared state"
mkdir "$F/ws/docs/specs/r0/r0.s1-demo/work-r0.s1.w1/verify.md"   # a path that IS there, unreadable as a record
inv "$F"
t_assert_eq "halt:unreadable" "$(route r0.s1.w1)" "S30: an unreadable verify.md halts, never close-finished"
t_assert_rc 3 "S30: ...rc 3"

# S31 (#673 G1): an unreadable holder list reads exactly like "no holders" -
# the pre-fix `|| holders=""` routed a planned item with a recorded branch and
# a missing derived path to `reattach`, one mutation before it would have met
# the refusal. The list failing must read as HELD. The PATH shim is what makes
# the pipeline fail under the dispatcher's pipefail (sourcing the lib cannot:
# without pipefail the awk stage still exits 0); the control run proves the
# fixture really routes reattach when the list reads.
F="$TMP/s31"; fx "$F" 2
WT2="$(oss_in "$F" worktree_add core r0.s1.w2 two spine/r0.s1-demo)"
oss_in "$F" work_item_exec r0.s1.w2 "$(git -C "$WT2" rev-parse --abbrev-ref HEAD)" "$WT2" "$(git -C "$WT2" rev-parse HEAD)" >/dev/null
rm -rf "$WT2"                                    # planned + exec record + dir gone: a reattach candidate
WT1="$(spawn "$F" r0.s1.w1 one)"; rm -rf "$WT1"  # active + dir gone: the other arm that consults held
inv "$F"
t_assert_eq "reattach" "$(route r0.s1.w2)" "S31 control: a readable list routes the planned item reattach"
t_assert_eq "reattach" "$(route r0.s1.w1)" "S31 control: ...and the active item too"
SHG="$TMP/failgit-s31"; mkdir -p "$SHG"
printf '#!/usr/bin/env bash\ncase " $* " in *" worktree list "*) echo "fatal: simulated worktree list failure" >&2; exit 128;; esac\nexec %s "$@"\n' "$(command -v git)" > "$SHG/git"
chmod +x "$SHG/git"
T_OUT="$(cd "$F/ws" && PATH="$SHG:$PATH" bash "$OSS" spine_inventory r0.s1 2>&1)"; T_RC=$?
t_assert_eq "halt:worktree-held" "$(route r0.s1.w2)" "S31: an unreadable holder list is HELD - the planned item halts"
t_assert_eq "halt:worktree-held" "$(route r0.s1.w1)" "S31: ...and the active item halts"
t_assert_rc 3 "S31: ...rc 3"

# S32 (#673 H1): a work branch RESET to an ancestor of its recorded base_sha
# still differs from the base and is still an ancestor of the spine branch -
# the A1 predicate alone called that merged, so a complete item routed skip
# and an active one finish-status although no item work sits past the cut
# point. Merged-ness now requires the tip to DESCEND from base_sha; the
# rewrite halts. The controls prove the fixture's own landing routes normally:
# S32's pre-rewrite state is skip, S32b's is finish-status (S1/S12 too).
F="$TMP/s32"; mkfix "$F"
oss_in "$F" work_item_add r0.s1 One core >/dev/null
git -C "$F/core" commit -qm second --allow-empty      # an ancestor exists for the reset target
git -C "$F/core" checkout -q -b spine/r0.s1-demo
oss_in "$F" spine_base_set r0.s1 core main >/dev/null
WT="$(spawn "$F" r0.s1.w1 one)"
echo a > "$WT/a"; git -C "$WT" add a; close_item "$F" r0.s1.w1 "$WT"
inv "$F"
t_assert_eq "skip" "$(route r0.s1.w1)" "S32 control: the un-rewritten landing is skip"
git -C "$WT" reset -q --hard "$(git -C "$F/core" rev-parse main~1)"   # an ancestor of base_sha
inv "$F"
t_assert_eq "halt:unclassified" "$(route r0.s1.w1)" "S32: a complete item reset below base_sha halts, never skip"
t_assert_rc 3 "S32: ...rc 3"
# S32b: the ACTIVE variant - the same rewrite the predicate used to call a
# landing, routing finish-status.
F="$TMP/s32b"; mkfix "$F"
oss_in "$F" work_item_add r0.s1 One core >/dev/null
git -C "$F/core" commit -qm second --allow-empty
git -C "$F/core" checkout -q -b spine/r0.s1-demo
oss_in "$F" spine_base_set r0.s1 core main >/dev/null
WT="$(spawn "$F" r0.s1.w1 one)"
echo a > "$WT/a"; git -C "$WT" add a; git -C "$WT" commit -qm "close r0.s1.w1"
git -C "$F/core" merge -q --no-ff work/r0.s1.w1-one -m "merge r0.s1.w1"
inv "$F"
t_assert_eq "finish-status" "$(route r0.s1.w1)" "S32b control: a genuine active landing is finish-status"
git -C "$WT" reset -q --hard "$(git -C "$F/core" rev-parse main~1)"
inv "$F"
t_assert_eq "halt:unclassified" "$(route r0.s1.w1)" "S32b: an active item reset below base_sha halts, never finish-status"
t_assert_rc 3 "S32b: ...rc 3"

# S33 (#673 I2): a COMPLETE item's dirty worktree halts the read-out on every
# route - merged+`skip` and unmerged+`finish-merge` alike - because close's
# cleanup calls `worktree_remove`, which refuses a dirty worktree at its last
# step, long after re-entry had run other repairs. The clean controls are the
# pre-dirt states (S1's merged landing skips; S12's unmerged one finishes).
F="$TMP/s33"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
echo a > "$WT/a"; git -C "$WT" add a; close_item "$F" r0.s1.w1 "$WT"
inv "$F"
t_assert_eq "skip" "$(route r0.s1.w1)" "S33 control: complete + merged + clean is skip"
echo dirt > "$WT/scratch"
inv "$F"
t_assert_eq "halt:dirty-worktree" "$(route r0.s1.w1)" "S33a: complete + merged + dirty halts, never skip"
t_assert_rc 3 "S33a: ...rc 3"
rm "$WT/scratch"
F="$TMP/s33b"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
echo a > "$WT/a"; git -C "$WT" add a; git -C "$WT" commit -qm c
oss_in "$F" work_item_status r0.s1.w1 complete >/dev/null
inv "$F"
t_assert_eq "finish-merge" "$(route r0.s1.w1)" "S33 control: complete + unmerged + clean is finish-merge"
echo dirt > "$WT/scratch"
inv "$F"
t_assert_eq "halt:dirty-worktree" "$(route r0.s1.w1)" "S33b: complete + unmerged + dirty halts before the merge"
t_assert_rc 3 "S33b: ...rc 3"

# S34 (#673 J1): the durable [fidelity] rejection record gates every arm that
# can MERGE, not just close-finished. An active item one merge away from
# landing (S9b's shape) whose verify.md records a rejection must halt -
# merging would land gate-rejected work the correction never cleared - and an
# unreadable record halts too, never reading as clear. Controls: S9b (no
# record) and the advisory-only file below both stay finish-merge.
F="$TMP/s34"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
echo a > "$WT/a"; git -C "$WT" add a; git -C "$WT" commit -qm "close r0.s1.w1"
D34="$F/ws/docs/specs/r0/r0.s1-demo/work-r0.s1.w1"; mkdir -p "$D34"
echo r > "$D34/report.md"
inv "$F"
t_assert_eq "finish-merge" "$(route r0.s1.w1)" "S34 control: no rejection record -> finish-merge (S9b shape)"
printf '[pattern] advisory only\n' > "$D34/verify.md"
inv "$F"
t_assert_eq "finish-merge" "$(route r0.s1.w1)" "S34 control: a record WITHOUT [fidelity] stays finish-merge"
printf '[fidelity] src/x.ts:3 - rejected\n' >> "$D34/verify.md"
inv "$F"
t_assert_eq "halt:close-rejected" "$(route r0.s1.w1)" "S34: an active finish-merge shape with a recorded rejection halts"
t_assert_rc 3 "S34: ...rc 3"
rm "$D34/verify.md"; mkdir "$D34/verify.md"
inv "$F"
t_assert_eq "halt:unreadable" "$(route r0.s1.w1)" "S34: an unreadable record on this arm halts, never finish-merge"
# S34b: the complete+unmerged arm (S12's shape) consults the same record.
F="$TMP/s34b"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
echo a > "$WT/a"; git -C "$WT" add a; git -C "$WT" commit -qm c
oss_in "$F" work_item_status r0.s1.w1 complete >/dev/null
inv "$F"
t_assert_eq "finish-merge" "$(route r0.s1.w1)" "S34b control: no rejection record -> finish-merge (S12 shape)"
mkdir -p "$F/ws/docs/specs/r0/r0.s1-demo/work-r0.s1.w1"
printf '[fidelity] rejected earlier\n' > "$F/ws/docs/specs/r0/r0.s1-demo/work-r0.s1.w1/verify.md"
inv "$F"
t_assert_eq "halt:close-rejected" "$(route r0.s1.w1)" "S34b: a complete+unmerged item with a recorded rejection halts"
t_assert_rc 3 "S34b: ...rc 3"

# S35 (#673 L2): a recorded branch must be one this item OWNS. A record naming
# a foreign branch (a pre-fix adopt, or a hand-edited record) used to reattach
# here, after which the next inventory would redispatch it - commits landing
# on a branch that is not this item's. The prefix predicate B1 applied to the
# adopt arm now guards every arm; S6 remains the control (this item's own
# work/ branch with a missing dir still reattaches).
F="$TMP/s35"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
git -C "$F/core" branch elsewhere
oss_in "$F" work_item_exec r0.s1.w1 elsewhere "$WT" "$(git -C "$F/core" rev-parse spine/r0.s1-demo)" >/dev/null
rm -rf "$WT"; inv "$F"
t_assert_eq "halt:unclassified" "$(route r0.s1.w1)" "S35: an active item recording a foreign branch halts, never reattaches"
t_assert_rc 3 "S35: ...rc 3"

# S36 (#673 L3): a `complete` item with NO branch ever recorded is not the
# post-cleanup shape - nothing proves a branch existed - so it halts under its
# own route instead of skipping the round done. S26 is the control (a branch
# recorded, its ref gone: the cleanup shape, still skip).
F="$TMP/s36"; fx "$F" 1
oss_in "$F" work_item_status r0.s1.w1 complete >/dev/null; inv "$F"
t_assert_eq "halt:branch-unknown" "$(route r0.s1.w1)" "S36: complete with no branch ever recorded halts"
t_assert_rc 3 "S36: ...rc 3"

# S38 (#673 L2, the complete arm): the same ownership guard covers a complete
# item whose record names a foreign branch carrying commits - the shape that
# used to route finish-merge and would merge a branch this item does not own.
F="$TMP/s38"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
git -C "$WT" checkout -q -B other
echo a > "$WT/a"; git -C "$WT" add a; git -C "$WT" commit -qm c
oss_in "$F" work_item_exec r0.s1.w1 other "$WT" "$(git -C "$F/core" rev-parse spine/r0.s1-demo)" >/dev/null
oss_in "$F" work_item_status r0.s1.w1 complete >/dev/null; inv "$F"
t_assert_eq "halt:unclassified" "$(route r0.s1.w1)" "S38: a complete item recording a foreign branch halts, never finish-merges"
t_assert_rc 3 "S38: ...rc 3"

# S37 (#673 L4): a LOCKED dead registration at this item's own path is not a
# reattachable one - git prints the lock a line AFTER the branch (measured),
# and the read-out now reads it. Routing reattach here would meet rc 8 only
# after §2b's repo repairs had mutated. S6 is the control (unlocked -> it
# reattaches).
F="$TMP/s37"; fx "$F" 1; WT="$(spawn "$F" r0.s1.w1 one)"
git -C "$F/core" worktree lock "$WT"; rm -rf "$WT"; inv "$F"
t_assert_eq "halt:worktree-held" "$(route r0.s1.w1)" "S37: a locked own-path dead registration is held, not reattachable"
t_assert_rc 3 "S37: ...rc 3"

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
