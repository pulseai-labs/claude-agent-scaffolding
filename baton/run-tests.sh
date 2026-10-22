#!/usr/bin/env bash
#
# baton - plugin test runner.
#
# A missing claude or bun is a failure, never a skip: a skipped suite reads
# exactly like a passing one. Run from any directory (CI runs it from the repo root).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

for tool in claude bun; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'baton: %s not found; the suite needs it\n' "$tool" >&2
    exit 1
  fi
done

claude plugin validate "$SCRIPT_DIR" || exit 1

# bin/omp-t3-claim arrives with the launcher; check its syntax once it exists.
if [ -f "$SCRIPT_DIR/bin/omp-t3-claim" ]; then
  bash -n "$SCRIPT_DIR/bin/omp-t3-claim" || exit 1
fi

bun test "$SCRIPT_DIR/tests"
