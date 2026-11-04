#!/usr/bin/env bash
set -u
source "$(dirname "$0")/_helpers.sh"

_csa_failed=0

test_fixture_empty_project_exists() {
  [[ -d "$CSA_FIXTURES_DIR/clean/empty-project" ]] || return 1
}
test_fixture_minimal_project_exists() {
  [[ -f "$CSA_FIXTURES_DIR/clean/minimal-project/.claude/settings.json" ]] || return 1
}
test_fixture_standard_project_exists() {
  [[ -f "$CSA_FIXTURES_DIR/clean/standard-project/.claude/settings.json" ]] || return 1
  [[ -f "$CSA_FIXTURES_DIR/clean/standard-project/CLAUDE.md" ]] || return 1
}
test_fixture_plugin_using_exists() {
  [[ -f "$CSA_FIXTURES_DIR/clean/plugin-using-project/.claude/settings.json" ]] || return 1
}
test_fixture_teamworkflow_exists() {
  [[ -f "$CSA_FIXTURES_DIR/clean/teamworkflow-project/.claude/settings.local.json" ]] || return 1
}

csa_test_run test_fixture_empty_project_exists || _csa_failed=$((_csa_failed + 1))
csa_test_run test_fixture_minimal_project_exists || _csa_failed=$((_csa_failed + 1))
csa_test_run test_fixture_standard_project_exists || _csa_failed=$((_csa_failed + 1))
csa_test_run test_fixture_plugin_using_exists || _csa_failed=$((_csa_failed + 1))
csa_test_run test_fixture_teamworkflow_exists || _csa_failed=$((_csa_failed + 1))

[[ "$_csa_failed" -eq 0 ]] || exit 1
