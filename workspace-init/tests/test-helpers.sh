#!/usr/bin/env bash
# tests/test-helpers.sh — unit tests for lib/_helpers.sh
# Covers: wi_log_{info,warn,error}, wi_realpath, wi_lock_{acquire,release},
#         wi_log_op, wi_render_template.

source "$(dirname "$0")/_helpers.sh"
source "$WI_LIB_DIR/_helpers.sh"

# Shared sandbox — direct mktemp avoids the $() subshell trap-loss issue
# (same pattern as claude-security-audit/tests/test-helpers.sh).
_WI_TMP="$(mktemp -d "${TMPDIR:-/tmp}/wi-helpers-test.XXXXXX")"
trap 'rm -rf "$_WI_TMP"' EXIT

# --- wi_log_info / warn / error ---

test_log_info_writes_to_stderr_with_prefix() {
  local out
  # Capture stderr only — redirect stdout to /dev/null first, then 2>&1 onto FD1.
  out="$(wi_log_info "hello world" 2>&1 >/dev/null)"
  assert_contains "INFO:" "$out" || return 1
  assert_contains "hello world" "$out" || return 1
}

test_log_warn_writes_to_stderr_with_prefix() {
  local out
  out="$(wi_log_warn "watch out" 2>&1 >/dev/null)"
  assert_contains "WARN:" "$out" || return 1
  assert_contains "watch out" "$out" || return 1
}

test_log_error_writes_to_stderr_with_prefix() {
  local out
  out="$(wi_log_error "kaboom" 2>&1 >/dev/null)"
  assert_contains "ERROR:" "$out" || return 1
  assert_contains "kaboom" "$out" || return 1
}

test_log_info_does_not_write_to_stdout() {
  local out
  out="$(wi_log_info "stderr-only" 2>/dev/null)"
  assert_eq "" "$out" || return 1
}

# --- wi_realpath ---

test_realpath_resolves_absolute_existing_path() {
  local f="$_WI_TMP/abs-file.txt"
  touch "$f"
  # Normalize both sides through the same function: canonical /var → /private/var
  # on macOS is implementation-defined; we assert idempotence + existence.
  local resolved; resolved="$(wi_realpath "$f")"
  [[ -n "$resolved" ]] || { echo "    empty result"; return 1; }
  [[ -f "$resolved" ]] || { echo "    resolved path missing: $resolved"; return 1; }
  # Idempotent
  local resolved2; resolved2="$(wi_realpath "$resolved")"
  assert_eq "$resolved" "$resolved2" || return 1
}

test_realpath_resolves_relative_path() {
  local subdir="$_WI_TMP/relsub"
  mkdir -p "$subdir"
  touch "$subdir/foo"
  local resolved
  resolved="$(cd "$subdir" && wi_realpath "./foo")"
  # Must be absolute and exist
  [[ "$resolved" == /* ]] || { echo "    not absolute: $resolved"; return 1; }
  [[ -f "$resolved" ]] || { echo "    resolved file missing: $resolved"; return 1; }
}

test_realpath_handles_dot_dot_traversal() {
  mkdir -p "$_WI_TMP/a" "$_WI_TMP/b"
  touch "$_WI_TMP/b/leaf"
  local resolved; resolved="$(wi_realpath "$_WI_TMP/a/../b/leaf")"
  local expected; expected="$(wi_realpath "$_WI_TMP/b/leaf")"
  assert_eq "$expected" "$resolved" || return 1
  # basename sanity (accepts /tmp or /private/tmp difference)
  assert_eq "leaf" "$(basename "$resolved")" || return 1
}

# --- wi_lock_acquire / wi_lock_release ---

test_lock_acquire_then_release_succeeds() {
  local lock="$_WI_TMP/free.lock"
  wi_lock_acquire "$lock" || { echo "    first acquire failed"; return 1; }
  [[ -f "$lock" ]] || { echo "    lock file not created"; return 1; }
  wi_lock_release "$lock" || { echo "    release failed"; return 1; }
  [[ ! -f "$lock" ]] || { echo "    lock file still present"; return 1; }
}

test_lock_acquire_second_call_fails_while_held() {
  local lock="$_WI_TMP/contended.lock"
  wi_lock_acquire "$lock" || { echo "    first acquire failed"; return 1; }
  # Second call should fail. Use a brief override of the retry budget by
  # bypassing the function — instead, we just call it and expect non-zero.
  # The helper sleeps 5x1s on contention; to keep the test fast we time-limit.
  local rc=0
  if WI_LOCK_RETRIES=1 wi_lock_acquire "$lock" 2>/dev/null; then
    rc=0
  else
    rc=1
  fi
  wi_lock_release "$lock"
  [[ "$rc" -ne 0 ]] || { echo "    second acquire unexpectedly succeeded"; return 1; }
}

test_lock_release_is_idempotent() {
  local lock="$_WI_TMP/idem.lock"
  # Never acquired — release should still succeed silently.
  wi_lock_release "$lock" || { echo "    release on unheld lock failed"; return 1; }
  # Release twice in a row
  wi_lock_acquire "$lock" || return 1
  wi_lock_release "$lock" || return 1
  wi_lock_release "$lock" || { echo "    second release failed"; return 1; }
}

# --- wi_log_op ---

test_log_op_appends_tab_separated_line() {
  local log="$_WI_TMP/init-log.tsv"
  wi_log_op "$log" "CREATE_DIR" "/some/path"
  wi_log_op "$log" "WRITE_FILE" "/some/file" "detail-here"
  local lines; lines="$(wc -l < "$log" | tr -d ' ')"
  assert_eq "2" "$lines" || return 1
  # Verify tab separation on first line (CREATE_DIR\t/some/path)
  grep -q $'^CREATE_DIR\t/some/path$' "$log" || { echo "    first line not tab-separated"; cat "$log"; return 1; }
  # Verify tab separation with detail on second line
  grep -q $'^WRITE_FILE\t/some/file\tdetail-here$' "$log" || { echo "    second line malformed"; cat "$log"; return 1; }
}

test_log_op_creates_parent_dir_if_missing() {
  local log="$_WI_TMP/nested/dir/init-log.tsv"
  wi_log_op "$log" "OP" "/p" || return 1
  [[ -f "$log" ]] || { echo "    log file not created"; return 1; }
}

# --- wi_render_template ---

test_render_template_substitutes_single_var() {
  local tmpl="$_WI_TMP/tmpl1.txt"
  local out="$_WI_TMP/out1.txt"
  printf 'Hello ${NAME}\n' > "$tmpl"
  wi_render_template "$tmpl" "$out" "NAME=World" || return 1
  local content; content="$(cat "$out")"
  assert_eq "Hello World" "$content" || return 1
}

test_render_template_substitutes_multiple_vars() {
  local tmpl="$_WI_TMP/tmpl2.txt"
  local out="$_WI_TMP/out2.txt"
  printf 'Project: ${PROJECT}, Owner: ${OWNER}\n' > "$tmpl"
  wi_render_template "$tmpl" "$out" "PROJECT=pulse" "OWNER=praveen" || return 1
  local content; content="$(cat "$out")"
  assert_eq "Project: pulse, Owner: praveen" "$content" || return 1
}

test_render_template_missing_template_returns_error() {
  local out="$_WI_TMP/wont-exist.txt"
  if wi_render_template "$_WI_TMP/no-such-template" "$out" "X=y" 2>/dev/null; then
    echo "    expected non-zero exit for missing template"; return 1
  fi
  [[ ! -f "$out" ]] || { echo "    output file should not exist"; return 1; }
}

# --- run all ---
wi_test_run test_log_info_writes_to_stderr_with_prefix
wi_test_run test_log_warn_writes_to_stderr_with_prefix
wi_test_run test_log_error_writes_to_stderr_with_prefix
wi_test_run test_log_info_does_not_write_to_stdout
wi_test_run test_realpath_resolves_absolute_existing_path
wi_test_run test_realpath_resolves_relative_path
wi_test_run test_realpath_handles_dot_dot_traversal
wi_test_run test_lock_acquire_then_release_succeeds
wi_test_run test_lock_acquire_second_call_fails_while_held
wi_test_run test_lock_release_is_idempotent
wi_test_run test_log_op_appends_tab_separated_line
wi_test_run test_log_op_creates_parent_dir_if_missing
wi_test_run test_render_template_substitutes_single_var
wi_test_run test_render_template_substitutes_multiple_vars
wi_test_run test_render_template_missing_template_returns_error

wi_test_summary
