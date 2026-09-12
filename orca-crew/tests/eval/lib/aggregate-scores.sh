#!/usr/bin/env bash
# aggregate-scores.sh — orca-crew copy.
#
# VERBATIM COPY of ossify/tests/eval/lib/aggregate-scores.sh below the header.
# The body derives EVAL_DIR from its own location, so it needs no edit to work
# here — and editing it is how the two silently stop agreeing. If ossify's
# changes, re-copy rather than patch. Nothing asserts the two are identical;
# `diff` them before trusting either.
# aggregate-scores.sh — read per-fixture JSON results and print pass/fail summary.
# Run AFTER the Claude-Code-session eval run has written results/*.json.

set -euo pipefail

EVAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESULTS_DIR="${EVAL_DIR}/results"
FIXTURES_DIR="${EVAL_DIR}/fixtures"

if [[ ! -d "$RESULTS_DIR" ]]; then
  echo "No results dir at $RESULTS_DIR — run the eval harness first."
  exit 1
fi

# --- unscored-fixture guard -------------------------------------------------
# This script counts result JSONs, so on its own it CANNOT detect its own
# incompleteness: a surface authored but never run is simply absent from
# results/, and the total comes back clean over fixtures nothing ever scored.
# That is a green ship gate over a surface that does not exist in the results.
#
# So the walk is over FIXTURES, which are authoritative — a fixture with no
# result is an UNSCORED fixture, never an absent one. Keying this off results/
# would reproduce the blind spot it exists to close.
unscored=""
unscored_count=0
if [[ -d "$FIXTURES_DIR" ]]; then
  for fixture_dir in "$FIXTURES_DIR"/*/; do
    [[ -d "$fixture_dir" ]] || continue
    surface="$(basename "$fixture_dir")"
    for fixture in "$fixture_dir"*.md; do
      [[ -e "$fixture" ]] || continue
      id="$(basename "$fixture" .md)"
      if [[ ! -f "${RESULTS_DIR}/${surface}/${id}.json" ]]; then
        unscored+="  UNSCORED: ${surface}/${id} — no results/${surface}/${id}.json"$'\n'
        unscored_count=$((unscored_count + 1))
      fi
    done
  done
fi

total_pass=0
total_fail=0
total_files=0

for skill_dir in "$RESULTS_DIR"/*/; do
  [[ -d "$skill_dir" ]] || continue
  skill="$(basename "$skill_dir")"
  skill_pass=0
  skill_fail=0

  for result in "$skill_dir"*.json; do
    [[ -e "$result" ]] || continue
    total_files=$((total_files + 1))
    pass=$(jq -r '.pass' "$result" 2>/dev/null || echo "false")
    if [[ "$pass" == "true" ]]; then
      skill_pass=$((skill_pass + 1))
      total_pass=$((total_pass + 1))
    else
      skill_fail=$((skill_fail + 1))
      total_fail=$((total_fail + 1))
      notes=$(jq -r '.notes // ""' "$result" 2>/dev/null)
      echo "  FAIL: ${skill}/$(basename "$result" .json) — ${notes}"
    fi
  done

  echo "${skill}: ${skill_pass} pass / ${skill_fail} fail"
done

echo ""
if [[ $unscored_count -gt 0 ]]; then
  printf '%s' "$unscored"
fi
echo "=== TOTAL: ${total_pass}/${total_files} passed ==="
if [[ $unscored_count -gt 0 ]]; then
  echo "=== GATE FAILED: ${unscored_count} fixture(s) unscored — the total above is over a PARTIAL run ==="
  exit 1
fi
[[ $total_fail -eq 0 ]]
