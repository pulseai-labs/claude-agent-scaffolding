#!/usr/bin/env bash
# test-state-upgrade.sh — 0.7.0 state contract: legacy files keep their dropped
# fields byte-for-byte, read verbs never create or mutate state.json, and a
# fresh seed carries the reduced schema. Every check goes through bin/arc (the
# strict `set -euo pipefail` dispatcher path), not only the sourced form.
set -u

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_DIR="$(cd "$TESTS_DIR/../lib" && pwd)"
PLUGIN_ROOT="$(cd "$TESTS_DIR/.." && pwd)"

source "$TESTS_DIR/_helpers.sh"
source "$LIB_DIR/_helpers.sh"
source "$LIB_DIR/state.sh"

export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
ARC="$PLUGIN_ROOT/bin/arc"

echo "=== test-state-upgrade.sh ==="
setup_tmp_repo > /dev/null
STATE_FILE="$CLAUDE_PLUGIN_DATA/state.json"

# ---------------------------------------------------------------------------
echo "-- (a) legacy state.json keeps dropped fields byte-for-byte through kept verbs --"
# A real user's file: schema v3 with the three withdrawn fields populated,
# principle_promotions[] in use, and an unknown top-level field.
cat > "$STATE_FILE" <<'EOF'
{"schema_version":3,"recent_runs":[],"external_runs":[],"principle_promotions":[{"timestamp":"2026-05-20T00:00:00Z","source":"manual","text":"sentinel principle","scope":"user"}],"candidate_promotions":[{"fingerprint":"fp-cand","text":"candidate text","votes":4}],"declined_candidates":[{"text":"declined text","declined_at":"2026-05-01T00:00:00Z","suppress_until":"2026-05-31T00:00:00Z"}],"auto_promote_suppressions":[{"fingerprint":"fp-supp","suppressed_at":"2026-05-15T10:22:00Z","expires_at":"2026-06-14T10:22:00Z","reason_score":4}],"extra_unknown":{"k":"v"}}
EOF
jq -S '{candidate_promotions, declined_candidates, auto_promote_suppressions, extra_unknown}' "$STATE_FILE" > "$TMP_DIR/before.json"

bash "$ARC" state_append_run --request-id req-legacy-1 --depth close \
  --adversaries '["claude","codex"]' --challenge-count 2 --concessions 1 \
  --skill-invoked critiquing-spec --elapsed-ms 10
assert_eq "state_append_run succeeds on legacy file" "0" "$?"

bash "$ARC" state_external_run_add --run-id r-legacy --host claude --adversary codex \
  --artifact /tmp/spec.md --depth close --result-path "$CLAUDE_PLUGIN_DATA/async/r-legacy/result.json"
assert_eq "state_external_run_add succeeds on legacy file" "0" "$?"

assert_eq "external_run_list returns the added record" "r-legacy" \
  "$(bash "$ARC" state_external_run_list | jq -r '.[0].run_id')"
assert_eq "external_run_get returns the record" "r-legacy" \
  "$(bash "$ARC" state_external_run_get r-legacy | jq -r '.run_id')"

bash "$ARC" state_append_promotion manual "another principle" project
assert_eq "state_append_promotion succeeds on legacy file" "0" "$?"
assert_eq "principle_promotions grew to 2" "2" \
  "$(jq '.principle_promotions | length' "$STATE_FILE")"

jq -S '{candidate_promotions, declined_candidates, auto_promote_suppressions, extra_unknown}' "$STATE_FILE" > "$TMP_DIR/after.json"
if cmp -s "$TMP_DIR/before.json" "$TMP_DIR/after.json"; then
  echo "  ✓ dropped fields + unknown field preserved byte-for-byte (jq -S canonical)"
  PASS=$((PASS+1))
else
  echo "  ✗ dropped fields changed across kept-verb writes:"
  diff "$TMP_DIR/before.json" "$TMP_DIR/after.json"
  FAIL=$((FAIL+1))
fi

# ---------------------------------------------------------------------------
echo "-- (b) read verbs on a missing state.json create nothing --"
rm -f "$STATE_FILE"

out="$(bash "$ARC" state_external_run_list)"; rc=$?
assert_eq "external_run_list on missing file: rc0" "0" "$rc"
assert_eq "external_run_list on missing file: prints []" "[]" "$out"
assert_file_missing "$STATE_FILE"

set +e
out="$(bash "$ARC" state_external_run_get r-anything 2>/dev/null)"; rc=$?
set -e 2>/dev/null || true
assert_eq "external_run_get on missing file: rc1 (not found)" "1" "$rc"
assert_eq "external_run_get on missing file: empty stdout" "" "$out"
assert_file_missing "$STATE_FILE"

echo "-- (b) adjacent control: a writer on the same missing path still creates it --"
bash "$ARC" state_external_run_add --run-id r-control --host claude --adversary codex \
  --artifact /tmp/spec.md --depth close --result-path "$CLAUDE_PLUGIN_DATA/async/r-control/result.json"
assert_eq "control writer rc0" "0" "$?"
assert_file_exists "$STATE_FILE"

echo "-- (b) schema-v2 file: read returns [] and does not migrate --"
cat > "$STATE_FILE" <<'EOF'
{"schema_version":2,"recent_runs":[{"request_id":"old"}],"principle_promotions":[],"candidate_promotions":[],"declined_candidates":[],"auto_promote_suppressions":[]}
EOF
cp "$STATE_FILE" "$TMP_DIR/v2-before.json"
out="$(bash "$ARC" state_external_run_list)"; rc=$?
assert_eq "external_run_list on v2 file: rc0" "0" "$rc"
assert_eq "external_run_list on v2 file: prints []" "[]" "$out"
if cmp -s "$TMP_DIR/v2-before.json" "$STATE_FILE"; then
  echo "  ✓ v2 file byte-identical after read (no migration-on-read)"
  PASS=$((PASS+1))
else
  echo "  ✗ v2 file mutated by external_run_list read"
  FAIL=$((FAIL+1))
fi
set +e
bash "$ARC" state_external_run_get nope >/dev/null 2>&1; rc=$?
set -e 2>/dev/null || true
assert_eq "external_run_get on v2 file: rc1" "1" "$rc"
if cmp -s "$TMP_DIR/v2-before.json" "$STATE_FILE"; then
  echo "  ✓ v2 file byte-identical after get (no migration-on-read)"
  PASS=$((PASS+1))
else
  echo "  ✗ v2 file mutated by external_run_get read"
  FAIL=$((FAIL+1))
fi

# ---------------------------------------------------------------------------
echo "-- (c) fresh seed carries the reduced schema --"
rm -f "$STATE_FILE"
bash "$ARC" state_init
assert_eq "state_init rc0 on missing file" "0" "$?"
assert_file_exists "$STATE_FILE"
assert_eq "fresh schema_version=3" "3" "$(jq -r '.schema_version' "$STATE_FILE")"
assert_eq "recent_runs seeded empty" "0" "$(jq '.recent_runs | length' "$STATE_FILE")"
assert_eq "external_runs seeded empty" "0" "$(jq '.external_runs | length' "$STATE_FILE")"
assert_eq "principle_promotions seeded empty" "0" "$(jq '.principle_promotions | length' "$STATE_FILE")"
assert_eq "candidate_promotions absent from fresh seed" "false" "$(jq 'has("candidate_promotions")' "$STATE_FILE")"
assert_eq "declined_candidates absent from fresh seed" "false" "$(jq 'has("declined_candidates")' "$STATE_FILE")"
assert_eq "auto_promote_suppressions absent from fresh seed" "false" "$(jq 'has("auto_promote_suppressions")' "$STATE_FILE")"

report_results
