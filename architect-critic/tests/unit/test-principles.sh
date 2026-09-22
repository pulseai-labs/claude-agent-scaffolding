#!/usr/bin/env bash
# test-principles.sh — tests for lib/principles.sh
# The lib now carries only the three path resolvers; reading and merging
# principle files is prose work owned by the skills. These tests pin the
# resolver contract every consumer relies on.
set -u

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_ROOT="$(cd "$TESTS_DIR/.." && pwd)"

source "$TESTS_DIR/_helpers.sh"
source "$PLUGIN_ROOT/lib/_helpers.sh"
source "$PLUGIN_ROOT/lib/principles.sh"

echo "=== test-principles.sh ==="

# ---------------------------------------------------------------------------
# Test 1: shipped path resolves to the plugin's template, which exists
# ---------------------------------------------------------------------------
echo "--- Test: ac_principles_shipped_path ---"
setup_tmp_repo > /dev/null
result="$(ac_principles_shipped_path)"
assert_eq "shipped path is <plugin>/templates/principles.md" "$PLUGIN_ROOT/templates/principles.md" "$result"
assert_file_exists "$result"

# ---------------------------------------------------------------------------
# Test 2: user-global path lives under $HOME/.claude (NOT plugin data — #207)
# ---------------------------------------------------------------------------
echo "--- Test: ac_principles_user_path ---"
setup_tmp_repo > /dev/null
export HOME="$TMP_DIR/home"
mkdir -p "$HOME"
result="$(ac_principles_user_path)"
assert_eq "user path is \$HOME/.claude/architect-critic/principles.md" "$HOME/.claude/architect-critic/principles.md" "$result"
case "$result" in
  "$CLAUDE_PLUGIN_DATA"*)
    echo "  ✗ user path resolves inside plugin data dir (regression of #207)"; FAIL=$((FAIL+1)) ;;
  *)
    echo "  ✓ user path is outside CLAUDE_PLUGIN_DATA"; PASS=$((PASS+1)) ;;
esac

# ---------------------------------------------------------------------------
# Test 3: project path resolves under git toplevel; empty outside a repo
# ---------------------------------------------------------------------------
echo "--- Test: ac_principles_project_path ---"
setup_tmp_repo > /dev/null
result="$(ac_principles_project_path)"
assert_eq "project path is <repo>/.claude/architect-critic/principles.md" "$TMP_DIR/repo/.claude/architect-critic/principles.md" "$result"

mkdir -p "$TMP_DIR/not-a-repo" && cd "$TMP_DIR/not-a-repo"
result="$(ac_principles_project_path)"
assert_eq "project path empty outside a git repo" "" "$result"
cd "$TMP_DIR/repo"

# ---------------------------------------------------------------------------
# Test 4: the three resolvers dispatch through bin/arc (kept-surface coverage)
# ---------------------------------------------------------------------------
echo "--- Test: resolvers via arc dispatcher ---"
ARC="$PLUGIN_ROOT/bin/arc"
assert_eq "arc principles_user_path" "$HOME/.claude/architect-critic/principles.md" "$(bash "$ARC" principles_user_path)"
assert_eq "arc principles_shipped_path" "$PLUGIN_ROOT/templates/principles.md" "$(bash "$ARC" principles_shipped_path)"
assert_eq "arc principles_project_path" "$TMP_DIR/repo/.claude/architect-critic/principles.md" "$(bash "$ARC" principles_project_path)"

report_results
