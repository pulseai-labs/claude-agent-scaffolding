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
_retired_route_patterns='(/onboard|/scaffold-project|scaffold-onboard|scaffold-dev|scaffold-\*|/defer([^a-z]|$)|workspace-init v[0-9]|workspace-init@[0-9])'

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

  # S8 round 4 (F2): the fresh block opens no tool, so half its readers are on Codex —
  # it must name the skill form the way the Scenario-C block does. And (F3) a recorded
  # tooling repo that already carries history refuses the route outright.
  assert_contains 'on Codex, invoke the corresponding ossify skill — `start`, or `adopt`' "$init_sec" || return 1
  assert_contains 'a recorded tooling repo that already carries history refuses it too' "$init_sec" || return 1

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

  # S8 final edit: the Scenario-C route states adoption's scope (an unpinned truth
  # is how this class returns — every other surface carries the qualifier), and the
  # AGENTS.md work is committed before the route, or A3 refuses on the dirt that
  # step itself created.
  assert_contains 'only for a project previously onboarded with the legacy scaffold stack' "$dual_sec" || return 1
  # #768: step 3 now routes the leftover CLAUDE.md to /ossify:doctor, which authors
  # the repair — so the block says the user *reviews and commits* the result, rather
  # than authoring the file themselves. Same commitment before the route (A3).
  assert_contains 'review and commit before' "$dual_sec" || return 1

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
  # between each skill's printed block and its example's copy. `ossify skill`
  # covers the Codex-form lines, which name the skill and not a slash command.
  local l
  while IFS= read -r l; do
    [[ -z "$l" ]] && continue
    assert_contains "$l" "$init_ex_sec" || return 1
  done < <(awk '/^## 6\. Print next-steps/,/^## 7\./' "$INIT_SKILL" \
             | grep -E 'git commit -m|/ossify|ossify skill')
  while IFS= read -r l; do
    [[ -z "$l" ]] && continue
    assert_contains "$l" "$pair_ex_sec" || return 1
  done < <(awk '/^## 8\. Print next-steps/,/^## 9\./' "$PAIR_SKILL" \
             | grep -E 'git commit -m|/ossify|ossify skill')

  # Closing sentences name the ossify route, not the retired one.
  assert_contains '/ossify:start' "$init_ex_sec" || return 1
  assert_contains '/ossify:adopt' "$pair_ex_sec" || return 1
  # F3's clause rides the same mirror: the example must state it too.
  assert_contains 'a recorded tooling repo that already carries history refuses it too' "$init_ex_sec" || return 1
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
  # The row carries the shipped version: read it from the manifest, not a literal
  # that every bump would have to edit.
  local wi_ver
  wi_ver="$(jq -r .version "$WI_PLUGIN_ROOT/.claude-plugin/plugin.json" 2>/dev/null)"
  [[ -n "$wi_ver" && "$wi_ver" != null ]] || { echo "    no version in the workspace-init manifest"; return 1; }
  assert_contains "v$wi_ver" "$row" || return 1
  assert_not_contains 'scaffold-onboard' "$row" || return 1
  assert_not_contains 'scaffold-dev' "$row" || return 1
  assert_not_contains 'scaffolding chain' "$row" || return 1
  assert_not_contains '/defer' "$row" || return 1

  # S8 closing edit (item 3): the row's continuation clause states adoption's
  # qualifier — the claim it replaced ("for existing source or history" alone)
  # is what the row must not carry back.
  assert_contains 'only for a project previously onboarded with the legacy scaffold stack' "$row" || return 1

  # S8 round 1 (F3): the lifecycle overview above the table must not leave
  # workspace-init at the head of the chain this release retires for new
  # workspaces — it names ossify as the continuation and no longer names the
  # retired chain.
  local overview
  overview="$(awk '/^Most of the marketplace is designed to/,/^## Install/' "$ROOT_README")"
  [[ -n "$overview" ]] || { echo "    root lifecycle overview not found"; return 1; }
  assert_not_contains '(chain head)' "$overview" || return 1
  assert_contains 'its continuation for new workspaces is `ossify`' "$overview" || return 1
  assert_not_contains 'scaffold-onboard' "$overview" || return 1

  # S8 round 3 (H1): this plugin's own README states the continuation twice, and
  # both must state adoption's scope rather than imply that "existing source or
  # history" alone qualifies for it.
  local wi_readme
  wi_readme="$(cat "$WI_PLUGIN_ROOT/README.md")"
  assert_contains 'legacy scaffold stack' "$wi_readme" || return 1
  assert_not_contains 'for existing source or history' "$wi_readme" || return 1

  # S8 round 4 (F1): the README hands off to ossify, so its own install path must
  # install it — a standalone reader must not reach an unregistered command.
  assert_contains '/plugin install ossify@claude-agent-scaffolding' "$wi_readme" || return 1
  assert_contains 'install it alongside first' "$wi_readme" || return 1

  # Illustrative created_by values must be version-neutral, so substituting the
  # current release number for 0.1.0 cannot satisfy them.
  grep -qF 'workspace-init@<running plugin version>' "$WI_PLUGIN_ROOT/templates/pairing.json.tmpl" \
    || { echo "    pairing.json.tmpl created_by comment is not version-neutral"; return 1; }
  grep -qF 'workspace-init@<running-plugin-version>' "$FRESH_EX" \
    || { echo "    fresh example created_by is not version-neutral"; return 1; }
}

# --- #538: the launcher step names both surfaces, as the Scenario-C block does ---

test_launcher_steps_name_both_surfaces() {
  local init_sec pair_sec init_ex_sec pair_ex_sec
  init_sec="$(awk '/^## 6\. Print next-steps/,/^## 7\./' "$INIT_SKILL")"
  pair_sec="$(awk '/^## 8\. Print next-steps/,/^## 9\./' "$PAIR_SKILL")"
  init_ex_sec="$(awk '/^## Final next-steps message/,0' "$FRESH_EX")"
  pair_ex_sec="$(awk '/^## Final next-steps message/,0' "$PAIR_CLEAN_EX")"
  [[ -n "$init_sec" && -n "$pair_sec" && -n "$init_ex_sec" && -n "$pair_ex_sec" ]] \
    || { echo "    a scoped next-steps section is empty — headings drifted"; return 1; }

  local sec
  for sec in "$init_sec" "$pair_sec" "$init_ex_sec" "$pair_ex_sec"; do
    # No Claude-only launcher line survives …
    if grep -Eq '&& claude[[:space:]]*$' <<<"$sec"; then
      echo "    a launcher line still names only claude:"
      grep -En '&& claude[[:space:]]*$' <<<"$sec"
      return 1
    fi
    # … and the launcher names the Codex CLI beside it.
    assert_contains '&& claude      # Claude Code; on Codex, run `codex` in that directory instead' "$sec" || return 1
  done

  # The Scenario-A route names the Codex skill form, as the fresh and C blocks do.
  assert_contains 'On Codex, invoke the corresponding ossify skill — `adopt`, or `start`' "$pair_sec" || return 1
  assert_contains 'On Codex, invoke the corresponding ossify skill — `adopt`, or `start`' "$pair_ex_sec" || return 1
}

# --- #174: `--ai-dir-name` reaches every station the skills and commands own ---

test_ai_dir_name_flag_reaches_skills_and_commands() {
  local s
  for s in "$INIT_SKILL" "$PAIR_SKILL"; do
    grep -qF -- '--ai-dir-name <dir>' "$s" || { echo "    $s: flag grammar missing"; return 1; }
    grep -qF 'ai_root="${parent}/${ai_dir_name}"' "$s" || { echo "    $s: ai_root does not use ai_dir_name"; return 1; }
    ! grep -qF 'ai_root="${parent}/${name}-ai"' "$s" || { echo "    $s: hard-coded <name>-ai ai_root survives"; return 1; }
    grep -qF 'append `--ai-dir-name "$ai_dir_name"`' "$s" || { echo "    $s: lib calls do not forward the flag"; return 1; }
    grep -qF 'substitute `{name}-ai` with the AI workspace directory name' "$s" \
      || { echo "    $s: next-steps substitution ignores a custom dir"; return 1; }
  done
  grep -qF -- '/init-workspace <name> [--wrapper <existing-dir>] --ai-dir-name <dir>' "$WI_PLUGIN_ROOT/commands/init-workspace.md" \
    || { echo "    init-workspace command lacks the flag form"; return 1; }
  grep -qF -- '/pair-workspace <abs-path-to-canonical> [--ai-dir-name <dir>]' "$WI_PLUGIN_ROOT/commands/pair-workspace.md" \
    || { echo "    pair-workspace command lacks the flag form"; return 1; }
  grep -qF -- '/pair-workspace /abs/path/to/existing-project --ai-dir-name existing-project-internal' "$WI_PLUGIN_ROOT/README.md" \
    || { echo "    README does not show the Scenario-A flag form"; return 1; }
}

# --- #146: the README describes itself without links outside the plugin tree ---

test_readme_links_stay_inside_the_plugin() {
  local readme="$WI_PLUGIN_ROOT/README.md"
  # `../docs/` is untracked process exhaust: it never ships and never resolves.
  if grep -En '\]\(\.\./docs/' "$readme"; then
    echo "    README links into the untracked ../docs/ tree"; return 1
  fi
  if grep -En 'docs/(SPEC|PLAN)-workspace-init' "$readme"; then
    echo "    README still names the untracked SPEC/PLAN docs"; return 1
  fi
}

# --- PR #829: each skill resolves wi_bin before its first "$wi_bin" call ---

test_skills_resolve_wi_bin_before_first_use() {
  local f rc=0
  for f in "$WI_PLUGIN_ROOT/skills/initializing-dual-repo-workspace/SKILL.md" \
           "$WI_PLUGIN_ROOT/skills/pairing-canonical-repo/SKILL.md"; do
    # One awk pass: the line that assigns wi_bin must precede the first line
    # that invokes "$wi_bin".
    if ! awk '
      index($0, "wi_bin=\"$(command -v wi)\"") && !def { def = NR }
      index($0, "\"$wi_bin\" ") && !use { use = NR }
      END { exit !(def && use && def < use) }
    ' "$f"; then
      echo "    $f: wi_bin is used before it is resolved (or never resolved)"; rc=1
    fi
  done
  return "$rc"
}

# --- #768: workspace-init writes AGENTS.md only ---

# The detector both the scan and its adjacent control run, so the control
# cannot pass by exercising a different predicate than the one that scans.
names_claude_md_stub() { # $1=file -> 0 when the file names a CLAUDE.md stub
  grep -Fq 'stub_claude_md' "$1" || grep -Fq 'CLAUDE.md stub' "$1" || grep -Fq 'Write CLAUDE.md' "$1"
}

# scan_claude_md_stub_mentions <plugin-root>
# Prints one path per offending file; rc 1 (with a message) when the globs match
# nothing at all, so an empty tree cannot report a clean scan having read none.
scan_claude_md_stub_mentions() { # $1=plugin root
  local root="$1" f hits="" scanned=0
  for f in "$root"/skills/*/SKILL.md "$root"/skills/*/examples/*.md \
           "$root"/templates/*.tmpl "$root/README.md"; do
    [[ -f "$f" ]] || continue
    scanned=$((scanned + 1))
    if names_claude_md_stub "$f"; then hits="$hits $f"; fi
  done
  if [[ "$scanned" -eq 0 ]]; then
    echo "    the surface globs matched no files under $root"; return 1
  fi
  [[ -z "$hits" ]] || printf '%s\n' "${hits# }"
  return 0
}

test_no_claude_md_stub_on_any_surface() {
  # #768: workspace-init writes AGENTS.md only. No skill, example or template
  # may still tell a model to write or expect a CLAUDE.md stub.
  local hits
  hits="$(scan_claude_md_stub_mentions "$WI_PLUGIN_ROOT")" || return 1
  [[ -z "$hits" ]] || { echo "    still names a CLAUDE.md stub:$hits"; return 1; }
  # Positive control: the skills still name the one stub they do write.
  grep -Fq 'stub_agents_md' "$WI_PLUGIN_ROOT/skills/initializing-dual-repo-workspace/SKILL.md" || { echo "    fresh skill lost stub_agents_md"; return 1; }
  grep -Fq 'stub_agents_md' "$WI_PLUGIN_ROOT/skills/pairing-canonical-repo/SKILL.md" || { echo "    pair skill lost stub_agents_md"; return 1; }
  # Adjacent control: the same predicate still fires on a file that names one.
  # Written outside the tree — this suite must not leave files in the plugin.
  local probe
  probe="$(mktemp "${TMPDIR:-/tmp}/wi-probe.XXXXXX")"
  printf 'Write CLAUDE.md for the workspace\n' > "$probe"
  if names_claude_md_stub "$probe"; then :; else
    rm -f "$probe"
    echo "    the detector no longer fires on a CLAUDE.md stub mention"; return 1
  fi
  rm -f "$probe"
}

test_claude_md_stub_scan_fails_on_an_empty_surface() {
  # D13: the guard's own path. A root with no matching files must report RED,
  # never a green scan of nothing — and the real root must still come back clean,
  # which is the adjacent control above.
  local empty
  empty="$(mktemp -d "${TMPDIR:-/tmp}/wi-empty-surface.XXXXXX")"
  if scan_claude_md_stub_mentions "$empty" >/dev/null 2>&1; then
    rmdir "$empty" 2>/dev/null
    echo "    an empty surface reported a clean scan"; return 1
  fi
  rmdir "$empty" 2>/dev/null
}

test_ossify_versions_are_conditioned_in_the_stub_and_scenario_c() {
  # D1/D2: the stub replaces itself and the Scenario C route relies on doctor's
  # repair; both ship in ossify 1.24.0, and a shipped 1.23.0 does neither. Each
  # surface must say so, and must keep the by-hand route the PR removed.
  local tmpl dual
  tmpl="$(cat "$WI_PLUGIN_ROOT/templates/AGENTS.md.stub.tmpl")"
  dual="$(cat "$WI_PLUGIN_ROOT/skills/pairing-existing-dual/SKILL.md")"
  assert_contains 'ossify 1.24.0 or later replaces a file that starts with the marker' "$tmpl" || return 1
  assert_not_contains '`/ossify:start` replaces the whole file' "$tmpl" || return 1
  local s
  for s in "$WI_PLUGIN_ROOT/skills/initializing-dual-repo-workspace/SKILL.md" \
           "$WI_PLUGIN_ROOT/skills/pairing-canonical-repo/SKILL.md"; do
    assert_contains 'ossify 1.24.0 or later replaces a file that starts with it' "$(cat "$s")" || return 1
  done
  assert_contains 'ossify 1.24.0 or later' "$dual" || return 1
  assert_contains 'merge `CLAUDE.md` into `AGENTS.md`' "$dual" || return 1
  # D4: the blanket "Specs … belong here" contradicted the manifest's routing,
  # which sends prd/srs/product_adrs to the canonical. The old stub had the
  # distinction; the fold dropped it. D25 adds MASTER-SPEC, which routing sends
  # to the AI workspace (`pairing.json.tmpl:76`).
  assert_contains 'Sprint specs, `MASTER-SPEC.md`, the memory bank and process records belong here.' "$tmpl" || return 1
  assert_contains 'PRDs and SRSs also go to the' "$tmpl" || return 1
  assert_not_contains 'Specs, the memory bank and process records belong here.' "$tmpl" || return 1
  # D5: the §4 scan must name the `.claude/` copy too, which step 3 covers.
  assert_contains '- `${ai_root}/.claude/CLAUDE.md`' "$dual" || return 1
  # D19/D21: adopt routes legacy projects, and an older ossify's adopt merges its
  # loop section into CLAUDE.md — so the same version condition applies there, and
  # the by-hand merge must be named on every surface that routes to adopt.
  assert_contains 'adopt merges its loop section into' "$tmpl" || return 1
  assert_contains 'it merges that section into' "$dual" || return 1
  # The by-hand route itself, not just the diagnosis: removing it SURVIVED until
  # this line existed.
  assert_contains 'merge it into `AGENTS.md` by hand' "$dual" || return 1
  local pair
  pair="$(cat "$WI_PLUGIN_ROOT/skills/pairing-canonical-repo/SKILL.md")"
  # Assert the version, not just the sentence: the bare "adopt merges its loop
  # section into `AGENTS.md`" SURVIVED dropping the condition on first run.
  assert_contains 'On ossify 1.24.0 or later, adopt merges its loop section into `AGENTS.md`' "$pair" || return 1
  assert_contains 'merge that section into' "$pair" || return 1
  local init_s
  init_s="$(cat "$WI_PLUGIN_ROOT/skills/initializing-dual-repo-workspace/SKILL.md")"
  assert_contains 'adopt merges its loop section into AGENTS.md on ossify 1.24.0 or later' "$init_s" || return 1
  # D21: every older-ossify statement must describe 1.23.0's real behaviour. The
  # round-1 wording ("treats it as an existing file and asks you to keep it or
  # move it aside") was wrong — occupied-destinations.md has no AGENTS.md entry at
  # all, so /start writes CLAUDE.md beside an untouched stub with no question.
  assert_not_contains 'asks you to keep it or move it aside' "$tmpl" || return 1
  assert_not_contains 'asks you to keep it or move it aside' "$init_s" || return 1
  assert_not_contains 'asks you to keep it or move it aside' "$pair" || return 1
  # …and the real behaviour is stated: /start never looks for AGENTS.md, and the
  # interop check never opens CLAUDE.md.
  assert_contains 'never looks for `AGENTS.md`' "$tmpl" || return 1
  assert_contains 'never looks for `AGENTS.md`' "$init_s" || return 1
  assert_contains 'never looks for `AGENTS.md`' "$pair" || return 1
  assert_contains 'never opens `CLAUDE.md`' "$tmpl" || return 1
  assert_contains 'never opens `CLAUDE.md`' "$init_s" || return 1
  assert_contains 'never opens `CLAUDE.md`' "$pair" || return 1
  # D21, the sites the round-1 pins did not reach (all three SURVIVED mutation
  # until these lines existed): Scenario C's step 3 premise, its step-4 start-arm
  # shadowing warning, and the README template's unconditioned "until ossify
  # authors" clause.
  assert_contains 'never opens `CLAUDE.md`' "$dual" || return 1
  # The precedence rule itself: the SURVIVED mutation removed exactly this clause
  # while the other `never opens` occurrence satisfied the line above.
  assert_contains 'Claude Code loads `CLAUDE.md` and ignores `AGENTS.md` whenever both exist' "$dual" || return 1
  assert_contains 'it writes a `CLAUDE.md` beside the stub, which then shadows' "$dual" || return 1
  local rtmpl
  rtmpl="$(cat "$WI_PLUGIN_ROOT/templates/README.md.tmpl")"
  assert_contains 'until ossify 1.24.0 or later replaces it' "$rtmpl" || return 1
  # The three next-steps blocks route to `/ossify:start`, which is the arm that
  # actually shadows — the round-1 text warned only on the adopt arm. The example
  # must mirror its skill: the mirror test's grep (`/ossify`, `ossify skill`)
  # does not reach these comment lines, so a mutation dropping one SURVIVED here
  # until this line existed.
  local warn='on ossify 1.24.0 or later this replaces the marked AGENTS.md stub; on an older'
  assert_contains "$warn" "$init_s" || return 1
  assert_contains "$warn" "$(cat "$WI_PLUGIN_ROOT/skills/initializing-dual-repo-workspace/examples/fresh-bootstrap.md")" || return 1
  # Adjacent control: the unconditioned clause and the round-1 misstatement are
  # gone from the shipped surfaces.
  assert_not_contains 'until ossify authors project-specific guidance' "$rtmpl" || return 1
  assert_not_contains 'treats it as an existing file' "$dual" || return 1
}

test_marker_string_matches_across_surfaces() {
  # D14: the marker is a contract between workspace-init and ossify's /start.
  # The skills quote it in prose; the template mints it. A typo in either would
  # ship a stub ossify never recognises.
  local marker='<!-- workspace-init stub: ossify:start replaces this file -->'
  local tmpl_first
  tmpl_first="$(head -n 1 "$WI_PLUGIN_ROOT/templates/AGENTS.md.stub.tmpl")"
  assert_eq "$marker" "$tmpl_first" || return 1
  local s
  for s in "$WI_PLUGIN_ROOT/skills/initializing-dual-repo-workspace/SKILL.md" \
           "$WI_PLUGIN_ROOT/skills/pairing-canonical-repo/SKILL.md"; do
    grep -Fq "$marker" "$s" || { echo "    $s does not quote the template marker verbatim"; return 1; }
  done
}

test_claude_code_fallback_is_version_gated() {
  # D20: the `AGENTS.md` fallback shipped in Claude Code 2.1.277 (release
  # v2.1.277, 2026-09-18). This release stops writing CLAUDE.md, so on an older
  # or enterprise-pinned client a fresh workspace loads no project instructions
  # at all — every surface that states the fallback must name the floor.
  local tmpl init_s pair_s chg
  tmpl="$(cat "$WI_PLUGIN_ROOT/templates/AGENTS.md.stub.tmpl")"
  init_s="$(cat "$WI_PLUGIN_ROOT/skills/initializing-dual-repo-workspace/SKILL.md")"
  pair_s="$(cat "$WI_PLUGIN_ROOT/skills/pairing-canonical-repo/SKILL.md")"
  chg="$(cat "$WI_PLUGIN_ROOT/CHANGELOG.md")"

  assert_contains 'Claude Code 2.1.277 or later loads it when the' "$tmpl" || return 1
  assert_contains 'an older Claude Code reads only `CLAUDE.md`' "$tmpl" || return 1
  assert_contains 'Claude Code 2.1.277 or later' "$init_s" || return 1
  assert_contains 'Claude Code 2.1.277 or later' "$pair_s" || return 1
  assert_contains 'Claude Code **2.1.277 or later** loads it as project instructions' "$chg" || return 1
  # Adjacent control: the unqualified claim, and the "measured on" wording the
  # design used for its probe, must be gone from the shipped surfaces.
  assert_not_contains 'Claude Code, Codex, OMP and other agents read it' "$tmpl" || return 1
  assert_not_contains 'measured on Claude Code 2.1.300' "$chg" || return 1
  assert_not_contains 'Claude Code loads it when the' "$tmpl" || return 1
}

test_release_record_matches_the_shipped_files() {
  # D23/D24: the release record and a test header carry claims about files that
  # can drift from them. Three of these were wrong in round 1 (R2 found them) and
  # each mutation SURVIVED until this test existed.
  local chg hdr
  chg="$(cat "$WI_PLUGIN_ROOT/CHANGELOG.md")"
  hdr="$(sed -n '1,10p' "$WI_PLUGIN_ROOT/tests/test-stubs.sh")"
  # The "grown organically" pointer lives in `pairing-canonical-repo` §1, not in
  # `pairing-existing-dual` — verify the fact before pinning the claim.
  local dual_s
  dual_s="$(cat "$WI_PLUGIN_ROOT/skills/pairing-existing-dual/SKILL.md")"
  grep -Fq 'grown organically' "$WI_PLUGIN_ROOT/skills/pairing-canonical-repo/SKILL.md" \
    || { echo "    the pointer no longer lives in pairing-canonical-repo"; return 1; }
  case "$dual_s" in
    *'grown organically'*) echo "    pairing-existing-dual now holds the pointer too — update the claim"; return 1 ;;
  esac
  assert_contains 'pointer paragraph in `pairing-canonical-repo` §1 names' "$chg" || return 1
  # The `## AI-trace filter` section came from the old CLAUDE.md stub.
  git -C "$REPO_ROOT" show b4410e89:workspace-init/templates/CLAUDE.md.stub.tmpl 2>/dev/null \
    | grep -Fq '## AI-trace filter' \
    || { echo "    the old CLAUDE.md stub no longer shows the AI-trace section"; return 1; }
  assert_contains 'section plus the canonical-and-ossify continuation sections from the old `CLAUDE.md` stub' "$chg" || return 1
  # The header's count must equal the runners that file actually declares.
  local runners
  runners="$(grep -c 'wi_test_run' "$WI_PLUGIN_ROOT/tests/test-stubs.sh")"
  assert_contains "Covers ($runners tests)" "$hdr" || return 1
  assert_not_contains 'SPEC §8.5' "$hdr" || return 1
}

test_layout_tree_versions_match_manifests() {
  # D7: the root README's Layout tree carries a hand-maintained `(vX.Y.Z)` per
  # plugin, and workspace-init's had drifted to v0.8.0 two releases behind. The
  # catalog row above is read from the manifest; this tree was not. Pin every
  # label to its own manifest so the next bump cannot leave a stale one.
  local layout n=0 d v m
  # Fence-aware: `sed -n '/^## Layout$/,/^```$/p'` closes on the OPENING fence
  # and returns three lines. Enter on the heading, then skip one fence, then
  # collect until the fence that closes the block.
  layout="$(awk '
    /^## Layout$/ { inblock=1; next }
    inblock && /^```/ { if (fence++) exit; next }
    inblock { print }
  ' "$ROOT_README")"
  [[ -n "$layout" ]] || { echo "    Layout block not found in the root README"; return 1; }
  while IFS= read -r line; do
    case "$line" in
      *'plugin (v'*|*'lifecycle (v'*|*'roles'*'orchestrator (v'*) ;;
      *) continue ;;
    esac
    d="$(printf '%s' "$line" | sed -E 's/^[^ ]+ ([a-z-]+)\/.*/\1/')"
    [[ -d "$REPO_ROOT/$d" ]] || { echo "    Layout names a missing dir: $d"; return 1; }
    v="$(printf '%s' "$line" | grep -oE '\(v[0-9.]+' | sed 's/(v//')"
    m="$(jq -r .version "$REPO_ROOT/$d/.claude-plugin/plugin.json" 2>/dev/null)"
    [[ -n "$m" && "$m" != null ]] || m="$(jq -r .version "$REPO_ROOT/$d/package.json" 2>/dev/null)"
    [[ "$v" == "$m" ]] || { echo "    $d: Layout says v$v, manifest says $m"; return 1; }
    n=$((n + 1))
  done <<<"$layout"
  # Adjacent control: the scan must have found the rows, not passed vacuously.
  [[ "$n" -ge 10 ]] || { echo "    only $n version labels found in the Layout tree"; return 1; }
}

test_existing_dual_scans_both_instruction_files() {
  local s="$WI_PLUGIN_ROOT/skills/pairing-existing-dual/SKILL.md"
  grep -Fq '`${ai_root}/AGENTS.md`' "$s" && grep -Fq '`${ai_root}/CLAUDE.md`' "$s" || { echo "    scan list must name both files"; return 1; }
  grep -Fq '/ossify:doctor' "$s" || { echo "    next steps must route a CLAUDE.md to the doctor repair"; return 1; }
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
wi_test_run test_launcher_steps_name_both_surfaces
wi_test_run test_ai_dir_name_flag_reaches_skills_and_commands
wi_test_run test_readme_links_stay_inside_the_plugin
wi_test_run test_skills_resolve_wi_bin_before_first_use
wi_test_run test_no_claude_md_stub_on_any_surface
wi_test_run test_claude_md_stub_scan_fails_on_an_empty_surface
wi_test_run test_marker_string_matches_across_surfaces
wi_test_run test_ossify_versions_are_conditioned_in_the_stub_and_scenario_c
wi_test_run test_claude_code_fallback_is_version_gated
wi_test_run test_release_record_matches_the_shipped_files
wi_test_run test_layout_tree_versions_match_manifests
wi_test_run test_existing_dual_scans_both_instruction_files

wi_test_summary
