#!/usr/bin/env bash
# tests/test-init-fresh.sh — end-to-end integration test for FRESH-mode bootstrap.
#
# Drives the 8-task pre-onboard pipeline (SPEC §8) directly by calling the
# wi_* library functions in the order a SKILL.md body would orchestrate.
# Each test creates its own tempdir and asserts a slice of the resulting
# filesystem + git + manifest state.
#
# Covered (~18 tests):
#   Happy path    (5)  : exit, ai dir, canonical dir, manifest present + valid
#   Manifest body (6)  : routing entries, project_type personal + work, declared + actual default_branch
#   Hooks         (2)  : both repos have baked hook; hook is functional (blocks Co-Authored-By)
#   Staging       (2)  : ai staged but canonical not; no auto-commit anywhere
#   Gitignore     (1)  : .workspace/handoffs/ literal in .gitignore
#   Failure modes (2)  : non-writable parent, invalid name — preflight aborts, no dirs

source "$(dirname "$0")/_helpers.sh"
source "$WI_LIB_DIR/_helpers.sh"
source "$WI_LIB_DIR/skeleton.sh"
source "$WI_LIB_DIR/manifest.sh"
source "$WI_LIB_DIR/stubs.sh"
source "$WI_LIB_DIR/git-init.sh"
source "$WI_LIB_DIR/trace-filter.sh"
source "$WI_LIB_DIR/rollback.sh"

# Shared sandbox — direct mktemp (avoids $() trap-loss).
_WI_TMP="$(mktemp -d "${TMPDIR:-/tmp}/wi-init-fresh.XXXXXX")"
_wi_init_fresh_cleanup() {
  if [[ -d "$_WI_TMP" ]]; then
    chmod -R u+w "$_WI_TMP" 2>/dev/null || true
    rm -rf "$_WI_TMP"
  fi
}
trap _wi_init_fresh_cleanup EXIT

# ---------------------------------------------------------------------------
# Helper: run the 8-task FRESH-mode bootstrap pipeline.
# ---------------------------------------------------------------------------
_run_bootstrap() {
  local parent="$1"; local name="$2"; local project_type="${3:-personal}"
  local ai_root="$parent/$name-ai"
  local canonical_root="$parent/$name"

  wi_skeleton_preflight "$parent" "$name" || return 1
  wi_skeleton_create_root_pair "$parent" "$name" || return 1
  wi_skeleton_seed_subdirs "$ai_root" || return 1

  # In fresh mode, canonical exists (we just created it) but has no commits/HEAD.
  # Run the detect-branch chain to get the default; fall back to main on prompt EOF.
  local default_branch
  default_branch="$(wi_git_detect_default_branch "$canonical_root" </dev/null)"
  [[ -z "$default_branch" ]] && default_branch="main"

  wi_manifest_write "$ai_root" "$canonical_root" "$project_type" --default-branch "$default_branch" || return 1
  wi_stub_claude_md "$ai_root" "$name" || return 1
  wi_stub_agents_md "$ai_root" "$name" || return 1
  wi_stub_readme "$ai_root" "$name" || return 1
  # Reproduce the issue environment: system/global git defaults to `master`.
  # Fresh workspace-init repos must still land on the manifest-declared `main`.
  local git_config="$parent/gitconfig"
  git config --file "$git_config" init.defaultBranch master
  GIT_CONFIG_GLOBAL="$git_config" GIT_CONFIG_NOSYSTEM=1 \
    wi_git_init_pair "$ai_root" "$canonical_root" || return 1
  wi_trace_filter_install_pair "$ai_root" "$canonical_root" || return 1
  wi_git_stage_ai_workspace "$ai_root" || return 1
  return 0
}

# ---------------------------------------------------------------------------
# Happy path — 5 tests
# ---------------------------------------------------------------------------

test_H1_bootstrap_succeeds_exit_zero() {
  local parent="$_WI_TMP/h1"; mkdir -p "$parent"
  if ! _run_bootstrap "$parent" "alpha" personal >/dev/null 2>&1; then
    echo "    bootstrap pipeline returned non-zero"
    return 1
  fi
}

test_H2_ai_workspace_dir_exists() {
  local parent="$_WI_TMP/h2"; mkdir -p "$parent"
  _run_bootstrap "$parent" "alpha" personal >/dev/null 2>&1
  assert_dir_exists "$parent/alpha-ai" || return 1
}

test_H3_canonical_dir_exists() {
  local parent="$_WI_TMP/h3"; mkdir -p "$parent"
  _run_bootstrap "$parent" "alpha" personal >/dev/null 2>&1
  assert_dir_exists "$parent/alpha" || return 1
}

test_H4_manifest_present_and_valid_json() {
  local parent="$_WI_TMP/h4"; mkdir -p "$parent"
  _run_bootstrap "$parent" "alpha" personal >/dev/null 2>&1
  local manifest="$parent/alpha-ai/.workspace/pairing.json"
  assert_file_exists "$manifest" || return 1
  if ! jq -e . "$manifest" >/dev/null 2>&1; then
    echo "    manifest is not valid JSON"
    return 1
  fi
}

test_H5_manifest_passes_validate() {
  local parent="$_WI_TMP/h5"; mkdir -p "$parent"
  _run_bootstrap "$parent" "alpha" personal >/dev/null 2>&1
  if ! wi_manifest_validate "$parent/alpha-ai" 2>/dev/null; then
    echo "    wi_manifest_validate failed"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Manifest content — 6 tests
# ---------------------------------------------------------------------------

test_M1_routing_complete_all_16_entries() {
  local parent="$_WI_TMP/m1"; mkdir -p "$parent"
  _run_bootstrap "$parent" "alpha" personal >/dev/null 2>&1
  local manifest="$parent/alpha-ai/.workspace/pairing.json"
  local count
  count="$(jq -r '.routing | keys | length' "$manifest" 2>/dev/null)"
  assert_eq "16" "$count" || { echo "    routing has $count entries, expected 16"; return 1; }
  # Spot-check the four canonical-bound entries from SPEC.
  local keys=(master_spec executive_summary memory_bank claude_md agents_md \
              scaffold_project_outputs backlog project_plan roadmap prd srs \
              product_adrs process_adrs sprint_specs implementation_handoffs \
              brainstorm_artifacts)
  local k v
  for k in "${keys[@]}"; do
    v="$(jq -r --arg k "$k" '.routing[$k] // empty' "$manifest")"
    if [[ -z "$v" ]]; then
      echo "    routing.$k missing or null"
      return 1
    fi
  done
}

test_M2_project_type_personal() {
  local parent="$_WI_TMP/m2"; mkdir -p "$parent"
  _run_bootstrap "$parent" "alpha" personal >/dev/null 2>&1
  local v
  v="$(jq -r '.git_policy.project_type' "$parent/alpha-ai/.workspace/pairing.json")"
  assert_eq "personal" "$v" || return 1
}

test_M3_project_type_work() {
  local parent="$_WI_TMP/m3"; mkdir -p "$parent"
  _run_bootstrap "$parent" "beta" work >/dev/null 2>&1
  local v
  v="$(jq -r '.git_policy.project_type' "$parent/beta-ai/.workspace/pairing.json")"
  assert_eq "work" "$v" || return 1
}

test_M4_canonical_default_branch_present() {
  local parent="$_WI_TMP/m4"; mkdir -p "$parent"
  _run_bootstrap "$parent" "alpha" personal >/dev/null 2>&1
  local v
  v="$(jq -r '.canonical.default_branch // empty' "$parent/alpha-ai/.workspace/pairing.json")"
  if [[ -z "$v" ]]; then
    echo "    canonical.default_branch missing/empty"
    return 1
  fi
}

test_M5_ai_repo_actual_branch_is_main() {
  local parent="$_WI_TMP/m5"; mkdir -p "$parent"
  _run_bootstrap "$parent" "alpha" personal >/dev/null 2>&1 || return 1
  assert_eq "main" "$(git -C "$parent/alpha-ai" symbolic-ref --short HEAD)" || return 1
}

test_M6_canonical_actual_branch_matches_manifest() {
  local parent="$_WI_TMP/m6"; mkdir -p "$parent"
  _run_bootstrap "$parent" "alpha" personal >/dev/null 2>&1 || return 1
  local manifest_branch actual_branch
  manifest_branch="$(jq -r '.canonical.default_branch' "$parent/alpha-ai/.workspace/pairing.json")"
  actual_branch="$(git -C "$parent/alpha" symbolic-ref --short HEAD)"
  assert_eq "$manifest_branch" "$actual_branch" || return 1
}

# ---------------------------------------------------------------------------
# Hooks — 2 tests
# ---------------------------------------------------------------------------

test_K1_hooks_installed_both_repos_with_baked_path() {
  local parent="$_WI_TMP/k1"; mkdir -p "$parent"
  _run_bootstrap "$parent" "alpha" personal >/dev/null 2>&1

  local ai_hook="$parent/alpha-ai/.git/hooks/commit-msg"
  local cn_hook="$parent/alpha/.git/hooks/commit-msg"
  assert_file_exists "$ai_hook" || return 1
  assert_file_exists "$cn_hook" || return 1
  [[ -x "$ai_hook" ]] || { echo "    ai hook not +x"; return 1; }
  [[ -x "$cn_hook" ]] || { echo "    canonical hook not +x"; return 1; }

  # Baked path: must match the absolute AI workspace path (after canonicalization
  # for macOS /var → /private/var).
  local ai_root_canon
  ai_root_canon="$(wi_realpath "$parent/alpha-ai")"
  # The path is baked shell-quoted (printf %q) so any byte survives — evaluate
  # the assignment line exactly as bash would rather than unpicking quotes.
  local baked_ai baked_cn
  baked_ai="$(eval "$(grep -m1 -E '^AI_WORKSPACE_PATH=' "$ai_hook")"; printf '%s' "$AI_WORKSPACE_PATH")"
  baked_cn="$(eval "$(grep -m1 -E '^AI_WORKSPACE_PATH=' "$cn_hook")"; printf '%s' "$AI_WORKSPACE_PATH")"
  local baked_ai_canon baked_cn_canon
  baked_ai_canon="$(wi_realpath "$baked_ai")"
  baked_cn_canon="$(wi_realpath "$baked_cn")"
  assert_eq "$ai_root_canon" "$baked_ai_canon" || { echo "    ai-hook baked path mismatch"; return 1; }
  assert_eq "$ai_root_canon" "$baked_cn_canon" || { echo "    canonical-hook baked path mismatch"; return 1; }
}

test_K2_hook_blocks_co_authored_by_returns_one() {
  local parent="$_WI_TMP/k2"; mkdir -p "$parent"
  _run_bootstrap "$parent" "alpha" personal >/dev/null 2>&1

  local hook="$parent/alpha-ai/.git/hooks/commit-msg"
  local fixture="$_WI_TMP/k2-msg.txt"
  cat > "$fixture" <<'EOF'
add: implement feature foo

Some body text.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
  "$hook" "$fixture" >/dev/null 2>&1
  local rc=$?
  assert_eq "1" "$rc" || { echo "    hook returned $rc (expected 1)"; return 1; }
}

# ---------------------------------------------------------------------------
# Staging + commits — 2 tests
# ---------------------------------------------------------------------------

test_T1_ai_staged_canonical_not_staged() {
  local parent="$_WI_TMP/t1"; mkdir -p "$parent"
  _run_bootstrap "$parent" "alpha" personal >/dev/null 2>&1
  # AI workspace has staged changes.
  local ai_status
  ai_status="$(git -C "$parent/alpha-ai" status --porcelain 2>/dev/null)"
  if [[ -z "$ai_status" ]]; then
    echo "    AI workspace has no staged or modified files (expected non-empty)"
    return 1
  fi
  # Canonical: nothing in index (no `A ` lines).
  local cn_index
  cn_index="$(git -C "$parent/alpha" diff --cached --name-only 2>/dev/null)"
  if [[ -n "$cn_index" ]]; then
    echo "    canonical has staged files (unexpected): $cn_index"
    return 1
  fi
}

test_T2_no_auto_commit_in_either_repo() {
  local parent="$_WI_TMP/t2"; mkdir -p "$parent"
  _run_bootstrap "$parent" "alpha" personal >/dev/null 2>&1
  # AI workspace: no commits yet → log fails or empty.
  local ai_log
  ai_log="$(git -C "$parent/alpha-ai" log --oneline 2>/dev/null || true)"
  if [[ -n "$ai_log" ]]; then
    echo "    AI workspace has unexpected commits: $ai_log"
    return 1
  fi
  # Canonical: same.
  local cn_log
  cn_log="$(git -C "$parent/alpha" log --oneline 2>/dev/null || true)"
  if [[ -n "$cn_log" ]]; then
    echo "    canonical has unexpected commits: $cn_log"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# .gitignore content — 1 test
# ---------------------------------------------------------------------------

test_G1_gitignore_contains_handoffs_literal() {
  local parent="$_WI_TMP/g1"; mkdir -p "$parent"
  _run_bootstrap "$parent" "alpha" personal >/dev/null 2>&1
  local body
  body="$(cat "$parent/alpha-ai/.gitignore")"
  assert_contains ".workspace/handoffs/" "$body" || return 1
}

# ---------------------------------------------------------------------------
# Failure modes — 2 tests
# ---------------------------------------------------------------------------

test_F1_parent_not_writable_aborts_no_dirs() {
  local parent="$_WI_TMP/f1"; mkdir -p "$parent"
  chmod -w "$parent"
  local rc
  ( _run_bootstrap "$parent" "alpha" personal >/dev/null 2>&1 ); rc=$?
  chmod +w "$parent"  # restore so cleanup works
  [[ $rc -ne 0 ]] || { echo "    expected non-zero exit on unwritable parent (got 0)"; return 1; }
  # No alpha-ai or alpha dirs should exist.
  if [[ -d "$parent/alpha-ai" || -d "$parent/alpha" ]]; then
    echo "    dirs created despite preflight abort"
    return 1
  fi
}

test_F2_invalid_name_aborts_no_dirs() {
  local parent="$_WI_TMP/f2"; mkdir -p "$parent"
  local rc
  ( _run_bootstrap "$parent" "Foo!" personal >/dev/null 2>&1 ); rc=$?
  [[ $rc -ne 0 ]] || { echo "    expected non-zero exit for invalid name (got 0)"; return 1; }
  # No Foo!-ai or Foo! dirs.
  if [[ -d "$parent/Foo!-ai" || -d "$parent/Foo!" ]]; then
    echo "    dirs created despite preflight abort"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Run all (18 tests)
# ---------------------------------------------------------------------------

wi_test_run test_H1_bootstrap_succeeds_exit_zero
wi_test_run test_H2_ai_workspace_dir_exists
wi_test_run test_H3_canonical_dir_exists
wi_test_run test_H4_manifest_present_and_valid_json
wi_test_run test_H5_manifest_passes_validate

wi_test_run test_M1_routing_complete_all_16_entries
wi_test_run test_M2_project_type_personal
wi_test_run test_M3_project_type_work
wi_test_run test_M4_canonical_default_branch_present
wi_test_run test_M5_ai_repo_actual_branch_is_main
wi_test_run test_M6_canonical_actual_branch_matches_manifest

wi_test_run test_K1_hooks_installed_both_repos_with_baked_path
wi_test_run test_K2_hook_blocks_co_authored_by_returns_one

wi_test_run test_T1_ai_staged_canonical_not_staged
wi_test_run test_T2_no_auto_commit_in_either_repo

wi_test_run test_G1_gitignore_contains_handoffs_literal

wi_test_run test_F1_parent_not_writable_aborts_no_dirs
wi_test_run test_F2_invalid_name_aborts_no_dirs

wi_test_summary
