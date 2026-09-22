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

# The MIRROR guard on the same pair (GLM seat, round 2 on PR #520; reported
# measured twice and re-measured here). `work_item_exec` refuses to dispatch an
# already-`abandoned` item: without it the companion verb re-creates at rc 0
# exactly the stranded record the abandonment guard above refuses to create in
# the other order - {status:abandoned, branch, worktree_path}, the pair doctor
# reports as drift.
WID3="$(oss_entity_add_work_item "$S" r0.s1 "withdrawn, then dispatched?")"
t_capture oss_entity_set_work_item_status "$S" "$WID3" abandoned
t_assert_rc 0 "setup: a third item is withdrawn before any dispatch"
N2="$(oss_state_read "$S" '[.mutations[] | select(.op=="set_work_item_exec")] | length')"
t_capture oss_entity_set_work_item_exec "$S" "$WID3" "work/$WID3" "$TMP/.worktrees/$WID3" "abc123"
t_assert_rc 7 "dispatching an ABANDONED item refuses"
t_assert_contains "$T_OUT" "is abandoned" "...and names the status as the reason"
t_capture oss_state_read "$S" ".work_items[] | select(.id==\"$WID3\") | [(.branch // \"\"), (.worktree_path // \"\")] | join(\",\")"
t_assert_eq "," "$T_OUT" "...leaving branch and worktree_path unset"
t_capture oss_state_read "$S" '[.mutations[] | select(.op=="set_work_item_exec")] | length'
t_assert_eq "$N2" "$T_OUT" "...and journaling nothing"
# ADJACENT CONTROL: the same call on a live item still journals, so the refusal
# above is the abandoned STATUS and not the verb - without this, a guard that
# refused every dispatch would satisfy the assertions above.
t_capture oss_entity_set_work_item_exec "$S" "$WID" "work/$WID" "$TMP/.worktrees/$WID" "abc123"
t_assert_rc 0 "the same call on a live item still dispatches"
# ...and un-withdrawing re-opens the path, which is exactly what the refusal names.
t_capture oss_entity_set_work_item_status "$S" "$WID3" planned
t_assert_rc 0 "the way back the refusal names works"
t_capture oss_entity_set_work_item_exec "$S" "$WID3" "work/$WID3" "$TMP/.worktrees/$WID3" "abc123"
t_assert_rc 0 "...and the un-withdrawn item can then be dispatched"

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
# out of every close-path reader and out of release close's tag set. The raw op is
# the only path that can now produce that shape, which is what makes this the
# clause's own row rather than a duplicate of the dispatched one above.
WID4B="$(oss_entity_add_work_item "$S" r0.s1 "landed, no dispatch record")"
oss_state_mutate "$S" set_work_item_status \
  "$(jq -n --arg w "$WID4B" --arg st complete --arg ts "$(_oss_now)" '{work_item:$w,status:$st,at:$ts}')" >/dev/null
t_assert_eq "complete" "$(oss_state_read "$S" ".work_items[] | select(.id==\"$WID4B\") | .status")" \
  "setup: an item is complete with NO dispatch record (the raw op, as an older journal would hold it)"
t_capture oss_entity_set_work_item_status "$S" "$WID4B" abandoned
t_assert_rc 7 "a COMPLETE item with no dispatch record still refuses the abandonment"
t_assert_contains "$T_OUT" "complete" "...naming the status that blocks it, not a dispatch"

# (2) THE SPINE LEVEL. A mid-round replan that retires a spine whose items are
# active with recorded dispatches returns rc 0, and every close-path reader then
# skips those items - the same strand, one level up. Retirement is for a spine
# that ran NOTHING: any item dispatched, active or complete refuses it.
SP2="$(oss_entity_add_spine "$S" r0 "second spine" flesh canonical)"
WID5="$(oss_entity_add_work_item "$S" "$SP2" "dispatched item")"
t_capture oss_entity_set_work_item_exec "$S" "$WID5" "work/$WID5" "$TMP/.worktrees/$WID5" "abc123"
t_assert_rc 0 "setup: an item of the second spine is dispatched"
t_capture oss_entity_set_spine_status "$S" "$SP2" abandoned
t_assert_rc 7 "retiring a spine with a DISPATCHED item refuses"
t_assert_contains "$T_OUT" "$WID5" "...naming the item that blocks it"
t_capture oss_state_read "$S" ".spines[] | select(.id==\"$SP2\") | .status"
t_assert_eq "planned" "$T_OUT" "...leaving the spine's status alone"
# ADJACENT CONTROLS: both legitimate retirements still work, so the refusal is
# "ran something" and not "has items".
SP3="$(oss_entity_add_spine "$S" r0 "third spine" flesh canonical)"
t_capture oss_entity_set_spine_status "$S" "$SP3" abandoned
t_assert_rc 0 "a spine with NO items still retires (nothing ran)"
SP4="$(oss_entity_add_spine "$S" r0 "fourth spine" flesh canonical)"
WID6="$(oss_entity_add_work_item "$S" "$SP4" "withdrawn before dispatch")"
t_capture oss_entity_set_work_item_status "$S" "$WID6" abandoned
t_assert_rc 0 "setup: its only item is withdrawn before any dispatch"
t_capture oss_entity_set_spine_status "$S" "$SP4" abandoned
t_assert_rc 0 "...and that spine still retires (it ran nothing)"
# A COMPLETE item blocks it too: its merge is on the spine branch, so retiring
# the spine takes the landed line down with it.
SP5="$(oss_entity_add_spine "$S" r0 "fifth spine" flesh canonical)"
WID7="$(oss_entity_add_work_item "$S" "$SP5" "landed item")"
t_capture oss_entity_set_work_item_exec "$S" "$WID7" "work/$WID7" "$TMP/.worktrees/$WID7" "abc123"
t_assert_rc 0 "setup: its item is dispatched"
t_capture oss_entity_set_work_item_status "$S" "$WID7" complete
t_assert_rc 0 "setup: ...and goes complete"
t_capture oss_entity_set_spine_status "$S" "$SP5" abandoned
t_assert_rc 7 "retiring a spine with a COMPLETE item refuses"

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

t_capture oss_entity_set_release_status "$S" "r0" "closed"
t_assert_rc 0 "release status accepts a valid transition"
t_capture oss_state_read "$S" '.releases[] | select(.id=="r0") | .status'
t_assert_eq "closed" "$T_OUT" "release status actually changed"

t_capture oss_entity_set_work_item_exec "$S" "$WI" "work/r0.s1.w1-x" "/tmp/wt" "abc123"
t_assert_rc 0 "work item exec fields recorded"
t_capture oss_state_replay "$S"
t_assert_rc 0 "replay stays clean across the new status + exec ops"

cd "$HERE"
rm -rf "$TMP"
t_summary
