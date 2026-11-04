#!/usr/bin/env bash
# run-tests.sh — discovers and runs all tests in tests/test-*.sh.
# Exit 0 if all pass; non-zero with summary if any fail.

set -u
cd "$(dirname "$0")"

declare -i total=0 failed=0
for test_file in tests/test-*.sh; do
  [[ -f "$test_file" ]] || continue
  printf '\n=== %s ===\n' "$test_file"
  if bash "$test_file"; then
    total=$((total + 1))
  else
    total=$((total + 1))
    failed=$((failed + 1))
  fi
done

printf '\n--- Summary: %d files, %d failed ---\n' "$total" "$failed"
[[ "$failed" -eq 0 ]] || exit 1
