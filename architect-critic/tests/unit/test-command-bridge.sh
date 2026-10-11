#!/usr/bin/env bash
# test-command-bridge.sh — guards the $ARGUMENTS -> $ARCHITECT_CRITIC_ARGS bridge.
# A skill cannot see a slash command's $ARGUMENTS; the wrapper exports it. The
# wrappers are rewritten to name the skill by path (Rule 1), so the bridge must
# survive that rewrite: every command that reads $ARGUMENTS keeps the export.
set -u

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_ROOT="$(cd "$TESTS_DIR/.." && pwd)"
source "$TESTS_DIR/_helpers.sh"

echo "=== test-command-bridge.sh ==="

# Non-vacuity: the five argument-taking commands are the ones this guard covers.
for c in critique critique-jobs critique-list principles-list promote-principle; do
  assert_file_contains "$PLUGIN_ROOT/commands/$c.md" 'ARGUMENTS'
done

n=0
for f in "$PLUGIN_ROOT"/commands/*.md; do
  grep -q 'ARGUMENTS' "$f" || continue
  n=$((n+1))
  assert_file_contains "$f" '^export ARCHITECT_CRITIC_ARGS="\$ARGUMENTS"$'
done
assert_eq "argument-reading commands checked" "5" "$n"

report_results
