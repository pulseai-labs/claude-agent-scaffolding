#!/usr/bin/env bash
# tests/test-hook-portable.sh — #983: the commit-msg hook finds the manifest
# from the repo it runs in, not from an absolute path baked on one host.
# Covers (11 tests):
#   X1. a pair moved to another parent (old absolute path gone): both hooks
#       find the manifest, a trailer is blocked by the pattern, a clean commit
#       passes — from each repo and from a linked worktree of the canonical
#   X2. a legacy fail-open hook carrying a dead absolute path: the repair verb
#       rewrites it to the reference form, and the trailer is then blocked
#   X3. the sibling AI workspace is gone: fail closed, naming the path and
#       the WI_TRACE_FILTER_MANIFEST escape
#   X4. the workspace is present but its manifest is not: fail closed
#   X5. the escape names a moved manifest: the filter still runs and is
#       announced; a clean commit passes
#   X6. a pair that is not side by side bakes abs:<path> (adjacent control)
#   X7. a canonical whose .git turned into a file after install: fail closed;
#       re-installing there bakes abs:<path> and filters again
#   X8. an unrecognised reference: fail closed
#   X9. a canonical whose .git is a symlink: the installer bakes abs:, as the
#       hook could not resolve sibling there; a hook already baked sibling
#       before the symlink fails closed, and re-installing clears it
#       (#983 review C1 — the README remedy must not loop)
#   X10. an exported CDPATH holding a .git: install and commit both ignore
#       it (#983 review C2)
#   X11. a .git symlink to a directory that IS named .git but belongs to
#       another parent: abs:, since the hook would resolve against that
#       parent (#983 review C5)

source "$(dirname "$0")/_helpers.sh"
source "$WI_LIB_DIR/_helpers.sh"

_WI_TMP="$(mktemp -d "${TMPDIR:-/tmp}/wi-portable-test.XXXXXX")"
_WI_TMP="$(cd "$_WI_TMP" && pwd -P)"
trap 'rm -rf -- "$_WI_TMP"' EXIT

_commit() { # $1=repo $2=message $3=stderr-file
  git -C "$1" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "$2" 2>"$3"
}

_ref() { # the reference a hook bakes, evaluated as bash reads it
  ( eval "$(grep -m1 -E '^AI_WORKSPACE_REF=' "$1")"; printf '%s' "$AI_WORKSPACE_REF" )
}

# A paired, hooked p-ai + p under <parent>. Echoes nothing; fails loudly.
_make_pair() {
  local parent="$1"
  mkdir -p "$parent/p-ai" "$parent/p"
  git -C "$parent/p-ai" init -q && git -C "$parent/p" init -q || return 1
  "$WI_BIN" manifest_write "$parent/p-ai" "$parent/p" work --default-branch main >/dev/null 2>&1 || {
    echo "    manifest_write failed"; return 1; }
  "$WI_BIN" trace_filter_install_pair "$parent/p-ai" "$parent/p" 2>/dev/null || {
    echo "    trace_filter_install_pair failed"; return 1; }
  _commit "$parent/p" 'seed' /dev/null || { echo "    seed commit failed"; return 1; }
}

_trailer=$'subject\n\nCo-Authored-By: Bot <bot@x>'

# Trailer blocked BY THE PATTERN (so the manifest was found and evaluated),
# and a clean commit passes (so the hook is not simply failing everything).
_assert_filters() { # $1=repo $2=label
  local err="$_WI_TMP/err"
  _commit "$1" "$_trailer" "$err" && { echo "    $2: trailer commit allowed"; return 1; }
  grep -q 'blocked AI-trace pattern' "$err" || {
    echo "    $2: block did not come from the pattern"; cat "$err"; return 1; }
  _commit "$1" 'clean subject' "$err" || {
    echo "    $2: clean commit blocked"; cat "$err"; return 1; }
}

_assert_closed() { # $1=stderr-file $2=reason-substring
  grep -qF 'fails closed' "$1" || { echo "    block does not say it fails closed"; cat "$1"; return 1; }
  grep -qF "$2" "$1" || { echo "    block does not name: $2"; cat "$1"; return 1; }
  grep -qF 'WI_TRACE_FILTER_MANIFEST=' "$1" || { echo "    block does not name the escape"; cat "$1"; return 1; }
}

test_X1_moved_pair_resolves_from_its_own_repo() {
  local a="$_WI_TMP/x1/hostA" b="$_WI_TMP/x1/hostB"
  _make_pair "$a" || return 1
  assert_eq "sibling:p-ai" "$(_ref "$a/p/.git/hooks/commit-msg")" || return 1
  assert_eq "self" "$(_ref "$a/p-ai/.git/hooks/commit-msg")" || return 1
  mkdir -p "$b"; mv "$a/p" "$a/p-ai" "$b/"; rmdir "$a"
  [[ ! -e "$a" ]] || { echo "    precondition: the install-time path still exists"; return 1; }
  _assert_filters "$b/p" canonical || return 1
  _assert_filters "$b/p-ai" "AI workspace" || return 1
  git -C "$b/p" worktree add -q "$_WI_TMP/x1/wt" 2>/dev/null || { echo "    worktree add failed"; return 1; }
  _assert_filters "$_WI_TMP/x1/wt" "canonical linked worktree" || return 1
}

test_X2_legacy_dead_path_hook_is_rewritten_by_repair() {
  local d="$_WI_TMP/x2"
  _make_pair "$d" || return 1
  local hook="$d/p/.git/hooks/commit-msg"
  # The pre-0.5.1 hook as found on the #951 pilot repos, with its baked
  # /Users/draco/... path swapped for one that is gone on every host (the
  # real path exists on the MacBook, where this suite also runs).
  local dead="$d/install-host/p-ai" legacy
  legacy='#!/usr/bin/env bash
# workspace-init: commit-msg AI-trace filter (auto-installed)
# DO NOT EDIT — regenerated on workspace-init runs.
# Embedded AI workspace path: __DEAD__

AI_WORKSPACE_PATH="__DEAD__"
MANIFEST_PATH="${AI_WORKSPACE_PATH}/.workspace/pairing.json"

commit_msg_file="$1"
if [[ ! -f "$commit_msg_file" ]]; then exit 0; fi

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "warning: workspace-init manifest not found at $MANIFEST_PATH; trace filter disabled. Re-run /init-workspace --repair." >&2
  exit 0
fi
exit 0'
  printf '%s\n' "${legacy//__DEAD__/$dead}" > "$hook"
  chmod +x "$hook"
  [[ ! -e "$dead" ]] || { echo "    precondition: the legacy path exists"; return 1; }
  # Precondition: the legacy hook fails open — this is the #983 defect.
  _commit "$d/p" "$_trailer" "$_WI_TMP/err" || { echo "    precondition: legacy hook blocked"; return 1; }
  "$WI_BIN" trace_filter_install_pair "$d/p-ai" "$d/p" 2>/dev/null || { echo "    repair failed"; return 1; }
  grep -qF "$dead" "$hook" && { echo "    repaired hook still names the dead path"; return 1; }
  assert_eq "sibling:p-ai" "$(_ref "$hook")" || return 1
  _assert_filters "$d/p" "repaired canonical" || return 1
}

test_X3_missing_sibling_workspace_fails_closed() {
  local d="$_WI_TMP/x3"
  _make_pair "$d" || return 1
  mv "$d/p-ai" "$d/p-ai-elsewhere"
  _commit "$d/p" 'clean subject' "$_WI_TMP/err" && { echo "    commit allowed with no AI workspace"; return 1; }
  _assert_closed "$_WI_TMP/err" "AI workspace path is unreachable: $d/p-ai;" || return 1
}

test_X4_missing_manifest_fails_closed() {
  local d="$_WI_TMP/x4"
  _make_pair "$d" || return 1
  rm "$d/p-ai/.workspace/pairing.json"
  _commit "$d/p" 'clean subject' "$_WI_TMP/err" && { echo "    commit allowed with no manifest"; return 1; }
  _assert_closed "$_WI_TMP/err" "manifest not found at $d/p-ai/.workspace/pairing.json" || return 1
}

test_X5_escape_keeps_the_filter_running() {
  local d="$_WI_TMP/x5"
  _make_pair "$d" || return 1
  mv "$d/p-ai" "$d/p-ai-elsewhere"
  local m="$d/p-ai-elsewhere/.workspace/pairing.json" err="$_WI_TMP/err"
  WI_TRACE_FILTER_MANIFEST="$m" _commit "$d/p" "$_trailer" "$err" && {
    echo "    trailer allowed under the escape"; return 1; }
  grep -q 'blocked AI-trace pattern' "$err" || { echo "    escape block is not the pattern"; cat "$err"; return 1; }
  grep -qF "WI_TRACE_FILTER_MANIFEST: $m" "$err" || { echo "    escape not announced"; cat "$err"; return 1; }
  WI_TRACE_FILTER_MANIFEST="$m" _commit "$d/p" 'clean subject' "$err" || {
    echo "    clean commit blocked under the escape"; cat "$err"; return 1; }
  # The escape names a manifest; a wrong one still fails closed.
  WI_TRACE_FILTER_MANIFEST="$d/nope.json" _commit "$d/p" 'clean subject' "$err" && {
    echo "    a missing escape manifest was accepted"; return 1; }
  _assert_closed "$err" "manifest not found at $d/nope.json" || return 1
}

test_X6_non_sibling_pair_bakes_absolute_path() {
  local d="$_WI_TMP/x6"
  mkdir -p "$d/a/p-ai" "$d/b/p"
  git -C "$d/a/p-ai" init -q && git -C "$d/b/p" init -q || return 1
  "$WI_BIN" manifest_write "$d/a/p-ai" "$d/b/p" work --default-branch main >/dev/null 2>&1 || return 1
  "$WI_BIN" trace_filter_install_pair "$d/a/p-ai" "$d/b/p" 2>/dev/null || { echo "    install failed"; return 1; }
  assert_eq "abs:$d/a/p-ai" "$(_ref "$d/b/p/.git/hooks/commit-msg")" || return 1
  assert_eq "self" "$(_ref "$d/a/p-ai/.git/hooks/commit-msg")" || return 1
  _assert_filters "$d/b/p" "non-sibling canonical" || return 1
}

test_X7_git_file_repo_fails_closed() {
  local d="$_WI_TMP/x7"
  _make_pair "$d" || return 1
  # Move canonical's git dir out; .git becomes a gitdir: file. The sibling
  # reference can no longer be resolved from the common dir's parent.
  git -C "$d/p" init -q --separate-git-dir="$d/p.git" >/dev/null 2>&1 || { echo "    separate-git-dir failed"; return 1; }
  [[ -f "$d/p/.git" ]] || { echo "    precondition: .git is not a file"; return 1; }
  _commit "$d/p" 'clean subject' "$_WI_TMP/err" && { echo "    commit allowed with an unresolvable root"; return 1; }
  _assert_closed "$_WI_TMP/err" "cannot locate this repository's main worktree" || return 1
  # Re-installing into that repo bakes the absolute form, which needs no root.
  "$WI_BIN" trace_filter_install "$d/p-ai" "$d/p" 2>/dev/null || { echo "    re-install failed"; return 1; }
  assert_eq "abs:$d/p-ai" "$(_ref "$d/p.git/hooks/commit-msg")" || return 1
  _assert_filters "$d/p" "separate-git-dir canonical" || return 1
}

test_X8_unrecognised_reference_fails_closed() {
  local d="$_WI_TMP/x8"
  _make_pair "$d" || return 1
  local hook="$d/p/.git/hooks/commit-msg"
  sed 's/^AI_WORKSPACE_REF=.*/AI_WORKSPACE_REF=bogus/' "$hook" > "$hook.new" && mv "$hook.new" "$hook" && chmod +x "$hook"
  _commit "$d/p" 'clean subject' "$_WI_TMP/err" && { echo "    commit allowed with a bad reference"; return 1; }
  _assert_closed "$_WI_TMP/err" "unrecognised AI workspace reference: bogus" || return 1
}

test_X9_symlinked_git_dir_bakes_absolute() {
  local d="$_WI_TMP/x9"
  _make_pair "$d" || return 1
  # Canonical's .git becomes a symlink to a directory with another name.
  mkdir -p "$d/store"
  mv "$d/p/.git" "$d/store/p-real.git" && ln -s "$d/store/p-real.git" "$d/p/.git" || return 1
  [[ -L "$d/p/.git" && -d "$d/p/.git" ]] || { echo "    precondition: .git is not a symlinked dir"; return 1; }
  # The hook baked sibling before the change, so it cannot resolve now.
  _commit "$d/p" 'clean subject' "$_WI_TMP/err" && { echo "    commit allowed with an unresolvable root"; return 1; }
  _assert_closed "$_WI_TMP/err" "cannot locate this repository's main worktree" || return 1
  # The README remedy: re-install. It must record abs:, not sibling again.
  "$WI_BIN" trace_filter_install "$d/p-ai" "$d/p" 2>/dev/null || { echo "    re-install failed"; return 1; }
  assert_eq "abs:$d/p-ai" "$(_ref "$d/store/p-real.git/hooks/commit-msg")" \
    "a symlinked .git must bake abs:" || return 1
  _assert_filters "$d/p" "symlinked-.git canonical" || return 1
}

test_X10_exported_cdpath_is_ignored() {
  local d="$_WI_TMP/x10"
  mkdir -p "$d/decoy/.git"
  # Install under the CDPATH as well: the installer's own check must hold.
  ( export CDPATH="$d/decoy"; _make_pair "$d/pair" ) || return 1
  assert_eq "sibling:p-ai" "$(_ref "$d/pair/p/.git/hooks/commit-msg")" || return 1
  # git hands the hook a relative .git in the main worktree; with CDPATH
  # honoured, cd .git would land in decoy/.git and echo its path.
  ( export CDPATH="$d/decoy"; _assert_filters "$d/pair/p" "canonical under CDPATH" ) || return 1
  ( export CDPATH="$d/decoy"; _assert_filters "$d/pair/p-ai" "AI workspace under CDPATH" ) || return 1
  # The lib's path canonicaliser takes relative input too; CDPATH must not
  # redirect it either (the same class, swept across lib/).
  local got
  got="$(cd "$d/pair/p" && CDPATH="$d/decoy" wi_realpath .git)"
  assert_eq "$d/pair/p/.git" "$got" "wi_realpath followed CDPATH" || return 1
}

test_X11_git_dir_of_another_parent_bakes_absolute() {
  local d="$_WI_TMP/x11"
  _make_pair "$d" || return 1
  mkdir -p "$d/store/elsewhere"
  mv "$d/p/.git" "$d/store/elsewhere/.git" && ln -s "$d/store/elsewhere/.git" "$d/p/.git" || return 1
  "$WI_BIN" trace_filter_install "$d/p-ai" "$d/p" 2>/dev/null || { echo "    install failed"; return 1; }
  assert_eq "abs:$d/p-ai" "$(_ref "$d/store/elsewhere/.git/hooks/commit-msg")" \
    "a .git whose parent is not the repo must bake abs:" || return 1
  _assert_filters "$d/p" "foreign-parent .git canonical" || return 1
}

wi_test_run test_X1_moved_pair_resolves_from_its_own_repo
wi_test_run test_X2_legacy_dead_path_hook_is_rewritten_by_repair
wi_test_run test_X3_missing_sibling_workspace_fails_closed
wi_test_run test_X4_missing_manifest_fails_closed
wi_test_run test_X5_escape_keeps_the_filter_running
wi_test_run test_X6_non_sibling_pair_bakes_absolute_path
wi_test_run test_X7_git_file_repo_fails_closed
wi_test_run test_X8_unrecognised_reference_fails_closed
wi_test_run test_X9_symlinked_git_dir_bakes_absolute
wi_test_run test_X10_exported_cdpath_is_ignored
wi_test_run test_X11_git_dir_of_another_parent_bakes_absolute

wi_test_summary
