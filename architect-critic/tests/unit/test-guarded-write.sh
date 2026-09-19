#!/usr/bin/env bash
# tests/unit/test-guarded-write.sh — ac_guarded_jq_write funnel contract (#451)
#
# Every state.json writer funnels through ac_guarded_jq_write. jq exits 0 for a
# program that emits NOTHING (empty stream) or MORE THAN ONE document, so exit
# status alone cannot protect the target: the replacement must parse as exactly
# one JSON object. On refusal: rc != 0, the target is left byte-identical, and
# no temp file is left behind.
set -u

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_DIR="$(cd "$TESTS_DIR/../lib" && pwd)"

source "$TESTS_DIR/_helpers.sh"
source "$LIB_DIR/_helpers.sh"

echo "=== test-guarded-write.sh (#451) ==="

_sha256() { shasum -a 256 "$1" | awk '{print $1}'; }

_tmp_leftover_count() {
  local target="$1"
  shopt -s nullglob
  local leftovers=( "${target}".* )
  shopt -u nullglob
  printf '%s' "${#leftovers[@]}"
}

# ---------------------------------------------------------------------------
# T1: a jq program that emits NOTHING (`empty`) must not empty the target.
# This is the #451 mechanism: the promote generator's zero-output stream was
# mv'd over state.json as a 0-byte file.
# ---------------------------------------------------------------------------
echo ""
echo "--- T1: empty jq output is refused, target byte-identical ---"
setup_tmp_repo > /dev/null
TARGET="$TMP_DIR/state.json"
printf '%s\n' '{"schema_version":3,"recent_runs":[]}' > "$TARGET"
BEFORE_SHA="$(_sha256 "$TARGET")"

ac_guarded_jq_write "$TARGET" 'empty' "$TARGET" 2>/dev/null
RC=$?
[[ "$RC" -ne 0 ]]
assert_eq "empty output refused (rc != 0)" "0" "$?"
assert_eq "target byte-identical after refused write" "$BEFORE_SHA" "$(_sha256 "$TARGET")"
assert_eq "no temp file left behind" "0" "$(_tmp_leftover_count "$TARGET")"

# ---------------------------------------------------------------------------
# T2: a jq program that emits MULTIPLE documents is refused the same way —
# two objects concatenated is not a valid state.json either.
# ---------------------------------------------------------------------------
echo ""
echo "--- T2: multi-document jq output is refused ---"
setup_tmp_repo > /dev/null
TARGET="$TMP_DIR/state.json"
printf '%s\n' '{"schema_version":3,"recent_runs":[]}' > "$TARGET"
BEFORE_SHA="$(_sha256 "$TARGET")"

ac_guarded_jq_write "$TARGET" '. , {"extra":1}' "$TARGET" 2>/dev/null
RC=$?
[[ "$RC" -ne 0 ]]
assert_eq "two-document output refused (rc != 0)" "0" "$?"
assert_eq "target byte-identical after refused write" "$BEFORE_SHA" "$(_sha256 "$TARGET")"
assert_eq "no temp file left behind" "0" "$(_tmp_leftover_count "$TARGET")"

# ---------------------------------------------------------------------------
# T3 (control): a valid single-object write must still land — the funnel is
# stricter now, so pin that it does not over-refuse.
# ---------------------------------------------------------------------------
echo ""
echo "--- T3: valid single-object write still lands (control) ---"
setup_tmp_repo > /dev/null
TARGET="$TMP_DIR/state.json"
printf '%s\n' '{"schema_version":3,"recent_runs":[]}' > "$TARGET"

ac_guarded_jq_write "$TARGET" '. + {"marker":"yes"}' "$TARGET" 2>/dev/null
RC=$?
assert_eq "valid write accepted (rc == 0)" "0" "$RC"
MARKER="$(jq -r '.marker' "$TARGET")"
assert_eq "written field applied" "yes" "$MARKER"

# ---------------------------------------------------------------------------
report_results
