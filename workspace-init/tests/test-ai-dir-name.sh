#!/usr/bin/env bash
# tests/test-ai-dir-name.sh — #174: the optional `--ai-dir-name NAME` override for
# the AI workspace directory (default `<name>-ai`).
#
# Covered:
#   D. Default control (2) — no flag: `<name>-ai`, exactly as before
#   N. Override        (4) — preflight + both create helpers + manifest name
#   V. Refusals        (8) — empty, `.`, `..`, `/`, leading `-`, missing value,
#                            duplicate flag, canonical collision (fresh + pair)
#   B. Rollback        (1) — removes the custom-named dir, never `<name>-ai`
#   X. Dispatcher      (2) — bin/wi under `set -euo pipefail`: refusal + success

source "$(dirname "$0")/_helpers.sh"
source "$WI_LIB_DIR/_helpers.sh"
source "$WI_LIB_DIR/skeleton.sh"
source "$WI_LIB_DIR/manifest.sh"
source "$WI_LIB_DIR/rollback.sh"

_WI_TMP="$(mktemp -d "${TMPDIR:-/tmp}/wi-ai-dir-name.XXXXXX")"
_wi_ai_dir_name_cleanup() {
  if [[ -d "$_WI_TMP" ]]; then
    chmod -R u+w "$_WI_TMP" 2>/dev/null || true
    rm -rf "$_WI_TMP"
  fi
}
trap _wi_ai_dir_name_cleanup EXIT

_mk_git_repo() { # $1=path
  mkdir -p "$1"
  git -C "$1" init -q 2>/dev/null
}

# ---------------------------------------------------------------------------
# D. Default control — the loosening must not move the no-flag path
# ---------------------------------------------------------------------------

test_D1_no_flag_creates_name_ai_exactly() {
  local parent="$_WI_TMP/d1"; mkdir -p "$parent"
  wi_skeleton_preflight "$parent" "foo" 2>/dev/null || { echo "    preflight failed"; return 1; }
  wi_skeleton_create_root_pair "$parent" "foo" >/dev/null 2>&1 || { echo "    create failed"; return 1; }
  assert_dir_exists "$parent/foo-ai" || return 1
  assert_dir_exists "$parent/foo" || return 1
  local entries
  entries="$(ls -A "$parent")"
  assert_eq "$(printf 'foo\nfoo-ai')" "$entries" || return 1
  local log="$parent/foo-ai/.workspace/init-log"
  assert_eq "$(printf 'MKDIR\t%s\nMKDIR\t%s\nMKDIR\t%s' "$parent/foo-ai" "$parent/foo" "$parent/foo-ai/.workspace")" \
    "$(cut -f1,2 "$log")" || return 1
}

test_D2_no_flag_ai_only_creates_name_ai() {
  local parent="$_WI_TMP/d2"; mkdir -p "$parent"
  wi_skeleton_create_root_ai_only "$parent" "foo" >/dev/null 2>&1 || { echo "    create failed"; return 1; }
  assert_eq "foo-ai" "$(ls -A "$parent")" || return 1
}

# ---------------------------------------------------------------------------
# N. Override
# ---------------------------------------------------------------------------

test_N1_preflight_checks_the_custom_target() {
  local parent="$_WI_TMP/n1"; mkdir -p "$parent/foo-internal"
  # The custom target exists → refuse; `<name>-ai` is absent and must not matter.
  if wi_skeleton_preflight "$parent" "foo" --ai-dir-name foo-internal 2>/dev/null; then
    echo "    preflight passed although the custom AI target exists"; return 1
  fi
  # The default target exists but the custom one does not → pass.
  local p2="$_WI_TMP/n1b"; mkdir -p "$p2/foo-ai"
  wi_skeleton_preflight "$p2" "foo" --ai-dir-name foo-internal 2>/dev/null || {
    echo "    preflight refused although the custom AI target is free"; return 1; }
}

test_N2_create_root_pair_uses_custom_name() {
  local parent="$_WI_TMP/n2"; mkdir -p "$parent"
  wi_skeleton_create_root_pair "$parent" "foo" --ai-dir-name foo-internal >/dev/null 2>&1 || {
    echo "    create_root_pair failed"; return 1; }
  assert_dir_exists "$parent/foo-internal/.workspace" || return 1
  assert_dir_exists "$parent/foo" || return 1
  [[ ! -e "$parent/foo-ai" ]] || { echo "    default <name>-ai was created too"; return 1; }
  grep -qxF "$(printf 'MKDIR\t%s' "$parent/foo-internal")" <(cut -f1,2 "$parent/foo-internal/.workspace/init-log") \
    || { echo "    custom root not logged"; return 1; }
}

test_N3_create_root_ai_only_uses_custom_name() {
  local parent="$_WI_TMP/n3"; mkdir -p "$parent"
  wi_skeleton_create_root_ai_only "$parent" "foo" --ai-dir-name Foo_Notes.v2 >/dev/null 2>&1 || {
    echo "    create_root_ai_only failed"; return 1; }
  assert_eq "Foo_Notes.v2" "$(ls -A "$parent")" || return 1
  assert_dir_exists "$parent/Foo_Notes.v2/.workspace" || return 1
}

test_N4_manifest_records_the_custom_name() {
  local parent="$_WI_TMP/n4"; mkdir -p "$parent"
  local canonical="$_WI_TMP/n4-canon/foo"; _mk_git_repo "$canonical"
  wi_skeleton_preflight "$parent" "foo" --pair-with "$canonical" --ai-dir-name foo-internal 2>/dev/null \
    || { echo "    preflight failed"; return 1; }
  wi_skeleton_create_root_ai_only "$parent" "foo" --ai-dir-name foo-internal >/dev/null 2>&1 || return 1
  wi_skeleton_seed_subdirs "$parent/foo-internal" >/dev/null 2>&1 || return 1
  wi_manifest_write "$parent/foo-internal" "$canonical" personal >/dev/null 2>&1 || {
    echo "    manifest_write failed"; return 1; }
  assert_eq "foo-internal" "$(wi_manifest_read "$parent/foo-internal" '.ai_workspace.name')" || return 1
  wi_manifest_validate "$parent/foo-internal" 2>/dev/null || { echo "    manifest invalid"; return 1; }
}

# ---------------------------------------------------------------------------
# V. Refusals — each refuses with a named error and creates nothing
# ---------------------------------------------------------------------------

# $1=label $2=dir-name; asserts preflight AND both create helpers refuse and
# the parent stays empty.
_assert_refused() {
  local label="$1" dn="$2"
  local parent="$_WI_TMP/v-$label"; mkdir -p "$parent"
  local err
  if err="$(wi_skeleton_preflight "$parent" "foo" --ai-dir-name "$dn" 2>&1 >/dev/null)"; then
    echo "    preflight accepted --ai-dir-name '$dn'"; return 1
  fi
  assert_contains 'ai-dir-name' "$err" || return 1
  # Refused for its own reason — not because a fallthrough target collided.
  assert_not_contains 'already exists' "$err" || return 1
  if wi_skeleton_create_root_pair "$parent" "foo" --ai-dir-name "$dn" >/dev/null 2>&1; then
    echo "    create_root_pair accepted --ai-dir-name '$dn'"; return 1
  fi
  if wi_skeleton_create_root_ai_only "$parent" "foo" --ai-dir-name "$dn" >/dev/null 2>&1; then
    echo "    create_root_ai_only accepted --ai-dir-name '$dn'"; return 1
  fi
  [[ -z "$(ls -A "$parent")" ]] || { echo "    refusal left entries: $(ls -A "$parent")"; return 1; }
}

test_V1_refuses_empty()         { _assert_refused empty ''; }
test_V2_refuses_dot()           { _assert_refused dot '.'; }
test_V3_refuses_dotdot()        { _assert_refused dotdot '..'; }
test_V4_refuses_slash()         { _assert_refused slash 'a/b'; }
test_V5_refuses_leading_dash()  { _assert_refused dash '-x'; }

test_V6_refuses_missing_value_and_duplicate_flag() {
  local parent="$_WI_TMP/v6"; mkdir -p "$parent"
  local err
  if err="$(wi_skeleton_preflight "$parent" "foo" --ai-dir-name 2>&1 >/dev/null)"; then
    echo "    preflight accepted a missing value"; return 1
  fi
  assert_contains '--ai-dir-name requires a value' "$err" || return 1
  if err="$(wi_skeleton_preflight "$parent" "foo" --ai-dir-name a --ai-dir-name b 2>&1 >/dev/null)"; then
    echo "    preflight accepted a duplicate flag"; return 1
  fi
  assert_contains 'given more than once' "$err" || return 1
  if wi_skeleton_create_root_pair "$parent" "foo" --ai-dir-name >/dev/null 2>&1; then
    echo "    create_root_pair accepted a missing value"; return 1
  fi
  if wi_skeleton_preflight "$parent" "foo" --ai-dir-name a --ai-dir-name b 2>/dev/null; then
    echo "    preflight accepted a duplicate flag"; return 1
  fi
  if wi_skeleton_create_root_ai_only "$parent" "foo" --ai-dir-name a --ai-dir-name b >/dev/null 2>&1; then
    echo "    create_root_ai_only accepted a duplicate flag"; return 1
  fi
  [[ -z "$(ls -A "$parent")" ]] || { echo "    refusal left entries"; return 1; }
}

test_V7_fresh_refuses_name_equal_to_canonical() {
  local parent="$_WI_TMP/v7"; mkdir -p "$parent"
  local err
  if err="$(wi_skeleton_preflight "$parent" "foo" --ai-dir-name foo 2>&1 >/dev/null)"; then
    echo "    preflight accepted an AI dir equal to the canonical"; return 1
  fi
  assert_contains 'canonical' "$err" || return 1
  if wi_skeleton_create_root_pair "$parent" "foo" --ai-dir-name foo >/dev/null 2>&1; then
    echo "    create_root_pair merged the AI workspace into the canonical"; return 1
  fi
  # A case-insensitive filesystem (macOS default) maps FOO and foo to one dir.
  if wi_skeleton_preflight "$parent" "foo" --ai-dir-name FOO 2>/dev/null; then
    echo "    preflight accepted an AI dir equal to the canonical up to case"; return 1
  fi
  if wi_skeleton_create_root_pair "$parent" "foo" --ai-dir-name FOO >/dev/null 2>&1; then
    echo "    create_root_pair accepted an AI dir equal to the canonical up to case"; return 1
  fi
  [[ -z "$(ls -A "$parent")" ]] || { echo "    refusal left entries: $(ls -A "$parent")"; return 1; }
}

test_V8_pair_refuses_the_existing_canonical_as_target() {
  local parent="$_WI_TMP/v8"; mkdir -p "$parent"
  _mk_git_repo "$parent/proj"
  local err
  if err="$(wi_skeleton_preflight "$parent" "foo" --pair-with "$parent/proj" --ai-dir-name proj 2>&1 >/dev/null)"; then
    echo "    preflight accepted the existing canonical as the AI target"; return 1
  fi
  assert_contains 'already exists' "$err" || return 1
}

# ---------------------------------------------------------------------------
# B. Rollback
# ---------------------------------------------------------------------------

test_B1_rollback_removes_the_custom_dir() {
  local parent="$_WI_TMP/b1"; mkdir -p "$parent"
  wi_skeleton_create_root_pair "$parent" "foo" --ai-dir-name foo-internal >/dev/null 2>&1 || return 1
  wi_skeleton_seed_subdirs "$parent/foo-internal" >/dev/null 2>&1 || return 1
  wi_rollback "$parent/foo-internal/.workspace/init-log" >/dev/null 2>&1 || {
    echo "    rollback failed"; return 1; }
  [[ ! -e "$parent/foo-internal" ]] || { echo "    custom AI dir survived rollback"; return 1; }
  [[ ! -e "$parent/foo" ]] || { echo "    canonical survived rollback"; return 1; }
  [[ -z "$(ls -A "$parent")" ]] || { echo "    rollback left entries: $(ls -A "$parent")"; return 1; }
}

# ---------------------------------------------------------------------------
# X. Dispatcher path — bin/wi runs `set -euo pipefail`
# ---------------------------------------------------------------------------

test_X1_dispatcher_refuses_bad_name_nonzero() {
  local parent="$_WI_TMP/x1"; mkdir -p "$parent"
  local err rc=0
  err="$("$WI_BIN" skeleton_preflight "$parent" "foo" --ai-dir-name '../escape' 2>&1 >/dev/null)" || rc=$?
  [[ "$rc" -ne 0 ]] || { echo "    dispatcher returned 0 for '../escape'"; return 1; }
  assert_contains 'ai-dir-name' "$err" || return 1
  rc=0
  "$WI_BIN" skeleton_create_root_ai_only "$parent" "foo" --ai-dir-name >/dev/null 2>&1 || rc=$?
  [[ "$rc" -ne 0 ]] || { echo "    dispatcher returned 0 for a missing value"; return 1; }
  [[ -z "$(ls -A "$parent")" ]] || { echo "    refusal left entries"; return 1; }
}

test_X2_dispatcher_creates_custom_dir() {
  local parent="$_WI_TMP/x2"; mkdir -p "$parent"
  "$WI_BIN" skeleton_preflight "$parent" "foo" --ai-dir-name foo-internal 2>/dev/null || {
    echo "    dispatcher preflight failed"; return 1; }
  "$WI_BIN" skeleton_create_root_pair "$parent" "foo" --ai-dir-name foo-internal >/dev/null 2>&1 || {
    echo "    dispatcher create failed"; return 1; }
  assert_eq "$(printf 'foo\nfoo-internal')" "$(ls -A "$parent")" || return 1
}

wi_test_run test_D1_no_flag_creates_name_ai_exactly
wi_test_run test_D2_no_flag_ai_only_creates_name_ai
wi_test_run test_N1_preflight_checks_the_custom_target
wi_test_run test_N2_create_root_pair_uses_custom_name
wi_test_run test_N3_create_root_ai_only_uses_custom_name
wi_test_run test_N4_manifest_records_the_custom_name
wi_test_run test_V1_refuses_empty
wi_test_run test_V2_refuses_dot
wi_test_run test_V3_refuses_dotdot
wi_test_run test_V4_refuses_slash
wi_test_run test_V5_refuses_leading_dash
wi_test_run test_V6_refuses_missing_value_and_duplicate_flag
wi_test_run test_V7_fresh_refuses_name_equal_to_canonical
wi_test_run test_V8_pair_refuses_the_existing_canonical_as_target
wi_test_run test_B1_rollback_removes_the_custom_dir
wi_test_run test_X1_dispatcher_refuses_bad_name_nonzero
wi_test_run test_X2_dispatcher_creates_custom_dir

wi_test_summary
