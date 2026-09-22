#!/usr/bin/env bash
# tests/test-stubs.sh — unit tests for lib/stubs.sh
# Covers (per SPEC §8.5/§8.6/§8.7, ~10 tests):
#   C. CLAUDE.md (3) — stub rendering + substitution + idempotency
#   A. AGENTS.md (3) — stub rendering + project-name fallback + idempotency
#   R. README.md (3) — stub rendering + substitution + idempotency
#   T. Template missing (1) — returns non-zero when template absent

source "$(dirname "$0")/_helpers.sh"
source "$WI_LIB_DIR/_helpers.sh"
source "$WI_LIB_DIR/manifest.sh"
source "$WI_LIB_DIR/stubs.sh"

# Shared sandbox — direct mktemp (avoids $() trap-loss).
_WI_TMP="$(mktemp -d "${TMPDIR:-/tmp}/wi-stubs-test.XXXXXX")"
_wi_stubs_cleanup() {
  if [[ -d "$_WI_TMP" ]]; then
    chmod -R u+w "$_WI_TMP" 2>/dev/null || true
    rm -rf "$_WI_TMP"
  fi
}
trap _wi_stubs_cleanup EXIT

# Helper: create a minimal valid manifest for testing.
_setup_manifest() {
  local ai_root="$1"
  local canonical_root="$2"
  mkdir -p "${ai_root}/.workspace"
  wi_manifest_write "$ai_root" "$canonical_root" "personal" || {
    echo "FATAL: wi_manifest_write failed"
    return 1
  }
}

# ---------------------------------------------------------------------------
# C. CLAUDE.md (3 tests)
# ---------------------------------------------------------------------------

test_C1_claude_md_writes_file_with_substitution() {
  local ai_root="$_WI_TMP/c1-ai"
  local canonical_root="$_WI_TMP/c1"
  mkdir -p "$ai_root" "$canonical_root"
  _setup_manifest "$ai_root" "$canonical_root" || return 1

  if ! wi_stub_claude_md "$ai_root" "my-project" 2>/dev/null; then
    echo "    expected success"
    return 1
  fi

  assert_file_exists "${ai_root}/CLAUDE.md" || return 1
  local content
  content="$(cat "${ai_root}/CLAUDE.md")"
  assert_contains "my-project" "$content" || return 1
  assert_contains "$canonical_root" "$content" || return 1
  assert_not_contains '${PROJECT_NAME}' "$content" || return 1
  assert_not_contains '${CANONICAL_ROOT}' "$content" || return 1

  # S8: the rendered stub hands lifecycle work to ossify and carries no
  # retired-stack continuation or ornamental version claim.
  assert_contains '/ossify:start' "$content" || return 1
  assert_contains '/ossify:adopt' "$content" || return 1
  assert_not_contains '/onboard' "$content" || return 1
  assert_not_contains 'scaffold-onboard' "$content" || return 1
  [[ ! "$content" =~ workspace-init\ v[0-9] ]] || return 1
}

test_C2_claude_md_logs_write_file() {
  local ai_root="$_WI_TMP/c2-ai"
  local canonical_root="$_WI_TMP/c2"
  mkdir -p "$ai_root" "$canonical_root"
  _setup_manifest "$ai_root" "$canonical_root" || return 1

  wi_stub_claude_md "$ai_root" "test-proj" >/dev/null 2>&1 || return 1

  local log="${ai_root}/.workspace/init-log"
  assert_file_exists "$log" || return 1
  local content
  content="$(cat "$log")"
  assert_contains "WRITE_FILE" "$content" || return 1
  assert_contains "${ai_root}/CLAUDE.md" "$content" || return 1
}

test_C3_claude_md_idempotent() {
  local ai_root="$_WI_TMP/c3-ai"
  local canonical_root="$_WI_TMP/c3"
  mkdir -p "$ai_root" "$canonical_root"
  _setup_manifest "$ai_root" "$canonical_root" || return 1

  # First call.
  wi_stub_claude_md "$ai_root" "proj" >/dev/null 2>&1 || return 1
  local log="${ai_root}/.workspace/init-log"
  local count1
  count1="$(grep -c 'WRITE_FILE' "$log" || echo 0)"

  # Second call (idempotent).
  wi_stub_claude_md "$ai_root" "proj" >/dev/null 2>&1 || return 1
  local count2
  count2="$(grep -c 'WRITE_FILE' "$log" || echo 0)"

  # Should still be same count (one CLAUDE.md entry).
  [[ "$count1" == "$count2" ]] || { echo "    log grew on second call"; return 1; }
}

# ---------------------------------------------------------------------------
# A. AGENTS.md (3 tests)
# ---------------------------------------------------------------------------

test_A1_agents_md_writes_file_with_project_name() {
  local ai_root="$_WI_TMP/a1-ai"
  local canonical_root="$_WI_TMP/a1"
  mkdir -p "$ai_root" "$canonical_root"
  _setup_manifest "$ai_root" "$canonical_root" || return 1

  if ! wi_stub_agents_md "$ai_root" "my-agents-proj" 2>/dev/null; then
    echo "    expected success"
    return 1
  fi

  assert_file_exists "${ai_root}/AGENTS.md" || return 1
  local content
  content="$(cat "${ai_root}/AGENTS.md")"
  assert_contains "my-agents-proj" "$content" || return 1
  assert_not_contains '${PROJECT_NAME}' "$content" || return 1

  # S8: ossify doctor's agents_md check is exactly `grep -qi ossify` on the
  # rendered file — run the owning predicate, not an approximation.
  grep -qi 'ossify' "${ai_root}/AGENTS.md" || {
    echo '    rendered AGENTS.md never mentions ossify'; return 1; }
  assert_not_contains 'scaffold-onboard' "$content" || return 1
}

test_A2_agents_md_fallback_to_manifest_name() {
  local ai_root="$_WI_TMP/a2-ai"
  local canonical_root="$_WI_TMP/a2"
  mkdir -p "$ai_root" "$canonical_root"
  _setup_manifest "$ai_root" "$canonical_root" || return 1

  # Call without explicit project_name — should read from manifest.
  if ! wi_stub_agents_md "$ai_root" 2>/dev/null; then
    echo "    expected success when reading name from manifest"
    return 1
  fi

  assert_file_exists "${ai_root}/AGENTS.md" || return 1
  # The manifest AI workspace name is "a2-ai" (basename of ai_root).
  local content
  content="$(cat "${ai_root}/AGENTS.md")"
  assert_contains "a2-ai" "$content" || return 1
}

test_A3_agents_md_idempotent() {
  local ai_root="$_WI_TMP/a3-ai"
  local canonical_root="$_WI_TMP/a3"
  mkdir -p "$ai_root" "$canonical_root"
  _setup_manifest "$ai_root" "$canonical_root" || return 1

  wi_stub_agents_md "$ai_root" "test" >/dev/null 2>&1 || return 1
  local log="${ai_root}/.workspace/init-log"
  local count1
  count1="$(grep -c 'AGENTS.md' "$log" || echo 0)"

  wi_stub_agents_md "$ai_root" "test" >/dev/null 2>&1 || return 1
  local count2
  count2="$(grep -c 'AGENTS.md' "$log" || echo 0)"

  [[ "$count1" == "$count2" ]] || { echo "    log grew on second call"; return 1; }
}

# ---------------------------------------------------------------------------
# R. README.md (3 tests)
# ---------------------------------------------------------------------------

test_R1_readme_writes_file_with_substitution() {
  local ai_root="$_WI_TMP/r1-ai"
  local canonical_root="$_WI_TMP/r1"
  mkdir -p "$ai_root" "$canonical_root"
  _setup_manifest "$ai_root" "$canonical_root" || return 1

  if ! wi_stub_readme "$ai_root" "readme-proj" 2>/dev/null; then
    echo "    expected success"
    return 1
  fi

  assert_file_exists "${ai_root}/README.md" || return 1
  local content
  content="$(cat "${ai_root}/README.md")"
  assert_contains "readme-proj" "$content" || return 1
  assert_contains "$canonical_root" "$content" || return 1
  assert_not_contains '${PROJECT_NAME}' "$content" || return 1
  assert_not_contains '${CANONICAL_ROOT}' "$content" || return 1

  # S8: the rendered README routes lifecycle to ossify and does not claim
  # bootstrap already authored a memory bank or sprint specs.
  assert_contains 'ossify' "$content" || return 1
  assert_contains '/ossify:start' "$content" || return 1
  assert_contains '/ossify:adopt' "$content" || return 1
  assert_not_contains 'scaffold-onboard' "$content" || return 1
  assert_not_contains 'scaffold-dev' "$content" || return 1
  assert_not_contains 'emory bank' "$content" || return 1
}

test_R2_readme_logs_write_file() {
  local ai_root="$_WI_TMP/r2-ai"
  local canonical_root="$_WI_TMP/r2"
  mkdir -p "$ai_root" "$canonical_root"
  _setup_manifest "$ai_root" "$canonical_root" || return 1

  wi_stub_readme "$ai_root" "test" >/dev/null 2>&1 || return 1

  local log="${ai_root}/.workspace/init-log"
  assert_file_exists "$log" || return 1
  local content
  content="$(cat "$log")"
  assert_contains "README.md" "$content" || return 1
}

test_R3_readme_idempotent() {
  local ai_root="$_WI_TMP/r3-ai"
  local canonical_root="$_WI_TMP/r3"
  mkdir -p "$ai_root" "$canonical_root"
  _setup_manifest "$ai_root" "$canonical_root" || return 1

  wi_stub_readme "$ai_root" "proj" >/dev/null 2>&1 || return 1
  local log="${ai_root}/.workspace/init-log"
  local count1
  count1="$(grep -c 'README.md' "$log" || echo 0)"

  wi_stub_readme "$ai_root" "proj" >/dev/null 2>&1 || return 1
  local count2
  count2="$(grep -c 'README.md' "$log" || echo 0)"

  [[ "$count1" == "$count2" ]] || { echo "    log grew on second call"; return 1; }
}

# ---------------------------------------------------------------------------
# T. Template missing (1 test)
# ---------------------------------------------------------------------------

test_T1_missing_template_fails() {
  local ai_root="$_WI_TMP/t1-ai"
  local canonical_root="$_WI_TMP/t1"
  mkdir -p "$ai_root" "$canonical_root"
  _setup_manifest "$ai_root" "$canonical_root" || return 1

  # Temporarily hide the template by pointing to a nonexistent directory.
  local old_tmpl_dir="$WI_TEMPLATES_DIR"
  export WI_TEMPLATES_DIR="/nonexistent/templates"

  local rc=0
  wi_stub_claude_md "$ai_root" "proj" 2>/dev/null || rc=$?

  export WI_TEMPLATES_DIR="$old_tmpl_dir"

  [[ $rc -ne 0 ]] || { echo "    expected non-zero exit when template missing"; return 1; }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

echo "== Running tests for lib/stubs.sh =="
echo ""

echo "C. CLAUDE.md"
wi_test_run test_C1_claude_md_writes_file_with_substitution
wi_test_run test_C2_claude_md_logs_write_file
wi_test_run test_C3_claude_md_idempotent

echo ""
echo "A. AGENTS.md"
wi_test_run test_A1_agents_md_writes_file_with_project_name
wi_test_run test_A2_agents_md_fallback_to_manifest_name
wi_test_run test_A3_agents_md_idempotent

echo ""
echo "R. README.md"
wi_test_run test_R1_readme_writes_file_with_substitution
wi_test_run test_R2_readme_logs_write_file
wi_test_run test_R3_readme_idempotent

echo ""
echo "T. Template handling"
wi_test_run test_T1_missing_template_fails

echo ""
wi_test_summary
