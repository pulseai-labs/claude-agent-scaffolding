#!/usr/bin/env bash
# Spine-planning shell-out contract (Plan B task 8).
#
# Every assertion here guards a claim plan-spine's PROSE makes about the `oss`
# surface it shells out to. Driven through the REAL dispatcher binary (which
# runs `set -euo pipefail`) rather than by sourcing, because the skill body
# calls `oss <subcommand>` and a sourced-only test never exercises strict mode,
# arg passthrough, or rc propagation.
#
# Prose anchors:
#   SKILL.md §4a/§4c, §8d, §8e, §9   and   references/{demo-authoring,
#   demo-amendments,fake-ledger-discipline,cross-repo,decomposition}.md
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"
for lib in id state manifest commands entities registries ledger demo doctor; do . "$HERE/../lib/$lib.sh"; done
OSS="$HERE/../bin/oss"
TMP="$(mktemp -d)"; export OSS_STATE_FILE="$TMP/state.json"
# #272/#310 Task 4: an omitted target_repo now routes through
# _oss_default_repo_key, which needs a discoverable manifest even when
# OSS_STATE_FILE pins the state path directly - the old default was a literal
# `canonical`, never a lookup. well_known_paths.project_state is pinned to the
# SAME path as OSS_STATE_FILE so _oss_resolve_state's override-notice never
# fires and stays out of captured stdout below.
mkdir -p "$TMP/.ossify"
cat > "$TMP/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"canonical":{"root":"$TMP/canon"}},"well_known_paths":{"project_state":"$OSS_STATE_FILE"}}
JSON
cd "$TMP"

"$OSS" init spine-planning-demo >/dev/null
"$OSS" release_add "MVP" "a trader can place a paper trade" >/dev/null
"$OSS" spine_add r0 "order ticket" flesh >/dev/null
# D1: a genuine sibling spine, minted r0.s2 - needed so the §8e "apply_pending is
# scoped to the closing spine only" block below amends AGAINST A REAL SPINE. The
# by-spine argument is now a validated join key (Step 3); without this second
# spine, ledger_supersede against "r0.s2" would rc-7 before writing any pending
# amendment, and the scoping assertion would pass vacuously whether or not the
# scoping guard in apply_demo_pending actually works - exactly the shape the
# Step 7 mutation test exists to catch, so it must not be able to hide there.
"$OSS" spine_add r0 "sibling spine" flesh >/dev/null

# --- §3 pre-flight: `oss get` is `jq -r` WITHOUT `-e`, so a `select` that matches
# nothing exits 0 with EMPTY output. The skill body resolves the target spine by
# testing the output, not the rc, precisely because of this - an `oss get … || …`
# guard would never fire and the skill would plan against a typo'd spine id.
# If `oss get` ever grows `-e`, this test is what says the prose may be relaxed.
t_capture "$OSS" get '.spines[] | select(.id == "r0.s1") | .class'
t_assert_rc 0 "get on an existing spine is rc 0"
t_assert_eq "flesh" "$T_OUT" "get reads the class plan-release recorded"
t_capture "$OSS" get '.spines[] | select(.id == "r9.s9") | .class'
t_assert_rc 0 "get on a MISSING spine is still rc 0 (no -e)"
t_assert_eq "" "$T_OUT" "...and the miss shows up only as empty output"
t_capture "$OSS" get '.spines[] | select(.id == "r0.s1") | .release'
t_assert_eq "r0" "$T_OUT" "get resolves the spine's release for the ledger-budget read"

# --- §4a / cross-repo.md §1: work items carry exactly one target_repo, default
# canonical, explicit override honored - through the real binary.
t_capture "$OSS" work_item_add r0.s1 "order-ticket form"
t_assert_eq "r0.s1.w1" "$T_OUT" "dispatcher: work_item_add mints r0.s1.w1"
t_capture "$OSS" get '.work_items[0].target_repo'
t_assert_eq "canonical" "$T_OUT" "dispatcher: target_repo defaults to canonical"
# The default-key assertions above need EXACTLY ONE declared repo; this one
# needs a second, or "explicit" is indistinguishable from "default". Widening
# the fixture up front satisfies this and disarms those, and leaving it widened
# makes every LATER omitted-key call in this file refuse - so the second repo is
# declared here and withdrawn immediately after.
cat > "$TMP/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"canonical":{"root":"$TMP/canon"},"private_core":{"root":"$TMP/priv"}},"well_known_paths":{"project_state":"$OSS_STATE_FILE"}}
JSON
t_capture "$OSS" work_item_add r0.s1 "paper-fill adapter" private_core
t_assert_eq "r0.s1.w2" "$T_OUT" "dispatcher: second work item minted"
t_capture "$OSS" get '.work_items[1].target_repo'
t_assert_eq "private_core" "$T_OUT" "dispatcher: explicit target_repo stored"
cat > "$TMP/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"canonical":{"root":"$TMP/canon"}},"well_known_paths":{"project_state":"$OSS_STATE_FILE"}}
JSON

# §4a: an unknown spine id is rc 7 and writes nothing (the body tells the skill
# to resolve the spine at pre-flight instead of minting against a typo).
t_capture "$OSS" get '.work_items | length'; WI_BEFORE="$T_OUT"
t_capture "$OSS" work_item_add r9.s9 "ghost"
t_assert_rc 7 "dispatcher: work_item_add against unknown spine is rc 7"
t_capture "$OSS" get '.work_items | length'
t_assert_eq "$WI_BEFORE" "$T_OUT" "no phantom work item after unknown-spine rejection"

# --- §8d / demo-authoring.md §6: auto: lines bind command + expected, and the
# expected grammar is exactly exit:<n> | contains:<str>.
t_capture "$OSS" ledger_add_auto r0.s1 "paper order round-trips" "true" "exit:0"
t_assert_rc 0 "dispatcher: auto line with exit: expected accepted"
AUTO1="$T_OUT"
t_capture "$OSS" ledger_add_auto r0.s1 "bench reports p50" "true" "contains:p50"
t_assert_rc 0 "dispatcher: auto line with contains: expected accepted"
AUTO2="$T_OUT"
t_capture "$OSS" ledger_add_auto r0.s1 "unbound" "true" "under 40ms"
t_assert_rc 2 "dispatcher: comparison-shaped expected rejected (grammar has no comparison form)"
t_capture "$OSS" ledger_add_auto r0.s1 "unbound" "true" "exit0"
t_assert_rc 2 "dispatcher: malformed expected rejected"

# --- §8d / demo-authoring.md §3.5: the inspector-phrasing floor is a PREFIX-ONLY
# backstop. Both halves of that claim are load-bearing for the skill's prose:
#   (a) the three banned prefixes are rejected rc 2, case-insensitively;
#   (b) inspector lines that do NOT start with one are ACCEPTED by the lib.
# (b) is why the prose says the judgment lives in the skill, not in the lib -
# if the lib ever grew a substring check, the prose would be overstating the
# gap and this test is what tells us.
t_capture "$OSS" ledger_add_user r0.s1 "inspect the SQLite schema" "schema visible"
t_assert_rc 2 "dispatcher: 'inspect ' prefix rejected"
t_capture "$OSS" ledger_add_user r0.s1 "View the order record" "record visible"
t_assert_rc 2 "dispatcher: 'view ' prefix rejected (case-insensitive)"
t_capture "$OSS" ledger_add_user r0.s1 "OPEN the generated file" "file visible"
t_assert_rc 2 "dispatcher: 'open ' prefix rejected (uppercase)"
t_capture "$OSS" get '[.demo_ledger[] | select(.type=="user")] | length'
t_assert_eq "0" "$T_OUT" "no user line written by any rejected call"

for evader in \
  "Lets the user open the settings file" \
  "review the generated schema" \
  "confirm the audit table exists" \
  "check that the record was written"
do
  t_capture "$OSS" ledger_add_user r0.s1 "$evader" "outcome"
  t_assert_rc 0 "prefix-only backstop ACCEPTS an inspector line that does not start with a banned word: '$evader'"
done

# ...and a genuine journey line whose outcome is visible is accepted too - the
# false-reject guard in demo-authoring.md §3.3 has nothing mechanical fighting it.
# Deliberately phrased in a domain no eval fixture uses: this file must never
# hand the journey-line-floor eval a ready-made answer if the eval's read path
# ever widens past skills/.
t_capture "$OSS" ledger_add_user r0.s1 "reschedule a delivery to a later slot and see the tracking page show the new window" "the delivery moves to the chosen slot"
t_assert_rc 0 "dispatcher: verb + visible-outcome journey line accepted"
USER1="$T_OUT"

# --- §8e / D1: amendments are RECORDED at planning time and APPLIED at close.
t_capture "$OSS" get '.demo_ledger | length'; LEDGER_BEFORE="$T_OUT"
t_capture "$OSS" ledger_supersede "$AUTO1" r0.s1 "the order ticket replaced the CLI entry point"
t_assert_rc 0 "dispatcher: supersede by line id ok"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$AUTO1\")][0].pending_amendments[0].status"
t_assert_eq "superseded" "$T_OUT" "supersede records a PENDING amendment"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$AUTO1\")][0].pending_amendments[0].by"
t_assert_eq "r0.s1" "$T_OUT" "...keyed to the planning spine"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$AUTO1\")][0].status"
t_assert_eq "active" "$T_OUT" "...and leaves the live status ACTIVE until close"
t_capture "$OSS" ledger_active_auto
t_assert_eq "2" "$(printf '%s' "$T_OUT" | jq 'length')" "a pending amendment does NOT drop the line from the live set"

# unplan is the escape hatch immediate semantics never had: a replanned or
# abandoned spine must not permanently drop coverage. F1: the spine argument
# is now required (a line can carry more than one spine's pending amendment),
# and unplan rejects a spine that holds nothing pending on the line.
t_capture "$OSS" ledger_unplan "$AUTO1" r0.s2
t_assert_rc 7 "dispatcher: unplan rejects a spine with no pending amendment on the line"
t_capture "$OSS" ledger_unplan "$AUTO1" r0.s1
t_assert_rc 0 "unplan clears THIS spine's pending amendment"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$AUTO1\")][0].pending_amendments"
t_assert_eq "[]" "$T_OUT" "pending cleared"

# re-plan it, then apply at close.
t_capture "$OSS" ledger_supersede "$AUTO1" r0.s1 "the order ticket replaced the CLI entry point"
t_capture "$OSS" ledger_retire "$USER1" r0.s1 "the CSV export flow was removed by this spine"
t_capture "$OSS" ledger_apply_pending r0.s1
t_assert_rc 0 "apply_pending ok"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$AUTO1\")][0].status"
t_assert_eq "superseded" "$T_OUT" "close applied the supersede"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$AUTO1\")][0].status_by"
t_assert_eq "r0.s1" "$T_OUT" "superseding spine recorded on apply"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$USER1\")][0].status_reason"
t_assert_eq "the CSV export flow was removed by this spine" "$T_OUT" "retire reason carried through the pending round trip"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$AUTO1\")][0].pending_amendments"
t_assert_eq "[]" "$T_OUT" "pending is consumed by apply, not left dangling"
t_capture "$OSS" get '.demo_ledger | length'
t_assert_eq "$LEDGER_BEFORE" "$T_OUT" "amended lines are archived, not deleted"
t_capture "$OSS" ledger_active_auto
t_assert_eq "1" "$(printf '%s' "$T_OUT" | jq 'length')" "only the un-amended auto line stays active after close"

# apply_pending for a DIFFERENT spine must not touch this spine's lines.
t_capture "$OSS" ledger_supersede "$AUTO2" r0.s2 "reason"
t_capture "$OSS" ledger_apply_pending r0.s1
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$AUTO2\")][0].status"
t_assert_eq "active" "$T_OUT" "apply_pending is scoped to the closing spine only"

# --- F1 (user decision, 2026-07-31): the regression this task exists to
# prevent. TWO spines plan an amendment on the SAME line. Each spine's close
# applies and consumes ONLY its own; the sibling's pending amendment survives
# untouched until its own close runs. Under the old single-pending-slot model
# the second spine's plan would have silently overwritten the first's, and the
# first spine's amendment would never apply.
t_capture "$OSS" ledger_add_auto r0.s1 "shared line both spines amend" "true" "exit:0"
t_assert_rc 0 "dispatcher: shared line added for the two-spine test"
SHARED="$T_OUT"
t_capture "$OSS" ledger_supersede "$SHARED" r0.s1 "r0.s1's reason"
t_assert_rc 0 "dispatcher: r0.s1 plans an amendment on the shared line"
t_capture "$OSS" ledger_retire "$SHARED" r0.s2 "r0.s2's reason"
t_assert_rc 0 "dispatcher: r0.s2 ALSO plans an amendment on the SAME line"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$SHARED\")][0].pending_amendments | length"
t_assert_eq "2" "$T_OUT" "both spines' pending amendments coexist on one line - a list, not a slot"

# r0.s2 closes FIRST even though it planned its amendment SECOND (so its list
# entry sits at index 1, not 0) — this ordering is deliberate: it is the case
# that actually distinguishes correct by-spine scoping from a mutation that
# just grabs the list's first entry. If the test instead closed spines in
# planning order, "apply whichever entry is first" and "apply the CALLING
# spine's entry" would agree by coincidence on this fixture, and a mutation
# that drops the `.by == $p.spine` match would pass here undetected.
t_capture "$OSS" ledger_apply_pending r0.s2
t_assert_rc 0 "dispatcher: r0.s2 closes first (though it is index 1 in the list) and applies its own amendment"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$SHARED\")][0].status"
t_assert_eq "retired" "$T_OUT" "r0.s2's amendment applied, not r0.s1's list-first entry"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$SHARED\")][0].status_by"
t_assert_eq "r0.s2" "$T_OUT" "status_by names r0.s2, the ACTUAL closing spine"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$SHARED\")][0].pending_amendments | length"
t_assert_eq "1" "$T_OUT" "r0.s2's entry is consumed; r0.s1's is still pending, not dropped"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$SHARED\")][0].pending_amendments[0].by"
t_assert_eq "r0.s1" "$T_OUT" "the surviving pending amendment belongs to r0.s1"

t_capture "$OSS" ledger_apply_pending r0.s1
t_assert_rc 0 "dispatcher: r0.s1 closes second and applies its own amendment"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$SHARED\")][0].status"
t_assert_eq "superseded" "$T_OUT" "r0.s1's amendment applied second - last close to run wins on status"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$SHARED\")][0].status_by"
t_assert_eq "r0.s1" "$T_OUT" "status_by now names r0.s1"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$SHARED\")][0].pending_amendments"
t_assert_eq "[]" "$T_OUT" "both spines' amendments fully consumed"

# --- G3: clear_demo_pending's by-spine scoping (ledger_unplan) is the entire
# reason unplan gained a required <spine> argument, and nothing had asserted
# it - both prior unplan fixtures amend a line carrying exactly one spine's
# entry, so the precondition the assertion needs (two entries, unplan one,
# prove the OTHER survives) never existed. Reuse the same two-entry
# precondition as the block above, on a fresh line.
t_capture "$OSS" ledger_add_auto r0.s1 "second shared line for the unplan-scoping test" "true" "exit:0"
t_assert_rc 0 "dispatcher: shared line added for the unplan-scoping test"
SHARED2="$T_OUT"
t_capture "$OSS" ledger_supersede "$SHARED2" r0.s1 "r0.s1's reason"
t_assert_rc 0 "dispatcher: r0.s1 plans on the second shared line"
t_capture "$OSS" ledger_retire "$SHARED2" r0.s2 "r0.s2's reason"
t_assert_rc 0 "dispatcher: r0.s2 ALSO plans on the second shared line"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$SHARED2\")][0].pending_amendments | length"
t_assert_eq "2" "$T_OUT" "setup: both spines pending on the second shared line"
t_capture "$OSS" ledger_unplan "$SHARED2" r0.s1
t_assert_rc 0 "dispatcher: r0.s1 unplans its own entry on the shared line"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$SHARED2\")][0].pending_amendments | length"
t_assert_eq "1" "$T_OUT" "unplan clears only the calling spine's entry, not the sibling's (G3)"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$SHARED2\")][0].pending_amendments[0].by"
t_assert_eq "r0.s2" "$T_OUT" "the survivor is the OTHER spine, not the one that unplanned (G3)"

# --- G4: set_demo_line_pending's upsert-by-spine dedupe. The SAME spine
# amends the SAME line TWICE (supersede, then retire) with no apply in
# between - an upsert must replace its own prior entry, not append a second
# one, or a stale amendment survives to be applied alongside the fresh one.
t_capture "$OSS" ledger_add_auto r0.s1 "line amended twice by the same spine" "true" "exit:0"
t_assert_rc 0 "dispatcher: line added for the upsert-dedupe test"
UPSERT="$T_OUT"
t_capture "$OSS" ledger_supersede "$UPSERT" r0.s1 "first pass: supersede"
t_assert_rc 0 "dispatcher: r0.s1 supersedes the line"
t_capture "$OSS" ledger_retire "$UPSERT" r0.s1 "second pass: retire instead"
t_assert_rc 0 "dispatcher: r0.s1 re-amends the SAME line as retire"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$UPSERT\")][0].pending_amendments | length"
t_assert_eq "1" "$T_OUT" "re-amending by the same spine upserts, not appends - one entry not two (G4)"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$UPSERT\")][0].pending_amendments[0].status"
t_assert_eq "retired" "$T_OUT" "the surviving entry is the LATEST plan, not the stale superseded one (G4)"
t_capture "$OSS" ledger_apply_pending r0.s1
t_assert_rc 0 "dispatcher: apply_pending ok (G4)"
t_capture "$OSS" get "[.demo_ledger[] | select(.id==\"$UPSERT\")][0].status"
t_assert_eq "retired" "$T_OUT" "close applies the LATEST amendment (retired), not a stale superseded one (G4)"

# unknown line id is still rc 7 and writes nothing.
t_capture "$OSS" ledger_supersede d999 r0.s1 "typo'd id"
t_assert_rc 7 "dispatcher: amendment against unknown line id is rc 7"

# --- F3: ledger_apply_pending had no reject-before-mutate guard - an unknown
# spine returned rc 0 and journaled a no-op mutation, so a typo'd spine at
# close time would silently apply nothing while reporting success.
t_capture "$OSS" get '.mutations | length'; MUT_BEFORE="$T_OUT"
t_capture "$OSS" ledger_apply_pending r9.s9
t_assert_rc 7 "dispatcher: apply_pending against an unknown spine is rc 7"
t_capture "$OSS" get '.mutations | length'
t_assert_eq "$MUT_BEFORE" "$T_OUT" "no phantom mutation journaled after unknown-spine refusal"

# --- §9 / fake-ledger-discipline.md §1: channel is validated against
# real|fake|deferred; anything else is rc 2 with no record written.
t_capture "$OSS" fake_add "coach-llm" fake "shell for the skeleton" "first real strategy iteration" r1
t_assert_rc 0 "dispatcher: fake channel accepted"
t_capture "$OSS" fake_add "positions-store" deferred "in-memory for r0; the journey claims no durability" "first multi-session use" r1
t_assert_rc 0 "dispatcher: deferred channel accepted"
t_capture "$OSS" fake_add "broker-adapter" real "replaced this spine" "n/a" r1
t_assert_rc 0 "dispatcher: real channel accepted"
t_capture "$OSS" get '.fakes | length'; FAKES_BEFORE="$T_OUT"
t_capture "$OSS" fake_add "broker-adapter" stub "x" "y" r1
t_assert_rc 2 "dispatcher: channel outside real|fake|deferred is rc 2"
t_capture "$OSS" get '.fakes | length'
t_assert_eq "$FAKES_BEFORE" "$T_OUT" "no phantom fake after invalid-channel rejection"
t_capture "$OSS" get '.fakes[0].replacement_trigger'
t_assert_eq "first real strategy iteration" "$T_OUT" "replacement trigger stored"
t_capture "$OSS" get '.fakes[0].expiry_release'
t_assert_eq "r1" "$T_OUT" "expiry release stored"

# --- §4c: touch_check's rc is INVERTED on purpose (0 = matched, 1 = clean) and
# it prints one line per match. The skill body branches on this; reading it
# backwards inverts the whole judge, so assert all three shapes through the
# real binary (strict mode included).
"$OSS" bone_add ADR-0002 "hexagonal domain boundary" "src/domain/**" "revisit at v1" >/dev/null
"$OSS" risk_gate_add live-money "src/adapters/broker/**" "paper-env,human-confirm,audit-trail" >/dev/null
t_capture "$OSS" touch_check src/domain/order.rs
t_assert_rc 0 "dispatcher: touch_check rc 0 == MATCHED"
t_assert_contains "$T_OUT" "bone ADR-0002" "touch_check names the matched bone on stdout"
t_capture "$OSS" touch_check src/adapters/broker/order.rs
t_assert_rc 0 "dispatcher: risk-gate surface also matches"
t_assert_contains "$T_OUT" "risk_gate live-money" "touch_check names the matched risk gate on stdout"
t_capture "$OSS" touch_check README.md docs/notes.md
t_assert_rc 1 "dispatcher: touch_check rc 1 == CLEAN"
t_capture "$OSS" touch_check README.md src/domain/order.rs
t_assert_rc 0 "dispatcher: any match in the path set is rc 0 (decomposition re-check passes the union)"
# rc 2 = "could not check" is the third arm the two-branch `if` in §4c cannot
# see: it must never be folded into rc 1, or an inconclusive judge reads as a
# clean verdict and the spine keeps the permissive class.
t_capture "$OSS" touch_check
t_assert_rc 2 "dispatcher: touch_check with zero paths is rc 2 (inconclusive), never rc 1 (clean)"

# --- state stays replayable after every spine-planning mutation above.
t_capture oss_state_replay "$OSS_STATE_FILE"
t_assert_rc 0 "replay clean after spine-planning ops"
t_capture "$OSS" doctor
t_assert_contains "$T_OUT" "ok: shape" "doctor shape green after spine-planning ops"

cd "$HERE"
unset OSS_STATE_FILE
rm -rf "$TMP"
t_summary
