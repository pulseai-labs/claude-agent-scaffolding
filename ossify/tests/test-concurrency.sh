#!/usr/bin/env bash
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"
. "$HERE/../lib/id.sh"; . "$HERE/../lib/state.sh"; . "$HERE/../lib/entities.sh"; . "$HERE/../lib/ledger.sh"
TMP="$(mktemp -d)"; S="$TMP/state.json"
oss_state_init "$S" concurrency-demo >/dev/null

# Server-side mint OVERRIDES a caller-supplied stale/duplicate id: the whole
# point of moving minting inside the lock is that a caller can never inject an
# id (two racing callers can't both win r0). Payload deliberately carries a
# bogus id:"r99" — the minted id must replace it.
t_capture oss_state_mutate "$S" add_release \
  '{"name":"x","goal":"y","status":"planned","created_at":"2026-01-01T00:00:00Z","id":"r99"}' release
t_assert_rc 0 "minted add_release ok"
t_assert_eq "r0" "$T_OUT" "server-side mint returns r0 (ignores caller id r99)"
t_capture oss_state_read "$S" '.releases[0].id'
t_assert_eq "r0" "$T_OUT" "stored release id is the minted r0, not the stale r99"

# Second release mints r1 (distinct id, no collision).
t_capture oss_state_mutate "$S" add_release \
  '{"name":"z","goal":"w","status":"planned","created_at":"2026-01-01T00:00:00Z"}' release
t_assert_eq "r1" "$T_OUT" "second release mints r1"
t_capture oss_state_read "$S" '[.releases[].id] | join(",")'
t_assert_eq "r0,r1" "$T_OUT" "release ids are distinct r0,r1"

# Demo-line counter minting inside the lock.
oss_entity_add_spine "$S" r0 "sk" bone canonical >/dev/null
t_capture oss_ledger_add_auto "$S" r0.s1 "core loop runs" "bash -c 'exit 0'" "exit:0"
t_assert_eq "d1" "$T_OUT" "first demo line mints d1"
t_capture oss_ledger_add_auto "$S" r0.s1 "second" "bash -c 'exit 0'" "exit:0"
t_assert_eq "d2" "$T_OUT" "second demo line mints d2"
t_capture oss_state_read "$S" '.counters.demo_line'
t_assert_eq "2" "$T_OUT" "demo_line counter is 2"

# Replay stays clean across all mint-path mutations.
t_capture oss_state_replay "$S"
t_assert_rc 0 "replay clean after minted mutations"

# --- Regression: strict-mode lock-leak guard for the mint block (the reason
# --- this task exists). Everything above runs through harness.sh, which
# --- never enables `set -e` (tests must observe failures, per harness.sh's
# --- own header) - so nothing above this point ever runs the mint code under
# --- a REAL `set -euo pipefail` (how bin/oss actually sources+calls this).
# --- These two blocks close that gap, following the same pattern as
# --- test-state-core.sh's R1/R2: force a failure INSIDE the critical section
# --- (between lock-acquire and lock-release) under real strict mode, in a
# --- subshell (isolates any hard-exit + auto-restores any function shadow),
# --- and confirm rc/lock/temp all come back clean.

# M1: force _oss_mint_id to fail mid-mint by shadowing oss_id_next_release,
# the helper the `release` mint spec dispatches to. Exercises the mint guards
# in `_oss_state_mutate_body` right where the new code runs inside the lock.
(
  set -euo pipefail
  oss_id_next_release() { return 1; }
  oss_state_mutate "$S" add_release \
    '{"name":"boom","goal":"g","status":"planned","created_at":"2026-01-01T00:00:00Z"}' release
)
m1=$?
t_assert_eq "4" "$m1" "forced mint-failure mutate aborts rc 4"
[ ! -d "$S.lock" ] && T_PASS=$((T_PASS+1)) || { T_FAIL=$((T_FAIL+1)); echo "FAIL: lock leaked after forced mint-failure mutate"; }
if ls "$S".tmp.* >/dev/null 2>&1; then T_FAIL=$((T_FAIL+1)); echo "FAIL: temp orphan after forced mint-failure mutate"; else T_PASS=$((T_PASS+1)); fi

# M2: unknown mint spec - _oss_mint_id's `*)` case returns 4 directly; must
# also clean up the lock/tmp under real strict mode.
(
  set -euo pipefail
  oss_state_mutate "$S" add_release \
    '{"name":"ghost","goal":"g","status":"planned","created_at":"2026-01-01T00:00:00Z"}' bogus
)
m2=$?
t_assert_eq "4" "$m2" "unknown-mint-spec mutate aborts rc 4"
[ ! -d "$S.lock" ] && T_PASS=$((T_PASS+1)) || { T_FAIL=$((T_FAIL+1)); echo "FAIL: lock leaked after unknown-mint-spec mutate"; }
if ls "$S".tmp.* >/dev/null 2>&1; then T_FAIL=$((T_FAIL+1)); echo "FAIL: temp orphan after unknown-mint-spec mutate"; else T_PASS=$((T_PASS+1)); fi

# ---------------------------------------------------------------------------
# M3 (#528, #529): the never-strand rail runs INSIDE the lock, and a guard that
# cannot answer fails CLOSED. The guard is handed to oss_state_mutate as its `$5`
# argument - the slot the 1.11.1 review built for the registries' duplicate rail -
# so these rows exercise that same mechanism through the work-item verbs. The
# 1.12.0 narrowing leaves two of them guarded (status, exec) and one not (spine
# status, whose guard rode #563); the third row below is the control for that.
# ---------------------------------------------------------------------------
REL3="$(oss_entity_add_release "$S" "guard fixture" "for M3")"
SP3="$(oss_entity_add_spine "$S" "$REL3" "guard spine" flesh canonical)"
WI3="$(oss_entity_add_work_item "$S" "$SP3" "dispatched item" canonical)"
oss_entity_set_work_item_exec "$S" "$WI3" "work/$WI3" "$TMP/.worktree/$WI3" "abc123" >/dev/null
t_assert_eq "work/$WI3" "$(oss_state_read "$S" ".work_items[] | select(.id==\"$WI3\") | .branch")" \
  "M3 setup: the fixture item records a dispatch, so the abandonment guard will refuse it"

# (a) THE TOCTOU HOLD, and the reason it is an rc and not a timing test. With the
# lock held, the verb must answer rc 3 - the lock-held refusal - and NOT the
# guard's rc 7, even for a payload the guard refuses. A read that happens BEFORE
# the lock refuses first and answers 7; a read that happens inside the lock never
# runs. That is the mechanical proof, and it cannot go flaky.
mkdir "$S.lock"
t_capture oss_entity_set_work_item_status "$S" "$WI3" abandoned
t_assert_rc 3 "(a) with the lock held, the abandonment answers rc 3, not the guard's rc 7"
t_capture oss_entity_set_work_item_exec "$S" "$WI3" "work/$WI3" "$TMP/.worktree/$WI3" "abc123"
t_assert_rc 3 "(a) ...and the dispatch guard does too"
# The spine verb keeps its pre-lock resolver and no longer carries a guard at all,
# so rc 3 here is the LOCK, not a rail: the same call answers 0 the moment it is
# released (asserted below) - which is what "the spine rail was dropped" means.
t_capture oss_entity_set_spine_status "$S" "$SP3" abandoned
t_assert_rc 3 "(a) ...and the retirement, which no longer carries a guard, still takes the lock"
rmdir "$S.lock"
t_capture oss_entity_set_spine_status "$S" "$SP3" abandoned
t_assert_rc 0 "(a) ...and lands at rc 0 once released - no spine rail remains (#563)"

# (b) A GUARD REFUSAL UNDER REAL STRICT MODE leaves the lock, the temp file and
# the journal exactly as they were. By the time a guard runs, the body has
# already created $tmp (and, for a minting op, minted an id) - so the failure
# path's `rm -f` is load-bearing rather than incidental.
N3="$(oss_state_read "$S" '.mutations | length')"
(
  set -euo pipefail
  oss_entity_set_work_item_status "$S" "$WI3" abandoned
)
m3=$?
t_assert_eq "7" "$m3" "(b) a guard refusal under set -euo pipefail answers rc 7"
[ ! -d "$S.lock" ] && T_PASS=$((T_PASS+1)) || { T_FAIL=$((T_FAIL+1)); echo "FAIL: lock leaked after a guard refusal"; }
if ls "$S".tmp.* >/dev/null 2>&1; then T_FAIL=$((T_FAIL+1)); echo "FAIL: temp orphan after a guard refusal"; else T_PASS=$((T_PASS+1)); fi
t_assert_eq "$N3" "$(oss_state_read "$S" '.mutations | length')" "(b) ...and the journal is unchanged"

# (c) A MIS-SHIFTED GUARD NAME IS LOUD. #550 tracks the positional escape hatch;
# what makes keeping it safe is that neither shift is silent: a guard name in the
# MINT slot reaches _oss_mint_id as an unknown spec (rc 4), and a bogus name in
# the GUARD slot answers the "could not answer" rc 4. Neither can pass as a
# successful mint.
t_capture oss_state_mutate "$S" set_work_item_status \
  "$(jq -n --arg w "$WI3" --arg st abandoned --arg ts "$(_oss_now)" '{work_item:$w,status:$st,at:$ts}')" \
  _oss_entity_guard_wi_status
t_assert_rc 4 "(c) a guard name in the MINT slot aborts rc 4 (unknown mint spec), not silently"
t_capture oss_state_mutate "$S" set_work_item_status \
  "$(jq -n --arg w "$WI3" --arg st abandoned --arg ts "$(_oss_now)" '{work_item:$w,status:$st,at:$ts}')" \
  "" no_such_guard_fn
t_assert_rc 4 "(c) a bogus guard name aborts rc 4 (could not answer), fail-closed"
t_assert_contains "$T_OUT" "could not answer" "(c) ...saying so, rather than minting on a rail that could not answer"
t_assert_eq "$N3" "$(oss_state_read "$S" '.mutations | length')" "(c) ...and neither mis-shift journaled anything"

rm -rf "$TMP"
t_summary
