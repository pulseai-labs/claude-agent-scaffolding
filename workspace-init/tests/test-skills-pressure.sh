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
DUAL_SKILL="$WI_PLUGIN_ROOT/skills/pairing-existing-dual/SKILL.md"
FRESH_EX="$WI_PLUGIN_ROOT/skills/initializing-dual-repo-workspace/examples/fresh-bootstrap.md"
PAIR_CLEAN_EX="$WI_PLUGIN_ROOT/skills/pairing-canonical-repo/examples/pair-with-existing-clean.md"
PAIR_ABORT_EX="$WI_PLUGIN_ROOT/skills/pairing-canonical-repo/examples/pair-with-aborts-on-ai-scaffolding.md"
REPO_ROOT="$(cd "$WI_PLUGIN_ROOT/.." && pwd)"
CLAUDE_MARKETPLACE="$REPO_ROOT/.claude-plugin/marketplace.json"
ROOT_README="$REPO_ROOT/README.md"

# Patterns that name the retired stack's continuation routes or ornamental
# version claims. `scaffold-\*` is a literal asterisk; `workspace-init v[0-9]`
# and `workspace-init@[0-9]` catch hardcoded version strings.
_retired_route_patterns='(/onboard|/scaffold-project|scaffold-onboard|scaffold-dev|scaffold-\*|workspace-init v[0-9]|workspace-init@[0-9])'

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

# --- S8: printed next-steps route to ossify, never to the retired stack ---

test_printed_skill_routes_point_to_ossify() {
  local init_sec pair_sec dual_sec
  init_sec="$(awk '/^## 6\. Print next-steps/,/^## 7\./' "$INIT_SKILL")"
  pair_sec="$(awk '/^## 8\. Print next-steps/,/^## 9\./' "$PAIR_SKILL")"
  dual_sec="$(awk '/^## 9\. Surface summary/,/^## 10\./' "$DUAL_SKILL")"

  [[ -n "$init_sec" && -n "$pair_sec" && -n "$dual_sec" ]] \
    || { echo "    a scoped next-steps section is empty — headings drifted"; return 1; }

  # Fresh bootstrap: a bare canonical starts at /ossify:start.
  assert_contains '/ossify:start' "$init_sec" || return 1
  # Scenario A + C: existing source or history routes directly to /ossify:adopt;
  # /ossify:start appears only as the empty-canonical exception.
  assert_contains '/ossify:adopt' "$pair_sec" || return 1
  assert_contains '/ossify:start' "$pair_sec" || return 1
  assert_contains '/ossify:adopt' "$dual_sec" || return 1
  assert_contains '/ossify:start' "$dual_sec" || return 1

  # S8 round 1 (F1): the Scenario-C block must prepare the workspace for adopt's
  # clean-tree gate (A3) — the skill writes pairing.json + the init-log but never
  # stages or commits, so a git-backed workspace is left dirty and a non-git one
  # cannot pass the tracked-tree sweep at all.
  assert_contains 'commit the pairing changes' "$dual_sec" || return 1
  assert_contains '`git init` it first' "$dual_sec" || return 1
  assert_contains 'must all be clean' "$dual_sec" || return 1

  # S8 round 1 (F2): the step opens the workspace in Claude *or* Codex, so the route
  # must name the Codex surface's form too — ossify's Codex manifest publishes
  # skills, not slash commands.
  assert_contains 'on Codex, invoke the corresponding ossify skill' "$dual_sec" || return 1

  # S8 round 2 (G1): the Scenario A route must state today's truth — adoption targets
  # projects that came from the legacy scaffold stack, and a plain existing-source
  # repository has no supported continuation — instead of advertising the refusal.
  assert_contains 'legacy scaffold stack' "$pair_sec" || return 1
  assert_contains 'no supported ossify continuation yet' "$pair_sec" || return 1
  assert_not_contains '# canonical has source or history' "$pair_sec" || return 1

  # S8 round 2 (G2): adoption's clean-tree gate sweeps every declared repo, so this
  # block must say the canonical is swept too — the pairing never cleans it.
  assert_contains 'every participating tree must be clean' "$pair_sec" || return 1
  assert_contains 'the AI workspace, the canonical,' "$pair_sec" || return 1

  # S8 round 2 (G3): after `git init` the manifest's tracked flag and the AI-side hook
  # are stale, so the block must send the user back through this skill before committing.
  assert_contains 're-run this skill' "$dual_sec" || return 1
  assert_contains 'the AI-side trace filter is installed' "$dual_sec" || return 1

  # S8 round 2 (G4): adoption lands on a workspace Codex can drive, and Scenario C never
  # writes AGENTS.md — the user must make it name ossify, and the block must say the
  # skill itself writes no project guidance.
  assert_contains '`AGENTS.md`' "$dual_sec" || return 1
  assert_contains 'never names ossify' "$dual_sec" || return 1
  assert_contains 'writes no project guidance' "$dual_sec" || return 1

  local sec
  for sec in "$init_sec" "$pair_sec" "$dual_sec"; do
    if grep -Eq "$_retired_route_patterns" <<<"$sec"; then
      echo "    retired route survives in a printed next-steps block:"
      grep -En "$_retired_route_patterns" <<<"$sec"
      return 1
    fi
  done
}

test_examples_routes_and_created_paths_match_reality() {
  local init_ex_sec pair_ex_sec
  init_ex_sec="$(awk '/^## Final next-steps message/,0' "$FRESH_EX")"
  pair_ex_sec="$(awk '/^## Final next-steps message/,0' "$PAIR_CLEAN_EX")"

  # The changed lines (commit text + route lines) must be byte-consistent
  # between each skill's printed block and its example's copy.
  local l
  while IFS= read -r l; do
    [[ -z "$l" ]] && continue
    assert_contains "$l" "$init_ex_sec" || return 1
  done < <(awk '/^## 6\. Print next-steps/,/^## 7\./' "$INIT_SKILL" \
             | grep -E 'git commit -m|/ossify')
  while IFS= read -r l; do
    [[ -z "$l" ]] && continue
    assert_contains "$l" "$pair_ex_sec" || return 1
  done < <(awk '/^## 8\. Print next-steps/,/^## 9\./' "$PAIR_SKILL" \
             | grep -E 'git commit -m|/ossify')

  # Closing sentences name the ossify route, not the retired one.
  assert_contains '/ossify:start' "$init_ex_sec" || return 1
  assert_contains '/ossify:adopt' "$pair_ex_sec" || return 1
  if grep -Eq "$_retired_route_patterns" <<<"$init_ex_sec"; then
    echo "    retired route survives in fresh-bootstrap next-steps"; return 1
  fi
  if grep -Eq "$_retired_route_patterns" <<<"$pair_ex_sec"; then
    echo "    retired route survives in pair-with-existing-clean next-steps"; return 1
  fi

  # Generated-path claims must match what the tasks actually create.
  local fresh_tree pair_tree
  fresh_tree="$(awk '/^## Created paths/,/^## Final manifest/' "$FRESH_EX")"
  pair_tree="$(awk '/^### AI workspace/,/^### Canonical/' "$PAIR_CLEAN_EX")"
  [[ -n "$fresh_tree" && -n "$pair_tree" ]] \
    || { echo "    a scoped created-paths section is empty — headings drifted"; return 1; }

  local bad need
  for bad in 'handoffs/' 'memory-bank/' 'MASTER-SPEC.md' 'process-adrs/' '.superpowers/brainstorm/'; do
    assert_not_contains "$bad" "$fresh_tree" || return 1
    assert_not_contains "$bad" "$pair_tree" || return 1
  done
  for need in '.workspace/' '.claude/.gitkeep' 'docs/specs/.gitkeep' '.superpowers/.gitkeep' '.archive/.gitkeep'; do
    assert_contains "$need" "$fresh_tree" || return 1
    assert_contains "$need" "$pair_tree" || return 1
  done
}

test_no_retired_guidance_or_ornamental_versions_on_consumer_surfaces() {
  # The scoped file set: every generated-file source, acting-prose surface and
  # consumer-facing catalog line a fresh workspace's user can read. Sibling
  # plugin entries in the shared catalogs are accurate hosted-but-deprecated
  # documentation and are deliberately out of scope.
  local files=(
    "$WI_PLUGIN_ROOT/templates/CLAUDE.md.stub.tmpl"
    "$WI_PLUGIN_ROOT/templates/AGENTS.md.stub.tmpl"
    "$WI_PLUGIN_ROOT/templates/README.md.tmpl"
    "$WI_PLUGIN_ROOT/templates/gitignore.tmpl"
    "$WI_PLUGIN_ROOT/templates/pairing.json.tmpl"
    "$WI_PLUGIN_ROOT/skills/initializing-dual-repo-workspace/SKILL.md"
    "$WI_PLUGIN_ROOT/skills/pairing-canonical-repo/SKILL.md"
    "$WI_PLUGIN_ROOT/skills/pairing-existing-dual/SKILL.md"
    "$WI_PLUGIN_ROOT/skills/initializing-dual-repo-workspace/examples/fresh-bootstrap.md"
    "$WI_PLUGIN_ROOT/skills/pairing-canonical-repo/examples/pair-with-existing-clean.md"
    "$WI_PLUGIN_ROOT/skills/pairing-canonical-repo/examples/pair-with-aborts-on-ai-scaffolding.md"
    "$WI_PLUGIN_ROOT/README.md"
    "$WI_PLUGIN_ROOT/lib/skeleton.sh"
  )
  local f
  for f in "${files[@]}"; do
    [[ -f "$f" ]] || { echo "    scoped file missing: $f"; return 1; }
    if grep -En "$_retired_route_patterns" "$f"; then
      echo "    retired guidance still present in $f"
      return 1
    fi
  done

  # Claude marketplace listing — only the workspace-init member is scoped.
  local desc
  desc="$(jq -r '.plugins[] | select(.name == "workspace-init") | .description' "$CLAUDE_MARKETPLACE")"
  [[ -n "$desc" ]] || { echo "    workspace-init description missing from marketplace.json"; return 1; }
  assert_contains 'ossify' "$desc" || return 1
  assert_not_contains 'first in the scaffolding chain' "$desc" || return 1
  if grep -Eq '[0-9]+ (skills|slash commands|tests)' <<<"$desc"; then
    echo "    hand-maintained counts in marketplace description"; return 1
  fi
  if grep -En "$_retired_route_patterns" <<<"$desc"; then
    echo "    retired route in marketplace description"; return 1
  fi

  # Root catalog — only the workspace-init row is scoped.
  local row
  row="$(grep -F '| [`workspace-init`](./workspace-init/)' "$ROOT_README")"
  [[ -n "$row" ]] || { echo "    workspace-init row not found in root README"; return 1; }
  assert_contains 'v0.6.0' "$row" || return 1
  assert_not_contains 'scaffold-onboard' "$row" || return 1
  assert_not_contains 'scaffold-dev' "$row" || return 1
  assert_not_contains 'scaffolding chain' "$row" || return 1

  # S8 round 1 (F3): the lifecycle overview above the table must not leave
  # workspace-init at the head of the chain this release retires for new
  # workspaces — it names ossify as the continuation and the old chain as legacy.
  local overview
  overview="$(awk '/^Most of the marketplace is designed to/,/^## Install/' "$ROOT_README")"
  [[ -n "$overview" ]] || { echo "    root lifecycle overview not found"; return 1; }
  assert_not_contains '(chain head)' "$overview" || return 1
  assert_contains 'its continuation for new workspaces is `ossify`' "$overview" || return 1
  assert_contains 'not the legacy `scaffold-onboard` + `scaffold-dev` chain' "$overview" || return 1

  # S8 round 3 (H1): this plugin's own README states the continuation twice, and
  # both must state adoption's scope rather than imply that "existing source or
  # history" alone qualifies for it.
  local wi_readme
  wi_readme="$(cat "$WI_PLUGIN_ROOT/README.md")"
  assert_contains 'legacy scaffold stack' "$wi_readme" || return 1
  assert_not_contains 'for existing source or history' "$wi_readme" || return 1

  # Illustrative created_by values must be version-neutral, so substituting the
  # current release number for 0.1.0 cannot satisfy them.
  grep -qF 'workspace-init@<running plugin version>' "$WI_PLUGIN_ROOT/templates/pairing.json.tmpl" \
    || { echo "    pairing.json.tmpl created_by comment is not version-neutral"; return 1; }
  grep -qF 'workspace-init@<running-plugin-version>' "$FRESH_EX" \
    || { echo "    fresh example created_by is not version-neutral"; return 1; }
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
wi_test_run test_printed_skill_routes_point_to_ossify
wi_test_run test_examples_routes_and_created_paths_match_reality
wi_test_run test_no_retired_guidance_or_ornamental_versions_on_consumer_surfaces

wi_test_summary
