#!/usr/bin/env bash
#
# bot-on-telegram - plugin test runner.
#
# A missing claude or bun is a failure, never a skip: a skipped suite reads
# exactly like a passing one. Run from any directory (CI runs it from the repo root).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

for tool in claude bun; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'bot-on-telegram: %s not found; the suite needs it\n' "$tool" >&2
    exit 1
  fi
done

claude plugin validate "$SCRIPT_DIR" || exit 1

bun test "$SCRIPT_DIR/tests"
