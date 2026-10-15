#!/usr/bin/env bash
# tests/test-stubs.sh — unit tests for lib/stubs.sh
# Covers (per SPEC §8.5/§8.6/§8.7, ~9 tests):
#   A. AGENTS.md (5) — stub rendering + project-name fallback + idempotency +
#                      no CLAUDE.md + dispatcher path
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
# A. AGENTS.md (5 tests)
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

  # S8 round 3: the router must state adoption's scope, not imply that
  # "existing source or history" alone qualifies for it.
  assert_contains 'legacy scaffold stack' "$content" || return 1
  assert_not_contains 'for existing source or history' "$content" || return 1

  assert_contains "$canonical_root" "$content" || return 1
  assert_not_contains '${CANONICAL_ROOT}' "$content" || return 1
  local first; first="$(head -n 1 "${ai_root}/AGENTS.md")"
  assert_eq '<!-- workspace-init stub: ossify:start replaces this file -->' "$first" || return 1
  # The single file carries what the CLAUDE.md stub used to: the trace filter.
  assert_contains 'Co-Authored-By:' "$content" || return 1
  # No pointer to a file that is no longer written.
  assert_not_contains 'Read `CLAUDE.md`' "$content" || return 1
  # D9: the fold dropped the route assertions the retired test_C1 carried; the
  # one stub still hands lifecycle work to ossify, with no retired-stack route.
  # Assert the routes themselves, not just the strings: line 5's prose already
  # contains `/ossify:start`, so the bare substring would survive the route's
  # removal (measured — that mutation SURVIVED until this line named the route).
  assert_contains '- Empty canonical: run `/ossify:start`' "$content" || return 1
  assert_contains '- `/ossify:adopt` currently targets projects previously onboarded' "$content" || return 1
  assert_not_contains '/onboard' "$content" || return 1
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
  local count1 count2
  count1="$(count_matches 'AGENTS.md' "$log")"
  # D10: a non-zero baseline, so the equality below cannot be 0 == 0.
  [[ "$count1" -gt 0 ]] || { echo "    no AGENTS.md entry after the first call"; return 1; }

  wi_stub_agents_md "$ai_root" "test" >/dev/null 2>&1 || return 1
  count2="$(count_matches 'AGENTS.md' "$log")"

  [[ "$count1" == "$count2" ]] || { echo "    log grew on second call ($count1 -> $count2)"; return 1; }
}

test_A7_agents_md_logs_write_file() {
  # D10: the fold dropped test_C2, which asserted the WRITE_FILE log line; no
  # test in the A set replaced it.
  local ai_root="$_WI_TMP/a7-ai" canonical_root="$_WI_TMP/a7"
  mkdir -p "$ai_root" "$canonical_root"
  _setup_manifest "$ai_root" "$canonical_root" || return 1
  wi_stub_agents_md "$ai_root" "p" >/dev/null 2>&1 || return 1

  local log="${ai_root}/.workspace/init-log"
  assert_file_exists "$log" || return 1
  local content; content="$(cat "$log")"
  assert_contains "WRITE_FILE" "$content" || return 1
  assert_contains "${ai_root}/AGENTS.md" "$content" || return 1
}

test_A4_no_claude_md_written() {
  local ai_root="$_WI_TMP/a4-ai" canonical_root="$_WI_TMP/a4"
  mkdir -p "$ai_root" "$canonical_root"
  _setup_manifest "$ai_root" "$canonical_root" || return 1
  wi_stub_agents_md "$ai_root" "p" >/dev/null 2>&1 || return 1
  [[ ! -e "${ai_root}/CLAUDE.md" ]] || { echo "    CLAUDE.md was written"; return 1; }
  if declare -F wi_stub_claude_md >/dev/null; then echo "    wi_stub_claude_md still defined"; return 1; fi
}

test_A5_dispatcher_path_renders_marker() {
  # bin/wi runs set -euo pipefail; sourcing the lib does not (canonical CLAUDE.md).
  local ai_root="$_WI_TMP/a5-ai" canonical_root="$_WI_TMP/a5"
  mkdir -p "$ai_root" "$canonical_root"
  _setup_manifest "$ai_root" "$canonical_root" || return 1
  "$WI_PLUGIN_ROOT/bin/wi" stub_agents_md "$ai_root" "p" >/dev/null 2>&1 || { echo "    dispatcher failed"; return 1; }
  assert_eq '<!-- workspace-init stub: ossify:start replaces this file -->' "$(head -n 1 "$ai_root/AGENTS.md")" || return 1
  # D11: assert the refusal itself, not merely a non-zero exit — any failure
  # (a missing arg, a bad path) would otherwise satisfy this test.
  local err
  err="$("$WI_PLUGIN_ROOT/bin/wi" stub_claude_md "$ai_root" "p" 2>&1 >/dev/null)"
  assert_contains 'Unknown function: wi_stub_claude_md' "$err" || return 1
}

test_A6_ampersand_in_canonical_root_survives_render() {
  # D3/#768: a canonical path with `&` (or `\`) used to be mangled by the
  # ${var//pat/repl} splice under bash 5.2+ patsub_replacement, leaving the
  # literal ${CANONICAL_ROOT} in the one instruction file every agent reads.
  # End-to-end through the dispatcher, which is where the real path arrives.
  local ai_root="$_WI_TMP/a6-ai" canonical_root="$_WI_TMP/a6/R&D"
  mkdir -p "$ai_root" "$canonical_root"
  _setup_manifest "$ai_root" "$canonical_root" || return 1
  "$WI_PLUGIN_ROOT/bin/wi" stub_agents_md "$ai_root" "p" >/dev/null 2>&1 || { echo "    dispatcher failed"; return 1; }

  local content; content="$(cat "$ai_root/AGENTS.md")"
  assert_contains "$canonical_root" "$content" || return 1
  assert_not_contains '${CANONICAL_ROOT}' "$content" || return 1
  # Adjacent control: the render still substitutes the other var, so the fix
  # did not disable substitution wholesale.
  assert_contains 'p — AI workspace' "$content" || return 1
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

  # S8 round 3: the plugin list must state adoption's scope, not imply that
  # "existing source or history" alone qualifies for it.
  assert_contains 'legacy scaffold stack' "$content" || return 1
  assert_not_contains 'for existing source or history' "$content" || return 1
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
  local count1 count2
  count1="$(count_matches 'README.md' "$log")"
  [[ "$count1" -gt 0 ]] || { echo "    no README.md entry after the first call"; return 1; }

  wi_stub_readme "$ai_root" "proj" >/dev/null 2>&1 || return 1
  count2="$(count_matches 'README.md' "$log")"

  [[ "$count1" == "$count2" ]] || { echo "    log grew on second call ($count1 -> $count2)"; return 1; }
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
  wi_stub_agents_md "$ai_root" "proj" 2>/dev/null || rc=$?

  export WI_TEMPLATES_DIR="$old_tmpl_dir"

  [[ $rc -ne 0 ]] || { echo "    expected non-zero exit when template missing"; return 1; }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

echo "== Running tests for lib/stubs.sh =="
echo ""

echo "A. AGENTS.md"
wi_test_run test_A1_agents_md_writes_file_with_project_name
wi_test_run test_A2_agents_md_fallback_to_manifest_name
wi_test_run test_A3_agents_md_idempotent
wi_test_run test_A7_agents_md_logs_write_file
wi_test_run test_A4_no_claude_md_written
wi_test_run test_A5_dispatcher_path_renders_marker
wi_test_run test_A6_ampersand_in_canonical_root_survives_render

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
