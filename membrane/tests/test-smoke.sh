#!/usr/bin/env bash
set -u
source "$(dirname "$0")/_helpers.sh"

_csa_failed=0

test_harness_loads() {
  [[ -n "$CSA_PLUGIN_ROOT" ]] || return 1
  [[ -d "$CSA_PLUGIN_ROOT/.claude-plugin" ]] || return 1
  assert_eq "membrane" "$(jq -r .name "$CSA_PLUGIN_ROOT/.claude-plugin/plugin.json")" || return 1
}

test_assertion_failures_are_loud() {
  # This test should FAIL; running it confirms the harness reports failures.
  # We invert by checking it returns non-zero.
  if assert_eq "a" "b" "intentional failure" 2>/dev/null; then
    return 1   # assert_eq returned 0, harness is broken
  fi
}

csa_test_run test_harness_loads             || _csa_failed=$((_csa_failed + 1))
csa_test_run test_assertion_failures_are_loud || _csa_failed=$((_csa_failed + 1))

[[ "$_csa_failed" -eq 0 ]] || exit 1
