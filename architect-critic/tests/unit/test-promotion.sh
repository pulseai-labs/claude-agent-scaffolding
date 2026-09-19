#!/usr/bin/env bash
# tests/unit/test-promotion.sh — FULL auto-promotion machinery (v0.2 Phase 3.3)
#
# Covers SPEC §7.2:
#   - fingerprint: sha256(normalize(text)) where normalize = lowercase + strip
#     punctuation + collapse whitespace
#   - vote_count >= 4 across DISTINCT runs → promotion candidate surfaced
#   - auto_promote_suppressions[]: reason_score=4 → 30d, reason_score=5 → 90d;
#     suppressed entries skipped while expires_at > now
#   - instinct signal: same fingerprint in N=3 consecutive recent_runs → surface
#   - ac_promotion_promote: idempotent (no double-insert into
#     principle_promotions[]) and stamps promotion_basis
set -u

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_DIR="$(cd "$TESTS_DIR/../lib" && pwd)"

source "$TESTS_DIR/_helpers.sh"
source "$LIB_DIR/_helpers.sh"
source "$LIB_DIR/state.sh"
source "$LIB_DIR/promotion.sh"

echo "=== test-promotion.sh (v0.2) ==="

# ---------------------------------------------------------------------------
# Helpers used across tests
# ---------------------------------------------------------------------------

# Re-seed the state with an arbitrary list of fingerprints distributed across
# N distinct runs. Args: <fingerprint> <num_distinct_runs>
_seed_votes_for_fingerprint() {
  local fp="$1"
  local n="$2"
  local i=1
  while [[ $i -le $n ]]; do
    ac_promotion_add_vote "$fp" "run-$i" "challenge-text-$i"
    i=$((i+1))
  done
}

# ---------------------------------------------------------------------------
# T1: ac_promotion_fingerprint — normalization
# Different casing, punctuation, and whitespace should yield the SAME sha256.
# ---------------------------------------------------------------------------
echo ""
echo "--- T1: fingerprint normalization ---"
setup_tmp_repo > /dev/null
ac_state_init

FP_A="$(ac_promotion_fingerprint "Spec lacks rollback")"
FP_C="$(ac_promotion_fingerprint "  SPEC   lacks  rollback!?  ")"
assert_eq "fingerprint A == fingerprint C (case+ws+punct only)" "$FP_A" "$FP_C"

FP_B="$(ac_promotion_fingerprint "the spec lacks rollback.")"
FP_B2="$(ac_promotion_fingerprint "The Spec Lacks Rollback")"
assert_eq "fingerprint B == fingerprint B2 (case only)" "$FP_B" "$FP_B2"

# Different content (A has no "the") → different fingerprint
[[ "$FP_A" != "$FP_B" ]]
assert_eq "fingerprint A != fingerprint B (different content)" "0" "$?"

# Fingerprint is 64-char hex (sha256)
[[ "$FP_A" =~ ^[0-9a-f]{64}$ ]]
assert_eq "fingerprint is 64-char lowercase hex (sha256)" "0" "$?"

# ---------------------------------------------------------------------------
# T2: vote_count below T=4 → no candidate surfaced
# ---------------------------------------------------------------------------
echo ""
echo "--- T2: below T=4 votes → no promotion candidate surfaced ---"
setup_tmp_repo > /dev/null
ac_state_init

FP_X="$(ac_promotion_fingerprint "challenge alpha")"
_seed_votes_for_fingerprint "$FP_X" 3

SURFACED="$(ac_promotion_check_candidates)"
SURFACED_COUNT="$(printf '%s' "$SURFACED" | jq --arg fp "$FP_X" '[.[] | select(.fingerprint == $fp)] | length')"
assert_eq "3 votes → fingerprint NOT surfaced for vote-recurrence" "0" "$SURFACED_COUNT"

# ---------------------------------------------------------------------------
# T3: vote_count reaches T=4 → candidate surfaced
# ---------------------------------------------------------------------------
echo ""
echo "--- T3: T=4 votes → promotion candidate surfaced ---"
setup_tmp_repo > /dev/null
ac_state_init

FP_Y="$(ac_promotion_fingerprint "challenge beta")"
_seed_votes_for_fingerprint "$FP_Y" 4

SURFACED="$(ac_promotion_check_candidates)"
SURFACED_COUNT="$(printf '%s' "$SURFACED" | jq --arg fp "$FP_Y" '[.[] | select(.fingerprint == $fp)] | length')"
assert_eq "4 votes → fingerprint IS surfaced" "1" "$SURFACED_COUNT"

SURFACED_BASIS="$(printf '%s' "$SURFACED" | jq -r --arg fp "$FP_Y" '.[] | select(.fingerprint == $fp) | .basis')"
assert_eq "surfaced basis = pattern-recurrence" "pattern-recurrence" "$SURFACED_BASIS"

# ---------------------------------------------------------------------------
# T4: add_vote increments vote_count and appends run-id (no double-count
# for the same run)
# ---------------------------------------------------------------------------
echo ""
echo "--- T4: add_vote increments and dedup-by-run ---"
setup_tmp_repo > /dev/null
ac_state_init

FP_Z="$(ac_promotion_fingerprint "challenge gamma")"
ac_promotion_add_vote "$FP_Z" "run-1" "text-1"
ac_promotion_add_vote "$FP_Z" "run-1" "text-1"   # same run → no double count
ac_promotion_add_vote "$FP_Z" "run-2" "text-2"

state_file="$(ac_state_path)"
VOTE_COUNT="$(jq --arg fp "$FP_Z" '.candidate_promotions[] | select(.fingerprint == $fp) | .vote_count' "$state_file")"
assert_eq "vote_count=2 after dedup by run-id" "2" "$VOTE_COUNT"
RUN_LIST_LEN="$(jq --arg fp "$FP_Z" '.candidate_promotions[] | select(.fingerprint == $fp) | .appeared_in_runs | length' "$state_file")"
assert_eq "appeared_in_runs has 2 distinct entries" "2" "$RUN_LIST_LEN"

# ---------------------------------------------------------------------------
# T5: suppression 30-day window (reason_score=4)
# After apply_suppression, check_candidates must NOT surface the fingerprint
# even when vote_count >= 4.
# ---------------------------------------------------------------------------
echo ""
echo "--- T5: suppression 30-day window blocks surface ---"
setup_tmp_repo > /dev/null
ac_state_init

FP_S="$(ac_promotion_fingerprint "suppressed challenge")"
_seed_votes_for_fingerprint "$FP_S" 4
SURFACED="$(ac_promotion_check_candidates)"
SURFACED_COUNT="$(printf '%s' "$SURFACED" | jq --arg fp "$FP_S" '[.[] | select(.fingerprint == $fp)] | length')"
assert_eq "before suppression: 4 votes → surfaced" "1" "$SURFACED_COUNT"

ac_promotion_apply_suppression "$FP_S" 4
SURFACED="$(ac_promotion_check_candidates)"
SURFACED_COUNT="$(printf '%s' "$SURFACED" | jq --arg fp "$FP_S" '[.[] | select(.fingerprint == $fp)] | length')"
assert_eq "after 30d suppression: NOT surfaced" "0" "$SURFACED_COUNT"

# Confirm reason_score=4 → expires_at = suppressed_at + 30d (delegate to state.sh)
state_file="$(ac_state_path)"
SUPPRESSED_AT="$(jq -r --arg fp "$FP_S" '.auto_promote_suppressions[] | select(.fingerprint == $fp) | .suppressed_at' "$state_file")"
EXPIRES_AT="$(jq -r --arg fp "$FP_S" '.auto_promote_suppressions[] | select(.fingerprint == $fp) | .expires_at' "$state_file")"
EXPECTED_30="$(_ac_date_add_days "$SUPPRESSED_AT" 30)"
assert_eq "reason_score=4 → 30-day window" "$EXPECTED_30" "$EXPIRES_AT"

# ---------------------------------------------------------------------------
# T6: suppression 90-day window (reason_score=5)
# ---------------------------------------------------------------------------
echo ""
echo "--- T6: suppression 90-day window (reason_score=5) ---"
setup_tmp_repo > /dev/null
ac_state_init

FP_S2="$(ac_promotion_fingerprint "never-again challenge")"
_seed_votes_for_fingerprint "$FP_S2" 4
ac_promotion_apply_suppression "$FP_S2" 5

state_file="$(ac_state_path)"
SUPPRESSED_AT="$(jq -r --arg fp "$FP_S2" '.auto_promote_suppressions[] | select(.fingerprint == $fp) | .suppressed_at' "$state_file")"
EXPIRES_AT="$(jq -r --arg fp "$FP_S2" '.auto_promote_suppressions[] | select(.fingerprint == $fp) | .expires_at' "$state_file")"
EXPECTED_90="$(_ac_date_add_days "$SUPPRESSED_AT" 90)"
assert_eq "reason_score=5 → 90-day window" "$EXPECTED_90" "$EXPIRES_AT"

SURFACED="$(ac_promotion_check_candidates)"
SURFACED_COUNT="$(printf '%s' "$SURFACED" | jq --arg fp "$FP_S2" '[.[] | select(.fingerprint == $fp)] | length')"
assert_eq "90d-suppressed fingerprint NOT surfaced" "0" "$SURFACED_COUNT"

# ---------------------------------------------------------------------------
# T7: expired suppression re-surfaces the fingerprint
# Simulate by manually editing expires_at to a past timestamp.
# ---------------------------------------------------------------------------
echo ""
echo "--- T7: expired suppression → re-surfaced ---"
setup_tmp_repo > /dev/null
ac_state_init

FP_E="$(ac_promotion_fingerprint "expired suppression fp")"
_seed_votes_for_fingerprint "$FP_E" 4
ac_promotion_apply_suppression "$FP_E" 4

# Force expires_at into the past
state_file="$(ac_state_path)"
PAST="2020-01-01T00:00:00Z"
jq --arg fp "$FP_E" --arg past "$PAST" \
  '.auto_promote_suppressions |= map(if .fingerprint == $fp then .expires_at = $past else . end)' \
  "$state_file" > "${state_file}.tmp" && mv "${state_file}.tmp" "$state_file"

SURFACED="$(ac_promotion_check_candidates)"
SURFACED_COUNT="$(printf '%s' "$SURFACED" | jq --arg fp "$FP_E" '[.[] | select(.fingerprint == $fp)] | length')"
assert_eq "after expiry → fingerprint re-surfaced" "1" "$SURFACED_COUNT"

# ---------------------------------------------------------------------------
# T8: instinct signal — same fingerprint in 3 consecutive recent_runs
# (even without explicit votes). Surfaced with basis=instinct-recurrence.
# Modeled via per-run instinct_observations[] field on recent_runs entries.
# ---------------------------------------------------------------------------
echo ""
echo "--- T8: instinct signal (N=3 consecutive runs) ---"
setup_tmp_repo > /dev/null
ac_state_init

FP_I="$(ac_promotion_fingerprint "instinct candidate text")"
state_file="$(ac_state_path)"

for i in 1 2 3; do
  ac_state_append_run "inst-run-${i}" "close" '["claude"]' 1 0 "critiquing-spec" 100
  jq --arg fp "$FP_I" --arg rid "inst-run-${i}" \
    '.recent_runs |= map(if .request_id == $rid then .instinct_observations = [$fp] else . end)' \
    "$state_file" > "${state_file}.tmp" && mv "${state_file}.tmp" "$state_file"
done

INSTINCT="$(ac_promotion_instinct_signal)"
INSTINCT_COUNT="$(printf '%s' "$INSTINCT" | jq --arg fp "$FP_I" '[.[] | select(.fingerprint == $fp)] | length')"
assert_eq "fingerprint in 3 consecutive runs → instinct candidate" "1" "$INSTINCT_COUNT"

INSTINCT_BASIS="$(printf '%s' "$INSTINCT" | jq -r --arg fp "$FP_I" '.[] | select(.fingerprint == $fp) | .basis')"
assert_eq "instinct basis = instinct-recurrence" "instinct-recurrence" "$INSTINCT_BASIS"

# Negative: only 2 consecutive runs → not surfaced
setup_tmp_repo > /dev/null
ac_state_init
state_file="$(ac_state_path)"
FP_I2="$(ac_promotion_fingerprint "instinct candidate two")"
for i in 1 2; do
  ac_state_append_run "inst2-run-${i}" "close" '["claude"]' 1 0 "critiquing-spec" 100
  jq --arg fp "$FP_I2" --arg rid "inst2-run-${i}" \
    '.recent_runs |= map(if .request_id == $rid then .instinct_observations = [$fp] else . end)' \
    "$state_file" > "${state_file}.tmp" && mv "${state_file}.tmp" "$state_file"
done
INSTINCT="$(ac_promotion_instinct_signal)"
INSTINCT_COUNT="$(printf '%s' "$INSTINCT" | jq --arg fp "$FP_I2" '[.[] | select(.fingerprint == $fp)] | length')"
assert_eq "fingerprint in only 2 consecutive runs → NOT instinct candidate" "0" "$INSTINCT_COUNT"

# ---------------------------------------------------------------------------
# T9: ac_promotion_promote is idempotent
# Two promote calls on the same fingerprint → one principle_promotions entry.
# ---------------------------------------------------------------------------
echo ""
echo "--- T9: promote is idempotent ---"
setup_tmp_repo > /dev/null
ac_state_init

FP_P="$(ac_promotion_fingerprint "idempotent principle")"
_seed_votes_for_fingerprint "$FP_P" 4
ac_promotion_promote "$FP_P" "pattern-recurrence"
ac_promotion_promote "$FP_P" "pattern-recurrence"

state_file="$(ac_state_path)"
PROMO_COUNT="$(jq --arg fp "$FP_P" '[.principle_promotions[] | select(.fingerprint == $fp)] | length' "$state_file")"
assert_eq "double promote → single principle_promotions entry" "1" "$PROMO_COUNT"

PROMO_BASIS="$(jq -r --arg fp "$FP_P" '.principle_promotions[] | select(.fingerprint == $fp) | .promotion_basis' "$state_file")"
assert_eq "promotion_basis stamped" "pattern-recurrence" "$PROMO_BASIS"

# ---------------------------------------------------------------------------
# T10: distinct-runs requirement — 4 votes from the SAME run do NOT count
# as 4 votes. (Distinct runs only.)
# ---------------------------------------------------------------------------
echo ""
echo "--- T10: same-run repeats don't satisfy T=4 ---"
setup_tmp_repo > /dev/null
ac_state_init

FP_D="$(ac_promotion_fingerprint "single-run repeated challenge")"
for i in 1 2 3 4; do
  ac_promotion_add_vote "$FP_D" "single-run" "text"
done

SURFACED="$(ac_promotion_check_candidates)"
SURFACED_COUNT="$(printf '%s' "$SURFACED" | jq --arg fp "$FP_D" '[.[] | select(.fingerprint == $fp)] | length')"
assert_eq "4 votes from 1 run → NOT surfaced" "0" "$SURFACED_COUNT"

# ---------------------------------------------------------------------------
# T11: promoting a fingerprint absent from candidate_promotions[] is refused at
# the dispatched interface — rc != 0, stderr names the fingerprint, and
# state.json is left byte-identical (#451: the promote jq program emits zero
# documents for an unknown fingerprint, which must never reach the file).
# ---------------------------------------------------------------------------
echo ""
echo "--- T11: missing-fingerprint promote via bin/arc is refused (#451) ---"
setup_tmp_repo > /dev/null
ac_state_init

FP_OK="$(ac_promotion_fingerprint "a real promoted principle")"
_seed_votes_for_fingerprint "$FP_OK" 4
state_file="$(ac_state_path)"
before_sha="$(shasum -a 256 "$state_file" | awk '{print $1}')"

MISSING_FP="deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
promote_err="$("$TESTS_DIR/../bin/arc" promotion_promote "$MISSING_FP" auto 2>&1 >/dev/null)"
promote_rc=$?
[[ "$promote_rc" -ne 0 ]]
assert_eq "missing-fingerprint promote exits non-zero" "0" "$?"
after_sha="$(shasum -a 256 "$state_file" | awk '{print $1}')"
assert_eq "state.json byte-identical after refused promote" "$before_sha" "$after_sha"
printf '%s' "$promote_err" | grep -qF "$MISSING_FP"
assert_eq "stderr names the missing fingerprint" "0" "$?"

# ---------------------------------------------------------------------------
report_results
