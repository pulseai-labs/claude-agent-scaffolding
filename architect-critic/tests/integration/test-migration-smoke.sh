#!/usr/bin/env bash
# test-migration-smoke.sh — end-to-end smoke for v0.1.x → v0.2 migration.
# Simulates a v0.1.x install with state.json schema 1 + inbox/outbox dirs +
# user-edited principles.md, runs the v0.2 migration, asserts the prescribed
# transformations happened per SPEC §10.

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_HOME="$(mktemp -d)"
trap 'rm -rf "$TMP_HOME"' EXIT

DATA_DIR="$TMP_HOME/.claude/architect-critic"

# --- Set up fake v0.1.x state ---
mkdir -p "$DATA_DIR/inbox" "$DATA_DIR/outbox"

cat > "$DATA_DIR/state.json" <<'JSON'
{
  "schema_version": 1,
  "in_flight": [],
  "recent_runs": [{ "request_id": "old-run", "cost_usd": 0 }],
  "principle_promotions": []
}
JSON

cat > "$DATA_DIR/inbox/test-req.json" <<'JSON'
{ "request_id": "stale-req", "spec_path": "/nowhere" }
JSON

cat > "$DATA_DIR/outbox/test-resp.json" <<'JSON'
{ "request_id": "stale-req", "status": "done" }
JSON

echo "- My custom user principle" > "$DATA_DIR/principles.md"

# --- Run migration ---
HOME="$TMP_HOME" bash "$PLUGIN_DIR/lib/migration.sh" check-v01-state

# --- Assertions ---
fail=0
fail_msg() { echo "FAIL: $1"; fail=1; }

# 1. state.json backed up to .v0.1.3.bak (or timestamped variant)
shopt -s nullglob
baks=("$DATA_DIR"/state.json.v0.1.3.bak*)
shopt -u nullglob
if [[ ${#baks[@]} -lt 1 ]]; then
  fail_msg ".v0.1.3.bak (or timestamped variant) not created"
fi

# 2. inbox/ moved under legacy-v0.1.x/
[[ -d "$DATA_DIR/inbox" ]] && fail_msg "inbox/ still present at original location"
[[ -d "$DATA_DIR/legacy-v0.1.x/inbox" ]] || fail_msg "legacy-v0.1.x/inbox missing"

# 3. outbox/ moved under legacy-v0.1.x/
[[ -d "$DATA_DIR/outbox" ]] && fail_msg "outbox/ still present at original location"
[[ -d "$DATA_DIR/legacy-v0.1.x/outbox" ]] || fail_msg "legacy-v0.1.x/outbox missing"

# 4. Shipped defaults prepended (ghost-notes or CORE markers)
if ! grep -qE 'Ghost notes|ghost-notes|pp-ghost-notes' "$DATA_DIR/principles.md"; then
  fail_msg "ghost-notes shipped default not prepended to principles.md"
fi

# 5. User content preserved
grep -q "My custom user principle" "$DATA_DIR/principles.md" || \
  fail_msg "user content lost from principles.md"

# 6. Migration tag present
grep -q "migrated from v0.1.x" "$DATA_DIR/principles.md" || \
  fail_msg "migration tag (migrated from v0.1.x) missing from principles.md"

# 7. Fresh state.json has the current schema (v3 as of #39)
schema_ver="$(jq -r '.schema_version' "$DATA_DIR/state.json" 2>/dev/null)"
if [[ "$schema_ver" != "3" ]]; then
  fail_msg "fresh state.json schema_version='$schema_ver' (expected 3)"
fi

# 8. Fresh state.json has no in_flight, no cost_usd anywhere
if jq -e '.in_flight' "$DATA_DIR/state.json" >/dev/null 2>&1; then
  fail_msg "fresh state.json still contains in_flight field"
fi
if jq -e '.. | objects | select(.cost_usd)' "$DATA_DIR/state.json" >/dev/null 2>&1; then
  fail_msg "fresh state.json contains cost_usd somewhere"
fi

# 9. withdrawn candidate/suppression fields are NOT seeded on a fresh file
for dropped in candidate_promotions declined_candidates auto_promote_suppressions; do
  jq -e "has(\"$dropped\") | not" "$DATA_DIR/state.json" >/dev/null 2>&1 || \
    fail_msg "fresh state.json seeds dropped field $dropped"
done

if [[ $fail -eq 0 ]]; then
  echo "Migration smoke: all assertions passed"
  exit 0
else
  echo "Migration smoke: FAILED"
  exit 1
fi
