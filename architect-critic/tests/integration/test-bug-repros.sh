#!/usr/bin/env bash
# test-bug-repros.sh — regression tests for GitHub issue #1 bugs.
# Each test starts FAILING (the bug still exists) and turns GREEN as v0.2 fixes land.

set -uo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TESTS_PASSED=0
TESTS_FAILED=0

assert_pass() {
  local desc="$1"
  echo "  PASS: $desc"
  TESTS_PASSED=$((TESTS_PASSED + 1))
}

assert_fail() {
  local desc="$1"
  echo "  FAIL: $desc"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

# --- BUG #1: $N substitution corrupts bash function locals ---
test_bug_1_arguments_bridge() {
  echo "BUG #1 — slash-command \$ARGUMENTS bridge replaces \$N positionals"
  # When fixed: /critique --spec custom.md should resolve custom.md, not $1
  # Regression check: grep for any "$1" / "$2" usage in commands/critique.md (should be zero)
  if grep -nE '\$[12345]' "$PLUGIN_DIR/commands/critique.md" 2>/dev/null | grep -v '\$ARGUMENTS' | grep -v '#'; then
    assert_fail "commands/critique.md still uses bare \$N positionals"
  else
    assert_pass "commands/critique.md uses \$ARGUMENTS only"
  fi
}

# --- BUG #2: claude-self-audit silent no-op ---
test_bug_2_skill_body_runs_audit() {
  echo "BUG #2 — claude-self-audit lives in skill body (not bash -c orchestration)"
  # When fixed: critiquing-spec/SKILL.md should contain the audit instructions as
  # markdown for Claude to read; should NOT contain "bash -c" wrapper around audit
  local skill_body="$PLUGIN_DIR/skills/critiquing-spec/SKILL.md"
  if [[ ! -f "$skill_body" ]]; then
    assert_fail "critiquing-spec/SKILL.md does not exist yet"
    return
  fi
  if grep -q 'HOST-AGENT SELF-AUDIT INSTRUCTIONS' "$skill_body" && \
     ! grep -q 'bash -c.*CLAUDE_AUDIT_TMP' "$skill_body"; then
    assert_pass "audit instructions present in markdown, not bash-orchestrated"
  else
    assert_fail "audit step still bash-orchestrated or instructions missing"
  fi
}

# --- BUG #3: hard fail without MASTER-SPEC.md ---
test_bug_3_path_discovery() {
  echo "BUG #3 — spec path discovery does not hard-fail on missing MASTER-SPEC"
  local skill_body="$PLUGIN_DIR/skills/critiquing-spec/SKILL.md"
  [[ -f "$skill_body" ]] || { assert_fail "skill body missing"; return; }
  if grep -q 'AskUserQuestion' "$skill_body" && grep -q 'well_known_paths' "$skill_body"; then
    assert_pass "discovery order documented (manifest fast-path + AskUserQuestion fallback)"
  else
    assert_fail "discovery order not fully specified"
  fi
}

# --- BUG #4: rebuttal cycle skipped non-TTY ---
test_bug_4_rebuttal_in_conversation() {
  echo "BUG #4 — rebuttal cycle uses Claude conversation, not bash read"
  local skill_body="$PLUGIN_DIR/skills/critiquing-spec/SKILL.md"
  [[ -f "$skill_body" ]] || { assert_fail "skill body missing"; return; }
  # Ensure no bash "read -r" used inside skill body for rebuttal capture
  if grep -E '^[[:space:]]*read -r' "$skill_body" >/dev/null; then
    assert_fail "skill body still uses bash 'read -r' for input"
  else
    assert_pass "no bash read; rebuttal handled in conversation"
  fi
}

# --- BUG #5: codex availability surfaced ---
test_bug_5_codex_status_in_output() {
  echo "BUG #5 — codex availability surfaced to user before audit"
  local skill_body="$PLUGIN_DIR/skills/critiquing-spec/SKILL.md"
  [[ -f "$skill_body" ]] || { assert_fail "skill body missing"; return; }
  if grep -qE 'Codex (detected|available|not detected)' "$skill_body"; then
    assert_pass "codex status messages in skill body"
  else
    assert_fail "skill body does not surface codex availability"
  fi
}

# --- BUG #9: Codex host must use Claude Code as optional fresh-frame adversary ---
test_bug_9_codex_host_claude_adversary() {
  echo "BUG #9 — Codex host flips close-depth adversary to Claude Code"
  local skill_body="$PLUGIN_DIR/skills/critiquing-spec/SKILL.md"
  [[ -f "$skill_body" ]] || { assert_fail "skill body missing"; return; }
  if grep -q 'HOST_AGENT' "$skill_body" && \
     grep -q 'claude_available' "$skill_body" && \
     grep -q 'Claude Code detected' "$skill_body"; then
    assert_pass "Codex-host Claude-adversary path documented"
  else
    assert_fail "Codex-host Claude-adversary path missing"
  fi
}

# --- BUG #6: cost_usd dropped entirely ---
test_bug_6_cost_field_removed() {
  echo "BUG #6 — cost_usd field removed from state.json schema"
  local state_lib="$PLUGIN_DIR/lib/state.sh"
  [[ -f "$state_lib" ]] || { assert_fail "lib/state.sh missing"; return; }
  if grep -q 'cost_usd' "$state_lib"; then
    assert_fail "lib/state.sh still references cost_usd"
  else
    assert_pass "cost_usd absent from state.sh"
  fi
}

# --- BUG #7: README has standalone-use section ---
test_bug_7_readme_standalone() {
  echo "BUG #7 — README documents standalone use"
  local readme="$PLUGIN_DIR/README.md"
  [[ -f "$readme" ]] || { assert_fail "README missing"; return; }
  if grep -qE '## (Standalone|Standalone use)' "$readme"; then
    assert_pass "README has standalone-use section"
  else
    assert_fail "README missing standalone-use section"
  fi
}

# --- BUG #8: project_class fallback consequence documented ---
test_bug_8_project_class_doc() {
  echo "BUG #8 — project_class fallback consequence documented"
  local skill_body="$PLUGIN_DIR/skills/critiquing-spec/SKILL.md"
  local readme="$PLUGIN_DIR/README.md"
  if { [[ -f "$skill_body" ]] && grep -q 'project_class.*unknown' "$skill_body"; } || \
     { [[ -f "$readme" ]] && grep -q 'project_class.*unknown' "$readme"; }; then
    assert_pass "project_class=unknown consequence documented"
  else
    assert_fail "project_class=unknown consequence not documented"
  fi
}

# --- BUG #96: phantom 'arc scorer_score'; rebuttal scoring is now agent-inline ---
test_bug_96_scorer_agent_inline() {
  echo "BUG #96 — rebuttal scoring is agent-inline; no phantom 'arc scorer_score' command"
  local skill_body="$PLUGIN_DIR/skills/critiquing-spec/SKILL.md"
  local arc_bin="$PLUGIN_DIR/bin/arc"
  [[ -f "$skill_body" ]] || { assert_fail "skill body missing"; return; }
  # (a) SKILL.md must not prescribe any 'arc scorer_score...' invocation (the #96 phantom)
  if grep -qE '(arc|arc_bin)"?[[:space:]]+scorer_score' "$skill_body"; then
    assert_fail "critiquing-spec/SKILL.md still prescribes 'arc scorer_score' (phantom command)"
  else
    assert_pass "critiquing-spec/SKILL.md prescribes no 'arc scorer_score' command"
  fi
  # (b) the deterministic scorer lib is gone (scoring is the agent's judgment call now)
  if [[ -e "$PLUGIN_DIR/lib/scorer.sh" ]]; then
    assert_fail "lib/scorer.sh still present — deterministic scorer should be removed"
  else
    assert_pass "lib/scorer.sh removed (rebuttal scoring is agent-inline)"
  fi
  # (c) arc --list must not advertise a scorer_score* suffix
  if bash "$arc_bin" --list 2>/dev/null | grep -qE '^scorer_score'; then
    assert_fail "arc --list still advertises a scorer_score* function"
  else
    assert_pass "arc --list advertises no scorer_score* function"
  fi
}

# --- Run all ---
test_bug_1_arguments_bridge
test_bug_2_skill_body_runs_audit
test_bug_3_path_discovery
test_bug_4_rebuttal_in_conversation
test_bug_5_codex_status_in_output
test_bug_6_cost_field_removed
test_bug_7_readme_standalone
test_bug_8_project_class_doc
test_bug_9_codex_host_claude_adversary
test_bug_96_scorer_agent_inline

echo ""
echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]]
