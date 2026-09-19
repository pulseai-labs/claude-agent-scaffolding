#!/usr/bin/env bash
# tests/test-trace-filter.sh — commit-msg hook regex + manifest behavior.
# Covers SPEC §7.3: anchored patterns, fail-open on missing manifest,
# empty-array short-circuit, multi-pattern detection.

source "$(dirname "$0")/_helpers.sh"
source "$WI_LIB_DIR/_helpers.sh"
source "$WI_LIB_DIR/manifest.sh"
source "$WI_LIB_DIR/trace-filter.sh"

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
  # The failure must name a repair that exists (#481) — see test_R1 for the
  # verb-contract check.
  if ! grep -q 'bin/wi trace_filter_install' "$d/stderr"; then
    echo "    expected stderr to name the wi trace_filter_install repair"
    echo "    got: $(cat "$d/stderr")"
    return 1
  fi
  return 0
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
  if ! grep -q 'bin/wi trace_filter_install' "$d/stderr"; then
    echo "    expected stderr to name the wi trace_filter_install repair"
    echo "    got: $(cat "$d/stderr")"
    return 1
  fi
  return 0
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
  grep -q 'bin/wi trace_filter_install' "$d/stderr" || {
    echo "    expected stderr to name the wi trace_filter_install repair"
    echo "    got: $(cat "$d/stderr")"; return 1; }
  # Non-boolean enforce is equally corrupt.
  tmp="$(mktemp)"
  jq '.git_policy.trace_filter.enforce = "yes"' "$manifest" > "$tmp" && mv "$tmp" "$manifest"
  rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "non-boolean enforce must fail closed (exit 1)" || return 1
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
  grep -q 'bin/wi trace_filter_install' "$d/stderr" || {
    echo "    expected stderr to name the wi trace_filter_install repair"
    echo "    got: $(cat "$d/stderr")"; return 1; }
  tmp="$(mktemp)"
  jq '.git_policy.trace_filter.blocked_patterns = "not-an-array"' "$manifest" > "$tmp" && mv "$tmp" "$manifest"
  rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" "non-array blocked_patterns must fail closed (exit 1)" || return 1
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
  # Every fail-closed branch prints the repair; the verb it names must exist —
  # a message naming a command that does not exist is the original #481 defect.
  local d; d="$(wi_tmpdir)"
  mkdir -p "$d/foo-ai"
  local hook; hook="$(_render_hook "$d")"
  local msg; msg="$(_write_msg "$d" $'x\n\nCo-Authored-By: A <a@b>\n')"
  local rc; rc="$(_run_hook "$hook" "$msg" "$d")"
  assert_eq "1" "$rc" || return 1
  grep -qF 'bin/wi trace_filter_install_pair' "$d/stderr" || {
    echo "    repair line does not name trace_filter_install_pair"
    cat "$d/stderr"; return 1; }
  grep -qF 'bin/wi trace_filter_install ' "$d/stderr" || {
    echo "    single-target repair form missing"
    cat "$d/stderr"; return 1; }
  "$WI_BIN" --list | grep -qx 'trace_filter_install_pair' || {
    echo "    trace_filter_install_pair not in wi --list"; return 1; }
  "$WI_BIN" --list | grep -qx 'trace_filter_install' || {
    echo "    trace_filter_install not in wi --list"; return 1; }
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
  # Moved workspace → manifest missing → fail CLOSED with the manifest error.
  git -C "$cn" -c user.email=t@t -c user.name=t commit -q --allow-empty \
      -m $'x\n\nCo-Authored-By: Bot <bot@x>' 2>"$d/moved-err"
  local rc=$?
  [[ "$rc" -ne 0 ]] || { echo "    trailer commit allowed after workspace move"; return 1; }
  grep -q 'manifest not found' "$d/moved-err" || {
    echo "    expected the manifest-missing failure"; cat "$d/moved-err"; return 1; }
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

wi_test_summary
