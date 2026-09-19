#!/usr/bin/env bash
# lib/trace-filter.sh — render + install commit-msg hook with baked AI workspace path.
#
# The commit-msg hook (hooks/commit-msg.tmpl) reads the pairing manifest to
# decide which patterns to block. The AI workspace absolute path is baked into
# the hook at install time so canonical's hook (in canonical's .git/hooks/) can
# find the sibling manifest without a walk-up search.
#
# Requires: lib/_helpers.sh (wi_log_op, wi_log_error)

set -u

if ! declare -F wi_log_op >/dev/null 2>&1; then
  # shellcheck disable=SC1091
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_helpers.sh"
fi
if ! declare -F wi_git_is_linked_worktree >/dev/null 2>&1; then
  # shellcheck disable=SC1091
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/skeleton.sh"
fi

# Locate the hooks/commit-msg.tmpl. Prefer WI_HOOKS_DIR (set by tests/_helpers.sh)
# with a relative-to-script fallback for production.
_wi_trace_filter_template() {
  if [[ -n "${WI_HOOKS_DIR:-}" && -f "${WI_HOOKS_DIR}/commit-msg.tmpl" ]]; then
    echo "${WI_HOOKS_DIR}/commit-msg.tmpl"
  else
    echo "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/hooks/commit-msg.tmpl"
  fi
}

# Ownership marker lines baked into every hook this plugin installs. The
# pre-0.5.1 template had no dedicated marker; its auto-installed header line is
# the legacy recognition line (field installs must stay re-bakeable so the
# moved-workspace repair keeps working).
_WI_TRACE_FILTER_MARKER='# workspace-init:managed-hook'
_WI_TRACE_FILTER_LEGACY='# workspace-init: commit-msg AI-trace filter (auto-installed)'

# _wi_trace_filter_is_our_hook <hook-file>
# True iff the file is a hook this plugin installed: a whole line equal to the
# marker, or the legacy header. A hook that merely *mentions* workspace-init,
# or quotes a marker inside a longer line, is foreign.
_wi_trace_filter_is_our_hook() {
  local hook="$1"
  [[ -f "$hook" ]] || return 1
  grep -qxF "$_WI_TRACE_FILTER_MARKER" "$hook" 2>/dev/null && return 0
  grep -qxF "$_WI_TRACE_FILTER_LEGACY" "$hook" 2>/dev/null
}

# wi_trace_filter_render <ai-workspace-root>
# Render the template substituting __AI_WORKSPACE_PATH__ with the given absolute path.
# Output goes to stdout. Returns 1 if the template is missing or unreadable.
wi_trace_filter_render() {
  local ai_root="$1"
  local tmpl
  tmpl="$(_wi_trace_filter_template)"
  if [[ ! -f "$tmpl" ]]; then
    wi_log_error "wi_trace_filter_render: template not found: $tmpl"
    return 1
  fi
  local content
  if ! content="$(cat "$tmpl")"; then
    wi_log_error "wi_trace_filter_render: could not read template: $tmpl"
    return 1
  fi
  # Bake the path shell-quoted (the template assigns it unquoted), so every
  # byte — & | \ " $ ` ' space — survives literally into the generated bash.
  # Splice left-to-right with %%/# ops, NOT ${var//…} or sed: under bash 5.2+
  # patsub_replacement (and always under sed), '&' in the replacement expands
  # to the matched text. Building a separate output accumulator also means a
  # path that itself contains the placeholder text terminates cleanly.
  local quoted
  quoted="$(printf '%q' "$ai_root")"
  local rendered="" rest="$content"
  while [[ "$rest" == *__AI_WORKSPACE_PATH__* ]]; do
    rendered+="${rest%%__AI_WORKSPACE_PATH__*}${quoted}"
    rest="${rest#*__AI_WORKSPACE_PATH__}"
  done
  printf '%s\n' "${rendered}${rest}"
}

# wi_trace_filter_is_installable_repo_root <target-repo>
# True only for an own git worktree root whose repo-local hooks dir is usable.
# Rejects non-repos, bare repos, nested subdirs of a parent repo, and linked worktrees.
wi_trace_filter_is_installable_repo_root() {
  local target_repo="${1:-}"
  [[ -n "$target_repo" ]] || return 1

  local inside_work_tree
  inside_work_tree="$(git -C "$target_repo" rev-parse --is-inside-work-tree 2>/dev/null)" || return 1
  [[ "$inside_work_tree" == "true" ]] || return 1

  local top_level target_canon top_canon
  top_level="$(git -C "$target_repo" rev-parse --show-toplevel 2>/dev/null)" || return 1
  target_canon="$(wi_realpath "$target_repo")"
  top_canon="$(wi_realpath "$top_level")"
  [[ "$target_canon" == "$top_canon" ]] || return 1

  if wi_git_is_linked_worktree "$target_repo"; then
    return 1
  fi
  return 0
}

# wi_trace_filter_install <ai-workspace-root> <target-repo>
# Render + write the commit-msg hook to the repo's resolved hooks dir + chmod +x + log HOOK_INSTALL.
wi_trace_filter_install() {
  local ai_root="$1"
  local target_repo="$2"
  if ! wi_trace_filter_is_installable_repo_root "$target_repo"; then
    wi_log_error "wi_trace_filter_install: target is not an installable git repo root: $target_repo"
    return 1
  fi

  # Use the repo's real git dir, not `--git-path hooks`: the trace filter is intentionally
  # installed into the repo-local hooks dir even when core.hooksPath points elsewhere.
  local git_dir hooks_dir
  git_dir="$(git -C "$target_repo" rev-parse --git-dir 2>/dev/null)" || {
    wi_log_error "wi_trace_filter_install: could not resolve hooks dir: $target_repo"
    return 1
  }
  hooks_dir="${git_dir}/hooks"
  case "$hooks_dir" in
    /*) : ;;
    *)  hooks_dir="${target_repo}/${hooks_dir}" ;;
  esac
  mkdir -p "$hooks_dir" || {
    wi_log_error "wi_trace_filter_install: mkdir failed: $hooks_dir"
    return 1
  }
  local out="${hooks_dir}/commit-msg"
  # Never displace a hook we did not install (#457). Our own hook (marker line,
  # or the pre-0.5.1 legacy header) stays replaceable so the moved-workspace
  # repair can re-bake it; anything else is refused before a byte is touched.
  if [[ -f "$out" ]] && ! _wi_trace_filter_is_our_hook "$out"; then
    wi_log_error "wi_trace_filter_install: refusing to overwrite existing commit-msg hook not installed by workspace-init: $out"
    return 1
  fi
  # Render to a temp file and move it into place — a failed render must never
  # destroy an existing hook (#457).
  local tmp="${out}.tmp.$$"
  if ! wi_trace_filter_render "$ai_root" > "$tmp" 2>/dev/null; then
    rm -f "$tmp"
    wi_log_error "wi_trace_filter_install: render failed"
    return 1
  fi
  chmod +x "$tmp" || {
    rm -f "$tmp"
    wi_log_error "wi_trace_filter_install: chmod failed: $tmp"
    return 1
  }
  mv -f "$tmp" "$out" || {
    rm -f "$tmp"
    wi_log_error "wi_trace_filter_install: could not install hook: $out"
    return 1
  }
  local log="${ai_root}/.workspace/init-log"
  wi_log_op "$log" HOOK_INSTALL "$target_repo"
  return 0
}

# wi_trace_filter_install_pair <ai-workspace-root> <canonical-root>
# Install in both AI workspace and canonical.
wi_trace_filter_install_pair() {
  local ai_root="$1"
  local canonical_root="$2"
  wi_trace_filter_install "$ai_root" "$ai_root" || return 1
  wi_trace_filter_install "$ai_root" "$canonical_root" || return 1
  return 0
}
