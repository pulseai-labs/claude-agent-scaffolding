#!/usr/bin/env bash
#
# molt — plugin test runner.
#
# The suites are TypeScript tests that `claude plugin test` discovers (*.test.ts),
# so this runner validates the plugin and hands the folder to that command. A
# missing claude binary is a failure, never a skip: a skipped mod suite reads
# exactly like a passing one.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v claude >/dev/null 2>&1; then
  printf 'molt: claude not found; the suite needs Claude Code 2.1.289 or later\n' >&2
  exit 1
fi

claude plugin validate "$SCRIPT_DIR" || exit 1

# The host fills a declared key with its manifest default before register() runs, so a
# default on a ladder key would hide a saved 0.1.0 softPercent or hardPercent for good.
if ! jq -e '[.userConfig | (.commandPercent, .blockPercent, .softPercent, .hardPercent) | has("default")] | any | not' \
    "$SCRIPT_DIR/.claude-plugin/plugin.json" >/dev/null; then
  printf 'molt: commandPercent, blockPercent, softPercent and hardPercent must declare no default in plugin.json\n' >&2
  exit 1
fi
claude plugin test "$SCRIPT_DIR"
