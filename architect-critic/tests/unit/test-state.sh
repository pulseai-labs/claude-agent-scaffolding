#!/usr/bin/env bash
# tests/unit/test-state.sh — tests for lib/state.sh (schema v3, async external runs)
# Covers: init at schema v3, recent_runs with concessions/skill_invoked (no cost_usd),
# manual promotions, locks.

set -u

# tests/unit/test-state.sh — TESTS_DIR points to tests/ (parent of unit/)
TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_DIR="$(cd "$TESTS_DIR/../lib" && pwd)"

source "$TESTS_DIR/_helpers.sh"
source "$LIB_DIR/_helpers.sh"
source "$LIB_DIR/state.sh"

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
setup_tmp_repo

assert_quick_exit_code() {
  local expected="$1"; shift
  local out="$CLAUDE_PLUGIN_DATA/quick-exit.out"
  set +e
  "$@" >"$out" 2>&1 &
  local pid=$!
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    echo "  ✗ command did not exit promptly: $*"; FAIL=$((FAIL+1))
    return
  fi
  wait "$pid"
  local ec=$?
  if [[ "$ec" == "$expected" ]]; then
    echo "  ✓ exit code $expected for: $*"; PASS=$((PASS+1))
  else
    echo "  ✗ exit code $expected for: $* (got $ec)"; FAIL=$((FAIL+1))
  fi
}

# ---------------------------------------------------------------------------
# T1: ac_state_path returns expected path
# ---------------------------------------------------------------------------
echo "T1: ac_state_path"
expected_path="$(ac_data_dir)/state.json"
actual_path="$(ac_state_path)"
assert_eq "ac_state_path returns data-dir/state.json" "$expected_path" "$actual_path"

# ---------------------------------------------------------------------------
# T2: schema_v3_init — fresh init writes schema_version: 3 (#39)
# ---------------------------------------------------------------------------
echo "T2: schema_v3_init"
state_file="$(ac_state_path)"
assert_file_missing "$state_file"
ac_state_init
assert_file_exists "$state_file"
schema_ver="$(jq '.schema_version' "$state_file")"
assert_eq "schema_version=3" "3" "$schema_ver"
assert_eq "external_runs seeded empty on init" "0" "$(jq '.external_runs | length' "$state_file")"

# ---------------------------------------------------------------------------
# T3: init empty arrays for all seeded keys; withdrawn fields are absent
# ---------------------------------------------------------------------------
echo "T3: ac_state_init empty arrays"
recent_runs_len="$(jq '.recent_runs | length' "$state_file")"
promotions_len="$(jq '.principle_promotions | length' "$state_file")"
assert_eq "recent_runs starts empty" "0" "$recent_runs_len"
assert_eq "principle_promotions starts empty" "0" "$promotions_len"
assert_eq "candidate_promotions absent from fresh seed" "false" "$(jq 'has("candidate_promotions")' "$state_file")"
assert_eq "declined_candidates absent from fresh seed" "false" "$(jq 'has("declined_candidates")' "$state_file")"
assert_eq "auto_promote_suppressions absent from fresh seed" "false" "$(jq 'has("auto_promote_suppressions")' "$state_file")"

# ---------------------------------------------------------------------------
# T4: test_no_in_flight_field — fresh state.json does not contain in_flight
# ---------------------------------------------------------------------------
echo "T4: no in_flight field"
has_in_flight="$(jq 'has("in_flight")' "$state_file")"
assert_eq "fresh state.json has no in_flight key" "false" "$has_in_flight"

# ---------------------------------------------------------------------------
# T5: ac_state_init does NOT overwrite an existing state.json
# ---------------------------------------------------------------------------
echo "T5: ac_state_init does not overwrite"
jq '.schema_version = 99' "$state_file" > "${state_file}.tmp" && mv "${state_file}.tmp" "$state_file"
ac_state_init
ver_after="$(jq '.schema_version' "$state_file")"
assert_eq "init does not overwrite existing state" "99" "$ver_after"
# restore to v2 for remaining tests
jq '.schema_version = 2' "$state_file" > "${state_file}.tmp" && mv "${state_file}.tmp" "$state_file"

# ---------------------------------------------------------------------------
# T7: ac_state_append_run — schema v3-compatible row with concessions + skill_invoked, no cost_usd
# ---------------------------------------------------------------------------
echo "T7: ac_state_append_run (schema v3-compatible)"
ac_state_append_run "crit-2026-05-24T10:00:00Z-close-abc123" "close" '["claude","codex"]' 8 2 "critiquing-spec" 65000
runs_len="$(jq '.recent_runs | length' "$state_file")"
assert_eq "recent_runs has 1 entry after append" "1" "$runs_len"
rid="$(jq -r '.recent_runs[0].request_id' "$state_file")"
assert_eq "recent_runs[0].request_id" "crit-2026-05-24T10:00:00Z-close-abc123" "$rid"
depth="$(jq -r '.recent_runs[0].depth' "$state_file")"
assert_eq "recent_runs[0].depth" "close" "$depth"
adv_count="$(jq '.recent_runs[0].adversaries_used | length' "$state_file")"
assert_eq "recent_runs[0].adversaries_used length=2" "2" "$adv_count"
ch_count="$(jq '.recent_runs[0].challenge_count' "$state_file")"
assert_eq "recent_runs[0].challenge_count=8" "8" "$ch_count"
elapsed="$(jq '.recent_runs[0].elapsed_ms' "$state_file")"
assert_eq "recent_runs[0].elapsed_ms=65000" "65000" "$elapsed"
deferred_count="$(jq '.recent_runs[0].deferred_count' "$state_file")"
assert_eq "recent_runs[0].deferred_count defaults to 0" "0" "$deferred_count"
deferred_len="$(jq '.recent_runs[0].deferred_challenges | length' "$state_file")"
assert_eq "recent_runs[0].deferred_challenges defaults empty" "0" "$deferred_len"

# concessions field present
echo "T7b: test_concessions_field_in_recent_runs"
concessions="$(jq '.recent_runs[0].concessions' "$state_file")"
assert_eq "recent_runs[0].concessions=2" "2" "$concessions"

# skill_invoked field present
echo "T7c: test_skill_invoked_field_in_recent_runs"
skill="$(jq -r '.recent_runs[0].skill_invoked' "$state_file")"
assert_eq "recent_runs[0].skill_invoked=critiquing-spec" "critiquing-spec" "$skill"

# No cost_usd
echo "T7d: test_no_cost_usd_field"
has_cost="$(jq '.recent_runs[0] | has("cost_usd")' "$state_file")"
assert_eq "recent_runs[0] has no cost_usd key" "false" "$has_cost"

# ---------------------------------------------------------------------------
# T7e: ac_state_append_run accepts flag-style invocation and CSV adversaries
# ---------------------------------------------------------------------------
echo "T7e: ac_state_append_run flag-style via arc dispatcher"
setup_tmp_repo > /dev/null
ac_state_init
state_file="$(ac_state_path)"
"$TESTS_DIR/../bin/arc" state_append_run \
  --request-id "crit-flag-style" \
  --depth close \
  --adversaries "claude,codex" \
  --challenge-count 13 \
  --concessions 7 \
  --skill-invoked critiquing-spec \
  --elapsed-ms 300000
flag_rc=$?
assert_eq "flag-style state_append_run rc=0" "0" "$flag_rc"
flag_id="$(jq -r '.recent_runs[0].request_id' "$state_file")"
assert_eq "flag-style request_id stored" "crit-flag-style" "$flag_id"
flag_adv="$(jq -r '.recent_runs[0].adversaries_used | join(",")' "$state_file")"
assert_eq "CSV adversaries converted to JSON array" "claude,codex" "$flag_adv"
flag_count="$(jq -r '.recent_runs[0].challenge_count' "$state_file")"
assert_eq "flag-style challenge_count stored" "13" "$flag_count"

echo "T7e2: ac_state_append_run stores deferred challenge details"
"$TESTS_DIR/../bin/arc" state_append_run \
  --request-id "crit-deferred-style" \
  --depth close \
  --adversaries "claude,codex" \
  --challenge-count 5 \
  --concessions 1 \
  --deferred-count 2 \
  --deferred-challenges '[{"index":2,"text":"Track retry cancellation semantics"},{"index":4,"text":"File observability gap"}]' \
  --skill-invoked critiquing-spec \
  --elapsed-ms 45000
deferred_id="$(jq -r '.recent_runs[-1].request_id' "$state_file")"
assert_eq "deferred request_id stored" "crit-deferred-style" "$deferred_id"
deferred_count="$(jq '.recent_runs[-1].deferred_count' "$state_file")"
assert_eq "deferred_count stored" "2" "$deferred_count"
deferred_first="$(jq -r '.recent_runs[-1].deferred_challenges[0].text' "$state_file")"
assert_eq "first deferred challenge text stored" "Track retry cancellation semantics" "$deferred_first"

echo "T7e3: ac_state_append_run stores disposition-triage counts"
"$TESTS_DIR/../bin/arc" state_append_run \
  --request-id "crit-triage-style" \
  --depth close \
  --adversaries "claude" \
  --challenge-count 9 \
  --concessions 7 \
  --auto-applied-count 6 \
  --escalated-count 3 \
  --skill-invoked critiquing-spec \
  --elapsed-ms 30000
triage_id="$(jq -r '.recent_runs[-1].request_id' "$state_file")"
assert_eq "triage request_id stored" "crit-triage-style" "$triage_id"
aac="$(jq '.recent_runs[-1].auto_applied_count' "$state_file")"
assert_eq "auto_applied_count stored" "6" "$aac"
esc="$(jq '.recent_runs[-1].escalated_count' "$state_file")"
assert_eq "escalated_count stored" "3" "$esc"
legacy_aac="$(jq '.recent_runs[0].auto_applied_count' "$state_file")"
assert_eq "auto_applied_count defaults to 0 when omitted" "0" "$legacy_aac"
legacy_esc="$(jq '.recent_runs[0].escalated_count' "$state_file")"
assert_eq "escalated_count defaults to 0 when omitted" "0" "$legacy_esc"

echo "T7f: ac_state_append_run missing flag values fail promptly"
assert_quick_exit_code 2 "$TESTS_DIR/../bin/arc" state_append_run --request-id

# ---------------------------------------------------------------------------
# T8: recent_runs cap at 20 entries (drops oldest)
# ---------------------------------------------------------------------------
echo "T8: recent_runs cap at 20"
for i in $(seq 1 20); do
  ac_state_append_run "crit-cap-${i}" "close" '["claude"]' 1 0 "critiquing-spec" 100
done
cap_len="$(jq '.recent_runs | length' "$state_file")"
assert_eq "recent_runs capped at 20" "20" "$cap_len"
last_id="$(jq -r '.recent_runs[-1].request_id' "$state_file")"
assert_eq "most recent entry is crit-cap-20" "crit-cap-20" "$last_id"
# Verify original entry crit-2026-...-abc123 was dropped
has_first="$(jq -r '[.recent_runs[].request_id] | index("crit-2026-05-24T10:00:00Z-close-abc123")' "$state_file")"
assert_eq "original entry was dropped after 20+1 appends" "null" "$has_first"

# ---------------------------------------------------------------------------
# T9: ac_state_append_promotion adds a principle_promotion entry
# ---------------------------------------------------------------------------
echo "T9: ac_state_append_promotion"
ac_state_append_promotion "manual" "Always document rollback paths" "user"
promo_len="$(jq '.principle_promotions | length' "$state_file")"
assert_eq "principle_promotions has 1 entry" "1" "$promo_len"
promo_text="$(jq -r '.principle_promotions[0].text' "$state_file")"
assert_eq "principle_promotions[0].text" "Always document rollback paths" "$promo_text"
promo_src="$(jq -r '.principle_promotions[0].source' "$state_file")"
assert_eq "principle_promotions[0].source" "manual" "$promo_src"
promo_scope="$(jq -r '.principle_promotions[0].scope' "$state_file")"
assert_eq "principle_promotions[0].scope" "user" "$promo_scope"

# ---------------------------------------------------------------------------
# T11: lock file is created and released
# ---------------------------------------------------------------------------
echo "T11: lock file acquire and release"
lock_path="$(ac_data_dir)/state.lock"
assert_file_missing "$lock_path"
ac_lock_acquire "$lock_path"
assert_file_exists "$lock_path"
ac_lock_release "$lock_path"
assert_file_missing "$lock_path"

# ---------------------------------------------------------------------------
# T12: second ac_lock_acquire fails when lock is held
# ---------------------------------------------------------------------------
echo "T12: concurrent lock refusal"
ac_lock_acquire "$lock_path"
( set -o noclobber; > "$lock_path" ) 2>/dev/null
second_rc=$?
assert_eq "noclobber fails when lock held" "1" "$second_rc"
ac_lock_release "$lock_path"

# ---------------------------------------------------------------------------
# T13: ac_state_write_field updates a scalar field atomically
# ---------------------------------------------------------------------------
echo "T13: ac_state_write_field"
ac_state_write_field ".schema_version" "2"
new_ver="$(jq '.schema_version' "$state_file")"
assert_eq "write_field updates schema_version to 2" "2" "$new_ver"

# ---------------------------------------------------------------------------
# T14: ac_state_init preserves on-disk state.json with future schema_version (>3)
# ---------------------------------------------------------------------------
echo "T14: future schema preserved"
setup_tmp_repo > /dev/null
mkdir -p "$(ac_data_dir)"
state_file="$(ac_state_path)"
printf '%s\n' '{"schema_version":99,"recent_runs":[],"future_field":"x"}' > "$state_file"
ac_state_init 2>&1 | grep -q "future schema_version=99"
assert_eq "future schema_version logs info" "0" "$?"
preserved_ver="$(jq '.schema_version' "$state_file")"
assert_eq "future schema preserved" "99" "$preserved_ver"
preserved_future="$(jq -r '.future_field' "$state_file")"
assert_eq "future field preserved" "x" "$preserved_future"

# ---------------------------------------------------------------------------
# T17: ac_state_init re-seeds a 0-byte state.json (#451)
# A guarded write that emptied state.json must be recoverable — a zero-byte
# file holds nothing to lose, so init re-seeds it with a warning.
# ---------------------------------------------------------------------------
echo "T17: ac_state_init re-seeds a 0-byte state.json"
setup_tmp_repo > /dev/null
mkdir -p "$(ac_data_dir)"
state_file="$(ac_state_path)"
: > "$state_file"
init_out="$("$TESTS_DIR/../bin/arc" state_init 2>&1)"
init_rc=$?
assert_eq "state_init on 0-byte file exits 0" "0" "$init_rc"
reseeded_ver="$(jq -r '.schema_version' "$state_file")"
assert_eq "re-seeded file is schema_version=3" "3" "$reseeded_ver"
printf '%s' "$init_out" | grep -q "re-seed"
assert_eq "re-seed warning emitted" "0" "$?"

# ---------------------------------------------------------------------------
# T18 (control): ac_state_init leaves a non-empty VALID state.json
# byte-identical — the new branches must not disturb a healthy file.
# ---------------------------------------------------------------------------
echo "T18: ac_state_init on non-empty valid file is a byte-identical no-op"
setup_tmp_repo > /dev/null
ac_state_init
state_file="$(ac_state_path)"
jq '.schema_version = 99' "$state_file" > "${state_file}.tmp" && mv "${state_file}.tmp" "$state_file"
before_sha="$(shasum -a 256 "$state_file" | awk '{print $1}')"
"$TESTS_DIR/../bin/arc" state_init >/dev/null 2>&1
assert_eq "state_init rc=0 on valid file" "0" "$?"
after_sha="$(shasum -a 256 "$state_file" | awk '{print $1}')"
assert_eq "valid file byte-identical after init" "$before_sha" "$after_sha"

# ---------------------------------------------------------------------------
# T19 (control): ac_state_init REFUSES a non-empty unparseable state.json —
# re-seeding it would destroy data, so it must fail with rc != 0 and leave
# the file byte-identical.
# ---------------------------------------------------------------------------
echo "T19: ac_state_init refuses a non-empty unparseable file"
setup_tmp_repo > /dev/null
mkdir -p "$(ac_data_dir)"
state_file="$(ac_state_path)"
printf 'this is not json {{{\n' > "$state_file"
before_sha="$(shasum -a 256 "$state_file" | awk '{print $1}')"
"$TESTS_DIR/../bin/arc" state_init >/dev/null 2>&1
refuse_rc=$?
[[ "$refuse_rc" -ne 0 ]]
assert_eq "unparseable file refused (rc != 0)" "0" "$?"
after_sha="$(shasum -a 256 "$state_file" | awk '{print $1}')"
assert_eq "unparseable file byte-identical after refusal" "$before_sha" "$after_sha"

# ---------------------------------------------------------------------------
# T20: a funnel refusal while state.lock is held must release it (#483 C1).
# Under bin/arc's `set -euo pipefail`, a failing funnel call aborts the
# dispatcher before the caller's ac_lock_release runs — unless the funnel
# itself releases the lock it was invoked under. Both refusal branches are
# exercised through real locked callers:
#   (a) shape refusal — state_write_field with a jq path that emits two
#       documents
#   (b) jq failure — state_write_field with an unparseable --argjson value
# In both cases: rc != 0, state.json byte-identical, no state.lock left, and
# the next write succeeds immediately (not after the 5s acquire timeout).
# ---------------------------------------------------------------------------
echo "T20: funnel refusal under lock leaves no state.lock"
setup_tmp_repo > /dev/null
ac_state_init
state_file="$(ac_state_path)"
lock_file="$(ac_data_dir)/state.lock"

t20_before="$(shasum -a 256 "$state_file" | awk '{print $1}')"
"$TESTS_DIR/../bin/arc" state_write_field '.a, .b' '1' 2>/dev/null
T20_RC=$?
[[ "$T20_RC" -ne 0 ]]
assert_eq "multi-doc funnel refusal exits non-zero" "0" "$?"
t20_after="$(shasum -a 256 "$state_file" | awk '{print $1}')"
assert_eq "state.json byte-identical after locked refusal" "$t20_before" "$t20_after"
assert_file_missing "$lock_file"

SECONDS=0
"$TESTS_DIR/../bin/arc" state_append_run "post-refusal-a" "close" '["claude"]' 1 0 "critiquing-spec" 10
assert_eq "next write succeeds after shape refusal" "0" "$?"
[[ $SECONDS -lt 4 ]]
assert_eq "no 5s lock stall after shape refusal" "0" "$?"

"$TESTS_DIR/../bin/arc" state_write_field ".x" "notanint{" 2>/dev/null
T20_RC=$?
[[ "$T20_RC" -ne 0 ]]
assert_eq "jq-fail funnel refusal exits non-zero" "0" "$?"
assert_file_missing "$lock_file"

SECONDS=0
"$TESTS_DIR/../bin/arc" state_append_run "post-refusal-b" "close" '["claude"]' 1 0 "critiquing-spec" 10
assert_eq "next write succeeds after jq-fail refusal" "0" "$?"
[[ $SECONDS -lt 4 ]]
assert_eq "no 5s lock stall after jq-fail refusal" "0" "$?"

# ---------------------------------------------------------------------------
# T21: no code path may remove a state.lock this process does not hold
# (#483 N1). Release is ownership-gated: the path must still be the lock we
# acquired AND its content must still be our owner token.
#   (a) a refusal inside an if-form caller, after which ac_lock_release runs —
#       a lock file planted by "another owner" in the gap must survive. The gap
#       is simulated by wrapping the funnel so it plants a foreign lock between
#       the refusal and the caller's own release.
#   (b) a second ac_lock_release after ours cleared is a no-op.
#   (c) through bin/arc: a lock we never acquired survives an acquire-timeout
#       refusal untouched.
# ---------------------------------------------------------------------------
echo "T21: lock release is ownership-gated (#483 N1)"
setup_tmp_repo > /dev/null
ac_state_init
state_file="$(ac_state_path)"
lock_file="$(ac_data_dir)/state.lock"
printf '{bad' > "$state_file"   # corrupt: the funnel's jq fails inside the caller

# (a) wrap ac_guarded_jq_write: run the real funnel, then plant a foreign lock
#     at the path before the caller's ac_lock_release executes.
eval "$(declare -f ac_guarded_jq_write | sed 's/^ac_guarded_jq_write ()/_ac_orig_guarded_write ()/')"
ac_guarded_jq_write() {
  _ac_orig_guarded_write "$@"
  local rc=$?
  if [[ $rc -ne 0 ]]; then
    printf 'foreign-owner-token' > "$(ac_data_dir)/state.lock"
  fi
  return $rc
}
ac_state_append_run "gap-run" "close" '["claude"]' 1 0 "critiquing-spec" 10 2>/dev/null
T21_RC=$?
[[ "$T21_RC" -ne 0 ]]
assert_eq "if-form caller refusal still exits non-zero" "0" "$?"
[[ -f "$lock_file" && "$(cat "$lock_file")" == "foreign-owner-token" ]]
assert_eq "foreign lock planted in the gap survives caller release" "0" "$?"
source "$LIB_DIR/_helpers.sh"   # restore the unwrapped funnel
rm -f "$lock_file"

# (b) second release after ours cleared → no-op against a foreign file
ac_lock_acquire "$lock_file"
ac_lock_release "$lock_file"
assert_file_missing "$lock_file"
printf 'foreign-owner-token' > "$lock_file"
ac_lock_release "$lock_file"   # we hold nothing — must not remove theirs
[[ -f "$lock_file" && "$(cat "$lock_file")" == "foreign-owner-token" ]]
assert_eq "second release is a no-op: foreign lock survives" "0" "$?"
rm -f "$lock_file"

# (c) a lock we never acquired survives an acquire-timeout through bin/arc
printf 'foreign-owner-token' > "$lock_file"
"$TESTS_DIR/../bin/arc" state_append_run "blocked-run" "close" '["claude"]' 1 0 "critiquing-spec" 10 2>/dev/null
T21_RC=$?
[[ "$T21_RC" -ne 0 ]]
assert_eq "acquire-timeout exits non-zero" "0" "$?"
[[ -f "$lock_file" && "$(cat "$lock_file")" == "foreign-owner-token" ]]
assert_eq "foreign lock survives acquire-timeout" "0" "$?"
rm -f "$lock_file"

# ---------------------------------------------------------------------------
# T22: an errexit inside a locked region that is NOT a funnel refusal still
# releases the lock (#483 N1) — the acquire-side EXIT trap covers every exit
# path, and only at subshell depth 0 so command substitutions cannot release
# the parent's lock.
#   (a) harness: set -e process acquires the lock then dies on `false` in the
#       locked region → no state.lock left behind.
#   (b) through bin/arc: `arc lock_acquire` returns rc=0 yet the lock is gone
#       once the dispatcher process exits.
# ---------------------------------------------------------------------------
echo "T22: errexit inside a locked region releases the lock (#483 N1)"
setup_tmp_repo > /dev/null
mkdir -p "$(ac_data_dir)"
lock_file="$(ac_data_dir)/state.lock"
arc_lib_dir="$(cd "$TESTS_DIR/../lib" && pwd)"

bash -c '
  set -euo pipefail
  source "'"$arc_lib_dir"'/_helpers.sh"
  source "'"$arc_lib_dir"'/state.sh"
  ac_lock_acquire "'"$lock_file"'"
  false
  echo unreachable
' 2>/dev/null
T22_RC=$?
[[ "$T22_RC" -ne 0 ]]
assert_eq "errexit inside locked region exits non-zero" "0" "$?"
assert_file_missing "$lock_file"

"$TESTS_DIR/../bin/arc" lock_acquire "$lock_file"
assert_eq "arc lock_acquire returns 0" "0" "$?"
assert_file_missing "$lock_file"

# ---------------------------------------------------------------------------
report_results
