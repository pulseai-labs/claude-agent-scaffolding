#!/usr/bin/env bash
# test-devin-ossify.sh — Focused Devin adapter test for ossify
#
# Validates that:
# - All six namespaced skills are advertised after install
# - The work-item-worker subagent skill is advertised with subagent: true
# - The worker skill delegates to the canonical work-item contract (no copy)
# - The oss dispatcher is locatable via full path
# - No CLAUDE_PLUGIN_ROOT in canonical skill bodies or agent body
# - Claude-only utilities (handoff, handoff-resume, work-pr) are absent from
#   the Devin compatibility inventory
# - The no-commit boundary is enforced (git commit/push/pull/fetch forbidden)
# - Representative oss dispositions (0, 1, 2) preserve stdout/stderr/rc
# - Plugin rules file for oss dispatcher exists

set -euo pipefail

EXPECTED_DEVIN_VERSION="3000.5.20"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
OS_ROOT="$ROOT/ossify"

DEVIN_BIN="$(command -v devin || true)"
NODE_BIN="$(command -v node || true)"

if [ -z "$DEVIN_BIN" ]; then
  printf 'FAIL: devin is required\n' >&2; exit 1
fi
if [ -z "$NODE_BIN" ]; then
  printf 'FAIL: node is required\n' >&2; exit 1
fi

DEVIN_VERSION="$("$DEVIN_BIN" version 2>/dev/null | head -1 || true)"
if printf '%s' "$DEVIN_VERSION" | grep -qv "$EXPECTED_DEVIN_VERSION"; then
  printf 'FAIL: expected devin %s, got "%s"\n' "$EXPECTED_DEVIN_VERSION" "$DEVIN_VERSION" >&2
  exit 1
fi

REAL_CREDENTIALS="$HOME/.local/share/devin/credentials.toml"
if [ ! -f "$REAL_CREDENTIALS" ]; then
  printf 'FAIL: %s not found\n' "$REAL_CREDENTIALS" >&2; exit 1
fi

# Fixture contract
if [ ! -f "$OS_ROOT/.devin-plugin/plugin.json" ]; then
  printf 'FAIL: ossify/.devin-plugin/plugin.json absent\n' >&2; exit 1
fi
if [ ! -x "$OS_ROOT/bin/oss" ]; then
  printf 'FAIL: ossify/bin/oss not executable\n' >&2; exit 1
fi

###############################################################################
# Isolation
###############################################################################
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/devin-os.XXXXXX")"
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

SAFE_PATH="${DEVIN_BIN%/*}:${NODE_BIN%/*}:/usr/local/bin:/usr/bin:/bin"

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); printf '  ok  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  not ok  %s\n' "$1"; }

cleanup() {
  rm -rf "$TEST_ROOT"
  printf '\nPassed: %d  Failed: %d\n' "$PASS" "$FAIL"
  if [ "$FAIL" -gt 0 ]; then exit 1; fi
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
# Install ossify
###############################################################################
run_devin plugins install --local -y "$OS_ROOT" >/dev/null 2>&1

###############################################################################
# Probe 1: All six namespaced skills are advertised
###############################################################################
printf 'Probe 1: Six namespaced skills advertised\n'

skills_json="$(run_devin skills list --json 2>/dev/null)"
skill_names="$(printf '%s' "$skills_json" | "$NODE_BIN" -e '
  const data = JSON.parse(require("fs").readFileSync(0,"utf8"));
  for (const s of data) console.log(s.name);
')"

for expected in \
  "ossify:start" \
  "ossify:plan-release" \
  "ossify:plan-spine" \
  "ossify:work-item" \
  "ossify:close" \
  "ossify:doctor"
do
  if printf '%s\n' "$skill_names" | grep -qx "$expected"; then
    pass "skill advertised: $expected"
  else
    fail "skill missing: $expected"
  fi
done

###############################################################################
# Probe 2: work-item-worker subagent skill is advertised
###############################################################################
printf '\nProbe 2: work-item-worker subagent skill\n'

# The .devin/skills/work-item-worker/SKILL.md should be advertised
worker_skill="$OS_ROOT/.devin/skills/work-item-worker/SKILL.md"
if [ -f "$worker_skill" ]; then
  pass ".devin/skills/work-item-worker/SKILL.md exists"
else
  fail ".devin/skills/work-item-worker/SKILL.md absent"
fi

# Check it has subagent: true in frontmatter
if head -10 "$worker_skill" 2>/dev/null | grep -q 'subagent.*true'; then
  pass "work-item-worker has subagent: true"
else
  fail "work-item-worker missing subagent: true"
fi

# Check it has allowed-tools including exec
if grep -q 'allowed-tools' "$worker_skill" 2>/dev/null; then
  pass "work-item-worker has allowed-tools"
  if grep -q 'exec' "$worker_skill" 2>/dev/null; then
    pass "work-item-worker allows exec"
  else
    fail "work-item-worker does not allow exec"
  fi
else
  fail "work-item-worker missing allowed-tools"
fi

###############################################################################
# Probe 3: Worker skill delegates to canonical contract (no copy)
###############################################################################
printf '\nProbe 3: Worker delegates to canonical contract\n'

# The worker skill should reference the canonical work-item/SKILL.md, not
# restate its body. Check that it points to the canonical skill.
if grep -q 'skills/work-item/SKILL.md' "$worker_skill" 2>/dev/null; then
  pass "worker skill references canonical work-item/SKILL.md"
else
  fail "worker skill does not reference canonical work-item/SKILL.md"
fi

# Check it does NOT copy the full contract (should be short, < 50 lines)
line_count="$(wc -l < "$worker_skill" 2>/dev/null || echo 0)"
if [ "$line_count" -lt 50 ]; then
  pass "worker skill is short ($line_count lines, delegates rather than copies)"
else
  fail "worker skill is too long ($line_count lines — may be copying contract)"
fi

# Check it does NOT contain the full return contract JSON
if grep -q '"mode": "complete"' "$worker_skill" 2>/dev/null; then
  fail "worker skill copies the return contract (should delegate)"
else
  pass "worker skill does not copy the return contract"
fi

###############################################################################
# Probe 4: oss dispatcher locatable via full path
###############################################################################
printf '\nProbe 4: oss dispatcher locatable\n'

oss_path="$OS_ROOT/bin/oss"
if [ -x "$oss_path" ]; then
  pass "oss dispatcher exists and is executable"
else
  fail "oss dispatcher not executable"
fi

# Verify oss help works
help_output="$("$oss_path" help 2>&1)" || true
if printf '%s' "$help_output" | grep -q 'ossify dispatcher'; then
  pass "oss help works"
else
  fail "oss help does not work"
fi

###############################################################################
# Probe 5: No CLAUDE_PLUGIN_ROOT in canonical skill bodies or agent body
###############################################################################
printf '\nProbe 5: No CLAUDE_PLUGIN_ROOT in skill/agent bodies\n'

for f in \
  "$OS_ROOT/skills/work-item/SKILL.md" \
  "$OS_ROOT/skills/start/SKILL.md" \
  "$OS_ROOT/skills/plan-release/SKILL.md" \
  "$OS_ROOT/skills/plan-spine/SKILL.md" \
  "$OS_ROOT/skills/close/SKILL.md" \
  "$OS_ROOT/skills/doctor/SKILL.md" \
  "$OS_ROOT/agents/implementer-agent.md"
do
  rel="${f#$OS_ROOT/}"
  if grep -q 'CLAUDE_PLUGIN_ROOT' "$f" 2>/dev/null; then
    fail "$rel still references \${CLAUDE_PLUGIN_ROOT}"
  else
    pass "$rel does not reference \${CLAUDE_PLUGIN_ROOT}"
  fi
done

# budget-check.md may mention CLAUDE_PLUGIN_ROOT in a diagnostic context
# (documenting the Claude Code env var bug), not as a path reference.
if grep -q 'CLAUDE_PLUGIN_ROOT' "$OS_ROOT/skills/doctor/references/budget-check.md" 2>/dev/null; then
  # Verify it's diagnostic (mentions "not exported" or similar), not a path ref
  if grep -q 'not exported\|not.*survive\|empty string' "$OS_ROOT/skills/doctor/references/budget-check.md" 2>/dev/null; then
    pass "budget-check.md mentions CLAUDE_PLUGIN_ROOT diagnostically (not as path ref)"
  else
    fail "budget-check.md uses CLAUDE_PLUGIN_ROOT as a path reference"
  fi
else
  pass "budget-check.md does not reference \${CLAUDE_PLUGIN_ROOT}"
fi

###############################################################################
# Probe 6: Claude-only utilities absent from Devin compatibility inventory
###############################################################################
printf '\nProbe 6: Claude-only utilities absent\n'

# handoff, handoff-resume, work-pr are Claude Code slash commands.
# They should not appear as Devin skills or in the .devin/ adapter.
for utility in handoff handoff-resume work-pr; do
  # Check they are not in .devin/skills/
  if find "$OS_ROOT/.devin" -name "*${utility}*" 2>/dev/null | grep -q .; then
    fail "$utility found in .devin/ (should be Claude-only)"
  else
    pass "$utility absent from .devin/"
  fi
done

###############################################################################
# Probe 7: No-commit boundary enforced in worker skill
###############################################################################
printf '\nProbe 7: No-commit boundary in worker skill\n'

# The worker skill (and canonical work-item) must forbid git commit/push/pull/fetch
for forbidden in 'git commit' 'git push' 'git pull' 'git fetch'; do
  # Check the canonical work-item SKILL.md mentions it as forbidden
  if grep -q "\`${forbidden}\`" "$OS_ROOT/skills/work-item/SKILL.md" 2>/dev/null; then
    pass "work-item SKILL.md mentions ${forbidden}"
  else
    fail "work-item SKILL.md does not mention ${forbidden}"
  fi
done

# Check the agent body too
for forbidden in 'git commit' 'git push' 'git pull' 'git fetch'; do
  if grep -q "\`${forbidden}\`" "$OS_ROOT/agents/implementer-agent.md" 2>/dev/null; then
    pass "implementer-agent.md mentions ${forbidden}"
  else
    fail "implementer-agent.md does not mention ${forbidden}"
  fi
done

###############################################################################
# Probe 8: Representative oss dispositions preserve stdout/stderr/rc
###############################################################################
printf '\nProbe 8: oss dispositions preserve stdout/stderr/rc\n'

# Test oss help (rc 0)
help_out="$("$oss_path" help 2>/dev/null)" && help_rc=0 || help_rc=$?
if [ "$help_rc" = "0" ] && printf '%s' "$help_out" | grep -q 'ossify dispatcher'; then
  pass "oss help: rc=0, stdout has dispatcher string"
else
  fail "oss help: rc=$help_rc, unexpected output"
fi

# Test oss unknown command (rc 2)
unknown_out="$("$oss_path" nonexistent_cmd 2>&1)" && unknown_rc=0 || unknown_rc=$?
if [ "$unknown_rc" = "2" ]; then
  pass "oss unknown: rc=2 (usage error)"
else
  fail "oss unknown: rc=$unknown_rc (expected 2)"
fi

# Test oss with no args (rc 0, shows help)
noargs_out="$("$oss_path" 2>/dev/null)" && noargs_rc=0 || noargs_rc=$?
if [ "$noargs_rc" = "0" ] && printf '%s' "$noargs_out" | grep -q 'ossify dispatcher'; then
  pass "oss no-args: rc=0, shows help"
else
  fail "oss no-args: rc=$noargs_rc, unexpected"
fi

###############################################################################
# Probe 9: Plugin rules file for oss dispatcher
###############################################################################
printf '\nProbe 9: Plugin rules file for oss dispatcher\n'

rules_file="$OS_ROOT/rules/dispatcher-path.md"
if [ -f "$rules_file" ]; then
  pass "rules/dispatcher-path.md exists"
  if head -1 "$rules_file" | grep -q '^---'; then
    pass "dispatcher-path.md has frontmatter"
  else
    fail "dispatcher-path.md missing frontmatter"
  fi
  if grep -q 'bin/oss' "$rules_file"; then
    pass "dispatcher-path.md references bin/oss"
  else
    fail "dispatcher-path.md does not reference bin/oss"
  fi
else
  fail "rules/dispatcher-path.md absent"
fi

###############################################################################
# Probe 10: Worker skill mentions no-commit and no-nesting
###############################################################################
printf '\nProbe 10: Worker skill no-commit and no-nesting\n'

if grep -qi 'no.commit\|never commit\|NEVER.*commit' "$worker_skill" 2>/dev/null; then
  pass "worker skill mentions no-commit"
else
  fail "worker skill does not mention no-commit"
fi

if grep -qi 'no.nest\|no.subagent\|never.*Task\|NEVER.*Task' "$worker_skill" 2>/dev/null; then
  pass "worker skill mentions no-nesting"
else
  fail "worker skill does not mention no-nesting"
fi

###############################################################################
# Probe 11: Worker skill has correct return envelope reference
###############################################################################
printf '\nProbe 11: Worker return envelope reference\n'

# The worker should reference the canonical return shapes without restating them
if grep -q 'complete.*gaps-surfaced\|gaps-surfaced.*complete' "$worker_skill" 2>/dev/null; then
  pass "worker skill references return modes"
else
  fail "worker skill does not reference return modes"
fi

# Cleanup
run_devin plugins remove -y ossify >/dev/null 2>&1
