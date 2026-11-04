#!/usr/bin/env bash
# membrane OPT-IN SessionStart hook.
#
# This file ships with the plugin but is NOT declared in plugin.json's "hooks"
# array. Default install has zero ambient surface (no hook fires on session start).
#
# To enable the "last audit N days ago" reminder, add this snippet to your
# ~/.claude/settings.json (replace the path with your actual plugin install dir):
#
# {
#   "hooks": {
#     "SessionStart": [
#       { "command": "bash <plugin_install_dir>/membrane/hooks/session-start-reminder.sh" }
#     ]
#   }
# }
#
# This is opt-in because v0.1's threat model flags plugin-installed SessionStart
# hooks as a Critical attack surface. The plugin therefore does not register
# one on the user's behalf — that would put the plugin's own shell into the
# very surface its rules treat as high-severity.

set -u

STATE_FILE="$PWD/.claude/audits/state.json"
[[ -r "$STATE_FILE" ]] || exit 0

LAST_DATE="$(jq -r '.last_audit.date // empty' "$STATE_FILE" 2>/dev/null)"
[[ -n "$LAST_DATE" ]] || exit 0

LAST_EPOCH=0
if date -d "$LAST_DATE" +%s >/dev/null 2>&1; then
  LAST_EPOCH="$(date -d "$LAST_DATE" +%s)"
elif date -j -f "%Y-%m-%dT%H:%M:%SZ" "$LAST_DATE" +%s >/dev/null 2>&1; then
  LAST_EPOCH="$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%SZ" "$LAST_DATE" +%s)"
fi
NOW_EPOCH="$(date -u +%s)"
DAYS_AGO=$(( (NOW_EPOCH - LAST_EPOCH) / 86400 ))

# The current set comes from the same library the audit uses, so the note
# compares like with like: user, project and local settings, an object map or an
# array. An unreadable set is unknown, so no change is claimed.
SNAPSHOT_NAMES="$(jq -r '.last_audit.enabled_plugins_snapshot[]?.name // empty' "$STATE_FILE" 2>/dev/null | sort -u)"
PLUGIN_DELTA=""
_HOOK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" 2>/dev/null && pwd)"
if [[ -n "$_HOOK_LIB" && -f "$_HOOK_LIB/helpers.sh" && -f "$_HOOK_LIB/enumerate-targets.sh" ]]; then
  # shellcheck source=/dev/null
  source "$_HOOK_LIB/helpers.sh"
  # shellcheck source=/dev/null
  source "$_HOOK_LIB/enumerate-targets.sh"
  if CURRENT_RAW="$(csa_enum_enabled_plugins "$PWD" 2>/dev/null)"; then
    CURRENT_NAMES="$(printf '%s\n' "$CURRENT_RAW" | sort -u)"
    if [[ "$SNAPSHOT_NAMES" != "$CURRENT_NAMES" ]]; then
      PLUGIN_DELTA=" Note: enabled-plugin set changed since then."
    fi
  fi
fi

printf 'membrane: last audit %d days ago.%s Run /security-audit when ready.\n' "$DAYS_AGO" "$PLUGIN_DELTA"
