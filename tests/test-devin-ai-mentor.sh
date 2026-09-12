#!/usr/bin/env bash
# test-devin-ai-mentor.sh — Focused Devin adapter test for ai-mentor
#
# Validates that:
# - All four namespaced skills are advertised after install
# - No state directory, hook, subprocess wrapper, or copied policy is introduced
# - The recommendation-policy reference is readable from the installed plugin
# - Skill-local references (personas.md, escape-valves.md) are readable
# - Canonical skill bodies do not use ${CLAUDE_PLUGIN_ROOT} (surface-neutral)
# - Negative control: absent reference is not accidentally read from developer checkout
#
# Uses an isolated HOME with a read-only credential bridge.

set -euo pipefail

EXPECTED_DEVIN_VERSION="3000.10.21"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
AM_ROOT="$ROOT/ai-mentor"

DEVIN_BIN="$(command -v devin || true)"
NODE_BIN="$(command -v node || true)"

if [ -z "$DEVIN_BIN" ]; then
  printf 'FAIL: devin is required\n' >&2; exit 1
fi
if [ -z "$NODE_BIN" ]; then
  printf 'FAIL: node is required\n' >&2; exit 1
fi

DEVIN_VERSION="$("$DEVIN_BIN" version 2>/dev/null | head -1 || true)"
DEVIN_VERSION_NUM="$(printf '%s' "$DEVIN_VERSION" | awk '{print $2}')"
if [ "$DEVIN_VERSION_NUM" != "$EXPECTED_DEVIN_VERSION" ]; then
  printf 'FAIL: expected devin %s, got "%s"\n' "$EXPECTED_DEVIN_VERSION" "$DEVIN_VERSION" >&2
  exit 1
fi

REAL_CREDENTIALS="$HOME/.local/share/devin/credentials.toml"
if [ ! -f "$REAL_CREDENTIALS" ]; then
  printf 'FAIL: %s not found\n' "$REAL_CREDENTIALS" >&2; exit 1
fi

# Fixture contract
if [ ! -f "$AM_ROOT/.devin-plugin/plugin.json" ]; then
  printf 'FAIL: ai-mentor/.devin-plugin/plugin.json absent\n' >&2; exit 1
fi
for REQUIRED in \
  "skills/grill-me/SKILL.md" \
  "skills/council/SKILL.md" \
  "skills/eli10/SKILL.md" \
  "skills/fool/SKILL.md" \
  "references/recommendation-policy.md" \
  "skills/council/personas.md" \
  "skills/grill-me/escape-valves.md"
do
  if [ ! -f "$AM_ROOT/$REQUIRED" ]; then
    printf 'FAIL: fixture absent: %s\n' "$REQUIRED" >&2; exit 1
  fi
done

###############################################################################
# Isolation
###############################################################################
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/devin-am.XXXXXX")"
TEST_ROOT="$(cd "$TEST_ROOT" && pwd -P)"
ISOLATED_HOME="$TEST_ROOT/home"
ISOLATED_CONFIG="$ISOLATED_HOME/.config"
ISOLATED_DATA="$ISOLATED_HOME/.local/share"
ISOLATED_CACHE="$ISOLATED_HOME/.cache"

mkdir -p \
  "$ISOLATED_CONFIG/devin" \
  "$ISOLATED_DATA/devin/cli" \
  "$ISOLATED_CACHE" \
  "$TEST_ROOT/project"

cat > "$ISOLATED_CONFIG/devin/config.json" <<'CFG'
{
  "auto_update": false,
  "skip_workspace_trust": true,
  "read_config_from": {
    "cursor": false, "windsurf": false, "claude": false,
    "copilot": false, "opencode": false, "vscode": false,
    "zed": false, "agents_standard": false
  }
}
CFG

cp "$REAL_CREDENTIALS" "$ISOLATED_DATA/devin/credentials.toml"
chmod 600 "$ISOLATED_DATA/devin/credentials.toml"

GIT_BIN_DIR="$(dirname "$(command -v git 2>/dev/null || echo /usr/bin/git)")"
JQ_BIN_DIR="$(dirname "$(command -v jq 2>/dev/null || echo /usr/bin/jq)")"
SAFE_PATH="${DEVIN_BIN%/*}:${NODE_BIN%/*}:${GIT_BIN_DIR}:${JQ_BIN_DIR}:/usr/local/bin:/usr/bin:/bin"

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); printf '  ok  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  not ok  %s\n' "$1"; }

cleanup() {
  local rc=$?
  rm -rf "$TEST_ROOT"
  printf '\nPassed: %d  Failed: %d\n' "$PASS" "$FAIL"
  if [ "$FAIL" -gt 0 ]; then exit 1; fi
  exit $rc
}
trap cleanup EXIT HUP INT TERM

run_devin() {
  env -i \
    HOME="$ISOLATED_HOME" \
    XDG_CONFIG_HOME="$ISOLATED_CONFIG" \
    XDG_DATA_HOME="$ISOLATED_DATA" \
    XDG_CACHE_HOME="$ISOLATED_CACHE" \
    PATH="$SAFE_PATH" \
    NO_COLOR=1 TERM=dumb DEVIN_AUTO_UPDATE=0 \
    "$DEVIN_BIN" "$@"
}

###############################################################################
# Install ai-mentor
###############################################################################
run_devin plugins install --local -y "$AM_ROOT" >/dev/null 2>&1

###############################################################################
# Probe 1: All four namespaced skills are advertised
###############################################################################
printf 'Probe 1: Four namespaced skills advertised\n'

skills_json="$(run_devin skills list --json 2>/dev/null)"
skill_names="$(printf '%s' "$skills_json" | "$NODE_BIN" -e '
  const data = JSON.parse(require("fs").readFileSync(0,"utf8"));
  for (const s of data) console.log(s.name);
')"

for expected in \
  "ai-mentor:grill-me" \
  "ai-mentor:council" \
  "ai-mentor:eli10" \
  "ai-mentor:fool"
do
  if printf '%s\n' "$skill_names" | grep -qx "$expected"; then
    pass "skill advertised: $expected"
  else
    fail "skill missing: $expected"
  fi
done

###############################################################################
# Probe 2: No state directory, hook, subprocess wrapper, or copied policy
###############################################################################
printf '\nProbe 2: No state/hooks/subprocess/copied policy\n'

# Check no .devin/skills directory (no copied skills)
if [ -d "$AM_ROOT/.devin/skills" ]; then
  fail ".devin/skills exists (copied skills)"
else
  pass "no .devin/skills (no copied skills)"
fi

# Check no hooks.json
if [ -f "$AM_ROOT/hooks.json" ] || [ -f "$AM_ROOT/.devin/hooks.json" ]; then
  fail "hooks.json exists"
else
  pass "no hooks.json"
fi

# Check no bin/ directory (no subprocess wrappers)
if [ -d "$AM_ROOT/bin" ]; then
  fail "bin/ exists (subprocess wrapper)"
else
  pass "no bin/ (no subprocess wrapper)"
fi

# Check no state directory
if [ -d "$AM_ROOT/state" ] || [ -d "$AM_ROOT/.state" ]; then
  fail "state directory exists"
else
  pass "no state directory"
fi

# Check no copied policy in .devin/ — -print -quit + string test, not
# `find | grep -q .` (pipefail SIGPIPE on grep -q's early exit reads as
# "absent": a false pass on exactly the mutation this guards).
if [ -n "$(find "$AM_ROOT/.devin" -name 'recommendation-policy*' -print -quit 2>/dev/null)" ]; then
  fail "copied policy found in .devin/"
else
  pass "no copied policy in .devin/"
fi

###############################################################################
# Probe 3: Recommendation-policy reference is readable from installed plugin
###############################################################################
printf '\nProbe 3: Recommendation-policy reference readable\n'

policy_path="$AM_ROOT/references/recommendation-policy.md"
if [ -f "$policy_path" ]; then
  pass "recommendation-policy.md exists at references/"
  # Verify it has substantive content (not empty)
  content_size="$(wc -c < "$policy_path")"
  if [ "$content_size" -gt 100 ]; then
    pass "recommendation-policy.md has content ($content_size bytes)"
  else
    fail "recommendation-policy.md is too small ($content_size bytes)"
  fi
else
  fail "recommendation-policy.md absent from references/"
fi

###############################################################################
# Probe 4: Skill-local references are readable
###############################################################################
printf '\nProbe 4: Skill-local references readable\n'

for ref in \
  "skills/council/personas.md" \
  "skills/grill-me/escape-valves.md"
do
  if [ -f "$AM_ROOT/$ref" ]; then
    pass "$ref exists"
    content_size="$(wc -c < "$AM_ROOT/$ref")"
    if [ "$content_size" -gt 50 ]; then
      pass "$ref has content ($content_size bytes)"
    else
      fail "$ref is too small ($content_size bytes)"
    fi
  else
    fail "$ref absent"
  fi
done

###############################################################################
# Probe 5: Canonical skill bodies do not use ${CLAUDE_PLUGIN_ROOT}
###############################################################################
printf '\nProbe 5: No CLAUDE_PLUGIN_ROOT in canonical skill bodies\n'

for skill_md in \
  "$AM_ROOT/skills/grill-me/SKILL.md" \
  "$AM_ROOT/skills/council/SKILL.md" \
  "$AM_ROOT/skills/eli10/SKILL.md" \
  "$AM_ROOT/skills/fool/SKILL.md"
do
  skill_name="$(basename "$(dirname "$skill_md")")"
  if grep -q 'CLAUDE_PLUGIN_ROOT' "$skill_md" 2>/dev/null; then
    fail "$skill_name still references \${CLAUDE_PLUGIN_ROOT}"
  else
    pass "$skill_name does not reference \${CLAUDE_PLUGIN_ROOT}"
  fi
done

###############################################################################
# Probe 6: Negative control — absent reference is not read from developer checkout
###############################################################################
printf '\nProbe 6: Negative control (absent reference)\n'

# Create a copy of ai-mentor with the recommendation-policy removed.
# Install from the copy and verify the reference is genuinely absent —
# the test does not accidentally read the developer's canonical checkout.
COPY_ROOT="$TEST_ROOT/ai-mentor-copy"
cp -R "$AM_ROOT" "$COPY_ROOT"
rm -f "$COPY_ROOT/references/recommendation-policy.md"

# Install from the copy
run_devin plugins remove -y ai-mentor >/dev/null 2>&1
run_devin plugins install --local -y "$COPY_ROOT" >/dev/null 2>&1

# The meaningful assertion is about the INSTALLED source, not the fixture
# mutation: `plugins info` must report the copy as the plugin source (so any
# consumer reads the mutated tree), and the policy must be absent under that
# reported source — not merely under the path this test happened to rm.
installed_source="$(run_devin plugins info ai-mentor 2>/dev/null \
  | awk '/source:/ {print $NF; exit}')"

if [ "$installed_source" = "$COPY_ROOT" ]; then
  pass "plugins info reports the mutated copy as installed source"
else
  fail "plugins info source is '$installed_source', expected '$COPY_ROOT'"
fi

if [ -n "$installed_source" ] \
  && [ ! -f "$installed_source/references/recommendation-policy.md" ] \
  && [ -f "$installed_source/skills/grill-me/SKILL.md" ]; then
  pass "policy absent and skill present at the reported installed source"
else
  fail "reported source '$installed_source' does not match the mutated copy"
fi

# Verify the original canonical checkout still has it (we didn't delete it)
if [ -f "$AM_ROOT/references/recommendation-policy.md" ]; then
  pass "original canonical checkout retains the reference"
else
  fail "original canonical checkout lost the reference (test mutated canonical!)"
fi

# Reinstall from canonical for remaining probes
run_devin plugins remove -y ai-mentor >/dev/null 2>&1
run_devin plugins install --local -y "$AM_ROOT" >/dev/null 2>&1

###############################################################################
# Probe 7: plugins info shows correct skill inventory
###############################################################################
printf '\nProbe 7: plugins info skill inventory\n'

info="$(run_devin plugins info ai-mentor 2>&1)"
for expected_skill in \
  "/ai-mentor:grill-me" \
  "/ai-mentor:council" \
  "/ai-mentor:eli10" \
  "/ai-mentor:fool"
do
  if printf '%s' "$info" | grep -q "$expected_skill"; then
    pass "plugins info shows $expected_skill"
  else
    fail "plugins info missing $expected_skill"
  fi
done

# Cleanup
run_devin plugins remove -y ai-mentor >/dev/null 2>&1
