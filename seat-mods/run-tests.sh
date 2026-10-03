#!/usr/bin/env bash
#
# seat-mods — plugin test runner.
#
# The suites are TypeScript tests that `claude plugin test` discovers (*.test.ts),
# so this runner validates the plugin and hands the folder to that command. A
# missing claude binary is a failure, never a skip: a skipped mod suite reads
# exactly like a passing one.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v claude >/dev/null 2>&1; then
  printf 'seat-mods: claude not found; the suite needs Claude Code 2.1.287 or later\n' >&2
  exit 1
fi

claude plugin validate "$SCRIPT_DIR" || exit 1
claude plugin test "$SCRIPT_DIR"
