#!/usr/bin/env bash
# lib/principles.sh — path resolvers for the principles.md sources.
#
# Reading and merging principle files is prose work owned by the skills
# (critiquing-spec Step 2, listing-principles Steps 2–4); this lib exposes
# only the three paths so every consumer resolves the same locations.
# Existence is not asserted; callers skip missing files silently and must
# never create them on a read path.

# Returns the path to the shipped-default principles template. Resolved
# relative to this lib file's parent dir so it works regardless of
# $CLAUDE_PLUGIN_ROOT being set (test isolation).
ac_principles_shipped_path() {
  local self_dir
  self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  echo "$self_dir/templates/principles.md"
}

# Returns the user-global principles path under $HOME.
# Honors $HOME overrides (so tests can sandbox via _v02_isolate_home).
ac_principles_user_path() {
  echo "$HOME/.claude/architect-critic/principles.md"
}

# Returns the project-scoped principles path (under git toplevel) or empty
# if cwd is not inside a git repo.
ac_principles_project_path() {
  local top
  top="$(git rev-parse --show-toplevel 2>/dev/null)"
  if [[ -z "$top" ]]; then
    return 0
  fi
  echo "$top/.claude/architect-critic/principles.md"
}
