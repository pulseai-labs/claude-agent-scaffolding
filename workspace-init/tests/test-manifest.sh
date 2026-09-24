#!/usr/bin/env bash
# tests/test-manifest.sh — unit tests for lib/manifest.sh
# Covers (per SPEC §13.1, ~25 tests):
#   A. Schema validation (8) — all required fields per §6.4 present after write
#   B. ${var} resolution (3) — manifest field refs
#   C. ${PLUGIN_DATA:<name>} (4) — plugin-data lookups
#   D. ${HOME} / ${USER} (2) — env-var expansion
#   E. Missing-field handling (3)
#   F. Reader/writer version-skew (3) — SPEC §6.5
#   G. Round-trip (2)
#   L. wi_manifest_relocate — the moved-workspace manifest repair (#491)

source "$(dirname "$0")/_helpers.sh"
source "$WI_LIB_DIR/_helpers.sh"
source "$WI_LIB_DIR/manifest.sh"

# Shared sandbox — direct mktemp (avoids $() trap-loss).
_WI_TMP="$(mktemp -d "${TMPDIR:-/tmp}/wi-manifest-test.XXXXXX")"
trap 'rm -rf "$_WI_TMP"' EXIT

# ---------------------------------------------------------------------------
# Setup helpers
# ---------------------------------------------------------------------------

# Creates a fresh ai/canonical pair under $_WI_TMP/<slot>/{name-ai,name},
# writes a default manifest via wi_manifest_write, and echoes the AI root.
_setup_pair() {
  local slot="$1"
  local name="${2:-foo}"
  local proj_type="${3:-personal}"
  local ai_root="$_WI_TMP/$slot/${name}-ai"
  local canonical_root="$_WI_TMP/$slot/${name}"
  mkdir -p "$ai_root/.workspace" "$canonical_root"
  wi_manifest_write "$ai_root" "$canonical_root" "$proj_type" --default-branch "main" >/dev/null 2>&1 \
    || { echo "    setup_pair: wi_manifest_write failed" >&2; return 1; }
  echo "$ai_root"
}

# ---------------------------------------------------------------------------
# A. Schema validation (8 tests)
# ---------------------------------------------------------------------------

test_A1_schema_version_present_and_v1() {
  local ai; ai="$(_setup_pair a1)" || return 1
  local v; v="$(jq -r '.schema_version' "$ai/.workspace/pairing.json")"
  assert_eq "1.0" "$v" || return 1
}

test_A2_topology_dual_repo() {
  local ai; ai="$(_setup_pair a2)" || return 1
  local t; t="$(jq -r '.topology' "$ai/.workspace/pairing.json")"
  assert_eq "dual-repo" "$t" || return 1
}

test_A3_ai_workspace_required_fields_present() {
  local ai; ai="$(_setup_pair a3)" || return 1
  local m="$ai/.workspace/pairing.json"
  [[ "$(jq -r '.ai_workspace.root // empty' "$m")" != "" ]]       || { echo "    ai_workspace.root missing"; return 1; }
  [[ "$(jq -r '.ai_workspace.name // empty' "$m")" != "" ]]       || { echo "    ai_workspace.name missing"; return 1; }
  [[ "$(jq -r '.ai_workspace.git_tracked' "$m")" == "true" ]]     || { echo "    ai_workspace.git_tracked != true"; return 1; }
  # git_remote present (may be JSON null, which is fine — required field, value optional)
  jq -e 'has("ai_workspace") and (.ai_workspace | has("git_remote"))' "$m" >/dev/null \
    || { echo "    ai_workspace.git_remote key missing"; return 1; }
}

test_A4_canonical_required_fields_present() {
  local ai; ai="$(_setup_pair a4)" || return 1
  local m="$ai/.workspace/pairing.json"
  [[ "$(jq -r '.canonical.root // empty' "$m")" != "" ]]              || { echo "    canonical.root missing"; return 1; }
  [[ "$(jq -r '.canonical.name // empty' "$m")" != "" ]]              || { echo "    canonical.name missing"; return 1; }
  [[ "$(jq -r '.canonical.git_tracked' "$m")" == "true" ]]            || { echo "    canonical.git_tracked != true"; return 1; }
  [[ "$(jq -r '.canonical.default_branch // empty' "$m")" == "main" ]] || { echo "    canonical.default_branch != main"; return 1; }
  jq -e 'has("canonical") and (.canonical | has("git_remote"))' "$m" >/dev/null \
    || { echo "    canonical.git_remote key missing"; return 1; }
}

test_A5_routing_all_16_entries_present() {
  local ai; ai="$(_setup_pair a5)" || return 1
  local m="$ai/.workspace/pairing.json"
  local entries=(
    master_spec executive_summary memory_bank claude_md agents_md
    scaffold_project_outputs backlog project_plan roadmap prd srs
    product_adrs process_adrs sprint_specs implementation_handoffs
    brainstorm_artifacts
  )
  local count=0
  local key val
  for key in "${entries[@]}"; do
    val="$(jq -r ".routing.${key} // empty" "$m")"
    if [[ -z "$val" ]]; then
      echo "    routing.$key missing"; return 1
    fi
    if [[ "$val" != "ai_workspace" && "$val" != "canonical" ]]; then
      echo "    routing.$key has unexpected value: $val"; return 1
    fi
    count=$((count + 1))
  done
  assert_eq "16" "$count" || return 1
  # Spot-check a few specific routings per SPEC §6.2
  [[ "$(jq -r '.routing.roadmap' "$m")"           == "canonical" ]]   || { echo "    roadmap != canonical"; return 1; }
  [[ "$(jq -r '.routing.master_spec' "$m")"       == "ai_workspace" ]] || { echo "    master_spec != ai_workspace"; return 1; }
  [[ "$(jq -r '.routing.process_adrs' "$m")"      == "ai_workspace" ]] || { echo "    process_adrs != ai_workspace"; return 1; }
}

test_A6_during_dev_block_complete() {
  local ai; ai="$(_setup_pair a6)" || return 1
  local m="$ai/.workspace/pairing.json"
  for k in worktrees_dir branch_naming sprint_dir_template slice_spec_format; do
    local v; v="$(jq -r ".during_dev.${k} // empty" "$m")"
    [[ -n "$v" ]] || { echo "    during_dev.$k missing"; return 1; }
  done
  # Make sure literal ${canonical.root} / ${ai_workspace.root} placeholders are preserved
  # (NOT pre-resolved at write time — they're resolved at read time).
  local wt; wt="$(jq -r '.during_dev.worktrees_dir' "$m")"
  assert_contains '${canonical.root}' "$wt" || return 1
  local sp; sp="$(jq -r '.during_dev.sprint_dir_template' "$m")"
  assert_contains '${ai_workspace.root}' "$sp" || return 1
}

test_A7_git_policy_blocked_patterns_complete() {
  local ai; ai="$(_setup_pair a7)" || return 1
  local m="$ai/.workspace/pairing.json"
  local count; count="$(jq '.git_policy.trace_filter.blocked_patterns | length' "$m")"
  assert_eq "4" "$count" || return 1
  # All 4 SPEC §7.3 patterns
  local patterns; patterns="$(jq -r '.git_policy.trace_filter.blocked_patterns[]' "$m")"
  assert_contains '^Co-Authored-By:'    "$patterns" || return 1
  assert_contains '^🤖 Generated with'  "$patterns" || return 1
  assert_contains 'noreply@anthropic'   "$patterns" || return 1
  assert_contains 'noreply@openai'      "$patterns" || return 1
  # Booleans per SPEC §6.2
  [[ "$(jq -r '.git_policy.trace_filter.enforce' "$m")"    == "true" ]]  || { echo "    enforce != true"; return 1; }
  [[ "$(jq -r '.git_policy.allow_ai_local_commits' "$m")"  == "true" ]]  || { echo "    allow_ai_local_commits != true"; return 1; }
  [[ "$(jq -r '.git_policy.allow_ai_push' "$m")"           == "false" ]] || { echo "    allow_ai_push != false"; return 1; }
}

test_A8_created_at_and_created_by_present() {
  local ai; ai="$(_setup_pair a8)" || return 1
  local m="$ai/.workspace/pairing.json"
  local ca; ca="$(jq -r '.created_at' "$m")"
  local cb; cb="$(jq -r '.created_by' "$m")"
  # ISO 8601-ish: YYYY-MM-DDTHH:MM:SSZ
  [[ "$ca" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    || { echo "    created_at not ISO 8601: $ca"; return 1; }
  # created_by is provenance (#71) — workspace-init@<running version>. Assert the
  # shape AND parity with the .claude-plugin manifest (single source of truth) so
  # this test never needs touching on a version bump.
  [[ "$cb" =~ ^workspace-init@[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || { echo "    created_by not workspace-init@<semver>: $cb"; return 1; }
  local pv; pv="$(jq -r '.version' "$WI_LIB_DIR/../.claude-plugin/plugin.json")"
  assert_eq "workspace-init@$pv" "$cb" || return 1
}

# A9 — #28 Phase 2: well_known_paths.roadmap_state routes the structured roadmap
# (project-roadmap.json) into the workspace so scaffold-dev can field-read it.
test_A9_well_known_paths_roadmap_state() {
  local ai; ai="$(_setup_pair a9)" || return 1
  local m="$ai/.workspace/pairing.json"
  local rs; rs="$(jq -r '.well_known_paths.roadmap_state // empty' "$m")"
  assert_eq '${ai_workspace.root}/.workspace/project-roadmap.json' "$rs" || return 1
  # …and it resolves to a real path under the ai workspace at read time.
  local resolved; resolved="$(wi_manifest_resolve "$ai" "$rs")"
  local aw; aw="$(jq -r '.ai_workspace.root' "$m")"
  assert_eq "${aw}/.workspace/project-roadmap.json" "$resolved" || return 1
}

# A10 — #84 (Devin): wi_manifest_read must return a present boolean false (not treat
# it as missing). Its own contract comment says false is present-with-value; `// empty`
# violated that. Covers the new git_tracked:false AND the pre-existing allow_ai_* falses.
test_A10_read_returns_present_boolean_false() {
  local d="$_WI_TMP/a10"; local ai="$d/foo-ai" cn="$d/foo"
  mkdir -p "$ai/.workspace" "$cn"
  wi_manifest_write "$ai" "$cn" personal --ai-git-tracked false >/dev/null 2>&1 || return 1
  # A present false boolean returns "false" with exit 0 …
  local v; v="$(wi_manifest_read "$ai" '.ai_workspace.git_tracked')" \
    || { echo "    read returned nonzero for present git_tracked:false"; return 1; }
  assert_eq "false" "$v" || return 1
  local p; p="$(wi_manifest_read "$ai" '.git_policy.allow_ai_push')" \
    || { echo "    read returned nonzero for allow_ai_push:false"; return 1; }
  assert_eq "false" "$p" || return 1
  # … a present true boolean too …
  local e; e="$(wi_manifest_read "$ai" '.git_policy.trace_filter.enforce')" || return 1
  assert_eq "true" "$e" || return 1
  # … but JSON null (no remote) and a missing key are still "missing".
  wi_manifest_read "$ai" '.ai_workspace.git_remote' >/dev/null 2>&1 \
    && { echo "    read should treat JSON null as missing"; return 1; }
  wi_manifest_read "$ai" '.does.not.exist' >/dev/null 2>&1 \
    && { echo "    read should treat a missing path as missing"; return 1; }
  return 0
}

# ---------------------------------------------------------------------------
# B. ${var} resolution (3 tests)
# ---------------------------------------------------------------------------

test_B1_resolve_ai_workspace_root() {
  local ai; ai="$(_setup_pair b1)" || return 1
  local out; out="$(wi_manifest_resolve "$ai" '${ai_workspace.root}')"
  local expected; expected="$(jq -r '.ai_workspace.root' "$ai/.workspace/pairing.json")"
  assert_eq "$expected" "$out" || return 1
}

test_B2_resolve_canonical_root() {
  local ai; ai="$(_setup_pair b2)" || return 1
  local out; out="$(wi_manifest_resolve "$ai" '${canonical.root}')"
  local expected; expected="$(jq -r '.canonical.root' "$ai/.workspace/pairing.json")"
  assert_eq "$expected" "$out" || return 1
}

test_B3_resolve_both_refs_in_one_string() {
  local ai; ai="$(_setup_pair b3)" || return 1
  local aw; aw="$(jq -r '.ai_workspace.root' "$ai/.workspace/pairing.json")"
  local cn; cn="$(jq -r '.canonical.root'    "$ai/.workspace/pairing.json")"
  local out; out="$(wi_manifest_resolve "$ai" 'X=${ai_workspace.root}/foo Y=${canonical.root}/bar')"
  assert_eq "X=${aw}/foo Y=${cn}/bar" "$out" || return 1
}

# ---------------------------------------------------------------------------
# C. ${PLUGIN_DATA:<name>} (4 tests)
# ---------------------------------------------------------------------------

test_C1_plugin_data_resolves_to_path() {
  local ai; ai="$(_setup_pair c1)" || return 1
  local out; out="$(wi_manifest_resolve "$ai" '${PLUGIN_DATA:architect-critic}')"
  # Must be an absolute path
  [[ "$out" == /* ]] || { echo "    not absolute: $out"; return 1; }
  # Must contain the plugin name somewhere
  assert_contains "architect-critic" "$out" || return 1
}

test_C2_plugin_data_for_nonexistent_plugin_still_resolves_to_path() {
  local ai; ai="$(_setup_pair c2)" || return 1
  # Per SPEC §13.3 the resolver returns a path (warning optional in v0.1).
  # Suppress stderr warnings; verify stdout still yields a path.
  local out; out="$(wi_manifest_resolve "$ai" '${PLUGIN_DATA:nonexistent-plugin-xyz}' 2>/dev/null)"
  [[ "$out" == /* ]] || { echo "    not absolute: $out"; return 1; }
  assert_contains "nonexistent-plugin-xyz" "$out" || return 1
}

test_C3_plugin_name_with_hyphens_works() {
  local ai; ai="$(_setup_pair c3)" || return 1
  # Hyphenated names are the norm; resolver must not split on hyphen.
  local out; out="$(wi_manifest_resolve "$ai" '${PLUGIN_DATA:scaffold-onboard}')"
  [[ "$out" == /* ]] || { echo "    not absolute: $out"; return 1; }
  assert_contains "scaffold-onboard" "$out" || return 1
  # Make sure the closing brace isn't left over
  assert_not_contains '}' "$out" || return 1
  assert_not_contains '$' "$out" || return 1
}

test_C4_mixed_envvar_plugindata_manifestfield_string() {
  local ai; ai="$(_setup_pair c4)" || return 1
  local aw_root; aw_root="$(jq -r '.ai_workspace.root' "$ai/.workspace/pairing.json")"
  local out; out="$(wi_manifest_resolve "$ai" '${HOME}/x/${PLUGIN_DATA:foo}/y/${ai_workspace.root}/z')"
  # All three forms must be resolved.
  assert_contains "$HOME/x/" "$out"   || return 1
  assert_contains "/foo"     "$out"   || return 1
  assert_contains "/y/"      "$out"   || return 1
  assert_contains "$aw_root" "$out"   || return 1
  assert_contains "/z"       "$out"   || return 1
  # No unresolved placeholders left over
  assert_not_contains '${'   "$out"   || return 1
}

# ---------------------------------------------------------------------------
# D. ${HOME} / ${USER} (2 tests)
# ---------------------------------------------------------------------------

test_D1_resolve_HOME() {
  local ai; ai="$(_setup_pair d1)" || return 1
  local out; out="$(wi_manifest_resolve "$ai" '${HOME}/foo')"
  assert_eq "$HOME/foo" "$out" || return 1
}

test_D2_resolve_USER() {
  local ai; ai="$(_setup_pair d2)" || return 1
  local out; out="$(wi_manifest_resolve "$ai" '/users/${USER}/data')"
  assert_eq "/users/$USER/data" "$out" || return 1
}

# ---------------------------------------------------------------------------
# E. Missing-field handling (3 tests)
# ---------------------------------------------------------------------------

test_E1_read_nonexistent_field_returns_nonzero() {
  local ai; ai="$(_setup_pair e1)" || return 1
  # wi_manifest_read with a bogus field — must NOT exit 0 with empty output.
  local out rc
  out="$(wi_manifest_read "$ai" '.does.not.exist' 2>/dev/null)"
  rc=$?
  if [[ $rc -eq 0 && -n "$out" && "$out" != "null" ]]; then
    echo "    bogus field unexpectedly returned: $out (rc=$rc)"
    return 1
  fi
  [[ $rc -ne 0 ]] || { echo "    expected non-zero exit for missing field"; return 1; }
}

test_E2_validate_fails_on_manifest_missing_routing_master_spec() {
  local ai; ai="$(_setup_pair e2)" || return 1
  local m="$ai/.workspace/pairing.json"
  # Strip routing.master_spec
  local tmp="$m.broken"
  jq 'del(.routing.master_spec)' "$m" > "$tmp" && mv "$tmp" "$m"
  if wi_manifest_validate "$ai" 2>/dev/null; then
    echo "    validate unexpectedly passed on manifest missing routing.master_spec"
    return 1
  fi
}

test_E3_read_missing_manifest_returns_nonzero() {
  local ai="$_WI_TMP/e3-empty-ai"
  mkdir -p "$ai"   # no .workspace/pairing.json inside
  if wi_manifest_read "$ai" 2>/dev/null; then
    echo "    read on missing manifest unexpectedly succeeded"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# F. Reader/writer version-skew (3 tests) — SPEC §6.5
# ---------------------------------------------------------------------------

test_F1_writer_emits_schema_version_1_0() {
  local ai; ai="$(_setup_pair f1)" || return 1
  local v; v="$(jq -r '.schema_version' "$ai/.workspace/pairing.json")"
  assert_eq "1.0" "$v" || return 1
  # Also confirm the constant
  assert_eq "1.0" "$WI_MANIFEST_SCHEMA_VERSION" || return 1
}

test_F2_validate_accepts_schema_version_1_0() {
  local ai; ai="$(_setup_pair f2)" || return 1
  if ! wi_manifest_validate "$ai" 2>/dev/null; then
    echo "    validate rejected schema_version 1.0"; return 1
  fi
}

test_F3_validate_rejects_schema_version_2_0() {
  local ai; ai="$(_setup_pair f3)" || return 1
  local m="$ai/.workspace/pairing.json"
  # Forge schema_version to 2.0
  local tmp="$m.forged"
  jq '.schema_version = "2.0"' "$m" > "$tmp" && mv "$tmp" "$m"

  local err rc
  err="$(wi_manifest_validate "$ai" 2>&1 >/dev/null)"
  rc=$?
  [[ $rc -ne 0 ]] || { echo "    validate unexpectedly passed on schema 2.0"; return 1; }
  # Error message should name the manifest path and instruct to update workspace-init.
  assert_contains "$m" "$err"               || { echo "    error did not name manifest path"; return 1; }
  assert_contains "update workspace-init" "$err" \
    || { echo "    error did not mention 'update workspace-init'"; return 1; }
}

# ---------------------------------------------------------------------------
# G. Round-trip (2 tests)
# ---------------------------------------------------------------------------

test_G1_write_then_read_full_json_structural_equality() {
  local ai; ai="$(_setup_pair g1)" || return 1
  local m="$ai/.workspace/pairing.json"
  local from_read; from_read="$(wi_manifest_read "$ai" | jq -S .)"
  local from_disk; from_disk="$(jq -S . "$m")"
  if [[ "$from_read" != "$from_disk" ]]; then
    echo "    read output != disk content"
    return 1
  fi
}

test_G2_defaults_round_trip_unchanged() {
  local ai; ai="$(_setup_pair g2)" || return 1
  local m="$ai/.workspace/pairing.json"
  # Default-case writer should produce null git_remote on both repos.
  local aw_remote; aw_remote="$(jq -r '.ai_workspace.git_remote' "$m")"
  local cn_remote; cn_remote="$(jq -r '.canonical.git_remote'    "$m")"
  assert_eq "null" "$aw_remote" || return 1
  assert_eq "null" "$cn_remote" || return 1
  # Re-read full JSON via wi_manifest_read and verify it parses cleanly.
  local rt; rt="$(wi_manifest_read "$ai")"
  echo "$rt" | jq -e . >/dev/null 2>&1 || { echo "    read output not valid JSON"; return 1; }
  # default_branch echoed back as-written
  local db; db="$(echo "$rt" | jq -r '.canonical.default_branch')"
  assert_eq "main" "$db" || return 1
}

# ---------------------------------------------------------------------------
# Run all
# ---------------------------------------------------------------------------

# A
wi_test_run test_A1_schema_version_present_and_v1
wi_test_run test_A2_topology_dual_repo
wi_test_run test_A3_ai_workspace_required_fields_present
wi_test_run test_A4_canonical_required_fields_present
wi_test_run test_A5_routing_all_16_entries_present
wi_test_run test_A6_during_dev_block_complete
wi_test_run test_A7_git_policy_blocked_patterns_complete
wi_test_run test_A8_created_at_and_created_by_present
wi_test_run test_A9_well_known_paths_roadmap_state
wi_test_run test_A10_read_returns_present_boolean_false

# B
wi_test_run test_B1_resolve_ai_workspace_root
wi_test_run test_B2_resolve_canonical_root
wi_test_run test_B3_resolve_both_refs_in_one_string

# C
wi_test_run test_C1_plugin_data_resolves_to_path
wi_test_run test_C2_plugin_data_for_nonexistent_plugin_still_resolves_to_path
wi_test_run test_C3_plugin_name_with_hyphens_works
wi_test_run test_C4_mixed_envvar_plugindata_manifestfield_string

# D
wi_test_run test_D1_resolve_HOME
wi_test_run test_D2_resolve_USER

# E
wi_test_run test_E1_read_nonexistent_field_returns_nonzero
wi_test_run test_E2_validate_fails_on_manifest_missing_routing_master_spec
wi_test_run test_E3_read_missing_manifest_returns_nonzero

# F
wi_test_run test_F1_writer_emits_schema_version_1_0
wi_test_run test_F2_validate_accepts_schema_version_1_0
wi_test_run test_F3_validate_rejects_schema_version_2_0

# G
wi_test_run test_G1_write_then_read_full_json_structural_equality
wi_test_run test_G2_defaults_round_trip_unchanged

# H — SPEC §6.3 mi_manifest_resolve alias
test_H1_mi_manifest_resolve_alias_matches_wi() {
  local d; d="$(wi_tmpdir)"
  local ai="$d/foo-ai"; local cn="$d/foo"
  mkdir -p "$ai/.workspace" "$cn"
  wi_manifest_write "$ai" "$cn" personal >/dev/null
  local got_wi got_mi
  got_wi="$(wi_manifest_resolve "$ai" 'X=${ai_workspace.root}')"
  got_mi="$(mi_manifest_resolve "$ai" 'X=${ai_workspace.root}')"
  assert_eq "$got_wi" "$got_mi" "mi_ alias resolves identically to wi_"
}
wi_test_run test_H1_mi_manifest_resolve_alias_matches_wi

# ---------------------------------------------------------------------------
# I — tooling_repo: optional marketplace-routing field (#48 Stage 2)
# ---------------------------------------------------------------------------

test_I1_tooling_repo_written_when_flag_present() {
  local d="$_WI_TMP/i1"
  local ai="$d/foo-ai" cn="$d/foo" tool="$d/foo-tools"
  mkdir -p "$ai/.workspace" "$cn" "$tool"
  wi_manifest_write "$ai" "$cn" personal --tooling-repo "$tool" >/dev/null 2>&1 \
    || { echo "    wi_manifest_write --tooling-repo failed"; return 1; }
  local m="$ai/.workspace/pairing.json"
  assert_eq "$tool"     "$(jq -r '.tooling_repo.root' "$m")" || return 1
  assert_eq "foo-tools" "$(jq -r '.tooling_repo.name' "$m")" || return 1
  # git_remote key present (value may be JSON null), mirroring canonical's sub-schema
  jq -e '.tooling_repo | has("git_remote")' "$m" >/dev/null \
    || { echo "    tooling_repo.git_remote key missing"; return 1; }
}

test_I2_tooling_repo_remote_recorded() {
  local d="$_WI_TMP/i2"
  local ai="$d/foo-ai" cn="$d/foo" tool="$d/foo-tools"
  mkdir -p "$ai/.workspace" "$cn" "$tool"
  wi_manifest_write "$ai" "$cn" personal \
    --tooling-repo "$tool" --tooling-repo-remote "git@github.com:me/tools.git" >/dev/null 2>&1 \
    || { echo "    write with --tooling-repo-remote failed"; return 1; }
  local m="$ai/.workspace/pairing.json"
  assert_eq "git@github.com:me/tools.git" "$(jq -r '.tooling_repo.git_remote' "$m")" || return 1
}

test_I3_tooling_repo_absent_by_default() {
  local ai; ai="$(_setup_pair i3)" || return 1
  local m="$ai/.workspace/pairing.json"
  # Absent → key omitted entirely (not JSON null), so today's behavior is unchanged.
  assert_eq "false" "$(jq 'has("tooling_repo")' "$m")" || return 1
  assert_exits_with 0 wi_manifest_validate "$ai" || return 1
}

test_I4_validate_accepts_wellformed_tooling_repo() {
  local d="$_WI_TMP/i4"
  local ai="$d/foo-ai" cn="$d/foo" tool="$d/foo-tools"
  mkdir -p "$ai/.workspace" "$cn" "$tool"
  wi_manifest_write "$ai" "$cn" personal --tooling-repo "$tool" >/dev/null 2>&1 \
    || { echo "    write failed"; return 1; }
  assert_exits_with 0 wi_manifest_validate "$ai" || return 1
}

test_I5_validate_rejects_malformed_tooling_repo() {
  local ai; ai="$(_setup_pair i5)" || return 1
  local m="$ai/.workspace/pairing.json"
  # Inject a tooling_repo missing its required root → validation must fail.
  local tmp; tmp="$(mktemp)"
  jq '.tooling_repo = {"name":"foo-tools","git_remote":null}' "$m" > "$tmp" && mv "$tmp" "$m"
  assert_exits_with 1 wi_manifest_validate "$ai" 2>/dev/null || return 1
}

test_I6_tooling_repo_remote_requires_root() {
  local d="$_WI_TMP/i6"
  local ai="$d/foo-ai" cn="$d/foo"
  mkdir -p "$ai/.workspace" "$cn"
  # --tooling-repo-remote without --tooling-repo would silently drop the URL.
  assert_exits_with 1 wi_manifest_write "$ai" "$cn" personal \
    --tooling-repo-remote "git@github.com:me/tools.git" 2>/dev/null || return 1
}

test_I7_tooling_repo_root_must_be_absolute() {
  local d="$_WI_TMP/i7"
  local ai="$d/foo-ai" cn="$d/foo"
  mkdir -p "$ai/.workspace" "$cn"
  # A relative root would break the later `cd "$target"` in /defer --tooling.
  assert_exits_with 1 wi_manifest_write "$ai" "$cn" personal \
    --tooling-repo "../relative-tools" 2>/dev/null || return 1
}

test_I8_validate_rejects_nonobject_tooling_repo() {
  local ai; ai="$(_setup_pair i8)" || return 1
  local m="$ai/.workspace/pairing.json"
  # A non-object tooling_repo (hand edit) must fail validation, not slip through
  # a swallowed jq indexing error.
  local tmp; tmp="$(mktemp)"
  jq '.tooling_repo = "not-an-object"' "$m" > "$tmp" && mv "$tmp" "$m"
  assert_exits_with 1 wi_manifest_validate "$ai" 2>/dev/null || return 1
}

wi_test_run test_I1_tooling_repo_written_when_flag_present
wi_test_run test_I2_tooling_repo_remote_recorded
wi_test_run test_I3_tooling_repo_absent_by_default
wi_test_run test_I4_validate_accepts_wellformed_tooling_repo
wi_test_run test_I5_validate_rejects_malformed_tooling_repo
wi_test_run test_I6_tooling_repo_remote_requires_root
wi_test_run test_I7_tooling_repo_root_must_be_absolute
wi_test_run test_I8_validate_rejects_nonobject_tooling_repo

# ---------------------------------------------------------------------------
# J. --ai-git-tracked flag (#71) — Scenario-C non-git AI workspace
# ---------------------------------------------------------------------------

test_J1_ai_git_tracked_defaults_true() {
  # _setup_pair writes with no --ai-git-tracked → default true (fresh/Scenario-A).
  local ai; ai="$(_setup_pair j1)" || return 1
  jq -e '.ai_workspace.git_tracked == true' "$ai/.workspace/pairing.json" >/dev/null \
    || { echo "    default ai_workspace.git_tracked != JSON true"; return 1; }
}

test_J2_ai_git_tracked_false_recorded() {
  local d="$_WI_TMP/j2"; local ai="$d/foo-ai" cn="$d/foo"
  mkdir -p "$ai/.workspace" "$cn"
  wi_manifest_write "$ai" "$cn" personal --ai-git-tracked false >/dev/null 2>&1 || return 1
  # Must be a JSON boolean false, not the string "false".
  jq -e '.ai_workspace.git_tracked == false' "$ai/.workspace/pairing.json" >/dev/null \
    || { echo "    ai_workspace.git_tracked not JSON false"; return 1; }
}

test_J3_ai_git_tracked_rejects_non_boolean() {
  local d="$_WI_TMP/j3"; local ai="$d/foo-ai" cn="$d/foo"
  mkdir -p "$ai/.workspace" "$cn"
  assert_exits_with 1 wi_manifest_write "$ai" "$cn" personal --ai-git-tracked maybe 2>/dev/null || return 1
}

test_J4_canonical_git_tracked_unaffected_by_flag() {
  local d="$_WI_TMP/j4"; local ai="$d/foo-ai" cn="$d/foo"
  mkdir -p "$ai/.workspace" "$cn"
  # The flag governs ONLY the AI workspace; canonical is always a validated repo.
  wi_manifest_write "$ai" "$cn" personal --ai-git-tracked false >/dev/null 2>&1 || return 1
  jq -e '.canonical.git_tracked == true' "$ai/.workspace/pairing.json" >/dev/null \
    || { echo "    canonical.git_tracked != JSON true"; return 1; }
}

wi_test_run test_J1_ai_git_tracked_defaults_true
wi_test_run test_J2_ai_git_tracked_false_recorded
wi_test_run test_J3_ai_git_tracked_rejects_non_boolean
wi_test_run test_J4_canonical_git_tracked_unaffected_by_flag

# ---------------------------------------------------------------------------
# K. principles_user_global removal — the pointer had zero consumers after the
#    architect-critic owned path moved to $HOME/.claude/architect-critic/.
#    The generic ${PLUGIN_DATA:<name>} resolver (group C) is untouched; this
#    deletes one data key, not the mechanism.
# ---------------------------------------------------------------------------

test_K1_principles_user_global_absent_from_all_three_sites() {
  local ai; ai="$(_setup_pair k1)" || return 1
  local m="$ai/.workspace/pairing.json"
  jq -e '.well_known_paths | has("principles_user_global") | not' "$m" >/dev/null \
    || { echo "    generated manifest still carries principles_user_global"; return 1; }
  local f
  for f in "$WI_PLUGIN_ROOT/templates/pairing.json.tmpl" \
           "$WI_PLUGIN_ROOT/skills/initializing-dual-repo-workspace/examples/fresh-bootstrap.md"; do
    if grep -qF 'principles_user_global' "$f"; then
      echo "    principles_user_global still present in $f"
      return 1
    fi
  done
}

wi_test_run test_K1_principles_user_global_absent_from_all_three_sites

# ---------------------------------------------------------------------------
# L. wi_manifest_relocate (#491) — rewrite the recorded roots after a move,
#    carrying every other field through byte-for-byte (as JSON).
# ---------------------------------------------------------------------------

# A manifest with every non-default value a repair must not lose.
_setup_custom_pair() {
  local slot="$1"
  local ai="$_WI_TMP/$slot/proj-ai" cn="$_WI_TMP/$slot/proj" tool="$_WI_TMP/$slot/tools"
  mkdir -p "$ai/.workspace" "$cn" "$tool"
  wi_manifest_write "$ai" "$cn" work --default-branch develop \
      --git-remote git@example.com:o/proj-ai.git \
      --canonical-git-remote git@example.com:o/proj.git \
      --tooling-repo "$tool" --tooling-repo-remote git@example.com:o/tools.git \
      >/dev/null 2>&1 || { echo "    setup_custom_pair: write failed" >&2; return 1; }
  local m="$ai/.workspace/pairing.json" tmp="$ai/.workspace/t"
  jq '.git_policy.trace_filter.blocked_patterns += ["^Signed-off-by: bot"]
      | .git_policy.allow_ai_push = true' "$m" > "$tmp" && mv "$tmp" "$m"
  echo "$ai"
}

test_L1_relocate_rewrites_ai_root_preserves_everything_else() {
  local ai; ai="$(_setup_custom_pair l1)" || return 1
  local moved="$_WI_TMP/l1/proj-ai-MOVED"
  mv "$ai" "$moved"
  local m="$moved/.workspace/pairing.json"
  jq -S 'del(.ai_workspace.root, .ai_workspace.name)' "$m" > "$_WI_TMP/l1/before"
  "$WI_BIN" manifest_relocate "$moved" 2>/dev/null || { echo "    relocate failed"; return 1; }
  local want; want="$(cd "$moved" && pwd -P)"
  assert_eq "$want" "$(jq -r '.ai_workspace.root' "$m")" "root rewritten" || return 1
  assert_eq "proj-ai-MOVED" "$(jq -r '.ai_workspace.name' "$m")" "name rewritten" || return 1
  jq -S 'del(.ai_workspace.root, .ai_workspace.name)' "$m" > "$_WI_TMP/l1/after"
  cmp -s "$_WI_TMP/l1/before" "$_WI_TMP/l1/after" || {
    echo "    a field other than ai_workspace.root/name changed:"
    diff "$_WI_TMP/l1/before" "$_WI_TMP/l1/after"; return 1; }
  # Resolution follows the new root.
  assert_eq "$want/docs/MASTER-SPEC.md" \
    "$(wi_manifest_resolve "$moved" '${ai_workspace.root}/docs/MASTER-SPEC.md')" \
    "resolver reads the relocated root" || return 1
  wi_manifest_validate "$moved" 2>/dev/null || { echo "    relocated manifest no longer validates"; return 1; }
}

test_L2_relocate_canonical_root_only_with_flag() {
  local ai; ai="$(_setup_custom_pair l2)" || return 1
  local m="$ai/.workspace/pairing.json"
  local old_cn; old_cn="$(jq -r '.canonical.root' "$m")"
  # Without the flag, canonical is untouched even if it moved.
  mv "$old_cn" "$_WI_TMP/l2/proj-NEW"
  "$WI_BIN" manifest_relocate "$ai" 2>/dev/null || return 1
  assert_eq "$old_cn" "$(jq -r '.canonical.root' "$m")" "canonical untouched without flag" || return 1
  jq -S 'del(.ai_workspace.root, .ai_workspace.name, .canonical.root, .canonical.name)' "$m" > "$_WI_TMP/l2/before"
  "$WI_BIN" manifest_relocate "$ai" --canonical-root "$_WI_TMP/l2/proj-NEW" 2>/dev/null || {
    echo "    relocate with --canonical-root failed"; return 1; }
  assert_eq "$(cd "$_WI_TMP/l2/proj-NEW" && pwd -P)" "$(jq -r '.canonical.root' "$m")" "canonical root" || return 1
  assert_eq "proj-NEW" "$(jq -r '.canonical.name' "$m")" "canonical name" || return 1
  jq -S 'del(.ai_workspace.root, .ai_workspace.name, .canonical.root, .canonical.name)' "$m" > "$_WI_TMP/l2/after"
  cmp -s "$_WI_TMP/l2/before" "$_WI_TMP/l2/after" || {
    echo "    --canonical-root changed another field:"; diff "$_WI_TMP/l2/before" "$_WI_TMP/l2/after"; return 1; }
}

test_L3_relocate_refuses_bad_manifest_unchanged() {
  local ai="$_WI_TMP/l3/proj-ai"; mkdir -p "$ai/.workspace"
  local m="$ai/.workspace/pairing.json" body
  for body in '' '{"a":1}
{"b":2}' '[1,2]' '{"ai_workspace":"not-an-object"}' '{ not json'; do
    printf '%s' "$body" > "$m"
    if "$WI_BIN" manifest_relocate "$ai" 2>/dev/null; then
      echo "    relocate accepted a bad manifest: $body"; return 1; fi
    [[ "$(cat "$m")" == "$body" ]] || { echo "    bad manifest was modified: $body"; return 1; }
  done
  # Missing manifest → refused, nothing created.
  rm -f "$m"
  if "$WI_BIN" manifest_relocate "$ai" 2>/dev/null; then
    echo "    relocate accepted a missing manifest"; return 1; fi
  assert_file_absent "$m" || return 1
  ls "$ai/.workspace" | grep -q . && { echo "    relocate left files behind"; return 1; }
  return 0
}

test_L4_relocate_refuses_bad_roots_unchanged() {
  local ai; ai="$(_setup_pair l4)" || return 1
  local m="$ai/.workspace/pairing.json"
  cp "$m" "$_WI_TMP/l4/orig"
  if "$WI_BIN" manifest_relocate "$ai" --canonical-root "$_WI_TMP/l4/nope" 2>"$_WI_TMP/l4/err"; then
    echo "    relocate accepted a nonexistent canonical root"; return 1; fi
  cmp -s "$_WI_TMP/l4/orig" "$m" || { echo "    manifest modified by a refused relocate"; return 1; }
  grep -qF 'canonical root is not a directory' "$_WI_TMP/l4/err" || {
    echo "    refusal does not name the canonical root"; cat "$_WI_TMP/l4/err"; return 1; }
  if "$WI_BIN" manifest_relocate "$_WI_TMP/l4/ai-TYPO" 2>/dev/null; then
    echo "    relocate accepted a nonexistent AI root"; return 1; fi
  [[ ! -e "$_WI_TMP/l4/ai-TYPO" ]] || { echo "    relocate created the mistyped root"; return 1; }
  if "$WI_BIN" manifest_relocate "$ai" --canonical-root 2>/dev/null; then
    echo "    relocate accepted --canonical-root without a value"; return 1; fi
  if "$WI_BIN" manifest_relocate "$ai" --bogus 2>/dev/null; then
    echo "    relocate accepted an unknown argument"; return 1; fi
  if "$WI_BIN" manifest_relocate 2>/dev/null; then
    echo "    relocate accepted no arguments"; return 1; fi
  cmp -s "$_WI_TMP/l4/orig" "$m" || { echo "    manifest modified by a refused call"; return 1; }
}

test_L5_relocate_relative_root_recorded_absolute() {
  local ai; ai="$(_setup_pair l5)" || return 1
  mv "$ai" "$_WI_TMP/l5/renamed-ai"
  ( cd "$_WI_TMP/l5" && "$WI_BIN" manifest_relocate renamed-ai ) 2>/dev/null || {
    echo "    relative relocate failed"; return 1; }
  assert_eq "$(cd "$_WI_TMP/l5/renamed-ai" && pwd -P)" \
    "$(jq -r '.ai_workspace.root' "$_WI_TMP/l5/renamed-ai/.workspace/pairing.json")" \
    "relative argument recorded as an absolute path"
}

wi_test_run test_L1_relocate_rewrites_ai_root_preserves_everything_else
wi_test_run test_L2_relocate_canonical_root_only_with_flag
wi_test_run test_L3_relocate_refuses_bad_manifest_unchanged
wi_test_run test_L4_relocate_refuses_bad_roots_unchanged
wi_test_run test_L5_relocate_relative_root_recorded_absolute

wi_test_summary
