#!/usr/bin/env bash
set -u
source "$(dirname "$0")/_helpers.sh"

_csa_failed=0

test_hook_silent_when_no_state() {
  local tmp; tmp="$(mktemp -d "${TMPDIR:-/tmp}/csa-hook.XXXXXX")"
  trap "rm -rf '$tmp'" RETURN
  local out; out="$(cd "$tmp" && bash "$CSA_PLUGIN_ROOT/hooks/session-start-reminder.sh" 2>&1)"
  # No output expected; exit 0
  assert_eq "" "$out"
}

test_hook_prints_days_when_state_exists() {
  local tmp; tmp="$(mktemp -d "${TMPDIR:-/tmp}/csa-hook2.XXXXXX")"
  trap "rm -rf '$tmp'" RETURN
  mkdir -p "$tmp/.claude/audits"
  local five_days_ago
  if date -u -d '5 days ago' +%Y-%m-%dT%H:%M:%SZ >/dev/null 2>&1; then
    five_days_ago="$(date -u -d '5 days ago' +%Y-%m-%dT%H:%M:%SZ)"
  else
    five_days_ago="$(date -u -v-5d +%Y-%m-%dT%H:%M:%SZ)"
  fi
  printf '{"last_audit":{"date":"%s"}}' "$five_days_ago" > "$tmp/.claude/audits/state.json"
  local out; out="$(cd "$tmp" && bash "$CSA_PLUGIN_ROOT/hooks/session-start-reminder.sh")"
  assert_contains "$out" "membrane: last audit" || return 1
  assert_contains "$out" "days ago" || return 1
}

# #825: the reminder reads the enabled set the way the audit does, so an object
# map no longer yields the values `true`/`false`, and an unchanged set is quiet.
_hook_run() { # $1 = tmp dir with .claude/, $2 = HOME
  (cd "$1" && HOME="$2" bash "$CSA_PLUGIN_ROOT/hooks/session-start-reminder.sh" 2>&1)
}
_hook_state() { # $1 = tmp dir, rest = snapshot names
  local tmp="$1"; shift
  local snap="[]" n
  for n in "$@"; do snap="$(printf '%s' "$snap" | jq -c --arg n "$n" '. + [{name: $n}]')"; done
  mkdir -p "$tmp/.claude/audits"
  printf '{"last_audit":{"date":"2026-01-01T00:00:00Z","enabled_plugins_snapshot":%s}}\n' "$snap" > "$tmp/.claude/audits/state.json"
}

test_hook_quiet_when_object_map_set_is_unchanged() {
  local tmp; tmp="$(mktemp -d "${TMPDIR:-/tmp}/csa-hook3.XXXXXX")"
  trap "rm -rf '$tmp'" RETURN
  mkdir -p "$tmp/home/.claude" "$tmp/.claude"
  printf '%s\n' '{"enabledPlugins":{"a@m":true,"off@m":false}}' > "$tmp/.claude/settings.json"
  printf '%s\n' '{"enabledPlugins":{"u@m":true}}' > "$tmp/home/.claude/settings.json"
  _hook_state "$tmp" "a@m" "u@m"
  local out; out="$(_hook_run "$tmp" "$tmp/home")"
  assert_contains "$out" "last audit" || return 1
  [[ "$out" != *"set changed"* ]] || { printf '    false change note: %s\n' "$out" >&2; return 1; }
}

test_hook_notes_a_changed_set() {
  local tmp; tmp="$(mktemp -d "${TMPDIR:-/tmp}/csa-hook4.XXXXXX")"
  trap "rm -rf '$tmp'" RETURN
  mkdir -p "$tmp/home/.claude" "$tmp/.claude"
  printf '%s\n' '{"enabledPlugins":{"a@m":true,"new@m":true}}' > "$tmp/.claude/settings.json"
  _hook_state "$tmp" "a@m"
  local out; out="$(_hook_run "$tmp" "$tmp/home")"
  assert_contains "$out" "enabled-plugin set changed" "a newly enabled plugin is noted" || return 1
  # Disabling one (false) is a change too.
  printf '%s\n' '{"enabledPlugins":{"a@m":false}}' > "$tmp/.claude/settings.json"
  out="$(_hook_run "$tmp" "$tmp/home")"
  assert_contains "$out" "enabled-plugin set changed" "a disabled plugin is noted"
}

test_hook_claims_no_change_when_the_set_is_unreadable() {
  local tmp; tmp="$(mktemp -d "${TMPDIR:-/tmp}/csa-hook5.XXXXXX")"
  trap "rm -rf '$tmp'" RETURN
  mkdir -p "$tmp/home/.claude" "$tmp/.claude"
  mkdir "$tmp/.claude/settings.json"
  _hook_state "$tmp" "a@m"
  local out; out="$(_hook_run "$tmp" "$tmp/home")"
  assert_contains "$out" "last audit" || return 1
  [[ "$out" != *"set changed"* ]] || { printf '    claimed a change on an unknown set: %s\n' "$out" >&2; return 1; }
}

csa_test_run test_hook_silent_when_no_state          || _csa_failed=$((_csa_failed + 1))
csa_test_run test_hook_prints_days_when_state_exists || _csa_failed=$((_csa_failed + 1))
csa_test_run test_hook_quiet_when_object_map_set_is_unchanged || _csa_failed=$((_csa_failed + 1))
csa_test_run test_hook_notes_a_changed_set || _csa_failed=$((_csa_failed + 1))
csa_test_run test_hook_claims_no_change_when_the_set_is_unreadable || _csa_failed=$((_csa_failed + 1))

[[ "$_csa_failed" -eq 0 ]] || exit 1
