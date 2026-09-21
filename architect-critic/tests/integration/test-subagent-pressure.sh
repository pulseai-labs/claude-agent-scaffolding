#!/usr/bin/env bash
# test-subagent-pressure.sh — static pressure checks for the 4 architect-critic skills.
#
# What this DOES test (statically, from bash):
#  - Each SKILL.md exists and has valid YAML frontmatter (name + description fields)
#  - Each skill's documented lib helpers exist and are callable from a fresh subshell
#  - codex subprocess invocation pattern works from a subshell (mocked codex via PATH)
#
# What this does NOT test (must be done manually in a Claude Code session):
#  - Actual Agent-tool dispatch of a skill (no CLI for that)
#  - Subagent-context deadlocks per [[feedback_subagent_vs_inline_threshold]] —
#    those manifest at runtime under real subagent socket conditions
#
# To do the manual pressure test, see the RUNBOOK block at the end of this file.

set -uo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SKILLS=(critiquing-spec reviewing-critique-history listing-principles promoting-principle)
PASS=0
FAIL=0

assert_pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
assert_fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

# --- 1. Each SKILL.md exists + has valid frontmatter ---
echo "=== Static check: skill frontmatter ==="
for skill in "${SKILLS[@]}"; do
  body="$PLUGIN_DIR/skills/$skill/SKILL.md"
  if [[ ! -f "$body" ]]; then
    assert_fail "$skill: SKILL.md missing"
    continue
  fi
  # Frontmatter must have name: and description: in first 20 lines
  if head -20 "$body" | grep -q "^name: $skill$" && head -20 "$body" | grep -q "^description: "; then
    assert_pass "$skill: frontmatter has name + description"
  else
    assert_fail "$skill: frontmatter missing name/description"
  fi
done

# --- 2. Lib helpers sourcing under fresh subshell ---
echo ""
echo "=== Subshell check: lib helpers source cleanly ==="
for lib in state.sh principles.sh codex.sh migration.sh; do
  if bash -c "source '$PLUGIN_DIR/lib/$lib' 2>/dev/null"; then
    assert_pass "lib/$lib sources cleanly in fresh subshell"
  else
    assert_fail "lib/$lib sourcing failed in fresh subshell"
  fi
done

# --- 3. codex.sh invocation pattern works under subshell (with mocked codex) ---
echo ""
echo "=== Subshell check: codex.sh invocation under subagent-like context ==="
mock_dir="$(mktemp -d)"
trap 'rm -rf "$mock_dir"' EXIT

# Use the existing mock-codex fixture if present
mock_codex_src="$PLUGIN_DIR/tests/fixtures/mock-codex/codex"
if [[ -x "$mock_codex_src" ]]; then
  cp "$mock_codex_src" "$mock_dir/codex"
  chmod +x "$mock_dir/codex"

  # Use an existing schema-conformant payload from the test fixtures
  payload_file="$PLUGIN_DIR/tests/fixtures/payloads/3-challenges.json"
  if [[ ! -f "$payload_file" ]]; then
    payload_file="$mock_dir/payload.json"
    cat > "$payload_file" <<'JSON'
{"challenges":[{"text":"Mock challenge","severity":"gap","rationale":"mock"}]}
JSON
  fi

  # Invoke ac_codex_run_audit from a fresh subshell with mocked codex on PATH.
  # MOCK_CODEX_OUTPUT is what the mock writes to --output-last-message.
  # CLAUDE_PLUGIN_ROOT lets codex.sh resolve the output-schema path.
  output_dir="$mock_dir/out"
  mkdir -p "$output_dir"
  if PATH="$mock_dir:$PATH" \
     MOCK_CODEX_OUTPUT="$payload_file" \
     CLAUDE_PLUGIN_ROOT="$PLUGIN_DIR" \
     bash -c "source '$PLUGIN_DIR/lib/_helpers.sh'; source '$PLUGIN_DIR/lib/codex.sh'; ac_codex_run_audit 'test prompt' '$output_dir' --timeout 30 >/dev/null 2>&1"; then
    assert_pass "ac_codex_run_audit succeeds under subshell with mock codex"
  else
    assert_fail "ac_codex_run_audit failed under subshell (potential subagent-context issue)"
  fi
else
  echo "  SKIP: mock-codex fixture not available; skipping codex subshell test"
fi

# --- 4. State.sh schema v3 init works in fresh HOME ---
echo ""
echo "=== Subshell check: state.sh init under fresh HOME ==="
fresh_home="$(mktemp -d)"
trap 'rm -rf "$mock_dir" "$fresh_home"' EXIT
if HOME="$fresh_home" CLAUDE_PLUGIN_DATA="$fresh_home/.claude/architect-critic" \
   bash -c "source '$PLUGIN_DIR/lib/_helpers.sh'; source '$PLUGIN_DIR/lib/state.sh'; ac_state_init && [[ -f \"\$(ac_state_path)\" ]]" 2>/dev/null; then
  schema_ver="$(jq -r '.schema_version' "$fresh_home/.claude/architect-critic/state.json" 2>/dev/null)"
  if [[ "$schema_ver" == "3" ]]; then
    assert_pass "ac_state_init creates schema v3 state.json under fresh HOME"
  else
    assert_fail "ac_state_init created wrong schema_version: $schema_ver"
  fi
else
  assert_fail "ac_state_init failed under fresh HOME subshell"
fi

# --- Results ---
echo ""
echo "Results: $PASS passed, $FAIL failed"

# Print runbook for the manual portion
cat <<'EOF'

=== Manual Agent-dispatch pressure test (run in a Claude Code session) ===

The static checks above verify lib + subshell mechanics. The truly subagent-
specific pressure test — verifying that each skill body can actually be applied
under Agent tool dispatch without deadlocks or socket failures — must be done
interactively.

To run it, paste the following prompt into Claude Code:

  For each of the 4 architect-critic skills (critiquing-spec, reviewing-critique-
  history, listing-principles, promoting-principle), dispatch an Agent subagent
  (general-purpose type) with the prompt: "Read architect-critic/skills/<skill>/
  SKILL.md end-to-end and describe how you would apply it to a sample fixture
  from tests/eval/fixtures/<skill>/01-*.md. Do not improvise beyond the skill
  body." Verify each subagent completes within 5 minutes and produces a coherent
  description. If any subagent deadlocks, hangs, or fails with socket/stream
  errors, that skill is flagged for inline-only execution per the project
  feedback memory feedback_subagent_vs_inline_threshold.

The Phase 9 final eval-harness run subsumes this test in practice — it
dispatches Agents per fixture and would surface any subagent-context failures
in the same way.

EOF

[[ $FAIL -eq 0 ]]
