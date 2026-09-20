#!/usr/bin/env bash
# tests/test-skills-pressure.sh — RED baseline for skill-first behavior.
# Phase 0: ALL FAIL (no skills/lib exist).
# Phase 6: ALL PASS after skill bodies + lib/ + commands land.

source "$(dirname "$0")/_helpers.sh"

# --- Helper: does a skill's frontmatter `description` field contain a phrase? ---
# Surrogate for skill auto-invocation: real harness matches user message against description.
skill_description_matches() { # $1=skill_path $2=user_phrase
  local skill_md="$1"
  local phrase="$2"
  [[ -f "$skill_md" ]] || return 1
  # Extract description line(s) from frontmatter
  awk '/^---$/{f=!f; next} f && /^description:/{flag=1} flag{print} /^---$/ && flag{exit}' "$skill_md" \
    | grep -qiF "$phrase"
}

INIT_SKILL="$WI_PLUGIN_ROOT/skills/initializing-dual-repo-workspace/SKILL.md"
PAIR_SKILL="$WI_PLUGIN_ROOT/skills/pairing-canonical-repo/SKILL.md"

# 1. Skill exists at expected path
test_init_skill_file_exists() { assert_file_exists "$INIT_SKILL"; }
test_pair_skill_file_exists() { assert_file_exists "$PAIR_SKILL"; }

# 2. Skill descriptions match the documented natural-language triggers per SPEC §5.1/§5.2
test_init_triggers_on_create_workspace() { skill_description_matches "$INIT_SKILL" "create workspace"; }
test_init_triggers_on_bootstrap_project() { skill_description_matches "$INIT_SKILL" "bootstrap project"; }
test_init_triggers_on_set_up_dual_repo() { skill_description_matches "$INIT_SKILL" "set up dual repo"; }
test_pair_triggers_on_existing_canonical() { skill_description_matches "$PAIR_SKILL" "existing canonical"; }
test_pair_triggers_on_pair_workspace() { skill_description_matches "$PAIR_SKILL" "pair"; }

# 3. Skill body is within the 150–500 line target (SPEC §5.1)
test_init_skill_body_size_in_range() {
  local lines; lines=$(wc -l < "$INIT_SKILL" 2>/dev/null || echo 0)
  (( lines >= 150 && lines <= 500 )) || { echo "    init SKILL.md: $lines lines"; return 1; }
}
test_pair_skill_body_size_in_range() {
  local lines; lines=$(wc -l < "$PAIR_SKILL" 2>/dev/null || echo 0)
  (( lines >= 150 && lines <= 500 )) || { echo "    pair SKILL.md: $lines lines"; return 1; }
}

# 4. Slash command wrappers use $ARGUMENTS bridge (per feedback_slash_command_dollar_n_bug)
test_init_command_uses_arguments_bridge() {
  local cmd="$WI_PLUGIN_ROOT/commands/init-workspace.md"
  [[ -f "$cmd" ]] || return 1
  grep -q '\$ARGUMENTS' "$cmd" || return 1
  ! grep -nE '\$[1-9]' "$cmd" | grep -v '\$ARGUMENTS' | grep -v '^[^:]*:#' >/dev/null
}
test_pair_command_uses_arguments_bridge() {
  local cmd="$WI_PLUGIN_ROOT/commands/pair-workspace.md"
  [[ -f "$cmd" ]] || return 1
  grep -q '\$ARGUMENTS' "$cmd" || return 1
  ! grep -nE '\$[1-9]' "$cmd" | grep -v '\$ARGUMENTS' | grep -v '^[^:]*:#' >/dev/null
}

test_init_skill_documents_explicit_wrapper_mode() {
  grep -qF -- '--wrapper <existing-dir>' "$INIT_SKILL" || return 1
  grep -qF 'never auto-detect' "$INIT_SKILL" || return 1
  grep -qF 'wrapper contents' "$INIT_SKILL" || return 1
}

test_init_command_forwards_wrapper_grammar() {
  local cmd="$WI_PLUGIN_ROOT/commands/init-workspace.md"
  grep -qF -- '/init-workspace <name> --wrapper <existing-dir>' "$cmd" || return 1
  grep -qF 'unknown option' "$cmd" || return 1
  grep -qF -- '--wrapper requires' "$cmd" || return 1
}

test_readme_uses_canonical_ai_suffix_in_both_fresh_modes() {
  local readme="$WI_PLUGIN_ROOT/README.md"
  grep -qF 'foo-ai/' "$readme" || return 1
  grep -qF 'existing-project-ai/' "$readme" || return 1
  ! grep -qF 'existing-project-ai-workspace/' "$readme"
}

# --- #173: Scenario A writes the detected remote to canonical.git_remote ---

test_pair_skill_manifest_write_uses_canonical_git_remote_flag() {
  # Scoped to the §6.4 manifest_write block only — `--git-remote` remains a
  # valid flag elsewhere (it records the AI workspace's OWN remote).
  local sec
  sec="$(awk '/### 6\.4/,/### 6\.5/' "$PAIR_SKILL")"
  assert_contains '--canonical-git-remote "$detected_remote"' "$sec" || return 1
  assert_not_contains ' --git-remote "' "$sec" || return 1
}

test_pair_example_uses_canonical_git_remote_flag() {
  local ex="$WI_PLUGIN_ROOT/skills/pairing-canonical-repo/examples/pair-with-existing-clean.md"
  grep -qF -- '--canonical-git-remote "git@github.com:example/foo.git"' "$ex" || {
    echo "    example does not pass --canonical-git-remote"; return 1; }
  ! grep -qF -- ' --git-remote "' "$ex" || {
    echo "    bare --git-remote still present in example"; return 1; }
}

# --- #481: nothing names the non-existent `/init-workspace --repair` ---

test_no_site_references_dead_repair_flag() {
  local sites=(
    "$WI_PLUGIN_ROOT/README.md"
    "$WI_PLUGIN_ROOT/hooks/commit-msg.tmpl"
    "$WI_PLUGIN_ROOT/skills/pairing-canonical-repo/examples/pair-with-aborts-on-ai-scaffolding.md"
  )
  local f
  for f in "${sites[@]}"; do
    [[ -f "$f" ]] || { echo "    pinned site missing: $f"; return 1; }
  done
  ! grep -Hn 'init-workspace --repair' "${sites[@]}" || {
    echo "    a site still names the non-existent --repair flag"; return 1; }
}

# --- run all ---
wi_test_run test_init_skill_file_exists
wi_test_run test_pair_skill_file_exists
wi_test_run test_init_triggers_on_create_workspace
wi_test_run test_init_triggers_on_bootstrap_project
wi_test_run test_init_triggers_on_set_up_dual_repo
wi_test_run test_pair_triggers_on_existing_canonical
wi_test_run test_pair_triggers_on_pair_workspace
wi_test_run test_init_skill_body_size_in_range
wi_test_run test_pair_skill_body_size_in_range
wi_test_run test_init_command_uses_arguments_bridge
wi_test_run test_pair_command_uses_arguments_bridge
wi_test_run test_init_skill_documents_explicit_wrapper_mode
wi_test_run test_init_command_forwards_wrapper_grammar
wi_test_run test_readme_uses_canonical_ai_suffix_in_both_fresh_modes
wi_test_run test_pair_skill_manifest_write_uses_canonical_git_remote_flag
wi_test_run test_pair_example_uses_canonical_git_remote_flag
wi_test_run test_no_site_references_dead_repair_flag

wi_test_summary
