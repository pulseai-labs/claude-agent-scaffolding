#!/usr/bin/env bash
# tests/test-pair-with-existing.sh — end-to-end integration test for PAIR-WITH
# (Scenario A) mode bootstrap.
#
# Drives the pair-with bootstrap pipeline (SPEC §8 + §9.4 marker abort) directly
# by calling the wi_* library functions in order, against a pre-existing
# canonical git repo with real working-tree content. Asserts the resulting
# state plus the five §9.4 abort conditions.
#
# Covered (~15 tests):
#   Happy path     (4) : exit, ai created, canonical preserved, file content intact
#   Manifest body  (3) : canonical.root, default_branch, git_remote (null + url variants)
#   Hooks          (1) : both repos have baked-path hook
#   §9.4 aborts    (5) : memory-bank, MASTER-SPEC at root, MASTER-SPEC under docs,
#                        onboarding-state.json, 2+ markers (abort + name in msg)
#   No partial     (2) : ai not created on abort, canonical hook absent on abort

source "$(dirname "$0")/_helpers.sh"
source "$WI_LIB_DIR/_helpers.sh"
source "$WI_LIB_DIR/skeleton.sh"
source "$WI_LIB_DIR/manifest.sh"
source "$WI_LIB_DIR/stubs.sh"
source "$WI_LIB_DIR/git-init.sh"
source "$WI_LIB_DIR/trace-filter.sh"
source "$WI_LIB_DIR/rollback.sh"

# Shared sandbox.
_WI_TMP="$(mktemp -d "${TMPDIR:-/tmp}/wi-pair-with.XXXXXX")"
_wi_pair_cleanup() {
  if [[ -d "$_WI_TMP" ]]; then
    chmod -R u+w "$_WI_TMP" 2>/dev/null || true
    rm -rf "$_WI_TMP"
  fi
}
trap _wi_pair_cleanup EXIT

# ---------------------------------------------------------------------------
# Helper: create an existing canonical git repo with content + initial commit.
# Echoes the absolute canonical path on stdout.
# ---------------------------------------------------------------------------
_make_existing_canonical() {
  local d="$1"; local name="$2"
  local canonical="$d/$name"
  mkdir -p "$canonical/src" "$canonical/docs"
  echo 'production code' > "$canonical/src/main.txt"
  echo '# Docs' > "$canonical/docs/README.md"
  git -C "$canonical" init -q
  # Set initial branch to main regardless of git's init.defaultBranch config.
  git -C "$canonical" symbolic-ref HEAD refs/heads/main
  git -C "$canonical" -c user.email=t@t -c user.name=t add .
  git -C "$canonical" -c user.email=t@t -c user.name=t commit -q -m "initial canonical commit"
  echo "$canonical"
}

# ---------------------------------------------------------------------------
# Helper: SPEC §9.4 marker check. Mirrors what the SKILL.md body performs
# before delegating to wi_skeleton_preflight (the lib function itself doesn't
# enforce these markers — that's deliberate, per spec).
# ---------------------------------------------------------------------------
_check_no_ai_scaffolding() {
  local canonical="$1"
  local found=()
  [[ -d "$canonical/.claude/memory-bank" ]] && found+=(".claude/memory-bank/")
  [[ -f "$canonical/MASTER-SPEC.md" ]]      && found+=("MASTER-SPEC.md")
  [[ -f "$canonical/docs/MASTER-SPEC.md" ]] && found+=("docs/MASTER-SPEC.md")
  [[ -f "$canonical/.claude/.onboarding-state.json" ]] && found+=(".claude/.onboarding-state.json")
  if (( ${#found[@]} > 0 )); then
    printf 'ABORT: existing canonical contains AI scaffolding markers: %s\n' "${found[*]}" >&2
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Helper: drive the pair-with bootstrap pipeline.
# Includes the §9.4 marker check before preflight.
# ---------------------------------------------------------------------------
_run_pair_with_bootstrap() {
  local parent="$1"; local name="$2"; local canonical="$3"; local project_type="${4:-work}"
  local ai_root="$parent/$name-ai"

  _check_no_ai_scaffolding "$canonical" || return 1
  wi_skeleton_preflight "$parent" "$name" --pair-with "$canonical" || return 1
  wi_skeleton_create_root_ai_only "$parent" "$name" || return 1
  wi_skeleton_seed_subdirs "$ai_root" || return 1

  local default_branch
  default_branch="$(wi_git_detect_default_branch "$canonical" </dev/null)"
  [[ -z "$default_branch" ]] && default_branch="main"

  local detected_remote
  detected_remote="$(wi_git_detect_remote "$canonical")"
  if [[ -n "$detected_remote" ]]; then
    wi_manifest_write "$ai_root" "$canonical" "$project_type" \
      --canonical-git-remote "$detected_remote" --default-branch "$default_branch" || return 1
  else
    wi_manifest_write "$ai_root" "$canonical" "$project_type" \
      --default-branch "$default_branch" || return 1
  fi

  wi_stub_claude_md "$ai_root" "$name" || return 1
  wi_stub_agents_md "$ai_root" "$name" || return 1
  wi_stub_readme    "$ai_root" "$name" || return 1
  wi_git_init_ai_only "$ai_root" || return 1
  wi_trace_filter_install_pair "$ai_root" "$canonical" || return 1
  wi_git_stage_ai_workspace "$ai_root" || return 1
  return 0
}

# ---------------------------------------------------------------------------
# Happy path — 4 tests
# ---------------------------------------------------------------------------

test_PH1_bootstrap_succeeds_against_clean_canonical() {
  local parent="$_WI_TMP/ph1"; mkdir -p "$parent"
  local canonical; canonical="$(_make_existing_canonical "$parent" "proj1")"
  if ! _run_pair_with_bootstrap "$parent" "proj1" "$canonical" work >/dev/null 2>&1; then
    echo "    pair-with bootstrap returned non-zero"
    return 1
  fi
}

test_PH2_ai_created_canonical_working_tree_unchanged() {
  local parent="$_WI_TMP/ph2"; mkdir -p "$parent"
  local canonical; canonical="$(_make_existing_canonical "$parent" "proj1")"

  # Snapshot canonical working-tree state (everything except .git) before bootstrap.
  local before
  before="$(cd "$canonical" && find . -not -path './.git' -not -path './.git/*' \
            | sort | xargs -I{} sh -c 'printf "%s\t" "{}"; stat -c "%Y %s" "{}" 2>/dev/null || stat -f "%m %z" "{}"')"
  _run_pair_with_bootstrap "$parent" "proj1" "$canonical" work >/dev/null 2>&1
  local after
  after="$(cd "$canonical" && find . -not -path './.git' -not -path './.git/*' \
           | sort | xargs -I{} sh -c 'printf "%s\t" "{}"; stat -c "%Y %s" "{}" 2>/dev/null || stat -f "%m %z" "{}"')"

  assert_dir_exists "$parent/proj1-ai" || return 1
  if [[ "$before" != "$after" ]]; then
    echo "    canonical working tree mutated by bootstrap"
    diff <(echo "$before") <(echo "$after")
    return 1
  fi
}

test_PH3_ai_has_skeleton_manifest_stubs() {
  local parent="$_WI_TMP/ph3"; mkdir -p "$parent"
  local canonical; canonical="$(_make_existing_canonical "$parent" "proj1")"
  _run_pair_with_bootstrap "$parent" "proj1" "$canonical" work >/dev/null 2>&1
  local ai="$parent/proj1-ai"
  assert_dir_exists  "$ai/.workspace" || return 1
  assert_dir_exists  "$ai/.claude"    || return 1
  assert_dir_exists  "$ai/docs"       || return 1
  assert_file_exists "$ai/.workspace/pairing.json" || return 1
  assert_file_exists "$ai/CLAUDE.md"  || return 1
  assert_file_exists "$ai/AGENTS.md"  || return 1
  assert_file_exists "$ai/README.md"  || return 1
  assert_file_exists "$ai/.gitignore" || return 1
}

test_PH4_canonical_file_content_and_mtime_preserved() {
  local parent="$_WI_TMP/ph4"; mkdir -p "$parent"
  local canonical; canonical="$(_make_existing_canonical "$parent" "proj1")"

  # Capture content + mtimes of canonical's working-tree files.
  local before_content_main; before_content_main="$(cat "$canonical/src/main.txt")"
  local before_content_docs; before_content_docs="$(cat "$canonical/docs/README.md")"
  local before_mtime_main; before_mtime_main="$(stat -c "%Y" "$canonical/src/main.txt" 2>/dev/null || stat -f "%m" "$canonical/src/main.txt")"
  local before_mtime_docs; before_mtime_docs="$(stat -c "%Y" "$canonical/docs/README.md" 2>/dev/null || stat -f "%m" "$canonical/docs/README.md")"

  _run_pair_with_bootstrap "$parent" "proj1" "$canonical" work >/dev/null 2>&1

  local after_content_main; after_content_main="$(cat "$canonical/src/main.txt")"
  local after_content_docs; after_content_docs="$(cat "$canonical/docs/README.md")"
  local after_mtime_main;   after_mtime_main="$(stat -c "%Y" "$canonical/src/main.txt" 2>/dev/null || stat -f "%m" "$canonical/src/main.txt")"
  local after_mtime_docs;   after_mtime_docs="$(stat -c "%Y" "$canonical/docs/README.md" 2>/dev/null || stat -f "%m" "$canonical/docs/README.md")"

  assert_eq "$before_content_main" "$after_content_main" || return 1
  assert_eq "$before_content_docs" "$after_content_docs" || return 1
  assert_eq "$before_mtime_main"   "$after_mtime_main"   || return 1
  assert_eq "$before_mtime_docs"   "$after_mtime_docs"   || return 1
}

# ---------------------------------------------------------------------------
# Manifest content — 3 tests
# ---------------------------------------------------------------------------

test_PM1_canonical_root_points_at_existing_path() {
  local parent="$_WI_TMP/pm1"; mkdir -p "$parent"
  local canonical; canonical="$(_make_existing_canonical "$parent" "proj1")"
  _run_pair_with_bootstrap "$parent" "proj1" "$canonical" work >/dev/null 2>&1
  local v
  v="$(jq -r '.canonical.root' "$parent/proj1-ai/.workspace/pairing.json")"
  # Canonicalize both sides for macOS /var → /private/var.
  local v_canon canonical_canon
  v_canon="$(wi_realpath "$v")"
  canonical_canon="$(wi_realpath "$canonical")"
  assert_eq "$canonical_canon" "$v_canon" || return 1
}

test_PM2_default_branch_detected_main() {
  local parent="$_WI_TMP/pm2"; mkdir -p "$parent"
  local canonical; canonical="$(_make_existing_canonical "$parent" "proj1")"
  _run_pair_with_bootstrap "$parent" "proj1" "$canonical" work >/dev/null 2>&1
  local v
  v="$(jq -r '.canonical.default_branch' "$parent/proj1-ai/.workspace/pairing.json")"
  assert_eq "main" "$v" || return 1
}

test_PM3_git_remote_null_when_no_origin_and_url_when_set() {
  # Variant A: no origin → null.
  local parent_a="$_WI_TMP/pm3a"; mkdir -p "$parent_a"
  local canonical_a; canonical_a="$(_make_existing_canonical "$parent_a" "proj1")"
  _run_pair_with_bootstrap "$parent_a" "proj1" "$canonical_a" work >/dev/null 2>&1
  local v_a
  v_a="$(jq -r '.canonical.git_remote' "$parent_a/proj1-ai/.workspace/pairing.json")"
  assert_eq "null" "$v_a" || { echo "    expected null git_remote on bare repo"; return 1; }

  # Variant B: with origin → url.
  local parent_b="$_WI_TMP/pm3b"; mkdir -p "$parent_b"
  local canonical_b; canonical_b="$(_make_existing_canonical "$parent_b" "proj1")"
  git -C "$canonical_b" remote add origin "git@github.com:example/proj1.git"
  _run_pair_with_bootstrap "$parent_b" "proj1" "$canonical_b" work >/dev/null 2>&1
  local v_b
  v_b="$(jq -r '.canonical.git_remote' "$parent_b/proj1-ai/.workspace/pairing.json")"
  assert_eq "git@github.com:example/proj1.git" "$v_b" || return 1
}

# ---------------------------------------------------------------------------
# Hooks — 1 test
# ---------------------------------------------------------------------------

test_PK1_both_repos_have_baked_hook() {
  local parent="$_WI_TMP/pk1"; mkdir -p "$parent"
  local canonical; canonical="$(_make_existing_canonical "$parent" "proj1")"
  _run_pair_with_bootstrap "$parent" "proj1" "$canonical" work >/dev/null 2>&1

  local ai_hook="$parent/proj1-ai/.git/hooks/commit-msg"
  local cn_hook="$canonical/.git/hooks/commit-msg"
  assert_file_exists "$ai_hook" || return 1
  assert_file_exists "$cn_hook" || return 1
  [[ -x "$ai_hook" ]] || { echo "    ai hook not +x"; return 1; }
  [[ -x "$cn_hook" ]] || { echo "    canonical hook not +x"; return 1; }

  local ai_root_canon
  ai_root_canon="$(wi_realpath "$parent/proj1-ai")"
  # The path is baked shell-quoted (printf %q) so any byte survives — evaluate
  # the assignment line exactly as bash would rather than unpicking quotes.
  local baked_ai baked_cn
  baked_ai="$(eval "$(grep -m1 -E '^AI_WORKSPACE_PATH=' "$ai_hook")"; printf '%s' "$AI_WORKSPACE_PATH")"
  baked_cn="$(eval "$(grep -m1 -E '^AI_WORKSPACE_PATH=' "$cn_hook")"; printf '%s' "$AI_WORKSPACE_PATH")"
  local baked_ai_canon baked_cn_canon
  baked_ai_canon="$(wi_realpath "$baked_ai")"
  baked_cn_canon="$(wi_realpath "$baked_cn")"
  assert_eq "$ai_root_canon" "$baked_ai_canon" || { echo "    ai hook baked-path mismatch"; return 1; }
  assert_eq "$ai_root_canon" "$baked_cn_canon" || { echo "    canonical hook baked-path mismatch"; return 1; }
}

# ---------------------------------------------------------------------------
# §9.4 abort conditions — 5 tests
# ---------------------------------------------------------------------------

test_PA1_memory_bank_marker_aborts_canonical_untouched() {
  local parent="$_WI_TMP/pa1"; mkdir -p "$parent"
  local canonical; canonical="$(_make_existing_canonical "$parent" "proj1")"
  mkdir -p "$canonical/.claude/memory-bank"
  local rc; ( _run_pair_with_bootstrap "$parent" "proj1" "$canonical" work >/dev/null 2>&1 ); rc=$?
  [[ $rc -ne 0 ]] || { echo "    expected non-zero exit (memory-bank marker)"; return 1; }
  # AI workspace must NOT be created.
  if [[ -d "$parent/proj1-ai" ]]; then
    echo "    ai workspace created despite abort"
    return 1
  fi
  # Canonical hook must NOT have been installed.
  if [[ -f "$canonical/.git/hooks/commit-msg" ]]; then
    echo "    canonical hook installed despite abort"
    return 1
  fi
}

test_PA2_master_spec_root_marker_aborts() {
  local parent="$_WI_TMP/pa2"; mkdir -p "$parent"
  local canonical; canonical="$(_make_existing_canonical "$parent" "proj1")"
  : > "$canonical/MASTER-SPEC.md"
  local err rc
  err="$(_run_pair_with_bootstrap "$parent" "proj1" "$canonical" work 2>&1 >/dev/null)"
  rc=$?
  [[ $rc -ne 0 ]] || { echo "    expected non-zero exit (MASTER-SPEC.md at root)"; return 1; }
  assert_contains "MASTER-SPEC.md" "$err" || { echo "    abort msg missing marker name"; return 1; }
}

test_PA3_docs_master_spec_marker_aborts() {
  local parent="$_WI_TMP/pa3"; mkdir -p "$parent"
  local canonical; canonical="$(_make_existing_canonical "$parent" "proj1")"
  : > "$canonical/docs/MASTER-SPEC.md"
  local err rc
  err="$(_run_pair_with_bootstrap "$parent" "proj1" "$canonical" work 2>&1 >/dev/null)"
  rc=$?
  [[ $rc -ne 0 ]] || { echo "    expected non-zero exit (docs/MASTER-SPEC.md)"; return 1; }
  assert_contains "docs/MASTER-SPEC.md" "$err" || return 1
}

test_PA4_onboarding_state_marker_aborts() {
  local parent="$_WI_TMP/pa4"; mkdir -p "$parent"
  local canonical; canonical="$(_make_existing_canonical "$parent" "proj1")"
  mkdir -p "$canonical/.claude"
  : > "$canonical/.claude/.onboarding-state.json"
  local err rc
  err="$(_run_pair_with_bootstrap "$parent" "proj1" "$canonical" work 2>&1 >/dev/null)"
  rc=$?
  [[ $rc -ne 0 ]] || { echo "    expected non-zero exit (.onboarding-state.json)"; return 1; }
  assert_contains ".onboarding-state.json" "$err" || return 1
}

test_PA5_two_or_more_markers_abort_msg_names_at_least_one() {
  local parent="$_WI_TMP/pa5"; mkdir -p "$parent"
  local canonical; canonical="$(_make_existing_canonical "$parent" "proj1")"
  mkdir -p "$canonical/.claude/memory-bank"
  : > "$canonical/MASTER-SPEC.md"
  local err rc
  err="$(_run_pair_with_bootstrap "$parent" "proj1" "$canonical" work 2>&1 >/dev/null)"
  rc=$?
  [[ $rc -ne 0 ]] || { echo "    expected non-zero exit (2 markers)"; return 1; }
  # At least one of the marker names must appear in the abort message.
  if [[ "$err" != *".claude/memory-bank/"* && "$err" != *"MASTER-SPEC.md"* ]]; then
    echo "    abort msg names neither marker; msg was: $err"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# No partial state — 2 tests
# ---------------------------------------------------------------------------

test_PN1_ai_workspace_not_created_after_abort() {
  local parent="$_WI_TMP/pn1"; mkdir -p "$parent"
  local canonical; canonical="$(_make_existing_canonical "$parent" "proj1")"
  mkdir -p "$canonical/.claude/memory-bank"
  ( _run_pair_with_bootstrap "$parent" "proj1" "$canonical" work >/dev/null 2>&1 ) || true
  # Verify $parent contains only proj1 (canonical), no proj1-ai.
  local entries
  entries="$(ls "$parent" 2>/dev/null)"
  assert_eq "proj1" "$entries" || { echo "    parent contains: $entries (expected only 'proj1')"; return 1; }
}

test_PN2_canonical_hook_not_installed_after_abort() {
  local parent="$_WI_TMP/pn2"; mkdir -p "$parent"
  local canonical; canonical="$(_make_existing_canonical "$parent" "proj1")"
  : > "$canonical/MASTER-SPEC.md"
  ( _run_pair_with_bootstrap "$parent" "proj1" "$canonical" work >/dev/null 2>&1 ) || true
  if [[ -f "$canonical/.git/hooks/commit-msg" ]]; then
    echo "    canonical hook installed despite abort"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Run all (15 tests)
# ---------------------------------------------------------------------------

wi_test_run test_PH1_bootstrap_succeeds_against_clean_canonical
wi_test_run test_PH2_ai_created_canonical_working_tree_unchanged
wi_test_run test_PH3_ai_has_skeleton_manifest_stubs
wi_test_run test_PH4_canonical_file_content_and_mtime_preserved

wi_test_run test_PM1_canonical_root_points_at_existing_path
wi_test_run test_PM2_default_branch_detected_main
wi_test_run test_PM3_git_remote_null_when_no_origin_and_url_when_set

wi_test_run test_PK1_both_repos_have_baked_hook

wi_test_run test_PA1_memory_bank_marker_aborts_canonical_untouched
wi_test_run test_PA2_master_spec_root_marker_aborts
wi_test_run test_PA3_docs_master_spec_marker_aborts
wi_test_run test_PA4_onboarding_state_marker_aborts
wi_test_run test_PA5_two_or_more_markers_abort_msg_names_at_least_one

wi_test_run test_PN1_ai_workspace_not_created_after_abort
wi_test_run test_PN2_canonical_hook_not_installed_after_abort

wi_test_summary
