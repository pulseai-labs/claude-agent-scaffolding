#!/usr/bin/env bash
#
# code-judo — plugin test runner.
#
# Discovers every suite under tests/ by glob rather than listing them. A hand
# list and this header's claim drift apart the moment someone adds a file: the
# runner reports ALL GREEN while silently never executing the new suite, and
# nothing in CI can tell the difference. The glob makes the claim true by
# construction.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

shopt -s nullglob
SUITES=(tests/test-*.sh)
shopt -u nullglob

# An empty glob would otherwise exit 0 having run nothing, which reads exactly
# like a passing suite.
if [ "${#SUITES[@]}" -eq 0 ]; then
  printf 'code-judo: no suites found under tests/test-*.sh\n' >&2
  exit 1
fi

failed=0
ran=0

for suite in "${SUITES[@]}"; do
  ran=$((ran + 1))
  printf '\n=== %s ===\n' "$suite"
  if bash "$suite"; then
    :
  else
    failed=$((failed + 1))
    printf '!!! FAILED: %s\n' "$suite"
  fi
done

printf '\n=== code-judo: %d suite(s) run, %d failed ===\n' "$ran" "$failed"
[ "$failed" -eq 0 ] || exit 1
exit 0
