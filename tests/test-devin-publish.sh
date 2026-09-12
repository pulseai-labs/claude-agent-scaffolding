#!/usr/bin/env bash
# test-devin-publish.sh — Devin native publish contract
#
# Validates the root meta-plugin and five native plugin manifests against the
# approved design spec as amended 2026-09-12 (five-plugin baseline: ossify
# promoted from optional, code-judo admitted).  One authoritative data block
# defines baseline, experimental, and excluded plugins.  No prose maintains a
# competing list.
#
# Test-first: this test is written before any production manifest and must
# fail (RED) when manifests are absent.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); printf '  ok  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  not ok  %s\n' "$1"; }

json_get() {
  jq -r "$1" "$2" 2>/dev/null
}

assert_file() {
  if [[ -f "$1" ]]; then pass "$2"; else fail "$2"; fi
}

assert_jq() {
  local expr="$1"
  local file="$2"
  local label="$3"
  if jq -e "$expr" "$file" >/dev/null 2>&1; then pass "$label"; else fail "$label"; fi
}

assert_jq_str() {
  local expr="$1"
  local expected="$2"
  local file="$3"
  local label="$4"
  local actual
  actual="$(json_get "$expr" "$file")"
  if [[ "$actual" == "$expected" ]]; then pass "$label"; else fail "$label (expected '$expected', got '$actual')"; fi
}

###############################################################################
# Authoritative data block — single source of truth for this test.
###############################################################################
GITHUB_REPO="https://github.com/pulseai-labs/claude-agent-scaffolding.git"

BASELINE_PLUGINS="workspace-init ai-mentor architect-critic ossify code-judo"
EXPERIMENTAL_PLUGINS=""
EXCLUDED_PLUGINS="scaffold scaffold-onboard scaffold-dev claude-security-audit orca-crew"

# Ossify's Devin claim is exactly six canonical skills plus the local worker;
# adopt, challenge, and wayfinder are deferred on this surface.
OSSIFY_DEVIN_SKILLS='["skills/start","skills/plan-release","skills/plan-spine","skills/work-item","skills/close","skills/doctor",".devin/skills"]'

ALL_TARGET_PLUGINS="$BASELINE_PLUGINS $EXPERIMENTAL_PLUGINS"

printf 'Devin native publish contract\n\n'

###############################################################################
# Root meta-plugin manifest
###############################################################################
ROOT_MANIFEST="$ROOT/.devin-plugin/plugin.json"

assert_file "$ROOT_MANIFEST" "root .devin-plugin/plugin.json exists"

if [[ -f "$ROOT_MANIFEST" ]]; then
  assert_jq_str '.name' "claude-agent-scaffolding-devin" "$ROOT_MANIFEST" \
    "root manifest name is claude-agent-scaffolding-devin"

  assert_jq_str '.version' "0.1.0" "$ROOT_MANIFEST" \
    "root manifest version is 0.1.0"

  # Required set is exactly the five baseline plugins — membership, count,
  # and the dep URLs are all pinned.
  # Dependency entries can be strings or objects with path/subdir/repo fields.
  for plugin in $BASELINE_PLUGINS; do
    if jq -e --arg p "$plugin" \
      '.requiredPlugins[] | select(. == $p or .path == $p or .subdir == $p or .repo == $p or .source == $p)' \
      "$ROOT_MANIFEST" >/dev/null 2>&1; then
      pass "root requiredPlugins includes $plugin"
    else
      fail "root requiredPlugins includes $plugin"
    fi
  done

  baseline_count="$(printf '%s' "$BASELINE_PLUGINS" | wc -w | tr -d ' ')"
  assert_jq ".requiredPlugins | length == $baseline_count" "$ROOT_MANIFEST" \
    "root requiredPlugins count equals the baseline set size"

  # Every required dep must point at this repository — a wrong-org or typo'd
  # URL is invisible to the hermetic live gate (it rewrites urls to file://).
  # Strict `.url ==`: a git-subdir entry with no url must fail, not default-pass.
  for plugin in $BASELINE_PLUGINS; do
    if jq -e --arg p "$plugin" --arg url "$GITHUB_REPO" \
      '.requiredPlugins[] | select(.path == $p or .subdir == $p or . == $p) | .url == $url' \
      "$ROOT_MANIFEST" >/dev/null 2>&1; then
      pass "requiredPlugins[$plugin].url is $GITHUB_REPO"
    else
      fail "requiredPlugins[$plugin] is missing or points off $GITHUB_REPO"
    fi
  done

  # Required set must NOT include experimental or excluded plugins
  for plugin in $EXPERIMENTAL_PLUGINS $EXCLUDED_PLUGINS; do
    if jq -e --arg p "$plugin" \
      '.requiredPlugins[] | select(. == $p or .path == $p or .subdir == $p or .repo == $p or .source == $p)' \
      "$ROOT_MANIFEST" >/dev/null 2>&1; then
      fail "root requiredPlugins must NOT include $plugin"
    else
      pass "root requiredPlugins excludes $plugin"
    fi
  done

  # Optional set is empty — the field must be absent, not an empty list,
  # so that absence rather than an empty array is the tested contract.
  assert_jq 'has("optionalPlugins") | not' "$ROOT_MANIFEST" \
    "root manifest has no optionalPlugins (five-plugin baseline)"

  # Optional set must NOT include baseline or excluded plugins
  for plugin in $BASELINE_PLUGINS $EXCLUDED_PLUGINS; do
    if jq -e --arg p "$plugin" \
      '.optionalPlugins[] | select(. == $p or .path == $p or .subdir == $p or .repo == $p or .source == $p)' \
      "$ROOT_MANIFEST" >/dev/null 2>&1; then
      fail "root optionalPlugins must NOT include $plugin"
    else
      pass "root optionalPlugins excludes $plugin"
    fi
  done

  # No forbid list
  assert_jq 'has("forbiddenPlugins") | not' "$ROOT_MANIFEST" \
    "root manifest has no forbiddenPlugins"
fi

###############################################################################
# Per-plugin native manifests
###############################################################################
for plugin in $ALL_TARGET_PLUGINS; do
  manifest="$ROOT/$plugin/.devin-plugin/plugin.json"
  claude_manifest="$ROOT/$plugin/.claude-plugin/plugin.json"

  assert_file "$manifest" "$plugin has .devin-plugin/plugin.json"
  [[ -f "$manifest" ]] || continue

  # Native name matches directory
  assert_jq_str '.name' "$plugin" "$manifest" \
    "$plugin native manifest name matches directory"

  # Native version equals Claude manifest version
  if [[ -f "$claude_manifest" ]]; then
    cv="$(json_get '.version' "$claude_manifest")"
    dv="$(json_get '.version' "$manifest")"
    if [[ -n "$cv" && "$cv" == "$dv" ]]; then
      pass "$plugin native version ($dv) matches Claude manifest"
    else
      fail "$plugin native version ($dv) != Claude manifest ($cv)"
    fi
  else
    fail "$plugin has no Claude manifest for version parity"
  fi

  # Native skills paths must be explicit and remain inside the plugin root.
  # If skills field is present, it must be a path or array of paths starting
  # with "skills/" or a documented alternative within the plugin root.
  skills_val="$(json_get '.skills' "$manifest")"
  if [[ "$skills_val" == "null" ]]; then
    pass "$plugin native manifest has no skills override (default skills/)"
  else
    # Check that skills paths don't reference outside the plugin root.
    # any() aggregation is load-bearing: bare `jq -e .skills[] | test` judges
    # only the LAST element, so an escape in an earlier slot was masked.
    # An entry fails if it is not a string, contains a `..` segment anywhere,
    # or is absolute.
    if jq -e '
      (.skills | if type == "array" then . else [.] end) as $s
      | any($s[]; (type != "string") or test("(^|/)\\.\\.(/|$)") or test("^/"))
    ' "$manifest" >/dev/null 2>&1; then
      fail "$plugin native skills path escapes plugin root"
    else
      pass "$plugin native skills path stays within plugin root"
    fi
  fi
done

# Ossify's skills selection is exactly the six-skill Devin claim plus the
# .devin/skills worker directory — adopt/challenge/wayfinder stay unadvertised.
if [[ "$(json_get '.skills | sort | join(",")' "$ROOT/ossify/.devin-plugin/plugin.json")" == \
     "$(printf '%s' "$OSSIFY_DEVIN_SKILLS" | jq -r 'sort | join(",")')" ]]; then
  pass "ossify skills array is the six-skill claim plus .devin/skills"
else
  fail "ossify skills array mismatch (got: $(json_get '.skills' "$ROOT/ossify/.devin-plugin/plugin.json"))"
fi

###############################################################################
# Excluded plugins must NOT have .devin-plugin/plugin.json
###############################################################################
for plugin in $EXCLUDED_PLUGINS; do
  if [[ -f "$ROOT/$plugin/.devin-plugin/plugin.json" ]]; then
    fail "$plugin (excluded) must NOT have .devin-plugin/plugin.json"
  else
    pass "$plugin (excluded) has no .devin-plugin/plugin.json"
  fi
done

###############################################################################
# No generated/copied Devin skill body
#
# Reject a .devin/skills/**/SKILL.md body that is byte-identical to, or
# contains the full body of, a canonical skill.  Thin wrappers remain allowed
# only under the approved selection rule.
###############################################################################
for plugin in $ALL_TARGET_PLUGINS; do
  devin_skills_dir="$ROOT/$plugin/.devin/skills"
  canonical_skills_dir="$ROOT/$plugin/skills"

  if [[ -d "$devin_skills_dir" ]]; then
    while IFS= read -r devin_skill_md; do
      devin_skill_name="$(basename "$(dirname "$devin_skill_md")")"
      canonical_skill_md="$canonical_skills_dir/$devin_skill_name/SKILL.md"

      if [[ -f "$canonical_skill_md" ]]; then
        # Byte-identical check
        if cmp -s "$devin_skill_md" "$canonical_skill_md"; then
          fail "$plugin/.devin/skills/$devin_skill_name is byte-identical copy of canonical"
        else
          # Full-body containment check: does the .devin version contain the
          # entire canonical body (after frontmatter)?
          canonical_body="$(awk 'NR==1 && $0=="---"{f=1;next} f && $0=="---"{f=0;next} !f{print}' "$canonical_skill_md")"
          devin_body="$(awk 'NR==1 && $0=="---"{f=1;next} f && $0=="---"{f=0;next} !f{print}' "$devin_skill_md")"
          if printf '%s' "$devin_body" | grep -qF "$canonical_body" 2>/dev/null; then
            fail "$plugin/.devin/skills/$devin_skill_name contains full canonical body"
          else
            pass "$plugin/.devin/skills/$devin_skill_name is a thin wrapper, not a copy"
          fi
        fi
      else
        pass "$plugin/.devin/skills/$devin_skill_name has no canonical counterpart (new Devin-only skill)"
      fi
    done < <(find "$devin_skills_dir" -name SKILL.md 2>/dev/null | sort)
  fi
done

###############################################################################
# SKILL.md frontmatter must parse as valid YAML
#
# Uses the same Ruby+Psych preflight pattern as test-codex-dual-publish.sh.
# Missing parser must fail loudly.
###############################################################################
assert_yaml_frontmatter() {
  local file="$1" label="$2" fm ruby_bin
  ruby_bin="$(command -v ruby || true)"
  if [[ -z "$ruby_bin" ]] || ! "$ruby_bin" -e 'require "psych"' >/dev/null 2>&1; then
    fail "$label (ruby+Psych unavailable on PATH — cannot validate frontmatter)"
    return
  fi
  fm="$(awk 'NR==1 && $0=="---"{f=1;next} f && $0=="---"{exit} f{print}' "$file")"
  if [[ -z "$fm" ]]; then
    fail "$label (no frontmatter block found)"
    return
  fi
  if printf '%s\n' "$fm" | "$ruby_bin" -ryaml -e 'Psych.parse($stdin.read)' >/dev/null 2>&1; then
    pass "$label"
  else
    fail "$label"
  fi
}

for plugin in $ALL_TARGET_PLUGINS; do
  # Check canonical skills
  if [[ -d "$ROOT/$plugin/skills" ]]; then
    while IFS= read -r skill_md; do
      skill_name="$(basename "$(dirname "$skill_md")")"
      assert_yaml_frontmatter "$skill_md" "$plugin/$skill_name canonical SKILL.md frontmatter parses"
    done < <(find "$ROOT/$plugin/skills" -name SKILL.md 2>/dev/null | sort)
  fi

  # Check .devin/skills if they exist
  if [[ -d "$ROOT/$plugin/.devin/skills" ]]; then
    while IFS= read -r skill_md; do
      skill_name="$(basename "$(dirname "$skill_md")")"
      assert_yaml_frontmatter "$skill_md" "$plugin/.devin/$skill_name Devin SKILL.md frontmatter parses"
    done < <(find "$ROOT/$plugin/.devin/skills" -name SKILL.md 2>/dev/null | sort)
  fi
done

###############################################################################
# Installation/support documentation contract
#
# .devin/INSTALL.md is the governing doc for the Devin surface.  These pin the
# claims the doc MUST carry (test-first: written before the prose).  Claim
# strings below are the stable substrings the doc is held to.
###############################################################################
INSTALL_DOC="$ROOT/.devin/INSTALL.md"
assert_file "$INSTALL_DOC" ".devin/INSTALL.md exists"

assert_doc_contains() {
  # $1 = literal substring the doc must carry, $2 = label
  if [[ -f "$INSTALL_DOC" ]] && grep -qF "$1" "$INSTALL_DOC"; then
    pass "$2"
  else
    fail "$2"
  fi
}

for plugin in $BASELINE_PLUGINS; do
  assert_doc_contains "$plugin" "INSTALL.md names baseline plugin $plugin"
done

assert_doc_contains "3000.10.21" "INSTALL.md pins the supported Devin floor"
assert_doc_contains "Devin Desktop" "INSTALL.md states CLI/Desktop support boundary"
assert_doc_contains "cloud sessions is not part of this contract" "INSTALL.md states cloud-session limitation"
assert_doc_contains "/.claude/architect-critic" "INSTALL.md documents shared critic state path"
assert_doc_contains "host-only" "INSTALL.md states architect-critic is host-only under Devin"
assert_doc_contains "async request is refused" "INSTALL.md states async critique is refused under Devin"
assert_doc_contains "<plugin>:<skill>" "INSTALL.md documents namespaced skill invocation"
assert_doc_contains "in beta" "INSTALL.md carries the plugins-beta caveat"
assert_doc_contains "requiredPlugins" "INSTALL.md documents meta-plugin auto-install"

# Ossify is baseline (amended): the doc must NOT relegate it to opt-in.
# Line-scoped co-occurrence, minus legitimate uses: the manifest field name,
# the plugins-info column list, and explicit negations.
if [[ ! -f "$INSTALL_DOC" ]]; then
  fail "INSTALL.md does not describe ossify as optional/opt-in (doc absent — unverifiable)"
elif grep -Ei 'ossify' "$INSTALL_DOC" \
      | grep -Ei 'optional|opt-in' \
      | grep -vEi 'required/optional|optionalPlugins|no optional|not optional' \
      | grep -q .; then
  fail "INSTALL.md must not describe ossify as optional/opt-in (it is baseline)"
else
  pass "INSTALL.md does not describe ossify as optional/opt-in"
fi

printf '\nPassed: %d  Failed: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
