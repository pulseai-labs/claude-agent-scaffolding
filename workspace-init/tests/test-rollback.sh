#!/usr/bin/env bash
# tests/test-rollback.sh — unit tests for lib/rollback.sh
#
# Covers SPEC §8.9 rollback semantics (~11 tests):
#   1. Fresh-mode full rollback walks log in reverse and removes everything
#   2. Pair-with mode never touches the existing canonical
#   3. Empty log is a clean no-op
#   4. Partial log (init failed early) rolls back only the logged ops
#   5. MKDIR inverse uses rm -rf so non-empty dirs are still cleaned
#   6. WRITE_FILE inverse is idempotent on already-missing files
#   7. HOOK_INSTALL inverse removes the hook but keeps the hooks dir
#   8. GIT_INIT inverse removes .git but NOT the working dir
#   9. Reverse-order execution verified via side-channel order capture
#  10. User-facing tally message contains both numbers
#  11. Unknown / corrupted op line → warn + skip, continue rolling back the rest
#
# Mirrors the test-skeleton.sh sandbox + cleanup pattern.

source "$(dirname "$0")/_helpers.sh"
source "$WI_LIB_DIR/_helpers.sh"
source "$WI_LIB_DIR/rollback.sh"

# Shared sandbox.
_WI_TMP="$(mktemp -d "${TMPDIR:-/tmp}/wi-rollback-test.XXXXXX")"
_wi_rollback_cleanup() {
  if [[ -d "$_WI_TMP" ]]; then
    chmod -R u+w "$_WI_TMP" 2>/dev/null || true
    rm -rf "$_WI_TMP"
  fi
}
trap _wi_rollback_cleanup EXIT

# ---------------------------------------------------------------------------
# Helpers (test-only — build a simulated init-log)
# ---------------------------------------------------------------------------

# _build_fresh_workspace <parent> <name>
#   Constructs a fully populated fresh-mode workspace (ai-root + canonical),
#   git inits both, installs a dummy commit-msg hook in each, writes a couple
#   of stub files, and appends one TAB-separated init-log line per op.
#   Echoes the ai-root path on stdout.
_build_fresh_workspace() {
  local parent="$1"
  local name="$2"
  local ai="${parent}/${name}-ai"
  local can="${parent}/${name}"
  local log="${ai}/.workspace/init-log"

  mkdir -p "$ai" "$can" "${ai}/.workspace" "${ai}/.claude" "${ai}/docs"
  : > "${ai}/CLAUDE.md"
  : > "${ai}/.gitignore"
  : > "${ai}/.workspace/pairing.json"     # not logged; rides on .workspace dir
  git -C "$ai"  init -q
  git -C "$can" init -q
  mkdir -p "${ai}/.git/hooks" "${can}/.git/hooks"
  # Installed hooks carry the workspace-init marker line; rollback only removes
  # marker-bearing hooks (it must never delete a foreign one).
  printf '#!/usr/bin/env bash\n# workspace-init:managed-hook\nexit 0\n' > "${ai}/.git/hooks/commit-msg"
  printf '#!/usr/bin/env bash\n# workspace-init:managed-hook\nexit 0\n' > "${can}/.git/hooks/commit-msg"
  chmod +x "${ai}/.git/hooks/commit-msg" "${can}/.git/hooks/commit-msg"

  {
    printf 'MKDIR\t%s\n'        "$ai"
    printf 'MKDIR\t%s\n'        "$can"
    printf 'MKDIR\t%s\n'        "${ai}/.workspace"
    printf 'MKDIR\t%s\n'        "${ai}/.claude"
    printf 'MKDIR\t%s\n'        "${ai}/docs"
    printf 'WRITE_FILE\t%s\n'   "${ai}/CLAUDE.md"
    printf 'WRITE_FILE\t%s\n'   "${ai}/.gitignore"
    printf 'GIT_INIT\t%s\n'     "$ai"
    printf 'GIT_INIT\t%s\n'     "$can"
    printf 'HOOK_INSTALL\t%s\n' "$ai"
    printf 'HOOK_INSTALL\t%s\n' "$can"
    printf 'GIT_STAGE\t%s\n'    "$ai"
  } > "$log"

  echo "$ai"
}

# ---------------------------------------------------------------------------
# 1. Fresh-mode full rollback
# ---------------------------------------------------------------------------

test_1_fresh_mode_full_rollback_removes_everything() {
  local parent="$_WI_TMP/t1"
  mkdir -p "$parent"
  local ai; ai="$(_build_fresh_workspace "$parent" "foo")"
  local can="${parent}/foo"
  local log="${ai}/.workspace/init-log"

  wi_rollback "$log" >/dev/null 2>&1 || {
    echo "    rollback returned non-zero"
    return 1
  }

  # Both roots gone (including .git inside them).
  if [[ -d "$ai"  ]]; then echo "    ai-root still present: $ai";        return 1; fi
  if [[ -d "$can" ]]; then echo "    canonical still present: $can";     return 1; fi
}

# ---------------------------------------------------------------------------
# 2. Pair-with mode skips ops affecting the existing canonical
# ---------------------------------------------------------------------------

test_2_pair_with_skips_existing_canonical() {
  local parent="$_WI_TMP/t2"
  mkdir -p "$parent"

  # Pre-existing canonical owned by the "user" — must NOT be touched.
  local can="${parent}/foo"
  mkdir -p "$can/src"
  git -C "$can" init -q
  : > "$can/src/important.txt"
  mkdir -p "$can/.git/hooks"
  : > "$can/.git/hooks/commit-msg"; chmod +x "$can/.git/hooks/commit-msg"
  local user_hook_before; user_hook_before="$(stat -c %Y "$can/.git/hooks/commit-msg" 2>/dev/null || stat -f %m "$can/.git/hooks/commit-msg")"

  # Pair-with workspace (only AI side was MKDIR'd; canonical was NOT).
  local ai="${parent}/foo-ai"
  mkdir -p "$ai/.workspace" "$ai/.claude"
  : > "$ai/CLAUDE.md"
  git -C "$ai" init -q
  local log="$ai/.workspace/init-log"
  {
    printf 'MKDIR\t%s\n'        "$ai"
    printf 'MKDIR\t%s\n'        "$ai/.workspace"
    printf 'MKDIR\t%s\n'        "$ai/.claude"
    printf 'WRITE_FILE\t%s\n'   "$ai/CLAUDE.md"
    printf 'GIT_INIT\t%s\n'     "$ai"
    printf 'HOOK_INSTALL\t%s\n' "$can"
    printf 'GIT_STAGE\t%s\n'    "$ai"
  } > "$log"

  local out
  out="$(wi_rollback "$log" --pair-with "$can" 2>&1)" || {
    echo "    rollback returned non-zero"
    return 1
  }

  # AI workspace must be gone.
  if [[ -d "$ai" ]]; then echo "    ai-root still present after rollback"; return 1; fi
  # Canonical working tree untouched.
  assert_dir_exists  "$can"                          || return 1
  assert_file_exists "$can/src/important.txt"         || return 1
  # Conservative: canonical's commit-msg hook left in place per SPEC §8.9 step 3.
  assert_file_exists "$can/.git/hooks/commit-msg"     || return 1
  # Tally message present.
  assert_contains "pair-with safety" "$out"           || return 1
}

# ---------------------------------------------------------------------------
# 3. Empty log → clean no-op
# ---------------------------------------------------------------------------

test_3_empty_log_clean_noop() {
  local parent="$_WI_TMP/t3"
  mkdir -p "$parent"
  local log="$parent/init-log"
  : > "$log"
  if ! wi_rollback "$log" >/dev/null 2>&1; then
    echo "    expected exit 0 on empty log"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 4. Partial log (init failed early)
# ---------------------------------------------------------------------------

test_4_partial_log_only_undoes_logged_ops() {
  local parent="$_WI_TMP/t4"
  mkdir -p "$parent"
  local ai="$parent/foo-ai"
  mkdir -p "$ai/.workspace" "$ai/.claude"
  local log="$ai/.workspace/init-log"
  # Only the first 3 ops were logged before init bailed.
  {
    printf 'MKDIR\t%s\n' "$ai"
    printf 'MKDIR\t%s\n' "$ai/.workspace"
    printf 'MKDIR\t%s\n' "$ai/.claude"
  } > "$log"

  # A NON-LOGGED sibling directory exists at the same parent — must NOT be removed
  # (only logged paths are touched).
  mkdir -p "$parent/unrelated"

  wi_rollback "$log" >/dev/null 2>&1 || {
    echo "    rollback returned non-zero"
    return 1
  }
  if [[ -d "$ai" ]]; then
    echo "    ai-root still present: $ai"
    return 1
  fi
  assert_dir_exists "$parent/unrelated" || return 1
}

# ---------------------------------------------------------------------------
# 5. MKDIR inverse uses rm -rf so non-empty dirs are still cleaned
# ---------------------------------------------------------------------------

test_5_mkdir_inverse_rm_rf_on_non_empty() {
  local parent="$_WI_TMP/t5"
  mkdir -p "$parent"
  local ai="$parent/foo-ai"
  mkdir -p "$ai/.workspace"
  # User-side leftover content NOT in init-log — rm -rf strategy should still clean.
  echo "stray" > "$ai/leftover.txt"
  local log="$ai/.workspace/init-log"
  printf 'MKDIR\t%s\n' "$ai" > "$log"

  wi_rollback "$log" >/dev/null 2>&1 || {
    echo "    rollback returned non-zero"
    return 1
  }
  if [[ -d "$ai" ]]; then echo "    ai-root still present after rollback"; return 1; fi
}

# ---------------------------------------------------------------------------
# 6. WRITE_FILE inverse is idempotent on already-missing files
# ---------------------------------------------------------------------------

test_6_write_file_inverse_idempotent_on_missing() {
  local parent="$_WI_TMP/t6"
  mkdir -p "$parent"
  local ai="$parent/foo-ai"
  mkdir -p "$ai/.workspace"
  local log="$ai/.workspace/init-log"
  # File never existed (user already removed it) — rollback should still succeed.
  printf 'WRITE_FILE\t%s\n' "$ai/never-was.md" > "$log"

  if ! wi_rollback "$log" >/dev/null 2>&1; then
    echo "    rollback returned non-zero for missing-file WRITE_FILE inverse"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 7. HOOK_INSTALL inverse removes the hook but keeps the hooks dir
# ---------------------------------------------------------------------------

test_7_hook_install_inverse_removes_hook_keeps_dir() {
  local parent="$_WI_TMP/t7"
  mkdir -p "$parent"
  local repo="$parent/repo"
  mkdir -p "$repo"
  git -C "$repo" init -q
  mkdir -p "$repo/.git/hooks"
  # A hook workspace-init installed (marker line) — the inverse may remove it.
  printf '#!/usr/bin/env bash\n# workspace-init:managed-hook\nexit 0\n' > "$repo/.git/hooks/commit-msg"
  chmod +x "$repo/.git/hooks/commit-msg"
  # Sibling hook to verify we don't blow away the whole hooks/ dir.
  : > "$repo/.git/hooks/pre-push.sample"

  local log="$parent/init-log"
  printf 'HOOK_INSTALL\t%s\n' "$repo" > "$log"

  wi_rollback "$log" >/dev/null 2>&1 || {
    echo "    rollback returned non-zero"
    return 1
  }
  assert_file_absent  "$repo/.git/hooks/commit-msg"      || return 1
  assert_dir_exists   "$repo/.git/hooks"                  || return 1
  assert_file_exists  "$repo/.git/hooks/pre-push.sample"  || return 1
}

# ---------------------------------------------------------------------------
# 8. GIT_INIT inverse removes .git but NOT the working dir
# ---------------------------------------------------------------------------

test_8_git_init_inverse_removes_dot_git_only() {
  local parent="$_WI_TMP/t8"
  mkdir -p "$parent"
  local repo="$parent/repo"
  mkdir -p "$repo"
  git -C "$repo" init -q
  echo "keep me" > "$repo/file.txt"

  local log="$parent/init-log"
  printf 'GIT_INIT\t%s\n' "$repo" > "$log"

  wi_rollback "$log" >/dev/null 2>&1 || {
    echo "    rollback returned non-zero"
    return 1
  }
  assert_dir_exists  "$repo"           || return 1
  assert_file_exists "$repo/file.txt"  || return 1
  if [[ -d "$repo/.git" ]]; then
    echo "    .git not removed"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 9. Reverse-order execution verified via side-channel order capture
# ---------------------------------------------------------------------------

test_9_reverse_order_execution() {
  local parent="$_WI_TMP/t9"
  mkdir -p "$parent"
  # Five WRITE_FILE entries pointing at fresh files; capture the deletion order
  # via the file-system-level mtime-ordered observation.
  local f1="$parent/a.txt" f2="$parent/b.txt" f3="$parent/c.txt" f4="$parent/d.txt" f5="$parent/e.txt"
  : > "$f1"; : > "$f2"; : > "$f3"; : > "$f4"; : > "$f5"

  local log="$parent/init-log"
  {
    printf 'WRITE_FILE\t%s\n' "$f1"
    printf 'WRITE_FILE\t%s\n' "$f2"
    printf 'WRITE_FILE\t%s\n' "$f3"
    printf 'WRITE_FILE\t%s\n' "$f4"
    printf 'WRITE_FILE\t%s\n' "$f5"
  } > "$log"

  # Side-channel: monkey-patch the rm step by overriding rm via a shell function
  # local to this test. We capture each inverse call's argument to ORDER_FILE.
  local order_file="$parent/order"
  : > "$order_file"
  # Override `rm` only inside this test (function takes precedence over PATH).
  rm() {
    # Always log the final non-flag arg (the path being rm'd).
    local last="${@: -1}"
    echo "$last" >> "$order_file"
    command rm "$@"
  }
  wi_rollback "$log" >/dev/null 2>&1 || {
    unset -f rm
    echo "    rollback returned non-zero"
    return 1
  }
  unset -f rm

  local got; got="$(cat "$order_file")"
  local expected
  expected="$(printf '%s\n%s\n%s\n%s\n%s\n' "$f5" "$f4" "$f3" "$f2" "$f1")"
  if [[ "$got" != "$expected" ]]; then
    echo "    expected reverse order:"; echo "$expected"
    echo "    got:";                    echo "$got"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 10. User-facing tally message
# ---------------------------------------------------------------------------

test_10_user_facing_tally_message() {
  local parent="$_WI_TMP/t10"
  mkdir -p "$parent"
  local ai; ai="$(_build_fresh_workspace "$parent" "foo")"
  local log="${ai}/.workspace/init-log"
  local out
  out="$(wi_rollback "$log" 2>&1)"
  assert_contains "rolled back" "$out" || return 1
  # Twelve total ops in the fresh log built by _build_fresh_workspace.
  assert_contains "12"          "$out" || return 1
}

# ---------------------------------------------------------------------------
# 12. HOOK_INSTALL inverse never deletes a hook it did not write (#457)
# ---------------------------------------------------------------------------

test_12_hook_install_inverse_spares_foreign_hook() {
  local parent="$_WI_TMP/t12"
  mkdir -p "$parent"
  local repo="$parent/repo"
  mkdir -p "$repo"
  git -C "$repo" init -q
  mkdir -p "$repo/.git/hooks"
  # A hook NOT installed by workspace-init (no marker line) — the log claims a
  # HOOK_INSTALL but the bytes are the user's; rollback must leave them alone.
  printf '#!/bin/sh\necho "PREEXISTING-HOOK-MARKER"\nexit 0\n' > "$repo/.git/hooks/commit-msg"
  chmod +x "$repo/.git/hooks/commit-msg"
  cp "$repo/.git/hooks/commit-msg" "$parent/hook.orig"

  local log="$parent/init-log"
  printf 'HOOK_INSTALL\t%s\n' "$repo" > "$log"

  local out
  out="$(wi_rollback "$log" 2>&1)" || {
    echo "    rollback returned non-zero"
    return 1
  }
  cmp -s "$parent/hook.orig" "$repo/.git/hooks/commit-msg" || {
    echo "    foreign hook deleted or modified by rollback"; return 1; }
  assert_contains "not installed by workspace-init" "$out" || return 1
}

# ---------------------------------------------------------------------------
# 11. Corrupted op line → warn + skip + continue
# ---------------------------------------------------------------------------

test_11_corrupted_op_line_skipped_with_warning() {
  local parent="$_WI_TMP/t11"
  mkdir -p "$parent"
  local ai="$parent/foo-ai"
  mkdir -p "$ai/.workspace"
  echo "stub" > "$ai/CLAUDE.md"
  local log="$ai/.workspace/init-log"
  {
    printf 'MKDIR\t%s\n'      "$ai"
    printf 'BOGUS_OP\tfoo\n'                              # corrupted line
    printf 'WRITE_FILE\t%s\n' "$ai/CLAUDE.md"
  } > "$log"

  local out
  out="$(wi_rollback "$log" 2>&1)" || {
    echo "    rollback returned non-zero on corrupted line"
    return 1
  }
  # Should have warned about BOGUS_OP and still removed the rest.
  assert_contains "BOGUS_OP" "$out" || return 1
  if [[ -d "$ai" ]]; then
    echo "    ai-root still present after rollback with corrupted line"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Run all
# ---------------------------------------------------------------------------

wi_test_run test_1_fresh_mode_full_rollback_removes_everything
wi_test_run test_2_pair_with_skips_existing_canonical
wi_test_run test_3_empty_log_clean_noop
wi_test_run test_4_partial_log_only_undoes_logged_ops
wi_test_run test_5_mkdir_inverse_rm_rf_on_non_empty
wi_test_run test_6_write_file_inverse_idempotent_on_missing
wi_test_run test_7_hook_install_inverse_removes_hook_keeps_dir
wi_test_run test_8_git_init_inverse_removes_dot_git_only
wi_test_run test_9_reverse_order_execution
wi_test_run test_10_user_facing_tally_message
wi_test_run test_11_corrupted_op_line_skipped_with_warning
wi_test_run test_12_hook_install_inverse_spares_foreign_hook

wi_test_summary
