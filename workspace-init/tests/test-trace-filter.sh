#!/usr/bin/env bash
# tests/test-trace-filter.sh — commit-msg hook regex + manifest behavior.
# Covers SPEC §7.3: anchored patterns, fail-open on missing manifest,
# empty-array short-circuit, multi-pattern detection.

source "$(dirname "$0")/_helpers.sh"
source "$WI_LIB_DIR/_helpers.sh"
source "$WI_LIB_DIR/manifest.sh"
source "$WI_LIB_DIR/trace-filter.sh"
source "$WI_LIB_DIR/rollback.sh"

# ---------------------------------------------------------------------------
# Shared fixture setup
# ---------------------------------------------------------------------------

# Create a tempdir with foo-ai/.workspace/pairing.json + foo/ canonical dir.
# Returns (echoes) the tempdir path.
_make_fixture() {
  local d; d="$(wi_tmpdir)"
  local ai="$d/foo-ai"; local cn="$d/foo"
  mkdir -p "$ai/.workspace" "$cn"
  wi_manifest_write "$ai" "$cn" personal >/dev/null 2>&1
  echo "$d"
}

# Render the hook from the fixture's ai workspace into a tempfile + chmod +x.
# Echoes the hook path.
_render_hook() {
  local d="$1"
  local ai="$d/foo-ai"
  local hook="$d/hook.sh"
  wi_trace_filter_render "$ai" > "$hook"
  chmod +x "$hook"
  echo "$hook"
}

_write_msg() {
  local d="$1"
  local content="$2"
  local msg="$d/msg"
  printf '%s' "$content" > "$msg"
  echo "$msg"
}

# Run hook against a commit message; returns the exit code via echo; stderr captured to $d/stderr.
_run_hook() {
  local hook="$1"; local msg="$2"; local d="$3"
  "$hook" "$msg" 2>"$d/stderr"
  echo $?
}

# The narrowed block contract (round 2): every fail-closed branch states that
# the filter fails closed, gives the specific reason, and points at the
# README's Repair section — and computes NO repair command or path itself.
_assert_fails_closed() {
  local err="$1"
  grep -q 'fails closed' "$err" || {
    echo "    block does not state the filter fails closed"
    cat "$err"; return 1; }
  grep -qF 'See Repair in the workspace-init README' "$err" || {
    echo "    missing pointer to the README Repair section"
    cat "$err"; return 1; }
  ! grep -qE 'wi [a-z_]+|bin/wi|trace_filter_|manifest_write' "$err" || {
    echo "    hook still computes a repair command"
    cat "$err"; return 1; }
}

# ---------------------------------------------------------------------------
# Positive (must block) — 6 tests
# ---------------------------------------------------------------------------

test_P1_co_authored_by_claude_blocks() {
  local d; d="$(_make_fixture)"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'fix: something\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "Co-Authored-By: Claude trailer must block"
}

test_P2_co_authored_by_human_blocks() {
  local d; d="$(_make_fixture)"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'fix: something\n\nCo-Authored-By: Human Dev <h@example.com>\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "Co-Authored-By trailer with human email must also block (broader catch)"
}

test_P3_robot_marker_at_line_start_blocks() {
  local d; d="$(_make_fixture)"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'🤖 Generated with [Claude Code]\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "🤖 Generated marker at line start must block"
}

test_P4_anthropic_noreply_substring_blocks() {
  local d; d="$(_make_fixture)"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'fix: something\n\nSome text with <noreply@anthropic.com> in it\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "<noreply@anthropic.com> in angle-brackets must block"
}

test_P5_openai_noreply_substring_blocks() {
  local d; d="$(_make_fixture)"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'fix: something\n\nTest with <noreply@openai.com> mid-line\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "<noreply@openai.com> must block"
}

test_P6_multi_pattern_blocks_on_first_match() {
  local d; d="$(_make_fixture)"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'fix: something\n\n🤖 Generated with [Claude Code]\nCo-Authored-By: Claude <noreply@anthropic.com>\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "multi-pattern message blocks (exit 1)"
}

# ---------------------------------------------------------------------------
# Negative (must allow) — 6 tests
# ---------------------------------------------------------------------------

test_N1_plain_message_allows() {
  local d; d="$(_make_fixture)"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'fix: bug\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "0" "$rc" "plain message exits 0"
}

test_N2_co_authored_mid_line_allows() {
  local d; d="$(_make_fixture)"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'docs: noting that Co-Authored-By trailers exist mid-line\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "0" "$rc" "Co-Authored-By not at line-start must allow (anchor)"
}

test_N3_robot_marker_mid_line_allows() {
  local d; d="$(_make_fixture)"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'chore: 🤖 Generated with marker stays mid-line\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "0" "$rc" "🤖 marker not at line-start must allow"
}

test_N4_docs_describing_pattern_allows() {
  local d; d="$(_make_fixture)"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'docs: document that hook blocks 🤖 Generated with marker\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "0" "$rc" "meta-commit about the pattern must allow (line doesn't START with marker)"
}

test_N5_bare_email_without_brackets_allows() {
  local d; d="$(_make_fixture)"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'fix: bare noreply@anthropic.com without brackets in body\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "0" "$rc" "bare email without angle-brackets must allow (anchored within brackets)"
}

test_N6_empty_body_allows() {
  local d; d="$(_make_fixture)"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" "")"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "0" "$rc" "empty message body must allow"
}

# ---------------------------------------------------------------------------
# Edge cases — 10 tests
# ---------------------------------------------------------------------------

test_E1_manifest_missing_fails_closed_with_repair() {
  local d; d="$(wi_tmpdir)"
  local ai="$d/foo-ai"
  mkdir -p "$ai"
  # No manifest written. Render the hook directly (template loader doesn't need manifest).
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'fix: anything\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "missing manifest must fail closed (exit 1)" || return 1
  if ! grep -q "manifest not found" "$d/stderr"; then
    echo "    expected stderr to contain 'manifest not found'"
    echo "    got: $(cat "$d/stderr")"
    return 1
  fi
  # Round 2: the hook states the reason and points at the README's Repair
  # section — it no longer computes a repair command itself.
  _assert_fails_closed "$d/stderr"
}

test_E2_enforce_false_allows_everything() {
  local d; d="$(_make_fixture)"
  # Flip enforce to false
  local manifest="$d/foo-ai/.workspace/pairing.json"
  local tmp; tmp="$(mktemp)"
  jq '.git_policy.trace_filter.enforce = false' "$manifest" > "$tmp" && mv "$tmp" "$manifest"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'fix: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "0" "$rc" "enforce:false must allow everything"
}

test_E3_empty_patterns_array_allows() {
  local d; d="$(_make_fixture)"
  local manifest="$d/foo-ai/.workspace/pairing.json"
  local tmp; tmp="$(mktemp)"
  jq '.git_policy.trace_filter.blocked_patterns = []' "$manifest" > "$tmp" && mv "$tmp" "$manifest"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'fix: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "0" "$rc" "empty patterns array must allow everything"
}

test_E4_malformed_json_manifest_fails_closed() {
  local d; d="$(_make_fixture)"
  # Corrupt the manifest into invalid JSON
  echo "{ this is not valid json" > "$d/foo-ai/.workspace/pairing.json"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'fix: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "malformed JSON manifest must fail closed (exit 1)" || return 1
  grep -q 'single JSON object' "$d/stderr" || {
    echo "    expected the single-JSON-object manifest error"
    echo "    got: $(cat "$d/stderr")"; return 1; }
  _assert_fails_closed "$d/stderr"
}

test_E9_missing_or_nonboolean_enforce_blocks() {
  # Only an EXPLICIT enforce:false may disable the filter: every manifest
  # wi_manifest_write has ever shipped writes the key, so its absence (or a
  # non-boolean value) means a corrupt manifest and must fail closed.
  local d; d="$(_make_fixture)"
  local manifest="$d/foo-ai/.workspace/pairing.json"
  local tmp; tmp="$(mktemp)"
  jq 'del(.git_policy.trace_filter.enforce)' "$manifest" > "$tmp" && mv "$tmp" "$manifest"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'fix: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "missing enforce key must fail closed (exit 1)" || return 1
  _assert_fails_closed "$d/stderr" || return 1
  # Non-boolean enforce is equally corrupt.
  tmp="$(mktemp)"
  jq '.git_policy.trace_filter.enforce = "yes"' "$manifest" > "$tmp" && mv "$tmp" "$manifest"
  rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "non-boolean enforce must fail closed (exit 1)" || return 1
  _assert_fails_closed "$d/stderr"
}

test_E10_unreadable_blocked_patterns_blocks() {
  # enforce:true with a missing or non-array blocked_patterns means the filter
  # cannot evaluate its policy — fail closed. (An explicit empty array stays
  # allowed; that is test_E3.)
  local d; d="$(_make_fixture)"
  local manifest="$d/foo-ai/.workspace/pairing.json"
  local tmp; tmp="$(mktemp)"
  jq 'del(.git_policy.trace_filter.blocked_patterns)' "$manifest" > "$tmp" && mv "$tmp" "$manifest"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'fix: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "missing blocked_patterns must fail closed (exit 1)" || return 1
  _assert_fails_closed "$d/stderr" || return 1
  tmp="$(mktemp)"
  jq '.git_policy.trace_filter.blocked_patterns = "not-an-array"' "$manifest" > "$tmp" && mv "$tmp" "$manifest"
  rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "non-array blocked_patterns must fail closed (exit 1)" || return 1
  _assert_fails_closed "$d/stderr"
}

test_E5_trailer_at_line_start_in_multiline_blocks() {
  local d; d="$(_make_fixture)"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'feat: add thing\n\nThis is a longer message\nwith multiple lines.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nSigned-off-by: User\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "trailer at line-start in multi-line body must block"
}

test_E6_pattern_at_line_start_with_trailing_whitespace_blocks() {
  local d; d="$(_make_fixture)"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'fix: x\n\nCo-Authored-By:   \n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "Co-Authored-By: with trailing whitespace still blocks (anchor ignores tail)"
}

test_E7_unicode_robot_at_line_start_blocks() {
  local d; d="$(_make_fixture)"
  local hook; hook="$(_render_hook "$d")"
  # Explicitly UTF-8 encoded 🤖 (F0 9F A4 96)
  local msg; msg="$(_write_msg "$d" $'\xf0\x9f\xa4\x96 Generated with [Claude Code]\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "UTF-8 🤖 marker at line start must block"
}

test_E8_render_substitutes_token() {
  local d; d="$(_make_fixture)"
  local hook; hook="$(_render_hook "$d")"
  if grep -q '__AI_WORKSPACE_PATH__' "$hook"; then
    echo "    placeholder __AI_WORKSPACE_PATH__ still present in rendered hook"
    return 1
  fi
  if ! grep -qF "$d/foo-ai" "$hook"; then
    echo "    expected baked path $d/foo-ai not found in rendered hook"
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Install target-repo shapes (#85) — 7 tests
# wi_trace_filter_install accepts an own git repo root, including a
# --separate-git-dir / submodule canonical whose .git is a FILE. It rejects
# nested subdirs, bare repos, linked worktrees, and non-repos.
# ---------------------------------------------------------------------------

# Build an AI workspace (with manifest) + a canonical repo of a given shape.
# $1=tempdir  $2="standard"|"separate". Echoes "<ai>|<canonical>|<real-gitdir>".
_make_install_fixture() {
  local d="$1"; local shape="$2"
  local ai="$d/foo-ai"; local cn="$d/foo"
  mkdir -p "$ai/.workspace" "$cn"
  if [[ "$shape" == "separate" ]]; then
    git init -q --separate-git-dir="$d/foo-gitdir" "$cn" 2>/dev/null
    wi_manifest_write "$ai" "$cn" personal >/dev/null 2>&1
    echo "$ai|$cn|$d/foo-gitdir"
  else
    git init -q "$cn" 2>/dev/null
    wi_manifest_write "$ai" "$cn" personal >/dev/null 2>&1
    echo "$ai|$cn|$cn/.git"
  fi
}

# #85: a --separate-git-dir canonical (its .git is a FILE) must install the
# hook into the REAL (separate) gitdir's hooks — not error, not $cn/.git/hooks.
test_S1_install_separate_git_dir_canonical() {
  local d; d="$(wi_tmpdir)"
  local parsed; parsed="$(_make_install_fixture "$d" separate)"
  local ai="${parsed%%|*}"; local rest="${parsed#*|}"
  local cn="${rest%%|*}"; local gitdir="${rest##*|}"
  [[ -f "$cn/.git" ]] || { echo "    fixture invalid: $cn/.git is not a file"; return 1; }
  wi_trace_filter_install "$ai" "$cn" || { echo "    install failed on --separate-git-dir canonical"; return 1; }
  assert_file_exists "$gitdir/hooks/commit-msg" || return 1
  [[ -x "$gitdir/hooks/commit-msg" ]] || { echo "    hook not executable"; return 1; }
  # It must NOT have tried to treat the .git FILE as a directory.
  assert_file_absent "$cn/.git/hooks/commit-msg" || return 1
}

# Regression: a plain standard repo still installs at $repo/.git/hooks.
test_S2_install_standard_repo_still_works() {
  local d; d="$(wi_tmpdir)"
  local parsed; parsed="$(_make_install_fixture "$d" standard)"
  local ai="${parsed%%|*}"; local rest="${parsed#*|}"
  local cn="${rest%%|*}"
  wi_trace_filter_install "$ai" "$cn" || { echo "    install failed on standard repo"; return 1; }
  assert_file_exists "$cn/.git/hooks/commit-msg" || return 1
  [[ -x "$cn/.git/hooks/commit-msg" ]] || { echo "    hook not executable"; return 1; }
}

# A non-repo target is still rejected by the precondition.
test_S3_install_rejects_non_repo() {
  local d; d="$(wi_tmpdir)"
  local ai="$d/foo-ai"; local cn="$d/foo"
  mkdir -p "$ai/.workspace" "$cn"
  wi_manifest_write "$ai" "$cn" personal >/dev/null 2>&1
  if wi_trace_filter_install "$ai" "$cn" 2>/dev/null; then
    echo "    install unexpectedly succeeded on a non-repo target"; return 1
  fi
  assert_file_absent "$cn/.git/hooks/commit-msg" || return 1
}

# The trace-filter contract is repo-local .git/hooks, not any configured shared
# core.hooksPath. A future tracked hooksPath variant is a separate design.
test_S4_install_ignores_custom_hooks_path() {
  local d; d="$(wi_tmpdir)"
  local parsed; parsed="$(_make_install_fixture "$d" standard)"
  local ai="${parsed%%|*}"; local rest="${parsed#*|}"
  local cn="${rest%%|*}"
  local custom="$d/shared-hooks"
  mkdir -p "$custom"
  git -C "$cn" config core.hooksPath "$custom"
  wi_trace_filter_install "$ai" "$cn" || { echo "    install failed with custom hooksPath"; return 1; }
  assert_file_exists "$cn/.git/hooks/commit-msg" || return 1
  assert_file_absent "$custom/commit-msg" || return 1
}

test_S5_install_rejects_repo_subdir() {
  local d; d="$(wi_tmpdir)"
  local parsed; parsed="$(_make_install_fixture "$d" standard)"
  local ai="${parsed%%|*}"; local rest="${parsed#*|}"
  local cn="${rest%%|*}"
  mkdir -p "$cn/subdir"
  if wi_trace_filter_install "$ai" "$cn/subdir" 2>/dev/null; then
    echo "    install unexpectedly succeeded on a repo subdir"; return 1
  fi
  assert_file_absent "$cn/.git/hooks/commit-msg" || return 1
}

test_S6_install_rejects_bare_repo() {
  local d; d="$(wi_tmpdir)"
  local ai="$d/foo-ai"; local cn="$d/foo-bare.git"
  mkdir -p "$ai/.workspace"
  git init -q --bare "$cn" 2>/dev/null
  wi_manifest_write "$ai" "$cn" personal >/dev/null 2>&1
  if wi_trace_filter_install "$ai" "$cn" 2>/dev/null; then
    echo "    install unexpectedly succeeded on a bare repo"; return 1
  fi
  assert_file_absent "$cn/hooks/commit-msg" || return 1
}

test_S7_install_rejects_linked_worktree() {
  local d; d="$(wi_tmpdir)"
  local parsed; parsed="$(_make_install_fixture "$d" standard)"
  local ai="${parsed%%|*}"; local rest="${parsed#*|}"
  local cn="${rest%%|*}"
  git -C "$cn" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
  git -C "$cn" worktree add -q -b linked-test "$d/linked" 2>/dev/null
  local linked_git_dir
  linked_git_dir="$(git -C "$d/linked" rev-parse --git-dir)"
  if wi_trace_filter_install "$ai" "$d/linked" 2>/dev/null; then
    echo "    install unexpectedly succeeded on a linked worktree"; return 1
  fi
  assert_file_absent "$linked_git_dir/hooks/commit-msg" || return 1
}

# ---------------------------------------------------------------------------
# Foreign-hook install safety (#457 / D-B1) — 6 tests
#
# wi_trace_filter_install must NEVER displace a commit-msg hook it did not
# write. Our own hook is recognised by the marker line
#   # workspace-init:managed-hook
# or by the pre-0.5.1 legacy header
#   # workspace-init: commit-msg AI-trace filter (auto-installed)
# (hooks already in the field predate the marker and must stay re-bakeable so
# the moved-workspace repair works). Anything else is foreign: refuse, leave
# every byte in place.
# ---------------------------------------------------------------------------

# Write a foreign (not-installed-by-us) commit-msg hook. $1 = hook path.
# (wi_tmpdir's EXIT trap fires inside its command-substitution subshell, so the
# dir it returns may already be gone — mkdir -p the parent before writing.)
_write_foreign_hook() {
  mkdir -p "$(dirname "$1")"
  printf '#!/bin/sh\necho "FOREIGN-HOOK-MARKER"\nexit 0\n' > "$1"
  chmod +x "$1"
}

# AI workspace + canonical git repo, with $2's contents already sitting at
# canonical/.git/hooks/commit-msg. Echoes "<ai>|<canonical>".
_make_foreign_hook_fixture() {
  local d="$1" hook_src="$2"
  local ai="$d/foo-ai" cn="$d/foo"
  mkdir -p "$ai/.workspace" "$cn"
  git -C "$cn" init -q 2>/dev/null
  wi_manifest_write "$ai" "$cn" personal >/dev/null 2>&1
  cp "$hook_src" "$cn/.git/hooks/commit-msg"
  chmod +x "$cn/.git/hooks/commit-msg"
  echo "$ai|$cn"
}

test_F1_install_refuses_foreign_hook_preserves_bytes() {
  local d; d="$(wi_tmpdir)"
  local fh="$d/foreign-hook"; _write_foreign_hook "$fh"
  local parsed; parsed="$(_make_foreign_hook_fixture "$d" "$fh")"
  local ai="${parsed%%|*}" cn="${parsed##*|}"
  cp "$cn/.git/hooks/commit-msg" "$d/hook.orig"
  if "$WI_BIN" trace_filter_install "$ai" "$cn" 2>"$d/inst-err"; then
    echo "    install unexpectedly succeeded over a foreign hook"; return 1
  fi
  cmp -s "$d/hook.orig" "$cn/.git/hooks/commit-msg" || {
    echo "    foreign hook bytes changed by refused install"; return 1; }
  grep -qi 'refus' "$d/inst-err" || {
    echo "    refusal not explained to the user"; cat "$d/inst-err"; return 1; }
  # Adjacent: the refusal runs before render — a render failure cannot turn a
  # refusal into a deletion (today `> "$out"` truncates before render runs).
  local bad="$d/badhooks"; mkdir -p "$bad"
  : > "$bad/commit-msg.tmpl"; chmod 000 "$bad/commit-msg.tmpl"
  if WI_HOOKS_DIR="$bad" "$WI_BIN" trace_filter_install "$ai" "$cn" 2>/dev/null; then
    echo "    install succeeded over foreign hook with unreadable template"; return 1
  fi
  cmp -s "$d/hook.orig" "$cn/.git/hooks/commit-msg" || {
    echo "    foreign hook changed on the render-failure path"; return 1; }
}

test_F2_render_failure_preserves_own_hook() {
  local d; d="$(wi_tmpdir)"; mkdir -p "$d"
  local fh="$d/our-hook"
  printf '#!/usr/bin/env bash\n# workspace-init:managed-hook\nexit 0\n' > "$fh"
  local parsed; parsed="$(_make_foreign_hook_fixture "$d" "$fh")"
  local ai="${parsed%%|*}" cn="${parsed##*|}"
  cp "$cn/.git/hooks/commit-msg" "$d/hook.orig"
  # Force a render failure: an unreadable template.
  local bad="$d/badhooks"; mkdir -p "$bad"
  : > "$bad/commit-msg.tmpl"; chmod 000 "$bad/commit-msg.tmpl"
  if WI_HOOKS_DIR="$bad" "$WI_BIN" trace_filter_install "$ai" "$cn" 2>/dev/null; then
    echo "    install unexpectedly succeeded with unreadable template"; return 1
  fi
  cmp -s "$d/hook.orig" "$cn/.git/hooks/commit-msg" || {
    echo "    our own hook was destroyed by a failed render"; return 1; }
}

test_F3_install_replaces_own_marked_hook() {
  local d; d="$(wi_tmpdir)"; mkdir -p "$d"
  local fh="$d/our-hook"
  printf '#!/usr/bin/env bash\n# workspace-init:managed-hook\nexit 0\n' > "$fh"
  local parsed; parsed="$(_make_foreign_hook_fixture "$d" "$fh")"
  local ai="${parsed%%|*}" cn="${parsed##*|}"
  "$WI_BIN" trace_filter_install "$ai" "$cn" 2>/dev/null || {
    echo "    re-install over our own hook refused"; return 1; }
  grep -qF '# workspace-init:managed-hook' "$cn/.git/hooks/commit-msg" || {
    echo "    re-rendered hook lost the marker"; return 1; }
  grep -qF "$ai" "$cn/.git/hooks/commit-msg" || {
    echo "    re-rendered hook did not bake the AI path"; return 1; }
}

test_F4_foreign_hook_mentioning_workspace_init_refused() {
  local d; d="$(wi_tmpdir)"; mkdir -p "$d"
  local fh="$d/foreign-hook"
  # Mentions workspace-init but carries NEITHER marker line — still foreign.
  printf '#!/bin/sh\n# see workspace-init docs for the policy this enforces\necho foreign\nexit 0\n' > "$fh"
  local parsed; parsed="$(_make_foreign_hook_fixture "$d" "$fh")"
  local ai="${parsed%%|*}" cn="${parsed##*|}"
  cp "$cn/.git/hooks/commit-msg" "$d/hook.orig"
  if "$WI_BIN" trace_filter_install "$ai" "$cn" 2>/dev/null; then
    echo "    install succeeded over a foreign hook that mentions workspace-init"; return 1
  fi
  cmp -s "$d/hook.orig" "$cn/.git/hooks/commit-msg" || {
    echo "    foreign hook bytes changed"; return 1; }
}

test_F5_legacy_installed_hook_is_replaced() {
  # Hooks installed by workspace-init <= 0.5.0 carry the legacy header but no
  # marker. They are still OURS — the moved-workspace repair must be able to
  # re-bake them.
  local d; d="$(wi_tmpdir)"; mkdir -p "$d"
  local fh="$d/legacy-hook"
  printf '#!/usr/bin/env bash\n# workspace-init: commit-msg AI-trace filter (auto-installed)\nexit 0\n' > "$fh"
  local parsed; parsed="$(_make_foreign_hook_fixture "$d" "$fh")"
  local ai="${parsed%%|*}" cn="${parsed##*|}"
  "$WI_BIN" trace_filter_install "$ai" "$cn" 2>/dev/null || {
    echo "    install refused a legacy (pre-marker) workspace-init hook"; return 1; }
  grep -qF '# workspace-init:managed-hook' "$cn/.git/hooks/commit-msg" || {
    echo "    legacy hook not re-rendered to the marker form"; return 1; }
}

test_F6_marker_text_embedded_in_line_stays_foreign() {
  # Adjacent control for the marker loosening: the marker is a WHOLE LINE. A
  # foreign hook quoting the marker inside a longer line is still foreign.
  local d; d="$(wi_tmpdir)"; mkdir -p "$d"
  local fh="$d/foreign-hook"
  printf '#!/bin/sh\necho "# workspace-init:managed-hook"\necho "# workspace-init: commit-msg AI-trace filter (auto-installed)"\nexit 0\n' > "$fh"
  local parsed; parsed="$(_make_foreign_hook_fixture "$d" "$fh")"
  local ai="${parsed%%|*}" cn="${parsed##*|}"
  cp "$cn/.git/hooks/commit-msg" "$d/hook.orig"
  if "$WI_BIN" trace_filter_install "$ai" "$cn" 2>/dev/null; then
    echo "    install succeeded over a hook merely quoting the marker"; return 1
  fi
  cmp -s "$d/hook.orig" "$cn/.git/hooks/commit-msg" || {
    echo "    foreign hook bytes changed"; return 1; }
}

# ---------------------------------------------------------------------------
# Special-character workspace paths (#458) — 10 tests
#
# The AI workspace path is baked into the rendered hook. Every byte of it must
# survive literally: sed replacement chars (& | \), shell-special chars
# (" $ ` '), spaces, and even the placeholder text itself.
# End-to-end through bin/wi + a real `git commit`: a trailer commit must be
# blocked BY THE FILTER (not by a syntax-broken hook), and a clean commit must
# pass (a hook that errors on every input would fake the first assertion).
# ---------------------------------------------------------------------------

# $1 = literal basename for the AI workspace dir (may contain specials).
_assert_e2e_trace_filter_blocks() {
  local dirname="$1"
  local d; d="$(wi_tmpdir)"
  local ai="$d/$dirname" cn="$d/canonical"
  mkdir -p "$ai" "$cn" || return 1
  git -C "$cn" init -q 2>/dev/null
  "$WI_BIN" manifest_write "$ai" "$cn" work --default-branch main >/dev/null 2>&1 || {
    echo "    manifest_write failed (dir: $dirname)"; return 1; }
  _with_timeout 20 "$WI_BIN" trace_filter_install "$ai" "$cn" 2>/dev/null || {
    echo "    trace_filter_install failed (dir: $dirname)"; return 1; }
  git -C "$cn" -c user.email=t@t -c user.name=t commit -q --allow-empty \
      -m $'subject\n\nCo-Authored-By: Bot <bot@x>' 2>"$d/trailer-err"
  local rc=$?
  [[ "$rc" -ne 0 ]] || {
    echo "    trailer commit not blocked (dir: $dirname)"; return 1; }
  grep -q 'blocked AI-trace pattern' "$d/trailer-err" || {
    echo "    block did not come from the trace filter (dir: $dirname)"
    cat "$d/trailer-err"; return 1; }
  git -C "$cn" -c user.email=t@t -c user.name=t commit -q --allow-empty \
      -m 'clean subject' 2>"$d/clean-err"
  rc=$?
  [[ "$rc" -eq 0 ]] || {
    echo "    clean commit blocked — hook is broken, not filtering (dir: $dirname)"
    cat "$d/clean-err"; return 1; }
}

test_SC0_plain_path_control()        { _assert_e2e_trace_filter_blocks 'wk-plain-ai'; }
test_SC1_ampersand_in_path()         { _assert_e2e_trace_filter_blocks 'wk-&-ai'; }
test_SC2_pipe_in_path()              { _assert_e2e_trace_filter_blocks 'wk-|-ai'; }
test_SC3_backslash_in_path()         { _assert_e2e_trace_filter_blocks 'wk-\bs-ai'; }
test_SC4_dquote_in_path()            { _assert_e2e_trace_filter_blocks 'wk-"-ai'; }
test_SC5_dollar_in_path()            { _assert_e2e_trace_filter_blocks 'wk-$x-ai'; }
test_SC6_backtick_in_path()          { _assert_e2e_trace_filter_blocks 'wk-`id`-ai'; }
test_SC7_space_in_path()             { _assert_e2e_trace_filter_blocks 'wk- dir-ai'; }
test_SC8_squote_in_path()            { _assert_e2e_trace_filter_blocks "wk-'-ai"; }
# The path may itself contain the placeholder text — the render must terminate
# and the baked value must stay literal (guards the substitution loop shape).
test_SC9_placeholder_text_in_path()  { _assert_e2e_trace_filter_blocks 'wk-__AI_WORKSPACE_PATH__-ai'; }

# ---------------------------------------------------------------------------
# Named-repair contract (#481) + moved-workspace end-to-end — 2 tests
# ---------------------------------------------------------------------------

test_R1_hook_repair_names_existing_wi_verb() {
  # Round 2 (skill-first): the hook states the fail-closed reason and points at
  # the README's Repair section — it computes no repair command or path. The
  # verb-existence contract moved to the README pin (test_H6).
  local d; d="$(wi_tmpdir)"
  mkdir -p "$d/foo-ai"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'x\n\nCo-Authored-By: A <a@b>\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" || return 1
  _assert_fails_closed "$d/stderr"
}

test_M1_moved_workspace_repair_restores_filter() {
  # The #481 trigger end to end: pair, MOVE the workspace, verify the hook now
  # fails closed, run the repair the message names, verify the filter is back.
  local d; d="$(wi_tmpdir)"
  local ai="$d/proj-ai" moved="$d/proj-ai-MOVED" cn="$d/proj"
  mkdir -p "$ai" "$cn"
  git -C "$ai" init -q 2>/dev/null; git -C "$cn" init -q 2>/dev/null
  "$WI_BIN" manifest_write "$ai" "$cn" work --default-branch main >/dev/null 2>&1 || return 1
  "$WI_BIN" trace_filter_install_pair "$ai" "$cn" 2>/dev/null || return 1
  mv "$ai" "$moved"
  # Moved workspace → baked path unreachable → fail CLOSED, naming the path
  # (the new contract: the unreachable path is named, not a JSON error).
  git -C "$cn" -c user.email=t@t -c user.name=t commit -q --allow-empty \
      -m $'x\n\nCo-Authored-By: Bot <bot@x>' 2>"$d/moved-err"
  local rc=$?
  [[ "$rc" -ne 0 ]] || { echo "    trailer commit allowed after workspace move"; return 1; }
  grep -q 'unreachable' "$d/moved-err" || {
    echo "    expected the unreachable-path failure"; cat "$d/moved-err"; return 1; }
  grep -qF "$ai" "$d/moved-err" || {
    echo "    failure does not name the stale path"; cat "$d/moved-err"; return 1; }
  _assert_fails_closed "$d/moved-err" || return 1
  # The named repair re-bakes both hooks against the moved workspace.
  "$WI_BIN" trace_filter_install_pair "$moved" "$cn" 2>/dev/null || {
    echo "    repair (trace_filter_install_pair) failed"; return 1; }
  # Still blocks trailers — but now because the PATTERN matched, i.e. the
  # manifest was found and evaluated.
  git -C "$cn" -c user.email=t@t -c user.name=t commit -q --allow-empty \
      -m $'y\n\nCo-Authored-By: Bot <bot@x>' 2>"$d/after-err"
  rc=$?
  [[ "$rc" -ne 0 ]] || { echo "    trailer commit allowed after repair"; return 1; }
  grep -q 'blocked AI-trace pattern' "$d/after-err" || {
    echo "    post-repair block is not the filter's"; cat "$d/after-err"; return 1; }
  git -C "$cn" -c user.email=t@t -c user.name=t commit -q --allow-empty \
      -m 'clean' 2>"$d/clean-err"
  rc=$?
  [[ "$rc" -eq 0 ]] || { echo "    clean commit blocked after repair"; cat "$d/clean-err"; return 1; }
  # And the AI-workspace-side hook was re-baked too (pair form).
  grep -qF "$moved" "$cn/.git/hooks/commit-msg" || {
    echo "    canonical hook not re-baked to the moved path"; return 1; }
}

# ---------------------------------------------------------------------------
# Manifest must be exactly ONE JSON object (round-1 RB1/CB2) — 4 tests
#
# `jq empty` accepts a stream: 0-byte files, whitespace-only files, and
# concatenated documents all exit 0, and a top-level array parses fine too.
# Each is a corrupt manifest — the hook must fail closed naming the manifest.
# ---------------------------------------------------------------------------

# Corrupt the fixture manifest with $1's exact bytes, render, run a trailer
# commit-msg, assert the block came from the manifest policy (not the pattern).
_assert_single_object_block() {
  local content="$1" desc="$2"
  local d; d="$(_make_fixture)"
  printf '%s' "$content" > "$d/foo-ai/.workspace/pairing.json"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'fix: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "$desc: must fail closed (exit 1)" || return 1
  grep -q 'single JSON object' "$d/stderr" || {
    echo "    $desc: expected the single-JSON-object manifest error"
    echo "    got: $(cat "$d/stderr")"; return 1; }
  _assert_fails_closed "$d/stderr"
}

test_O1_empty_manifest_blocks()            { _assert_single_object_block "" "0-byte manifest"; }
test_O2_whitespace_only_manifest_blocks()  { _assert_single_object_block $'  \n\t \n' "whitespace-only manifest"; }
test_O3_concatenated_documents_block()     { _assert_single_object_block '{"a":1}
{"b":2}' "two concatenated JSON documents"; }
test_O4_top_level_array_manifest_blocks()  { _assert_single_object_block '[1,2,3]' "top-level JSON array"; }

# ---------------------------------------------------------------------------
# Error status is never read as "no match" (round-1 CB1) — 3 tests
#
# `grep -qE` exits 2 on an invalid ERE — that is a policy evaluation failure,
# not "the trailer was absent". A non-string element in blocked_patterns is
# the same class: the filter cannot apply it, so it must not silently pass.
# ---------------------------------------------------------------------------

test_F7_invalid_ere_blocks_without_trailer() {
  local d; d="$(_make_fixture)"
  local manifest="$d/foo-ai/.workspace/pairing.json" tmp; tmp="$(mktemp)"
  jq '.git_policy.trace_filter.blocked_patterns = ["("]' "$manifest" > "$tmp" && mv "$tmp" "$manifest"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'fix: perfectly clean subject\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "invalid ERE must fail closed even on a clean message" || return 1
  # The message must name the unevaluatable pattern on one line — a bare grep
  # for '(' passes vacuously on the '(not recommended)' boilerplate.
  grep -qE 'regex.*\(' "$d/stderr" || {
    echo "    expected stderr to name the bad pattern"
    echo "    got: $(cat "$d/stderr")"; return 1; }
  _assert_fails_closed "$d/stderr"
}

test_F8_invalid_ere_blocks_with_trailer() {
  local d; d="$(_make_fixture)"
  local manifest="$d/foo-ai/.workspace/pairing.json" tmp; tmp="$(mktemp)"
  jq '.git_policy.trace_filter.blocked_patterns = ["(", "^Co-Authored-By:"]' "$manifest" > "$tmp" && mv "$tmp" "$manifest"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'fix: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" || return 1
  # The block must identify the unevaluatable pattern, not merely report the
  # trailer match — otherwise a broken policy masquerades as a working filter.
  grep -qE 'regex.*\(' "$d/stderr" || {
    echo "    expected stderr to name the invalid pattern"
    echo "    got: $(cat "$d/stderr")"; return 1; }
  _assert_fails_closed "$d/stderr"
}

test_F9_non_string_pattern_blocks() {
  local d; d="$(_make_fixture)"
  local manifest="$d/foo-ai/.workspace/pairing.json" tmp; tmp="$(mktemp)"
  jq '.git_policy.trace_filter.blocked_patterns = [42]' "$manifest" > "$tmp" && mv "$tmp" "$manifest"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'fix: clean\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "a non-string blocked_patterns element must fail closed" || return 1
  _assert_fails_closed "$d/stderr"
}

# ---------------------------------------------------------------------------
# Every block names a repair that fixes THAT condition (round-1 H class) —
# 6 tests
# ---------------------------------------------------------------------------

test_H1_missing_jq_blocks_naming_jq() {
  # jq absent from PATH is an environment failure, not "manifest is not valid
  # JSON" — the message must say so. Run the rendered hook under a PATH that
  # has bash but no jq.
  local d; d="$(_make_fixture)"
  local hook; hook="$(_render_hook "$d")"
  local fakebin="$d/fakebin"; mkdir -p "$fakebin"
  ln -s "$(command -v bash)" "$fakebin/bash"
  ln -s "$(command -v env)" "$fakebin/env" 2>/dev/null || true
  local msg; msg="$(_write_msg "$d" $'fix: x\n\nCo-Authored-By: Bot <bot@x>\n')"
  PATH="$fakebin" "$hook" "$msg" 2>"$d/stderr"
  local rc=$?
  assert_eq "1" "$rc" "missing jq must fail closed" || return 1
  grep -q 'jq' "$d/stderr" || {
    echo "    expected stderr to name jq as the missing tool"
    echo "    got: $(cat "$d/stderr")"; return 1; }
  ! grep -qE 'valid JSON|single JSON object' "$d/stderr" || {
    echo "    jq absence must not be reported as manifest corruption"
    echo "    got: $(cat "$d/stderr")"; return 1; }
  _assert_fails_closed "$d/stderr"
}

test_H2_relative_path_repair_restores_filter() {
  # The repair must work as a human types it — relative paths included (CB6).
  local d; d="$(wi_tmpdir)"
  local ai="$d/proj-ai" moved="$d/proj-ai-MOVED" cn="$d/proj"
  mkdir -p "$ai" "$cn"
  git -C "$ai" init -q 2>/dev/null; git -C "$cn" init -q 2>/dev/null
  "$WI_BIN" manifest_write "$ai" "$cn" work --default-branch main >/dev/null 2>&1 || return 1
  "$WI_BIN" trace_filter_install_pair "$ai" "$cn" 2>/dev/null || return 1
  mv "$ai" "$moved"
  # Repair exactly as a human standing in the parent dir would type it: the
  # README's Repair section names <plugin dir>/bin/wi — the same dispatcher
  # $WI_BIN resolves here.
  ( cd "$d" && "$WI_BIN" trace_filter_install_pair "proj-ai-MOVED" "proj" ) 2>/dev/null || {
    echo "    relative-path repair failed"; return 1; }
  git -C "$cn" -c user.email=t@t -c user.name=t commit -q --allow-empty \
      -m $'y\n\nCo-Authored-By: Bot <bot@x>' 2>"$d/after-err"
  local rc=$?
  [[ "$rc" -ne 0 ]] || { echo "    trailer commit allowed after relative-path repair"; return 1; }
  grep -q 'blocked AI-trace pattern' "$d/after-err" || {
    echo "    post-repair block is not the filter's (relative path was baked un-resolved)"
    cat "$d/after-err"; return 1; }
  git -C "$cn" -c user.email=t@t -c user.name=t commit -q --allow-empty \
      -m 'clean' 2>"$d/clean-err"
  rc=$?
  [[ "$rc" -eq 0 ]] || { echo "    clean commit blocked after repair"; cat "$d/clean-err"; return 1; }
}

test_H3_hint_names_main_worktree_not_linked() {
  # Commits from a linked worktree share this hook; the repair must name the
  # MAIN worktree root — the only path wi_trace_filter_install accepts (RB5).
  local d; d="$(wi_tmpdir)"; mkdir -p "$d"
  # Names chosen so none is a substring of another: a bare grep -F for the
  # canonical root cannot be satisfied by the AI path or the worktree path.
  local ai="$d/ai-side" cn="$d/canonical-repo" wt="$d/worktree-linked"
  mkdir -p "$ai" "$cn"
  git -C "$ai" init -q 2>/dev/null; git -C "$cn" init -q 2>/dev/null
  "$WI_BIN" manifest_write "$ai" "$cn" work --default-branch main >/dev/null 2>&1 || return 1
  "$WI_BIN" trace_filter_install_pair "$ai" "$cn" 2>/dev/null || return 1
  git -C "$cn" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init 2>/dev/null
  git -C "$cn" worktree add -q -b wt2 "$wt" 2>/dev/null || {
    echo "    could not create linked worktree"; return 1; }
  # Break the manifest path so the hook blocks and prints the hint.
  mv "$ai" "$d/ai-side-elsewhere"
  git -C "$wt" -c user.email=t@t -c user.name=t commit -q --allow-empty \
      -m $'x\n\nCo-Authored-By: Bot <bot@x>' 2>"$d/wt-err"
  local rc=$?
  [[ "$rc" -ne 0 ]] || { echo "    trailer commit allowed from linked worktree"; return 1; }
  _assert_fails_closed "$d/wt-err" || return 1
  ! grep -qF "$wt" "$d/wt-err" || {
    echo "    block still computes a path (names the linked worktree)"
    cat "$d/wt-err"; return 1; }
  ! grep -qF "$cn" "$d/wt-err" || {
    echo "    block still computes a path (names the canonical root)"
    cat "$d/wt-err"; return 1; }
}

test_H4_manifest_repair_verb_rewrites_manifest() {
  # A corrupt-manifest block must name a repair that actually rewrites
  # pairing.json — the hook re-bake verbs cannot fix a bad manifest (CB4).
  local d; d="$(_make_fixture)"
  echo '{ not json' > "$d/foo-ai/.workspace/pairing.json"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'x\n\nCo-Authored-By: Bot <bot@x>\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" || return 1
  _assert_fails_closed "$d/stderr" || return 1
  # Prove the README-documented repair end to end: rewrite the manifest,
  # re-bake the hook, then the pattern (not the manifest error) is what blocks
  # the next trailer.
  local ai="$d/foo-ai" cn="$d/foo"
  git -C "$cn" init -q 2>/dev/null
  "$WI_BIN" manifest_write "$ai" "$cn" work --default-branch main >/dev/null 2>&1 || {
    echo "    named repair (manifest_write) failed"; return 1; }
  "$WI_BIN" trace_filter_install "$ai" "$cn" 2>/dev/null || {
    echo "    hook install after manifest repair failed"; return 1; }
  git -C "$cn" -c user.email=t@t -c user.name=t commit -q --allow-empty \
      -m $'z\n\nCo-Authored-By: Bot <bot@x>' 2>"$d/after-err"
  rc=$?
  [[ "$rc" -ne 0 ]] || { echo "    trailer allowed after manifest repair"; return 1; }
  grep -q 'blocked AI-trace pattern' "$d/after-err" || {
    echo "    post-repair block is not the pattern match"; cat "$d/after-err"; return 1; }
}

test_H5_pair_repair_updates_canonical_despite_foreign_ai_hook() {
  # CB5: when the AI workspace carries a foreign commit-msg hook, the pair
  # repair must still fix the load-bearing canonical hook — and still report
  # the refusal (non-zero exit).
  local d; d="$(wi_tmpdir)"; mkdir -p "$d"
  local ai="$d/proj-ai" moved="$d/proj-ai-MOVED" cn="$d/proj"
  mkdir -p "$ai" "$cn"
  git -C "$ai" init -q 2>/dev/null; git -C "$cn" init -q 2>/dev/null
  "$WI_BIN" manifest_write "$ai" "$cn" work --default-branch main >/dev/null 2>&1 || return 1
  "$WI_BIN" trace_filter_install_pair "$ai" "$cn" 2>/dev/null || return 1
  mv "$ai" "$moved"
  # The moved workspace now carries a FOREIGN commit-msg hook (user's own).
  local fh="$moved/.git/hooks/commit-msg"
  _write_foreign_hook "$fh"
  cp "$fh" "$d/foreign.orig"
  if "$WI_BIN" trace_filter_install_pair "$moved" "$cn" 2>"$d/pair-err"; then
    echo "    pair repair must report the AI-side refusal (non-zero)"; return 1
  fi
  cmp -s "$d/foreign.orig" "$fh" || { echo "    foreign AI hook was destroyed"; return 1; }
  # …but the canonical hook was still re-baked to the moved workspace.
  grep -qF "$moved" "$cn/.git/hooks/commit-msg" || {
    echo "    canonical hook was not re-baked to the moved path"; return 1; }
  git -C "$cn" -c user.email=t@t -c user.name=t commit -q --allow-empty \
      -m $'z\n\nCo-Authored-By: Bot <bot@x>' 2>"$d/after-err"
  local rc=$?
  [[ "$rc" -ne 0 ]] || { echo "    trailer allowed after pair repair"; return 1; }
  grep -q 'blocked AI-trace pattern' "$d/after-err" || {
    echo "    post-repair block is not the pattern match"; cat "$d/after-err"; return 1; }
}

test_H6_workspace_init_mentions_resolve_to_real_commands() {
  # Every /workspace-init:<name> written in shipped files must name a command
  # that exists — commands/<name>.md (CB8). A dead name is the original #481
  # defect shape in prose form.
  local mentions missing=0 m name
  mentions="$(grep -rhoE '/workspace-init:[a-z0-9-]+' "$WI_PLUGIN_ROOT" \
      --exclude-dir=tests 2>/dev/null | sort -u)"
  while IFS= read -r m; do
    [[ -z "$m" ]] && continue
    name="${m#/workspace-init:}"
    [[ -f "$WI_PLUGIN_ROOT/commands/$name.md" ]] || {
      echo "    $m has no commands/$name.md"; missing=1; }
  done <<< "$mentions"
  [[ "$missing" -eq 0 ]] || return 1
  # And every `wi <verb>` the README names must be a real dispatcher verb.
  local verbs v
  verbs="$(grep -oE '\bwi [a-z_]+\b' "$WI_PLUGIN_ROOT/README.md" | awk '{print $2}' | sort -u)"
  while IFS= read -r v; do
    [[ -z "$v" ]] && continue
    "$WI_BIN" --list | grep -qx "$v" || {
      echo "    README names 'wi $v' but it is not in wi --list"; missing=1; }
  done <<< "$verbs"
  [[ "$missing" -eq 0 ]]
}

# ---------------------------------------------------------------------------
# Q5 — pair install validates the AI root before touching either hook — 1 test
# ---------------------------------------------------------------------------

test_Q5_pair_install_validates_ai_root_before_writes() {
  # A mistyped/moved AI root must fail BEFORE the canonical hook is rewritten —
  # the round-1 canonical-first ordering otherwise bakes a dead path into the
  # load-bearing hook (and wi_log_op even creates <bad>/.workspace).
  local d; d="$(wi_tmpdir)"; mkdir -p "$d"
  local ai="$d/ai-side" cn="$d/canonical"
  mkdir -p "$ai" "$cn"
  git -C "$ai" init -q 2>/dev/null; git -C "$cn" init -q 2>/dev/null
  "$WI_BIN" manifest_write "$ai" "$cn" work --default-branch main >/dev/null 2>&1 || return 1
  "$WI_BIN" trace_filter_install_pair "$ai" "$cn" 2>/dev/null || return 1
  cp "$cn/.git/hooks/commit-msg" "$d/canon.orig"
  # Leg 1: nonexistent AI root → nonzero, canonical hook byte-identical, and
  # nothing created at the bad path.
  if "$WI_BIN" trace_filter_install_pair "$d/ai-TYPO" "$cn" 2>"$d/err"; then
    echo "    pair accepted a nonexistent AI root"; return 1; fi
  cmp -s "$d/canon.orig" "$cn/.git/hooks/commit-msg" || {
    echo "    canonical hook rewritten despite a bad AI root"; return 1; }
  [[ ! -e "$d/ai-TYPO" ]] || {
    echo "    repair created a directory at the mistyped path"; return 1; }
  grep -qiE 'workspace|directory|exist' "$d/err" || {
    echo "    failure does not name the AI-root problem"; cat "$d/err"; return 1; }
  # Leg 2: existing AI root whose manifest is corrupt → same contract.
  local ai2="$d/ai-corrupt"
  mkdir -p "$ai2/.workspace"
  echo '{ not json' > "$ai2/.workspace/pairing.json"
  if "$WI_BIN" trace_filter_install_pair "$ai2" "$cn" 2>"$d/err2"; then
    echo "    pair accepted a corrupt manifest"; return 1; fi
  cmp -s "$d/canon.orig" "$cn/.git/hooks/commit-msg" || {
    echo "    canonical hook rewritten despite a corrupt manifest"; return 1; }
  grep -qiE 'manifest|json' "$d/err2" || {
    echo "    failure does not name the manifest problem"; cat "$d/err2"; return 1; }
  # Leg 3: existing AI root with NO manifest at all → same contract.
  local ai3="$d/ai-nomanifest"
  mkdir -p "$ai3"
  if "$WI_BIN" trace_filter_install_pair "$ai3" "$cn" 2>"$d/err3a"; then
    echo "    pair accepted a missing manifest"; return 1; fi
  cmp -s "$d/canon.orig" "$cn/.git/hooks/commit-msg" || {
    echo "    canonical hook rewritten despite a missing manifest"; return 1; }
  grep -qiE 'manifest' "$d/err3a" || {
    echo "    failure does not name the manifest problem"; cat "$d/err3a"; return 1; }
  # Leg 4: AI root exists but is a regular FILE — the -d branch's distinct
  # catch (downstream checks would misreport it as a missing manifest).
  touch "$d/ai-file"
  if "$WI_BIN" trace_filter_install_pair "$d/ai-file" "$cn" 2>"$d/err4"; then
    echo "    pair accepted a non-directory AI root"; return 1; fi
  cmp -s "$d/canon.orig" "$cn/.git/hooks/commit-msg" || {
    echo "    canonical hook rewritten despite a non-directory AI root"; return 1; }
  grep -qiE 'directory' "$d/err4" || {
    echo "    failure does not name the not-a-directory problem"; cat "$d/err4"; return 1; }
  # Adjacent control (CB5 stays): a VALID root + foreign AI-side hook still
  # repairs canonical and reports the refusal. Removing canonical's hook first
  # makes the repair observable (same bytes would re-render identically).
  local fh="$ai/.git/hooks/commit-msg"
  _write_foreign_hook "$fh"
  cp "$fh" "$d/foreign.orig"
  rm -f "$cn/.git/hooks/commit-msg"
  if "$WI_BIN" trace_filter_install_pair "$ai" "$cn" 2>"$d/err3"; then
    echo "    pair must still report the AI-side refusal"; return 1; fi
  grep -qF "$ai" "$cn/.git/hooks/commit-msg" || {
    echo "    canonical hook not re-installed for the valid root"; return 1; }
  grep -qF 'workspace-init:managed-hook' "$cn/.git/hooks/commit-msg" || {
    echo "    canonical hook missing the managed marker"; return 1; }
  cmp -s "$d/foreign.orig" "$fh" || {
    echo "    foreign AI hook was destroyed"; return 1; }
}

# ---------------------------------------------------------------------------
# Foreign-hook destruction edge cases (round-1 D class) — 2 tests
# ---------------------------------------------------------------------------

test_D1_dangling_symlink_hook_never_destroyed() {
  # A dangling symlink is not a regular file (-f fails) but it is still the
  # user's hook: install must refuse, and rollback must leave the link intact.
  local d; d="$(wi_tmpdir)"; mkdir -p "$d"
  local ai="$d/foo-ai" cn="$d/foo"
  mkdir -p "$ai/.workspace" "$cn"
  git -C "$cn" init -q 2>/dev/null
  "$WI_BIN" manifest_write "$ai" "$cn" personal >/dev/null 2>&1 || return 1
  ln -s "$d/nonexistent-target" "$cn/.git/hooks/commit-msg"
  local want; want="$(readlink "$cn/.git/hooks/commit-msg")"
  if "$WI_BIN" trace_filter_install "$ai" "$cn" 2>/dev/null; then
    echo "    install overwrote a dangling foreign symlink"; return 1
  fi
  [[ "$(readlink "$cn/.git/hooks/commit-msg")" == "$want" ]] || {
    echo "    dangling symlink changed by refused install"; return 1; }
  # Rollback of a logged HOOK_INSTALL must not remove the link either (the
  # HOOK_INSTALL inverse must see -L, not just -f).
  local log="$ai/.workspace/init-log"
  wi_log_op "$log" HOOK_INSTALL "$cn"
  wi_rollback "$log" >/dev/null 2>&1
  [[ -L "$cn/.git/hooks/commit-msg" ]] || {
    echo "    rollback deleted the dangling symlink"; return 1; }
  [[ "$(readlink "$cn/.git/hooks/commit-msg")" == "$want" ]] || {
    echo "    rollback rewrote the dangling symlink"; return 1; }
}

test_D2_scenario_c_skill_documents_foreign_hook_refusal() {
  # Scenario C pairs populated repos — a foreign commit-msg hook is likely.
  # The skill must carry the refusal guidance as one contiguous line (RB4).
  grep -qF 'the trace-filter install refuses rather than overwriting a hook it did not install' \
      "$WI_PLUGIN_ROOT/skills/pairing-existing-dual/SKILL.md" || {
    echo "    pairing-existing-dual does not document the foreign-hook refusal"; return 1; }
}

# ---------------------------------------------------------------------------
# Run all
# ---------------------------------------------------------------------------

# Positive
wi_test_run test_P1_co_authored_by_claude_blocks
wi_test_run test_P2_co_authored_by_human_blocks
wi_test_run test_P3_robot_marker_at_line_start_blocks
wi_test_run test_P4_anthropic_noreply_substring_blocks
wi_test_run test_P5_openai_noreply_substring_blocks
wi_test_run test_P6_multi_pattern_blocks_on_first_match

# Negative
wi_test_run test_N1_plain_message_allows
wi_test_run test_N2_co_authored_mid_line_allows
wi_test_run test_N3_robot_marker_mid_line_allows
wi_test_run test_N4_docs_describing_pattern_allows
wi_test_run test_N5_bare_email_without_brackets_allows
wi_test_run test_N6_empty_body_allows

# Edge
wi_test_run test_E1_manifest_missing_fails_closed_with_repair
wi_test_run test_E2_enforce_false_allows_everything
wi_test_run test_E3_empty_patterns_array_allows
wi_test_run test_E4_malformed_json_manifest_fails_closed
wi_test_run test_E9_missing_or_nonboolean_enforce_blocks
wi_test_run test_E10_unreadable_blocked_patterns_blocks
wi_test_run test_E5_trailer_at_line_start_in_multiline_blocks
wi_test_run test_E6_pattern_at_line_start_with_trailing_whitespace_blocks
wi_test_run test_E7_unicode_robot_at_line_start_blocks
wi_test_run test_E8_render_substitutes_token

# Install target-repo shapes (#85)
wi_test_run test_S1_install_separate_git_dir_canonical
wi_test_run test_S2_install_standard_repo_still_works
wi_test_run test_S3_install_rejects_non_repo
wi_test_run test_S4_install_ignores_custom_hooks_path
wi_test_run test_S5_install_rejects_repo_subdir
wi_test_run test_S6_install_rejects_bare_repo
wi_test_run test_S7_install_rejects_linked_worktree

# Foreign-hook install safety (#457)
wi_test_run test_F1_install_refuses_foreign_hook_preserves_bytes
wi_test_run test_F2_render_failure_preserves_own_hook
wi_test_run test_F3_install_replaces_own_marked_hook
wi_test_run test_F4_foreign_hook_mentioning_workspace_init_refused
wi_test_run test_F5_legacy_installed_hook_is_replaced
wi_test_run test_F6_marker_text_embedded_in_line_stays_foreign

# Special-character workspace paths (#458)
wi_test_run test_SC0_plain_path_control
wi_test_run test_SC1_ampersand_in_path
wi_test_run test_SC2_pipe_in_path
wi_test_run test_SC3_backslash_in_path
wi_test_run test_SC4_dquote_in_path
wi_test_run test_SC5_dollar_in_path
wi_test_run test_SC6_backtick_in_path
wi_test_run test_SC7_space_in_path
wi_test_run test_SC8_squote_in_path
wi_test_run test_SC9_placeholder_text_in_path

# Named-repair contract + moved-workspace repair (#481)
wi_test_run test_R1_hook_repair_names_existing_wi_verb
wi_test_run test_M1_moved_workspace_repair_restores_filter

# Single-JSON-object manifest policy (RB1, CB2)
wi_test_run test_O1_empty_manifest_blocks
wi_test_run test_O2_whitespace_only_manifest_blocks
wi_test_run test_O3_concatenated_documents_block
wi_test_run test_O4_top_level_array_manifest_blocks

# Error status is never a pass (CB1)
wi_test_run test_F7_invalid_ere_blocks_without_trailer
wi_test_run test_F8_invalid_ere_blocks_with_trailer
wi_test_run test_F9_non_string_pattern_blocks

# Repairs that actually repair (RB2/RB3/RB5, CB4/CB5/CB6/CB8)
wi_test_run test_H1_missing_jq_blocks_naming_jq
wi_test_run test_H2_relative_path_repair_restores_filter
wi_test_run test_H3_hint_names_main_worktree_not_linked
wi_test_run test_H4_manifest_repair_verb_rewrites_manifest
wi_test_run test_H5_pair_repair_updates_canonical_despite_foreign_ai_hook
wi_test_run test_H6_workspace_init_mentions_resolve_to_real_commands

# Foreign-hook destruction edges (CB3, RB4)
wi_test_run test_Q5_pair_install_validates_ai_root_before_writes
wi_test_run test_D1_dangling_symlink_hook_never_destroyed
wi_test_run test_D2_scenario_c_skill_documents_foreign_hook_refusal

wi_test_summary
