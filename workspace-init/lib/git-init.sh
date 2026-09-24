#!/usr/bin/env bash
# lib/git-init.sh — git init + default-branch detection + staging.
#
# Implements SPEC §8.4 (default-branch fallback chain) and §8.8 (git init
# both repos + `git add .` AI workspace, stage-don't-commit).
#
# Requires: lib/_helpers.sh, git on PATH.
# Bash 3.2+ compatible (stock macOS).

set -u

# Auto-source helpers if not already loaded (mirrors stubs.sh pattern).
if ! declare -F wi_log_op >/dev/null 2>&1; then
  # shellcheck source=./_helpers.sh
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_helpers.sh"
fi

# ---------------------------------------------------------------------------
# wi_git_init — initialize a single git repo at the given path on `main`.
#
# Args:
#   $1  repo-root             path to initialize
#   $2  ai-root-for-log       (optional, default=$1) AI workspace root whose
#                             .workspace/init-log receives the GIT_INIT entry.
#
# Idempotent: if $repo/.git already exists (directory or gitfile), logs a warn
# and returns 0 without changing the existing repository's branch.
# ---------------------------------------------------------------------------
wi_git_init() {
  local repo="$1"
  local ai_root_for_log="${2:-$repo}"

  if [[ -e "$repo/.git" ]]; then
    wi_log_warn "wi_git_init: $repo already a git repo; skipping"
    return 0
  fi

  if [[ ! -d "$repo" ]]; then
    wi_log_error "wi_git_init: not a directory: $repo"
    return 1
  fi

  # Pin the unborn branch explicitly. Git 2.28+ supports --initial-branch;
  # older Git releases need a plain init followed by an explicit HEAD update.
  # Both paths ignore machine-level init.defaultBranch without imposing a new
  # minimum Git version (#103).
  if ! git -C "$repo" init -q --initial-branch=main 2>/dev/null; then
    if ! git -C "$repo" init -q 2>/dev/null \
      || ! git -C "$repo" symbolic-ref HEAD refs/heads/main 2>/dev/null; then
      wi_log_error "wi_git_init: git init failed for $repo"
      return 1
    fi
  fi

  local log="${ai_root_for_log}/.workspace/init-log"
  wi_log_op "$log" GIT_INIT "$repo"
  return 0
}

# ---------------------------------------------------------------------------
# wi_git_init_pair — fresh mode: git init BOTH the AI workspace and canonical.
#
# Args:
#   $1  ai-root               AI workspace root
#   $2  canonical-root        canonical repo root
# ---------------------------------------------------------------------------
wi_git_init_pair() {
  local ai_root="$1"
  local canonical_root="$2"
  wi_git_init "$ai_root" "$ai_root" || return 1
  wi_git_init "$canonical_root" "$ai_root" || return 1
  return 0
}

# ---------------------------------------------------------------------------
# wi_git_init_ai_only — pair-with mode: git init only the AI workspace.
# Canonical is assumed to be an existing git repo.
# ---------------------------------------------------------------------------
wi_git_init_ai_only() {
  local ai_root="$1"
  wi_git_init "$ai_root" "$ai_root"
}

# ---------------------------------------------------------------------------
# wi_git_detect_default_branch — SPEC §8.4 4-step fallback chain.
#
# Args:
#   $1  repo-path
#
# Order:
#   1. git symbolic-ref refs/remotes/origin/HEAD   (origin's HEAD if set)
#   2. git symbolic-ref HEAD                       (local HEAD)
#   3. git branch --show-current                   (current branch)
#   4. Prompt user (reads stdin; default = `main`)
#
# Emits the detected branch on stdout. Always returns 0 (the prompt path
# always yields a value).
# ---------------------------------------------------------------------------
wi_git_detect_default_branch() {
  local repo="$1"
  local branch=""

  # Each probe below is EXPECTED to fail on some repos (no origin/HEAD, a
  # detached HEAD, not a repo at all). Under the dispatcher's
  # `set -euo pipefail` a failing probe would abort the whole function before
  # the next fallback runs (#482), so every probe's failure is absorbed with
  # `|| branch=""` and the chain moves on.

  # Step 1: origin/HEAD symbolic-ref.
  branch="$(git -C "$repo" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null \
    | sed 's@^refs/remotes/origin/@@')" || branch=""
  if [[ -n "$branch" ]]; then
    printf '%s\n' "$branch"
    return 0
  fi

  # Step 2: local HEAD symbolic-ref.
  branch="$(git -C "$repo" symbolic-ref HEAD 2>/dev/null \
    | sed 's@^refs/heads/@@')" || branch=""
  if [[ -n "$branch" ]]; then
    printf '%s\n' "$branch"
    return 0
  fi

  # Step 3: branch --show-current.
  branch="$(git -C "$repo" branch --show-current 2>/dev/null)" || branch=""
  if [[ -n "$branch" ]]; then
    printf '%s\n' "$branch"
    return 0
  fi

  # Step 4: prompt path. Read one line from stdin (testable via pipe).
  printf 'Could not detect default branch for %s. Enter (e.g., main, master, develop) [main]: ' \
    "$repo" >&2
  local input
  if IFS= read -r input; then
    if [[ -z "$input" ]]; then
      printf 'main\n'
    else
      printf '%s\n' "$input"
    fi
  else
    # EOF on stdin → default to main.
    printf 'main\n'
  fi
  return 0
}

# ---------------------------------------------------------------------------
# wi_git_detect_remote — emit origin URL on stdout, or nothing if no origin.
#
# Args:
#   $1  repo-path
#
# Always returns 0 (caller treats empty stdout as "no remote").
# ---------------------------------------------------------------------------
wi_git_detect_remote() {
  local repo="$1"
  git -C "$repo" remote get-url origin 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# wi_git_stage_ai_workspace — `git add .` in the AI workspace.
#
# Args:
#   $1  ai-root
#
# Stages all working-tree files; does NOT commit (SPEC §8.8 step 8: "review +
# commit yourself"). Logs a GIT_STAGE entry to init-log.
# ---------------------------------------------------------------------------
wi_git_stage_ai_workspace() {
  local ai_root="$1"

  # Accept both a normal .git directory and a gitfile-backed worktree (for
  # example `git init --separate-git-dir`). This matches wi_git_init's
  # idempotence check; git itself remains the authority on whether `add` works.
  if [[ ! -e "$ai_root/.git" ]]; then
    wi_log_error "wi_git_stage_ai_workspace: not a git repo: $ai_root"
    return 1
  fi

  if ! git -C "$ai_root" add . 2>/dev/null; then
    wi_log_error "wi_git_stage_ai_workspace: git add failed in $ai_root"
    return 1
  fi

  local log="${ai_root}/.workspace/init-log"
  wi_log_op "$log" GIT_STAGE "$ai_root"
  return 0
}
