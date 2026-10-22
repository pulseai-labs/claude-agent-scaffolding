#!/usr/bin/env bash
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"
. "$HERE/../lib/id.sh"; . "$HERE/../lib/state.sh"; . "$HERE/../lib/manifest.sh"; . "$HERE/../lib/entities.sh"
TMP="$(mktemp -d)"; S="$TMP/state.json"
# #272/#310 Task 4: oss_entity_add_work_item's omitted-target_repo default now
# routes through _oss_default_repo_key (manifest.sh, sourced above), which
# needs a discoverable manifest even for this direct lib-level call - the old
# default was a literal `canonical`, never a lookup. $S is passed explicitly
# throughout this file (never via OSS_STATE_FILE/manifest routing), so the
# fixture below only needs to be DISCOVERABLE, not aligned to any state path.
mkdir -p "$TMP/.ossify"
cat > "$TMP/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"canonical":{"root":"$TMP/canon"}},"well_known_paths":{}}
JSON
cd "$TMP"
oss_state_init "$S" ent-demo >/dev/null

t_capture oss_entity_add_release "$S" "Skeleton" "core loop usable end-to-end"
t_assert_rc 0 "release added"; t_assert_eq "r0" "$T_OUT" "first release is r0"

t_capture oss_entity_add_spine "$S" r0 "walking skeleton" bone canonical
t_assert_rc 0 "spine added"; t_assert_eq "r0.s1" "$T_OUT" "spine id"

# Fix 5 (test coverage): a rejected oss_entity_add_spine call must not mutate
# state — capture the spine count before each rejected call and confirm it is
# unchanged afterward (no phantom spine, no phantom journal entry).
t_capture oss_state_read "$S" '.spines | length'; SPINES_BEFORE="$T_OUT"

t_capture oss_entity_add_spine "$S" r9 "ghost" flesh canonical
t_assert_rc 7 "unknown release rejected"
t_capture oss_state_read "$S" '.spines | length'
t_assert_eq "$SPINES_BEFORE" "$T_OUT" "spine count unchanged after unknown-release rejection"

t_capture oss_entity_add_spine "$S" r0 "bad" cartilage canonical
t_assert_rc 2 "invalid class rejected"
t_capture oss_state_read "$S" '.spines | length'
t_assert_eq "$SPINES_BEFORE" "$T_OUT" "spine count unchanged after bad-class rejection"

t_capture oss_entity_add_work_item "$S" r0.s1 "wire entry point"
t_assert_rc 0 "work item added"; t_assert_eq "r0.s1.w1" "$T_OUT" "wi id"

t_capture oss_entity_set_spine_class "$S" r0.s1 flesh "user override after critic veto discussion"
t_assert_rc 0 "class override applied"
t_capture oss_state_read "$S" '.spines[0].class';            t_assert_eq "flesh" "$T_OUT" "class updated"
t_capture oss_state_read "$S" '.class_overrides | length';   t_assert_eq "1" "$T_OUT" "override recorded"

# --- Final review finding 7: class_set executes the fail-closed critic veto and
# is the 2nd-most-cited `oss` verb in skill prose, yet it had exactly the one
# happy-path assertion above. Three mutations survived the whole suite: swapping
# the args in the oss_cmd_class_set wrapper, deleting the class guard, and
# deleting the unknown-spine guard. The third is the silently harmful one — a
# typo'd spine id returned 0, appended a class_overrides audit record, changed no
# class, and replayed clean. Every sibling entity op already carries a
# reject-before-mutate + count-unchanged pair (see test-release-planning.sh's
# veto_add block); only the half that mutates the class was exempt.
t_capture oss_state_read "$S" '.class_overrides | length'; OVR_BEFORE="$T_OUT"

t_capture oss_entity_set_spine_class "$S" r0.s1 cartilage "not a class"
t_assert_rc 2 "class_set: class outside bone|flesh rejected"
t_capture oss_state_read "$S" '.class_overrides | length'
t_assert_eq "$OVR_BEFORE" "$T_OUT" "class_overrides unchanged after bad-class rejection"

t_capture oss_entity_set_spine_class "$S" r0.s2 bone "fail-closed default after critic veto"
t_assert_rc 7 "class_set: unknown spine id rejected"
t_capture oss_state_read "$S" '.class_overrides | length'
t_assert_eq "$OVR_BEFORE" "$T_OUT" "class_overrides unchanged after unknown-spine rejection (no phantom audit record)"
t_capture oss_state_read "$S" '.spines[0].class'
t_assert_eq "flesh" "$T_OUT" "no sibling spine's class touched by the rejected call"

# Dispatcher round-trip under the REAL `set -euo pipefail`, asserting the STORED
# VALUES and not only the rc: an rc-only assertion cannot see a wrapper that
# forwards the right arg count in the wrong order.
OSS="$HERE/../bin/oss"
t_capture env OSS_STATE_FILE="$S" "$OSS" class_set r0.s1 bone "bone-touch at decomposition: ADR-0002 (src/domain/**)"
t_assert_rc 0 "dispatcher: class_set accepted"
t_capture oss_state_read "$S" '.spines[0].class'
t_assert_eq "bone" "$T_OUT" "dispatcher: arg 2 landed as the CLASS (wrapper arg order intact)"
t_capture oss_state_read "$S" '[.class_overrides[] | select(.spine == "r0.s1")] | last | .reason'
t_assert_eq "bone-touch at decomposition: ADR-0002 (src/domain/**)" "$T_OUT" "dispatcher: arg 3 landed as the REASON"
t_capture oss_state_read "$S" '[.class_overrides[] | select(.spine == "r0.s1")] | last | .from'
t_assert_eq "flesh" "$T_OUT" "dispatcher: the prior class is recorded as 'from' (the audit trail is the point)"
t_capture env OSS_STATE_FILE="$S" "$OSS" class_set r9.s9 bone "typo'd id"
t_assert_rc 7 "dispatcher: class_set against an unknown spine is rc 7 through the real binary"

# the whole sequence above must still replay from base+journal.
t_capture oss_state_replay "$S"
t_assert_rc 0 "replay clean after the class_set accept/reject sequence"

SP=r0.s1; WI=r0.s1.w1   # this file uses literal ids; bind them once for the block below
# Status transitions: bad enum -> rc 2; unknown id -> rc 7 AND nothing mutated.
# A jq `select()` assignment is a silent NO-OP on a non-matching id, so without
# the entity guard a typo'd id would return 0 and change nothing - green, wrong.
t_capture oss_entity_set_spine_status "$S" "$SP" "shipped"
t_assert_rc 2 "spine status rejects an unknown enum value"
t_capture oss_entity_set_spine_status "$S" "r9.s9" "closed"
t_assert_rc 7 "spine status on an unknown spine is rc 7"
t_capture oss_state_read "$S" '[.mutations[] | select(.op=="set_spine_status")] | length'
t_assert_eq "0" "$T_OUT" "a rejected status change journals NOTHING"
t_capture oss_entity_set_spine_status "$S" "$SP" "closed"
t_assert_rc 0 "spine status accepts a valid transition"
t_capture oss_state_read "$S" ".spines[] | select(.id==\"$SP\") | .status"
t_assert_eq "closed" "$T_OUT" "spine status actually changed"
t_capture oss_entity_set_work_item_status "$S" "r9.s9.w9" "complete"
t_assert_rc 7 "work item status on an unknown id is rc 7"
t_capture oss_entity_set_release_status "$S" "r9" "closed"
t_assert_rc 7 "release status on an unknown id is rc 7"

# The block comment above claims "bad enum -> rc 2" for status transitions, but
# only the SPINE setter was ever asserted for it — the work-item and release
# setters had their unknown-id arm covered and their enum arm not, so a header
# promising all three was describing one. Each enum is DIFFERENT (spine uses
# `closed`, work item uses `complete`, both carry `abandoned`, release has
# neither of the last two), which is exactly the shape where a copy-paste guard
# goes unnoticed.
t_capture oss_entity_set_work_item_status "$S" "$WI" "shipped"
t_assert_rc 2 "work item status rejects an unknown enum value"
t_assert_contains "$T_OUT" "planned|active|complete|abandoned" "...and names the work-item enum, not another entity's"
# `closed` is valid for a spine and a release, and NOT for a work item. A guard
# copied from a sibling would accept it here; this is the assertion that sees it.
t_capture oss_entity_set_work_item_status "$S" "$WI" "closed"
t_assert_rc 2 "work item status rejects 'closed' - valid for a spine, not for a work item"

t_capture oss_entity_set_release_status "$S" "r0" "shipped"
t_assert_rc 2 "release status rejects an unknown enum value"
t_assert_contains "$T_OUT" "planned|active|closed" "...and names the release enum"
# `abandoned` is valid for a spine and not for a release — the mirror of the above.
t_capture oss_entity_set_release_status "$S" "r0" "abandoned"
t_assert_rc 2 "release status rejects 'abandoned' - valid for a spine, not for a release"

# Nothing above may have journaled: every one of those calls was refused.
t_capture oss_state_read "$S" '[.mutations[] | select(.op=="set_work_item_status" or .op=="set_release_status")] | length'
t_assert_eq "0" "$T_OUT" "no rejected work-item/release status change journals anything"

# And the accept path, so the guards are not passing by refusing everything.
# 1.22.0 (#563): `complete` needs a recorded dispatch, so the never-dispatched
# item refuses first, and lands once the dispatch is recorded - the real order.
t_capture oss_entity_set_work_item_status "$S" "$WI" "complete"
t_assert_rc 7 "work item status refuses complete on a never-dispatched item (#563)"
oss_entity_set_work_item_exec "$S" "$WI" "work/$WI" "$TMP/.worktrees/$WI" "sha-wi" >/dev/null
t_capture oss_entity_set_work_item_status "$S" "$WI" "complete"
t_assert_rc 0 "work item status accepts a valid transition"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WI\") | .status"
t_assert_eq "complete" "$T_OUT" "work item status actually changed"

# 1.11.0: `abandoned` is a work-item status - minted, then withdrawn before any
# dispatch. Without it such an item stayed `planned` (blocking spine close) or
# was marked `complete` (recording a merge that never happened). The refusals
# above stay the adjacent control: `closed` and `shipped` still refuse, and the
# release enum still refuses `abandoned`, so the widening is this one value.
t_capture oss_entity_add_work_item "$S" r0.s1 "withdrawn before dispatch"
WI2="$T_OUT"
t_assert_eq "r0.s1.w2" "$WI2" "setup: a second work item to withdraw"
N0="$(oss_state_read "$S" '[.mutations[] | select(.op=="set_work_item_status")] | length')"
t_capture oss_entity_set_work_item_status "$S" "$WI2" "abandoned"
t_assert_rc 0 "work item status accepts 'abandoned'"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WI2\") | .status"
t_assert_eq "abandoned" "$T_OUT" "work item status actually changed to abandoned"
t_capture oss_state_read "$S" '[.mutations[] | select(.op=="set_work_item_status")] | length'
t_assert_eq "$((N0 + 1))" "$T_OUT" "the abandonment journals exactly one set_work_item_status"
t_capture oss_state_read "$S" '[.mutations[] | select(.op=="set_work_item_status")] | last | .payload | keys | join(",")'
t_assert_eq "at,status,work_item" "$T_OUT" "the payload shape is unchanged - live journals already carry {work_item,status,at}"
# A withdrawal made by mistake is reversible through the same verb.
t_capture oss_entity_set_work_item_status "$S" "$WI2" "planned"
t_assert_rc 0 "an abandoned work item can return to planned"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WI2\") | .status"
t_assert_eq "planned" "$T_OUT" "...and the state reads planned again"
t_capture oss_state_read "$S" '[.mutations[] | select(.op=="set_work_item_status")] | length'
t_assert_eq "$((N0 + 2))" "$T_OUT" "one journaled mutation per accepted call"

# The DISPATCH guard on the same value (GLM seat, round 1 on PR #520).
# `abandoned` means withdrawn BEFORE any dispatch, and a recorded
# branch or worktree_path IS the dispatch. Without the guard, an active or
# complete item flips at rc 0; every close-path reader then skips it, its
# committed work never reaches the spine branch, and post-close it silently
# shrinks release close's tag set. Measured on the unguarded setter: it
# journaled and stranded at rc 0.
WID="$(oss_entity_add_work_item "$S" r0.s1 "dispatched, so not withdrawable")"
t_capture oss_entity_set_work_item_status "$S" "$WID" active
t_assert_rc 0 "setup: the dispatched item goes active"
t_capture oss_entity_set_work_item_exec "$S" "$WID" "work/$WID" "$TMP/.worktrees/$WID" "abc123"
t_assert_rc 0 "setup: the dispatch journals branch + worktree_path"
N1="$(oss_state_read "$S" '[.mutations[] | select(.op=="set_work_item_status")] | length')"
t_capture oss_entity_set_work_item_status "$S" "$WID" abandoned
t_assert_rc 7 "abandoning a DISPATCHED item refuses"
t_assert_contains "$T_OUT" "was dispatched" "...and names the dispatch as the reason"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WID\") | .status"
t_assert_eq "active" "$T_OUT" "...leaving the status untouched"
t_capture oss_state_read "$S" '[.mutations[] | select(.op=="set_work_item_status")] | length'
t_assert_eq "$N1" "$T_OUT" "...and journaling nothing"
# ADJACENT CONTROL: the same value on a never-dispatched item still applies, so
# the refusal above is the DISPATCH and not the value - without this, a guard
# that refused every abandonment would pass the assertions above.
t_capture oss_entity_set_work_item_status "$S" "$WI2" abandoned
t_assert_rc 0 "the same value on a never-dispatched item still applies"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WI2\") | .status"
t_assert_eq "abandoned" "$T_OUT" "...and lands"
# A branch ALONE (no worktree_path) is enough: the round walk journals both, and
# a guard reading only the worktree would let a half-journaled dispatch through.
WID2="$(oss_entity_add_work_item "$S" r0.s1 "branch only")"
oss_entity_set_work_item_exec "$S" "$WID2" "work/$WID2" "" "" >/dev/null 2>&1
t_capture oss_entity_set_work_item_status "$S" "$WID2" abandoned
t_assert_rc 7 "a recorded branch alone refuses the abandonment too"
# And a COMPLETE item is refused as well: the merge already landed, so
# abandoning it would take the tag set down with it.
t_capture oss_entity_set_work_item_status "$S" "$WID" complete
t_assert_rc 0 "setup: the dispatched item can still go complete"
t_capture oss_entity_set_work_item_status "$S" "$WID" abandoned
t_assert_rc 7 "a COMPLETE item cannot be abandoned after its merge landed"

# THE MIRROR ARM SHIPS in 1.22.0 (#563 member 2, operator ruling of 2026-10-12:
# refuse new writes). It was dropped from 1.12.0 by the 2026-09-23 narrowing; a
# dispatch onto an already-`abandoned` item now refuses, so the pair
# {status:abandoned, branch, worktree_path} can no longer be written through the
# verb. doctor's §5 report stays for the pairs older journals already hold.
WID3="$(oss_entity_add_work_item "$S" r0.s1 "withdrawn, then dispatched?")"
t_capture oss_entity_set_work_item_status "$S" "$WID3" abandoned
t_assert_rc 0 "setup: a third item is withdrawn before any dispatch"
N2="$(oss_state_read "$S" '[.mutations[] | select(.op=="set_work_item_exec")] | length')"
t_capture oss_entity_set_work_item_exec "$S" "$WID3" "work/$WID3" "$TMP/.worktrees/$WID3" "abc123"
t_assert_rc 7 "dispatching an ABANDONED item is refused - the mirror arm ships (#563)"
t_assert_contains "$T_OUT" "work_item_status $WID3 planned" "...naming the route back"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WID3\") | [(.status // \"\"), (.branch // \"\")] | join(\",\")"
t_assert_eq "abandoned," "$T_OUT" "...and no drift pair is written"
t_capture oss_state_read "$S" '[.mutations[] | select(.op=="set_work_item_exec")] | length'
t_assert_eq "$N2" "$T_OUT" "...journaling nothing"
# The live-item control this row has always carried: the same dispatch call on an
# item that is neither withdrawn nor landed still journals, so the accepted row
# above is not "this verb says yes to everything now".
WIDLIVE="$(oss_entity_add_work_item "$S" r0.s1 "live control item")"
t_capture oss_entity_set_work_item_status "$S" "$WIDLIVE" active
t_assert_rc 0 "setup: the control item is active"
t_capture oss_entity_set_work_item_exec "$S" "$WIDLIVE" "work/$WIDLIVE" "$TMP/.worktrees/$WIDLIVE" "abc123"
t_assert_rc 0 "the same call on a live item still dispatches"
# ...and un-withdrawing still re-opens the path on the drift pair too: the way back
# the dropped remedy used to name is a plain status write, in the guarded direction.
t_capture oss_entity_set_work_item_status "$S" "$WID3" planned
t_assert_rc 0 "the way back works: the withdrawn-then-dispatched item returns to planned"
t_capture oss_entity_set_work_item_exec "$S" "$WID3" "work/$WID3" "$TMP/.worktrees/$WID3" "abc123"
t_assert_rc 0 "...and it can then be re-dispatched (a payload that records a dispatch)"

# ---------------------------------------------------------------------------
# Phase 3 (1.12.0, #529 with #528 and #533 half A): the never-strand invariant -
# one predicate, one place, evaluated INSIDE the mutation lock.
# ---------------------------------------------------------------------------
# (1) THE PREDICATE READS ALL THREE FIELDS the dispatch writer journals. The
# abandonment guard read `branch` and `worktree_path` only, and the writer
# accepts a half-write: `work_item_exec <wi> "" "" <sha>` records base_sha alone
# at rc 0 (a hand-recovered dispatch), which a two-field read called
# undispatched - so the item abandoned successfully and its work was stranded,
# which is the harm the guard exists to prevent.
WID4="$(oss_entity_add_work_item "$S" r0.s1 "sha-only dispatch")"
t_capture oss_entity_set_work_item_exec "$S" "$WID4" "" "" "sha-only-abc"
t_assert_rc 0 "setup: the verb accepts a base_sha-only dispatch (the half-write shape)"
N3="$(oss_state_read "$S" '.mutations | length')"
t_capture oss_entity_set_work_item_status "$S" "$WID4" abandoned
t_assert_rc 7 "a base_sha-only dispatch REFUSES the abandonment"
t_assert_contains "$T_OUT" "base_sha" "...naming the field that made it dispatched"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WID4\") | .status"
t_assert_eq "planned" "$T_OUT" "...leaving the status alone"
t_capture oss_state_read "$S" '.mutations | length'
t_assert_eq "$N3" "$T_OUT" "...and journaling nothing"

# (1b) The `complete` clause of the same guard, which the dispatch clause does NOT
# cover. An item can be complete with no dispatch record - a hand-edited state, or
# a journal from a build that recorded the merge without the dispatch - and its
# merge is on the spine branch either way, so abandoning it takes a landed line
# out of every close-path reader and out of release close's tag set. The raw op
# below writes the shape with no dispatch record and no journal gap. Since 1.22.0
# the status verb refuses to write it (#563), so the raw op - an older journal -
# is the only source, and this stays the clause's own row rather than a duplicate
# of the dispatched one above.
WID4B="$(oss_entity_add_work_item "$S" r0.s1 "landed, no dispatch record")"
oss_state_mutate "$S" set_work_item_status \
  "$(jq -n --arg w "$WID4B" --arg st complete --arg ts "$(_oss_now)" '{work_item:$w,status:$st,at:$ts}')" >/dev/null
t_assert_eq "complete" "$(oss_state_read "$S" ".work_items[] | select(.id==\"$WID4B\") | .status")" \
  "setup: an item is complete with NO dispatch record (the raw op, as an older journal would hold it)"
t_capture oss_entity_set_work_item_status "$S" "$WID4B" abandoned
t_assert_rc 7 "a COMPLETE item with no dispatch record still refuses the abandonment"
t_assert_contains "$T_OUT" "complete" "...naming the status that blocks it, not a dispatch"

# (2) THE SPINE LEVEL does NOT SHIP - the operator's ruling of 2026-09-23 dropped
# the retirement refusal (round-1 #9, round-2 #17/#19/#20/#22/#27: the two levels
# disagreed, the printed remedy was false for one of its own causes, and the
# remedies circled on the pre-1.12 drift pair). It is the same class as the other
# dropped arms - a condition on a record the same verb family can rewrite - and it
# rides #563. The consequence is stated rather than hidden: a spine whose items
# have started or landed retires at rc 0 again, and every close-path reader then
# skips them.
#
# ADJACENT CONTROL, and the reason this is a narrowing and not a hole: the
# item-level rail still refuses the withdrawal of exactly these items, in the
# guarded ORDER. What the ruling dropped is the second door, not the lock.
SP2="$(oss_entity_add_spine "$S" r0 "second spine" flesh canonical)"
WID5="$(oss_entity_add_work_item "$S" "$SP2" "dispatched item")"
t_capture oss_entity_set_work_item_exec "$S" "$WID5" "work/$WID5" "$TMP/.worktrees/$WID5" "abc123"
t_assert_rc 0 "setup: an item of the second spine is dispatched"
t_capture oss_entity_set_spine_status "$S" "$SP2" abandoned
t_assert_rc 0 "retiring a spine with a DISPATCHED item is accepted - the spine rail is dropped"
t_capture oss_state_read "$S" ".spines[] | select(.id==\"$SP2\") | .status"
t_assert_eq "abandoned" "$T_OUT" "...and the retirement really lands (not a silent no-op)"
t_capture oss_entity_set_work_item_status "$S" "$WID5" abandoned
t_assert_rc 7 "...and the ITEM-level rail still refuses that item's withdrawal"
t_assert_contains "$T_OUT" "records a dispatch" "...naming the dispatch, one level down from the dropped refusal"
# Controls that were never about the dropped term: a spine with no items retires,
# and one whose only item was withdrawn before dispatch retires.
SP3="$(oss_entity_add_spine "$S" r0 "third spine" flesh canonical)"
t_capture oss_entity_set_spine_status "$S" "$SP3" abandoned
t_assert_rc 0 "a spine with NO items still retires (nothing ran)"
SP4="$(oss_entity_add_spine "$S" r0 "fourth spine" flesh canonical)"
WID6="$(oss_entity_add_work_item "$S" "$SP4" "withdrawn before dispatch")"
t_capture oss_entity_set_work_item_status "$S" "$WID6" abandoned
t_assert_rc 0 "setup: its only item is withdrawn before any dispatch"
t_capture oss_entity_set_spine_status "$S" "$SP4" abandoned
t_assert_rc 0 "...and that spine still retires (it ran nothing)"
# The second cause the dropped refusal used to name, kept as a row because the
# ITEM-level `complete` clause is the control for it now: a spine whose item is
# dispatched AND complete still retires, and the item still cannot be withdrawn.
SP5="$(oss_entity_add_spine "$S" r0 "fifth spine" flesh canonical)"
WID7="$(oss_entity_add_work_item "$S" "$SP5" "landed item")"
t_capture oss_entity_set_work_item_exec "$S" "$WID7" "work/$WID7" "$TMP/.worktrees/$WID7" "abc123"
t_assert_rc 0 "setup: its item is dispatched"
t_capture oss_entity_set_work_item_status "$S" "$WID7" complete
t_assert_rc 0 "setup: ...and goes complete"
t_capture oss_entity_set_spine_status "$S" "$SP5" abandoned
t_assert_rc 0 "retiring a spine with a COMPLETE item is accepted too - no spine read remains"
t_capture oss_entity_set_work_item_status "$S" "$WID7" abandoned
t_assert_rc 7 "...and the item-level rail still refuses the landed item's withdrawal"

# (3) DUPLICATE IDS (#533 half A). The existence probe read one line per matching
# record, so a duplicate id made the count string multi-line, the numeric case arm
# fired, and the verb answered rc 2 "cannot read work item" - while
# planned/active/complete, which skipped that read, proceeded on the SAME state at
# rc 0. One verb, one state, two answers. The in-lock resolver counts records once
# and names the condition the sibling registry verbs name (#305).
DUP="r0.s1.w9"
for _t in "duplicate id" "duplicate id, second row"; do
  oss_state_mutate "$S" add_work_item \
    "$(jq -n --arg s r0.s1 --arg t "$_t" --arg r canonical --arg ts "$(_oss_now)" \
      '{spine:$s,title:$t,target_repo:$r,status:"planned",created_at:$ts,id:"r0.s1.w9"}')" >/dev/null
done
t_assert_eq "2" "$(oss_state_read "$S" '[.work_items[] | select(.id=="r0.s1.w9")] | length')" \
  "setup: two records share one id (a duplicate no shipped verb can mint)"
t_capture oss_entity_set_work_item_status "$S" "$DUP" abandoned
t_assert_rc 7 "a duplicate id refuses the abandonment"
t_assert_contains "$T_OUT" "#305" "...naming the duplicate-id condition, not a state-read failure"
case "$T_OUT" in *"cannot read"*) T_FAIL=$((T_FAIL+1)); echo "FAIL: the duplicate-id refusal still reads as a state-read failure";; *) T_PASS=$((T_PASS+1));; esac
t_capture oss_entity_set_work_item_status "$S" "$DUP" planned
t_assert_rc 7 "...and the same state refuses that id for a status that skips the abandonment read"
t_capture oss_entity_set_work_item_exec "$S" "$DUP" "work/$DUP" "$TMP/.worktrees/$DUP" "abc"
t_assert_rc 7 "...and for a dispatch"

# (4) REPLAY IS UNTOUCHED, which is the whole reason the guards are verb-side. A
# live estate may already hold the inconsistent pair; journaling one through the
# raw op (the only path that can now produce one) must still replay clean.
oss_state_mutate "$S" set_work_item_status \
  "$(jq -n --arg w "$WID4" --arg st abandoned --arg ts "$(_oss_now)" '{work_item:$w,status:$st,at:$ts}')" >/dev/null
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WID4\") | [(.status // \"\"), (.base_sha // \"\")] | join(\",\")"
t_assert_eq "abandoned,sha-only-abc" "$T_OUT" "setup: the raw op CAN still journal the inconsistent pair (an older build's journal)"
t_capture oss_state_replay "$S"
t_assert_rc 0 "replay of that journal stays CLEAN - the rails are verb-side and _oss_apply_op is untouched"

# ---------------------------------------------------------------------------
# Phase 3, round 1 (PR #562 review, GLM seat), NARROWED by the operator's ruling
# of 2026-09-23: ONE clause survives on the dispatch write - a payload that
# records NO dispatch at all, on an item that already records one - because the
# abandonment rail above stands on it (erase the record and that rail sees an
# undispatched item and lets the strand through). The narrowing clause and the
# landed-provenance clause do not ship; the mirror arm ships in 1.22.0 (#563,
# the 1.22.0 block at the end of this file); each row below
# states which side of that line it is on, and every accepted row is paired with
# the refusal that must still fire next to it.
# ---------------------------------------------------------------------------
SP6="$(oss_entity_add_spine "$S" r0 "sixth spine" flesh canonical)"
WID9="$(oss_entity_add_work_item "$S" "$SP6" "erase me")"
t_capture oss_entity_set_work_item_exec "$S" "$WID9" "work/$WID9" "$TMP/.worktrees/$WID9" "sha-9"
t_assert_rc 0 "setup: the item records a full dispatch"

# (5a) ALL-EMPTY ON A RECORDED ITEM: the kept clause. It records no dispatch at
# all and would erase the one on record.
N9="$(oss_state_read "$S" '[.mutations[] | select(.op=="set_work_item_exec")] | length')"
t_capture oss_entity_set_work_item_exec "$S" "$WID9" "" "" ""
t_assert_rc 7 "an all-empty exec on a RECORDED item is REFUSED (the kept clause)"
t_assert_contains "$T_OUT" "no dispatch" "...naming emptiness as the reason"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WID9\") | .branch"
t_assert_eq "work/$WID9" "$T_OUT" "...leaving the recorded dispatch intact"
t_capture oss_state_read "$S" '[.mutations[] | select(.op=="set_work_item_exec")] | length'
t_assert_eq "$N9" "$T_OUT" "...and journaling nothing"
# ADJACENT CONTROL for the loosening that follows: the SAME call on an item with
# NO record at all is accepted, because there is nothing to erase. The pair is
# adjacent on purpose - the refusal above is the WIPE, not emptiness, and the
# clause was dropped exactly where it was not load-bearing. Then the recorded item
# refuses again AFTER the accepted one, so a mutation that neuters the clause
# cannot pass by row order either.
WID14="$(oss_entity_add_work_item "$S" "$SP6" "nothing to record")"
t_capture oss_entity_set_work_item_exec "$S" "$WID14" "" "" ""
t_assert_rc 0 "the same all-empty exec on an item with NO record is accepted now"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WID14\") | [(.branch // \"\"), (.worktree_path // \"\"), (.base_sha // \"\")] | join(\"|\")"
t_assert_eq "||" "$T_OUT" "...and the item holds no dispatch record"
t_capture oss_entity_set_work_item_exec "$S" "$WID9" "" "" ""
t_assert_rc 7 "...and a RECORDED item still refuses the same call, after it"

# (5b) NARROWING a recorded field: ACCEPTED now (the clause rode the same drop).
# What must not change is the rail's soundness - no accepted write may leave a
# recorded item reading UNDISPATCHED, and this one does not: the predicate still
# reads the base_sha it records, so the withdrawal is refused immediately after.
t_capture oss_entity_set_work_item_exec "$S" "$WID9" "" "" "sha-9b"
t_assert_rc 0 "an exec that empties a RECORDED field is accepted now (dropped clause)"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WID9\") | [(.branch // \"\"), (.worktree_path // \"\"), (.base_sha // \"\")] | join(\"|\")"
t_assert_eq "||sha-9b" "$T_OUT" "...and the record is what the payload wrote"
t_capture oss_entity_set_work_item_status "$S" "$WID9" abandoned
t_assert_rc 7 "...and the item still reads DISPATCHED, so the rail refuses it"
t_assert_contains "$T_OUT" "base_sha" "...naming the field the emptied write left behind"
# ADJACENT CONTROL: a FULL re-dispatch (all three fields) still journals, so the
# refusal above is not "this verb now refuses everything".
t_capture oss_entity_set_work_item_exec "$S" "$WID9" "work/$WID9-redo" "$TMP/.worktrees/$WID9-redo" "sha-9c"
t_assert_rc 0 "a full re-dispatch (all three fields) still journals"
# ...and the half-write is still accepted where there is NO record to narrow: that
# is the hand-recovered shape the design tolerates, and it strands nothing.
WID10="$(oss_entity_add_work_item "$S" "$SP6" "half-write")"
t_capture oss_entity_set_work_item_exec "$S" "$WID10" "" "" "sha-only-10"
t_assert_rc 0 "a base_sha-only dispatch on a fresh item is still accepted"

# (5c) LANDED PROVENANCE is no longer protected by this verb: re-dispatching a
# COMPLETE item overwrites the branch the merge landed from (round-1 #13's clause,
# dropped with the rest - #563). ADJACENT CONTROL: the landing itself still keeps
# the item out of a withdrawal, which is the rail that DID ship.
WID11="$(oss_entity_add_work_item "$S" "$SP6" "landed")"
t_capture oss_entity_set_work_item_exec "$S" "$WID11" "work/$WID11" "$TMP/.worktrees/$WID11" "sha-11"
t_assert_rc 0 "setup: the landed item is dispatched"
t_capture oss_entity_set_work_item_status "$S" "$WID11" complete
t_assert_rc 0 "setup: ...and goes complete"
t_capture oss_entity_set_work_item_exec "$S" "$WID11" "work/REDO" "$TMP/.worktrees/REDO" "sha-11b"
t_assert_rc 0 "re-dispatching a COMPLETE item is accepted now (dropped clause)"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WID11\") | .branch"
t_assert_eq "work/REDO" "$T_OUT" "...and the record is the redo's - the overwrite is the finding's harm, now #563"
t_capture oss_entity_set_work_item_status "$S" "$WID11" abandoned
t_assert_rc 7 "...and the landed item still cannot be withdrawn (the kept rail, item level)"
# ADJACENT CONTROL: the same call on an ACTIVE item still journals - the
# legitimate re-dispatch, a round that returned gaps-surfaced and runs again.
WID12="$(oss_entity_add_work_item "$S" "$SP6" "re-dispatchable")"
t_capture oss_entity_set_work_item_status "$S" "$WID12" active
t_assert_rc 0 "setup: an item goes active before its dispatch"
t_capture oss_entity_set_work_item_exec "$S" "$WID12" "work/$WID12" "$TMP/.worktrees/$WID12" "sha-12"
t_assert_rc 0 "the same call on an active item still dispatches"

# (6) THE `active` CLAUSE IS KEPT - it is a condition on the abandonment
# transition itself (the operator's ruling names it explicitly, round-2 #21), and
# the prose had to be narrowed to state it: decomposition.md §1 now says an
# `active` item is not withdrawable either, even with no dispatch record. Its
# whole justification is item-level now - the status is admitted on its own, and
# the round walk creates the worktree before it journals the dispatch - because
# the spine level that used to count it as 'ran something' does not ship (#563).
WID13="$(oss_entity_add_work_item "$S" "$SP6" "active, then withdrawn?")"
t_capture oss_entity_set_work_item_status "$S" "$WID13" active
t_assert_rc 0 "setup: the item is active with no dispatch record"
N13="$(oss_state_read "$S" '[.mutations[] | select(.op=="set_work_item_status")] | length')"
t_capture oss_entity_set_work_item_status "$S" "$WID13" abandoned
t_assert_rc 7 "abandoning an ACTIVE item refuses"
t_assert_contains "$T_OUT" "active" "...naming the status as the reason"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WID13\") | .status"
t_assert_eq "active" "$T_OUT" "...leaving the status untouched"
t_capture oss_state_read "$S" '[.mutations[] | select(.op=="set_work_item_status")] | length'
t_assert_eq "$N13" "$T_OUT" "...and journaling nothing"
# ADJACENT CONTROL: the clause reads the STATUS, not a predicate term - the item
# has no dispatch record, and the item it is written on is otherwise ordinary.
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WID13\") | [(.branch // \"\"), (.base_sha // \"\")] | join(\"|\")"
t_assert_eq "|" "$T_OUT" "...and it carries no dispatch record at all (the clause is the status)"
# ADJACENT CONTROLS, both documented routes, so the refusal is `active` and not
# every abandonment: the item returns to planned, and THEN withdraws.
t_capture oss_entity_set_work_item_status "$S" "$WID13" planned
t_assert_rc 0 "the named route works: the item returns to planned"
t_capture oss_entity_set_work_item_status "$S" "$WID13" abandoned
t_assert_rc 0 "...and a PLANNED never-dispatched item still withdraws"

t_capture oss_entity_set_release_status "$S" "r0" "closed"
t_assert_rc 0 "release status accepts a valid transition"
t_capture oss_state_read "$S" '.releases[] | select(.id=="r0") | .status'
t_assert_eq "closed" "$T_OUT" "release status actually changed"

# ---------------------------------------------------------------------------
# (7) THE ROUND-2 P1 MECHANISM IS GONE, exercised through bin/oss - the real
# dispatcher under `set -euo pipefail`, not the sourced lib. The pre-narrowing
# guard joined the record and the payload with U+0001 and parsed both with ONE
# line-oriented `read`, so a newline anywhere in a value truncated the parse: a
# full, valid re-dispatch was refused rc 7, and once the RECORD held a newline the
# item could never be re-dispatched at all - a permanent lockout (round-2 #18).
# Nothing positional is parsed now, so these rows are the repro.
# ---------------------------------------------------------------------------
WIDNL="$(oss_entity_add_work_item "$S" r0.s1 "newline repro")"
t_capture env OSS_STATE_FILE="$S" "$OSS" work_item_exec "$WIDNL" "work/$WIDNL" "$TMP/.worktrees/$WIDNL" "sha-nl"
t_assert_rc 0 "setup: the item records a dispatch through the dispatcher"
WIDNL_WT=$'/tmp/wt\nsub'
t_capture env OSS_STATE_FILE="$S" "$OSS" work_item_exec "$WIDNL" "work/redo" "$WIDNL_WT" "sha-nl2"
t_assert_rc 0 "a re-dispatch whose worktree_path holds a NEWLINE is accepted (was rc 7)"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WIDNL\") | .worktree_path"
t_assert_eq "$WIDNL_WT" "$T_OUT" "...and the newline is stored verbatim, not truncated"
# ...and the RECORD side, which is the half of #18 that was permanent: an item whose
# recorded field holds a newline accepts a further re-dispatch, and then a clean one.
t_capture env OSS_STATE_FILE="$S" "$OSS" work_item_exec "$WIDNL" "work/redo2" $'/tmp/wt2\nsub2' "sha-nl3"
t_assert_rc 0 "an item whose RECORD already holds a newline still accepts a re-dispatch"
t_capture env OSS_STATE_FILE="$S" "$OSS" work_item_exec "$WIDNL" "work/redo3" "$TMP/.worktrees/redo3" "sha-nl4"
t_assert_rc 0 "...and again with a clean path - the lockout is gone"
# CONTROL: the kept clause still fires through the dispatcher on that same
# newline-bearing record - the mechanism changed, the clause did not.
t_capture env OSS_STATE_FILE="$S" "$OSS" work_item_exec "$WIDNL" "" "" ""
t_assert_rc 7 "...and the kept clause still refuses the wipe on that item"

# ---------------------------------------------------------------------------
# (8) THE MALFORMED-FIELD ARM FAILS CLOSED, AND ITS REMEDY IS NOW A ROUTE THAT
# RUNS (P1-A, the operator's ruling of 2026-09-23). `_OSS_DISPATCHED_JQ` reads each
# field with `//`, and jq's `//` takes the right side for a JSON `false` - so an
# item whose record held `"branch": false` read as UNDISPATCHED, and the rail
# journaled the stranded pair it exists to prevent (round-2 #16). A guard that
# cannot answer answers rc 4 on BOTH paths, through bin/oss - and the route it
# names has to be one this state can actually walk, which is what the first half of
# this section measures: on a record with NOTHING well-formed, the wipe the message
# prescribes is accepted, and the withdrawal it chains to then succeeds.
# ---------------------------------------------------------------------------
WIDBAD="r0.s1.w98"
oss_state_mutate "$S" add_work_item \
  "$(jq -n --arg s r0.s1 --arg t "malformed dispatch field" --arg r canonical --arg ts "$(_oss_now)" \
    '{spine:$s,title:$t,target_repo:$r,status:"planned",created_at:$ts,id:"r0.s1.w98",branch:false}')" >/dev/null
t_assert_eq "false" "$(oss_state_read "$S" ".work_items[] | select(.id==\"$WIDBAD\") | .branch")" \
  "setup: an item records \"branch\": false (the raw-op write this release tolerates)"
N_BAD="$(oss_state_read "$S" '.mutations | length')"
N_BAD_EXEC="$(oss_state_read "$S" '[.mutations[] | select(.op=="set_work_item_exec")] | length')"
t_capture env OSS_STATE_FILE="$S" "$OSS" work_item_status "$WIDBAD" abandoned
t_assert_rc 4 "a malformed dispatch field makes the abandonment fail CLOSED at rc 4"
t_assert_contains "$T_OUT" "not a string" "...saying the guard could not answer, not reading it as undispatched"
t_capture oss_state_read "$S" '.mutations | length'
t_assert_eq "$N_BAD" "$T_OUT" "...and journaling nothing"
# THE ROUTE THE MESSAGE NAMES, both halves, on the record the message was printed
# for. Before P1-A the first half was refused (rc 4 on this record, rc 7 once any
# field survived) and the second half therefore never ran: the remedy named a
# repair that makes the item MORE dispatched, and a planned never-dispatched item
# could not be withdrawn at all.
t_capture env OSS_STATE_FILE="$S" "$OSS" work_item_exec "$WIDBAD" "" "" ""
t_assert_rc 0 "the wipe the remedy names is ACCEPTED on a record with nothing well-formed"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WIDBAD\") | [(.branch|tostring), (.worktree_path|tostring), (.base_sha|tostring)] | join(\"|\")"
t_assert_eq "||" "$T_OUT" "...and it clears the malformed field (the item now reads undispatched)"
t_capture env OSS_STATE_FILE="$S" "$OSS" work_item_status "$WIDBAD" abandoned
t_assert_rc 0 "...and the withdrawal the remedy chains to then RUNS"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WIDBAD\") | .status"
t_assert_eq "abandoned" "$T_OUT" "...leaving the item withdrawn, not stranded"
t_capture oss_state_read "$S" '[.mutations[] | select(.op=="set_work_item_exec")] | length'
t_assert_eq "$((N_BAD_EXEC + 1))" "$T_OUT" "...with exactly the one exec mutation the repair writes"
# ADJACENT CONTROL (i): the MIXED record keeps the wipe REFUSED - one well-formed
# field survives the malformed one, so erasing the record would still hide a real
# dispatch. Its repair is the full re-dispatch, which the message names instead.
WIDMIX="r0.s1.w97"
oss_state_mutate "$S" add_work_item \
  "$(jq -n --arg s r0.s1 --arg t "mixed dispatch record" --arg r canonical --arg ts "$(_oss_now)" \
    '{spine:$s,title:$t,target_repo:$r,status:"planned",created_at:$ts,id:"r0.s1.w97",branch:"work/mix",worktree_path:false}')" >/dev/null
t_capture env OSS_STATE_FILE="$S" "$OSS" work_item_status "$WIDMIX" abandoned
t_assert_rc 4 "the MIXED record fails the withdrawal closed too"
t_assert_contains "$T_OUT" "full re-dispatch" "...naming the repair that works for a record with a surviving field"
t_capture env OSS_STATE_FILE="$S" "$OSS" work_item_exec "$WIDMIX" "" "" ""
t_assert_rc 7 "...and its wipe is REFUSED, unlike the record with nothing well-formed"
t_assert_contains "$T_OUT" "would erase the record" "...naming the surviving dispatch as the reason"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WIDMIX\") | [(.branch|tostring), (.worktree_path|tostring)] | join(\"|\")"
t_assert_eq "work/mix|false" "$T_OUT" "...leaving the mixed record exactly as it was"
t_capture env OSS_STATE_FILE="$S" "$OSS" work_item_exec "$WIDMIX" "work/y" "/tmp/wty" "shaY"
t_assert_rc 0 "...and the full re-dispatch the message named replaces all three"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WIDMIX\") | [(.branch|tostring), (.worktree_path|tostring), (.base_sha|tostring)] | join(\"|\")"
t_assert_eq "work/y|/tmp/wty|shaY" "$T_OUT" "...repairing the malformed field on the way"
# ADJACENT CONTROL (ii): a GENUINE well-formed record still refuses the wipe, so
# the acceptance above is the `bad`-and-nothing-else class and not a general
# loosening of the clause.
WIDGEN="$(oss_entity_add_work_item "$S" r0.s1 "genuine record control")"
t_capture env OSS_STATE_FILE="$S" "$OSS" work_item_exec "$WIDGEN" "work/gen" "/tmp/wtgen" "shaGen"
t_assert_rc 0 "setup: a well-formed dispatch lands"
t_capture env OSS_STATE_FILE="$S" "$OSS" work_item_exec "$WIDGEN" "" "" ""
t_assert_rc 7 "a well-formed recorded item still refuses the wipe"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WIDGEN\") | .branch"
t_assert_eq "work/gen" "$T_OUT" "...leaving its dispatch intact"
# The repair path is still a repair, and the item still reads dispatched after it:
# a full re-dispatch on a malformed record is accepted, and the withdrawal is then
# refused on the dispatch it recorded (rc 7, not 4) - the guard answers when it can.
WIDBAD2="r0.s1.w95"
oss_state_mutate "$S" add_work_item \
  "$(jq -n --arg s r0.s1 --arg t "malformed, repaired by a re-dispatch" --arg r canonical --arg ts "$(_oss_now)" \
    '{spine:$s,title:$t,target_repo:$r,status:"planned",created_at:$ts,id:"r0.s1.w95",worktree_path:false}')" >/dev/null
t_capture env OSS_STATE_FILE="$S" "$OSS" work_item_exec "$WIDBAD2" "work/repair" "/tmp/wt-repair" "sha-repair"
t_assert_rc 0 "a full re-dispatch on a malformed record is accepted (the other repair)"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WIDBAD2\") | [(.branch|tostring), (.worktree_path|tostring), (.base_sha|tostring)] | join(\",\")"
t_assert_eq "work/repair,/tmp/wt-repair,sha-repair" "$T_OUT" "...and it replaced the malformed field"
t_capture env OSS_STATE_FILE="$S" "$OSS" work_item_status "$WIDBAD2" abandoned
t_assert_rc 7 "...and the same call now answers rc 7 (dispatched), not 4 - it answers when it can"

# The smoke row carries its own item: its subject is the exec PAYLOAD and the record
# it lands, not whatever status an item reached earlier in this file.
WIEXEC="$(oss_entity_add_work_item "$S" r0.s1 "exec smoke")"
t_capture oss_entity_set_work_item_exec "$S" "$WIEXEC" "work/$WIEXEC" "/tmp/wt" "abc123"
t_assert_rc 0 "work item exec fields recorded"
t_capture oss_state_replay "$S"
t_assert_rc 0 "replay stays clean across the new status + exec ops"

# ---------------------------------------------------------------------------
# 1.22.0 (#563, operator ruling 2026-10-12: refuse new writes, replay stays
# permissive). The verbs refuse the shapes; _oss_apply_op is unchanged, so a
# journal that already holds one still replays clean.
# ---------------------------------------------------------------------------
S22="$TMP/s22.json"
oss_state_init "$S22" s22 >/dev/null
oss_entity_add_release "$S22" "R" "goal" >/dev/null
SPA="$(oss_entity_add_spine "$S22" r0 "live spine" flesh canonical)"
_n22() { oss_state_read "$S22" '.mutations | length'; }

# (563-1) `complete` needs a recorded dispatch.
WC1="$(oss_entity_add_work_item "$S22" "$SPA" "never dispatched")"
N="$(_n22)"
t_capture oss_entity_set_work_item_status "$S22" "$WC1" complete
t_assert_rc 7 "563-1: complete refuses an item that records no dispatch"
t_assert_contains "$T_OUT" "work_item_exec" "563-1: ...naming the dispatch record as the route"
t_assert_eq "planned" "$(oss_state_read "$S22" ".work_items[] | select(.id==\"$WC1\") | .status")" "563-1: ...leaving the status untouched"
t_assert_eq "$N" "$(_n22)" "563-1: ...and journaling nothing"
t_capture oss_entity_set_work_item_status "$S22" "$WC1" abandoned
t_assert_rc 0 "563-1 setup: the never-dispatched item withdraws"
t_capture oss_entity_set_work_item_status "$S22" "$WC1" complete
t_assert_rc 7 "563-1: complete refuses to resurrect a withdrawn item as landed"
t_capture env OSS_STATE_FILE="$S22" "$OSS" work_item_status "$WC1" complete
t_assert_rc 7 "563-1: ...and the dispatcher returns the same rc 7"
# ADJACENT CONTROLS: a dispatched item still lands, and the predicate is the
# abandonment guard's own (a base_sha-only half-write counts as a dispatch).
WC2="$(oss_entity_add_work_item "$S22" "$SPA" "dispatched")"
oss_entity_set_work_item_exec "$S22" "$WC2" "work/$WC2" "/tmp/wt-$WC2" "sha-c2" >/dev/null
t_capture oss_entity_set_work_item_status "$S22" "$WC2" complete
t_assert_rc 0 "563-1 control: a dispatched item still goes complete"
WC3="$(oss_entity_add_work_item "$S22" "$SPA" "base_sha only")"
oss_entity_set_work_item_exec "$S22" "$WC3" "" "" "sha-c3" >/dev/null
t_capture oss_entity_set_work_item_status "$S22" "$WC3" complete
t_assert_rc 0 "563-1 control: a base_sha-only dispatch counts as recorded"
# A malformed field and nothing well-formed: the guard cannot answer - rc 4.
oss_state_mutate "$S22" add_work_item \
  "$(jq -n --arg s "$SPA" --arg ts "$(_oss_now)" '{spine:$s,title:"bad",target_repo:"canonical",status:"planned",created_at:$ts,id:"r0.s1.w90",branch:false}')" >/dev/null
N="$(_n22)"
t_capture oss_entity_set_work_item_status "$S22" "r0.s1.w90" complete
t_assert_rc 4 "563-1: a malformed dispatch field fails complete CLOSED at rc 4"
t_assert_contains "$T_OUT" "not a string" "563-1: ...saying the guard could not answer"
t_assert_eq "$N" "$(_n22)" "563-1: ...and journaling nothing"
# A malformed field beside a well-formed one: a genuine dispatch survives - lands.
oss_state_mutate "$S22" add_work_item \
  "$(jq -n --arg s "$SPA" --arg ts "$(_oss_now)" '{spine:$s,title:"mixed",target_repo:"canonical",status:"planned",created_at:$ts,id:"r0.s1.w91",branch:"work/m",worktree_path:false}')" >/dev/null
t_capture oss_entity_set_work_item_status "$S22" "r0.s1.w91" complete
t_assert_rc 0 "563-1: a mixed record (a well-formed field survives) still goes complete"
# Other statuses are not touched by the new clause.
WC4="$(oss_entity_add_work_item "$S22" "$SPA" "goes active")"
t_capture oss_entity_set_work_item_status "$S22" "$WC4" active
t_assert_rc 0 "563-1 control: active on a never-dispatched item is still a plain write"
# Replay stays permissive: the raw op journals complete-without-dispatch (an
# older journal), and replay is clean.
oss_state_mutate "$S22" set_work_item_status \
  "$(jq -n --arg w "$WC4" --arg ts "$(_oss_now)" '{work_item:$w,status:"complete",at:$ts}')" >/dev/null
t_assert_eq "complete" "$(oss_state_read "$S22" ".work_items[] | select(.id==\"$WC4\") | .status")" "563-1 setup: a legacy complete-without-dispatch record"
t_capture oss_state_replay "$S22"
t_assert_rc 0 "563-1: replay of a journal holding complete-without-dispatch stays CLEAN"

# (563-2a) an abandoned spine takes no new work item.
SPB="$(oss_entity_add_spine "$S22" r0 "retired spine" flesh canonical)"
WB1="$(oss_entity_add_work_item "$S22" "$SPB" "minted before the retirement")"
t_capture oss_entity_set_spine_status "$S22" "$SPB" abandoned
t_assert_rc 0 "563-2 setup: the spine retires"
N="$(_n22)"; NW="$(oss_state_read "$S22" '.work_items | length')"
t_capture oss_entity_add_work_item "$S22" "$SPB" "new work on a retired spine"
t_assert_rc 7 "563-2a: work_item_add refuses an abandoned spine"
t_assert_contains "$T_OUT" "spine_status $SPB planned" "563-2a: ...naming the route back"
t_assert_eq "$NW" "$(oss_state_read "$S22" '.work_items | length')" "563-2a: ...minting no item"
t_assert_eq "$N" "$(_n22)" "563-2a: ...and journaling nothing"
t_capture env OSS_STATE_FILE="$S22" "$OSS" work_item_add "$SPB" "via the dispatcher" canonical
t_assert_rc 7 "563-2a: ...and the dispatcher returns the same rc 7"
# (563-2b) nor a dispatch onto one of its items.
t_capture oss_entity_set_work_item_exec "$S22" "$WB1" "work/$WB1" "/tmp/wt-$WB1" "sha-b1"
t_assert_rc 7 "563-2b: work_item_exec refuses a dispatch onto an item of an abandoned spine"
t_assert_contains "$T_OUT" "spine_status $SPB planned" "563-2b: ...naming the route back"
t_assert_eq "" "$(oss_state_read "$S22" ".work_items[] | select(.id==\"$WB1\") | .branch // \"\"")" "563-2b: ...recording no dispatch"
t_assert_eq "$N" "$(_n22)" "563-2b: ...and journaling nothing"
# A wipe records no dispatch, so it keeps its existing behaviour.
t_capture oss_entity_set_work_item_exec "$S22" "$WB1" "" "" ""
t_assert_rc 0 "563-2b: a wipe (records no dispatch) on that item is still accepted"
# The route the messages name runs.
t_capture oss_entity_set_spine_status "$S22" "$SPB" planned
t_assert_rc 0 "563-2 route: the spine returns to planned"
t_capture oss_entity_add_work_item "$S22" "$SPB" "after the route"
t_assert_rc 0 "563-2 route: ...and takes a new item again"
t_capture oss_entity_set_work_item_exec "$S22" "$WB1" "work/$WB1" "/tmp/wt-$WB1" "sha-b1"
t_assert_rc 0 "563-2 route: ...and a dispatch again"
# (563-2b) item level: a withdrawn item takes no dispatch.
WA1="$(oss_entity_add_work_item "$S22" "$SPA" "withdrawn")"
oss_entity_set_work_item_status "$S22" "$WA1" abandoned >/dev/null
N="$(_n22)"
t_capture oss_entity_set_work_item_exec "$S22" "$WA1" "work/$WA1" "/tmp/wt-$WA1" "sha-a1"
t_assert_rc 7 "563-2b: work_item_exec refuses a dispatch onto an abandoned item"
t_assert_contains "$T_OUT" "work_item_status $WA1 planned" "563-2b: ...naming the route back"
t_assert_eq "$N" "$(_n22)" "563-2b: ...and journaling nothing"
t_capture oss_entity_set_work_item_exec "$S22" "$WA1" "" "" "sha-a1"
t_assert_rc 7 "563-2b: a base_sha-only payload records a dispatch too, and is refused"
t_capture oss_entity_set_work_item_status "$S22" "$WA1" planned
t_assert_rc 0 "563-2 route: the item returns to planned"
t_capture oss_entity_set_work_item_exec "$S22" "$WA1" "work/$WA1" "/tmp/wt-$WA1" "sha-a1"
t_assert_rc 0 "563-2 route: ...and is then dispatched"
t_capture oss_state_replay "$S22"
t_assert_rc 0 "563: replay is clean across the refusals and routes"

# ---------------------------------------------------------------------------
# 1.22.0 (#335, operator ruling 2026-10-12): spine_rename and work_item_rename,
# name-only journaled verbs.
# ---------------------------------------------------------------------------
SPR="$(oss_entity_add_spine "$S22" r0 "Coach agent" bone canonical)"
WR="$(oss_entity_add_work_item "$S22" "$SPR" "old title")"
oss_entity_set_spine_class "$S22" "$SPR" flesh "internal-enabler admitted" >/dev/null
SP_BEFORE="$(oss_state_read "$S22" ".spines[] | select(.id==\"$SPR\") | del(.name) | tojson")"
t_capture env OSS_STATE_FILE="$S22" "$OSS" spine_rename "$SPR" "[internal] Coach agent"
t_assert_rc 0 "335: spine_rename accepts"
t_assert_eq "[internal] Coach agent" "$(oss_state_read "$S22" ".spines[] | select(.id==\"$SPR\") | .name")" "335: ...and the name changed"
t_assert_eq "$SP_BEFORE" "$(oss_state_read "$S22" ".spines[] | select(.id==\"$SPR\") | del(.name) | tojson")" "335: ...and nothing else on the spine did"
t_assert_eq "[\"set_spine_name\",{\"spine\":\"$SPR\",\"name\":\"[internal] Coach agent\"}]" \
  "$(oss_state_read "$S22" '.mutations[-1] | [.op, (.payload | del(.at))] | tojson')" "335: journaled as set_spine_name {spine,name,at}"
t_assert_eq "at,name,spine" "$(oss_state_read "$S22" '.mutations[-1].payload | keys | join(",")')" "335: ...payload keys exactly"
WI_BEFORE="$(oss_state_read "$S22" ".work_items[] | select(.id==\"$WR\") | del(.title) | tojson")"
t_capture env OSS_STATE_FILE="$S22" "$OSS" work_item_rename "$WR" "new title"
t_assert_rc 0 "335: work_item_rename accepts"
t_assert_eq "new title" "$(oss_state_read "$S22" ".work_items[] | select(.id==\"$WR\") | .title")" "335: ...and the title changed"
t_assert_eq "$WI_BEFORE" "$(oss_state_read "$S22" ".work_items[] | select(.id==\"$WR\") | del(.title) | tojson")" "335: ...and nothing else on the item did"
t_assert_eq "[\"set_work_item_title\",{\"work_item\":\"$WR\",\"title\":\"new title\"}]" \
  "$(oss_state_read "$S22" '.mutations[-1] | [.op, (.payload | del(.at))] | tojson')" "335: journaled as set_work_item_title {work_item,title,at}"
t_assert_eq "at,title,work_item" "$(oss_state_read "$S22" '.mutations[-1].payload | keys | join(",")')" "335: ...payload keys exactly"
N="$(_n22)"
t_capture env OSS_STATE_FILE="$S22" "$OSS" spine_rename r0.s99 "x"
t_assert_rc 7 "335: spine_rename refuses an unknown spine"
t_capture env OSS_STATE_FILE="$S22" "$OSS" work_item_rename r0.s1.w99 "x"
t_assert_rc 7 "335: work_item_rename refuses an unknown item"
t_capture env OSS_STATE_FILE="$S22" "$OSS" spine_rename "$SPR" "[internal]" "Coach"
t_assert_rc 2 "335: spine_rename refuses an unquoted multi-word name instead of truncating it"
t_capture env OSS_STATE_FILE="$S22" "$OSS" work_item_rename "$WR"
t_assert_rc 2 "335: work_item_rename refuses a missing title"
for _t in a b; do
  oss_state_mutate "$S22" add_work_item \
    "$(jq -n --arg s "$SPA" --arg ts "$(_oss_now)" '{spine:$s,title:"dup",target_repo:"canonical",status:"planned",created_at:$ts,id:"r0.s1.w88"}')" >/dev/null
done
N="$(_n22)"
t_capture oss_entity_rename_work_item "$S22" "r0.s1.w88" "which one"
t_assert_rc 7 "335: a duplicate id refuses the rename rather than renaming both"
t_assert_eq "$N" "$(_n22)" "335: ...and none of the refusals journaled"
t_capture oss_state_replay "$S22"
t_assert_rc 0 "335: replay is clean across the renames"

# --- work_item_pr (1.26.0): record an active, dispatched item's PR -----------
_pr_wi() { oss_entity_add_work_item "$S" r0.s1 "$1"; }
_pr_snap() { cat "$S"; }
PRU="https://github.com/o/r/pull/7"
WP="$(_pr_wi "pr item")"
t_capture oss_entity_set_work_item_pr "$S" "$WP" "$PRU"
t_assert_rc 7 "work_item_pr refuses a PLANNED item"
t_assert_contains "$T_OUT" "work_item_status $WP active" "...naming the repair"
oss_entity_set_work_item_status "$S" "$WP" active >/dev/null
SNAP="$(_pr_snap)"
t_capture oss_entity_set_work_item_pr "$S" "$WP" "$PRU"
t_assert_rc 7 "work_item_pr refuses an ACTIVE item that records no dispatch"
t_assert_contains "$T_OUT" "work_item_exec $WP" "...naming the repair"
t_assert_eq "$SNAP" "$(_pr_snap)" "...leaving state byte-identical"
oss_entity_set_work_item_exec "$S" "$WP" "work/$WP" "$TMP/.worktrees/$WP" "sha-pr" >/dev/null
# bad URLs refuse; the good URL in the same test is the adjacent control.
SNAP="$(_pr_snap)"
for bad in "http://x/pull/7" "https://x/pulls/7" "https://x/pull/7 extra" "https://x/pull/7/files" "https://x/pull/" $'https://x/pull/7\nevil' $'junk\nhttps://x/pull/7' $'https://x/pull/7\r'; do
  t_capture oss_entity_set_work_item_pr "$S" "$WP" "$bad"
  t_assert_rc 7 "work_item_pr refuses the URL '$bad'"
done
t_assert_eq "$SNAP" "$(_pr_snap)" "...leaving state byte-identical across the bad URLs"
t_capture oss_entity_set_work_item_pr "$S" "$WP" "$PRU"
t_assert_rc 0 "CONTROL: a well-formed PR URL on the same item records"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WP\") | .pr_url"
t_assert_eq "$PRU" "$T_OUT" "...as .work_items[].pr_url"
t_capture oss_entity_set_work_item_pr "$S" "$WP" "$PRU"
t_assert_rc 0 "re-recording the same URL is idempotent"
t_capture oss_entity_set_work_item_pr "$S" "$WP" "https://github.com/o/r/pull/9"
t_assert_rc 0 "a different URL replaces it (a re-opened PR)"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WP\") | .pr_url"
t_assert_eq "https://github.com/o/r/pull/9" "$T_OUT" "...and the new URL is what is recorded"
t_capture oss_entity_set_work_item_pr "$S" "r0.s1.w999" "$PRU"
t_assert_rc 7 "work_item_pr refuses an unknown item"
oss_entity_set_work_item_status "$S" "$WP" complete >/dev/null
t_capture oss_entity_set_work_item_pr "$S" "$WP" "$PRU"
t_assert_rc 7 "work_item_pr refuses a COMPLETE item (not active)"

cd "$HERE"
rm -rf "$TMP"
t_summary
