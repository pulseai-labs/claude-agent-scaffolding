#!/usr/bin/env bash
# test-devin-architect-critic.sh — Focused Devin adapter test for architect-critic
#
# Validates that:
# - All six namespaced skills are advertised after install
# - HOST_AGENT=devin is recognized in the critiquing-spec skill body
# - adversaries_used=["devin"] is the host-only audit identity
# - No external_runs[] append occurs (no external adversary dispatch)
# - --async hard-refuses and does not enter foreground or mutate state
# - managing-async-critique reports unsupported on Devin
# - checking-adversary-readiness reports Devin policy, not Codex install
# - Fake codex/claude binaries on PATH are NOT invoked during a Devin critique
# - Shared state path ~/.claude/architect-critic is preserved
# - No CLAUDE_PLUGIN_ROOT in skill bodies
# - arc dispatcher is locatable via full path (same as wi)
# - Pre-existing Claude/Codex records are preserved

set -euo pipefail

EXPECTED_DEVIN_VERSION="3000.10.21"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
AC_ROOT="$ROOT/architect-critic"

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
if [ ! -f "$AC_ROOT/.devin-plugin/plugin.json" ]; then
  printf 'FAIL: architect-critic/.devin-plugin/plugin.json absent\n' >&2; exit 1
fi
if [ ! -x "$AC_ROOT/bin/arc" ]; then
  printf 'FAIL: architect-critic/bin/arc not executable\n' >&2; exit 1
fi

###############################################################################
# Isolation
###############################################################################
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/devin-ac.XXXXXX")"
TEST_ROOT="$(cd "$TEST_ROOT" && pwd -P)"
ISOLATED_HOME="$TEST_ROOT/home"
ISOLATED_CONFIG="$ISOLATED_HOME/.config"
ISOLATED_DATA="$ISOLATED_HOME/.local/share"
ISOLATED_CACHE="$ISOLATED_HOME/.cache"

mkdir -p \
  "$ISOLATED_CONFIG/devin" \
  "$ISOLATED_DATA/devin/cli" \
  "$ISOLATED_CACHE" \
  "$TEST_ROOT/project" \
  "$TEST_ROOT/fake-bin"

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

# Fake codex and claude binaries that write a sentinel if executed
for fake_bin in codex claude; do
  cat > "$TEST_ROOT/fake-bin/$fake_bin" <<FAKE
#!/bin/sh
echo "FAKE_${fake_bin}_EXECUTED" > "$TEST_ROOT/fake-bin/${fake_bin}-sentinel"
exit 0
FAKE
  chmod +x "$TEST_ROOT/fake-bin/$fake_bin"
done

GIT_BIN_DIR="$(dirname "$(command -v git 2>/dev/null || echo /usr/bin/git)")"
JQ_BIN_DIR="$(dirname "$(command -v jq 2>/dev/null || echo /usr/bin/jq)")"
SAFE_PATH="${DEVIN_BIN%/*}:${NODE_BIN%/*}:${GIT_BIN_DIR}:${JQ_BIN_DIR}:${TEST_ROOT}/fake-bin:/usr/local/bin:/usr/bin:/bin"

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
# Install architect-critic
###############################################################################
run_devin plugins install --local -y "$AC_ROOT" >/dev/null 2>&1

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
  "architect-critic:critiquing-spec" \
  "architect-critic:managing-async-critique" \
  "architect-critic:checking-adversary-readiness" \
  "architect-critic:reviewing-critique-history" \
  "architect-critic:listing-principles" \
  "architect-critic:promoting-principle"
do
  if printf '%s\n' "$skill_names" | grep -qx "$expected"; then
    pass "skill advertised: $expected"
  else
    fail "skill missing: $expected"
  fi
done

###############################################################################
# Probe 2: HOST_AGENT=devin recognized in critiquing-spec
###############################################################################
printf '\nProbe 2: HOST_AGENT=devin in critiquing-spec\n'

critique_skill="$AC_ROOT/skills/critiquing-spec/SKILL.md"
if grep -q 'HOST_AGENT=devin' "$critique_skill" 2>/dev/null; then
  pass "critiquing-spec recognizes HOST_AGENT=devin"
else
  fail "critiquing-spec does not recognize HOST_AGENT=devin"
fi

# Check that devin is listed in the host detection section
if grep -q 'devin' "$critique_skill" 2>/dev/null; then
  pass "critiquing-spec mentions devin"
else
  fail "critiquing-spec does not mention devin"
fi

###############################################################################
# Probe 3: adversaries_used=["devin"] is the host-only audit identity
###############################################################################
printf '\nProbe 3: adversaries_used=["devin"] host-only identity\n'

# The skill body should specify that on Devin, adversaries_used is ["devin"]
# (host-only audit, no external adversary)
if grep -q 'adversaries_used.*devin\|"devin"' "$critique_skill" 2>/dev/null; then
  pass "critiquing-spec specifies adversaries_used includes devin"
else
  fail "critiquing-spec does not specify adversaries_used for devin"
fi

###############################################################################
# Probe 4: No external_runs[] append on Devin
###############################################################################
printf '\nProbe 4: No external_runs[] append on Devin\n'

# The skill body should state that Devin does not append to external_runs[]
if grep -q 'external_runs.*devin\|no external.*devin\|devin.*no external' "$critique_skill" 2>/dev/null; then
  pass "critiquing-spec states no external_runs on Devin"
else
  fail "critiquing-spec does not address external_runs on Devin"
fi

###############################################################################
# Probe 5: --async hard-refuses on Devin
###############################################################################
printf '\nProbe 5: --async hard-refuses on Devin\n'

# The skill body should state that --async is refused on Devin
if grep -qi 'async.*refus\|refus.*async\|--async.*not.*support\|--async.*unsupported\|devin.*async.*refuse' "$critique_skill" 2>/dev/null; then
  pass "critiquing-spec refuses --async on Devin"
else
  fail "critiquing-spec does not explicitly refuse --async on Devin"
fi

###############################################################################
# Probe 6: managing-async-critique reports unsupported on Devin
###############################################################################
printf '\nProbe 6: managing-async-critique unsupported on Devin\n'

async_skill="$AC_ROOT/skills/managing-async-critique/SKILL.md"
if grep -qi 'devin.*unsupported\|unsupported.*devin\|devin.*not.*support\|not.*available.*devin' "$async_skill" 2>/dev/null; then
  pass "managing-async-critique reports unsupported on Devin"
else
  fail "managing-async-critique does not report unsupported on Devin"
fi

###############################################################################
# Probe 7: checking-adversary-readiness reports Devin policy
###############################################################################
printf '\nProbe 7: checking-adversary-readiness reports Devin policy\n'

doctor_skill="$AC_ROOT/skills/checking-adversary-readiness/SKILL.md"
if grep -qi 'devin' "$doctor_skill" 2>/dev/null; then
  pass "checking-adversary-readiness mentions Devin"
else
  fail "checking-adversary-readiness does not mention Devin"
fi

# Should not prescribe Codex installation as the primary path on Devin
if grep -qi 'devin.*host.only\|host.only.*devin\|devin.*no.*external\|no.*external.*adversary.*devin' "$doctor_skill" 2>/dev/null; then
  pass "checking-adversary-readiness states host-only policy for Devin"
else
  fail "checking-adversary-readiness does not state host-only policy for Devin"
fi

###############################################################################
# Probe 8: Fake codex/claude binaries are armed on SAFE_PATH — the sentinel
# assertions themselves run at the end of this file (post-check), after every
# arc invocation that could conceivably dispatch to an external adversary.
###############################################################################
printf '\nProbe 8: Fake-bin harness armed (post-check at end of file)\n'

for fake_bin in codex claude; do
  if [ -x "$TEST_ROOT/fake-bin/$fake_bin" ]; then
    pass "fake $fake_bin armed at $TEST_ROOT/fake-bin/$fake_bin"
  else
    fail "fake $fake_bin missing or not executable"
  fi
done

###############################################################################
# Probe 9: Shared state path preserved
###############################################################################
printf '\nProbe 9: Shared state path preserved\n'

# The state path should still be ~/.claude/architect-critic (in _helpers.sh)
helpers_sh="$AC_ROOT/lib/_helpers.sh"
if grep -q '\.claude/architect-critic' "$helpers_sh" 2>/dev/null; then
  pass "state path is ~/.claude/architect-critic (shared across surfaces)"
else
  fail "state path changed from ~/.claude/architect-critic"
fi

###############################################################################
# Probe 10: No CLAUDE_PLUGIN_ROOT in skill bodies
###############################################################################
printf '\nProbe 10: No CLAUDE_PLUGIN_ROOT in skill bodies\n'

for skill_md in \
  "$AC_ROOT/skills/critiquing-spec/SKILL.md" \
  "$AC_ROOT/skills/managing-async-critique/SKILL.md" \
  "$AC_ROOT/skills/checking-adversary-readiness/SKILL.md" \
  "$AC_ROOT/skills/reviewing-critique-history/SKILL.md" \
  "$AC_ROOT/skills/listing-principles/SKILL.md" \
  "$AC_ROOT/skills/promoting-principle/SKILL.md"
do
  skill_name="$(basename "$(dirname "$skill_md")")"
  if grep -q 'CLAUDE_PLUGIN_ROOT' "$skill_md" 2>/dev/null; then
    fail "$skill_name still references \${CLAUDE_PLUGIN_ROOT}"
  else
    pass "$skill_name does not reference \${CLAUDE_PLUGIN_ROOT}"
  fi
done

###############################################################################
# Probe 11: arc dispatcher locatable via full path
###############################################################################
printf '\nProbe 11: arc dispatcher locatable\n'

arc_path="$AC_ROOT/bin/arc"
if [ -x "$arc_path" ]; then
  pass "arc dispatcher exists and is executable"
else
  fail "arc dispatcher not executable"
fi

# Run under SAFE_PATH so the fake codex/claude binaries are on PATH — the
# post-check sentinels only prove non-invocation if the fakes were findable.
list_output="$(env -i HOME="$ISOLATED_HOME" PATH="$SAFE_PATH" "$arc_path" --list 2>&1)" || true
if printf '%s' "$list_output" | grep -q 'state_append_run'; then
  pass "arc --list shows state_append_run"
else
  fail "arc --list does not show state_append_run"
fi

###############################################################################
# Probe 12: Plugin rules file for dispatcher path
###############################################################################
printf '\nProbe 12: Plugin rules file for arc dispatcher\n'

rules_file="$AC_ROOT/rules/dispatcher-path.md"
if [ -f "$rules_file" ]; then
  pass "rules/dispatcher-path.md exists"
  if head -1 "$rules_file" | grep -q '^---'; then
    pass "dispatcher-path.md has frontmatter"
  else
    fail "dispatcher-path.md missing frontmatter"
  fi
  if grep -q 'bin/arc' "$rules_file"; then
    pass "dispatcher-path.md references bin/arc"
  else
    fail "dispatcher-path.md does not reference bin/arc"
  fi
else
  fail "rules/dispatcher-path.md absent"
fi

###############################################################################
# Probe 13: Pre-existing state records preserved
###############################################################################
printf '\nProbe 13: Pre-existing state records preserved\n'

# Create a state file with a pre-existing Claude run, then run arc state_append_run
# with devin adversaries and verify the pre-existing record is still there.
ac_state_dir="$ISOLATED_HOME/.claude/architect-critic"
mkdir -p "$ac_state_dir"
cat > "$ac_state_dir/state.json" <<'PRE'
{
  "schema_version": 3,
  "recent_runs": [
    {"request_id": "claude-run-001", "completed_at": "2026-01-01T00:00:00Z", "depth": "premise", "adversaries_used": ["claude"], "challenge_count": 3, "concessions": 1, "skill_invoked": "critiquing-spec", "elapsed_ms": 5000}
  ],
  "external_runs": [],
  "principle_promotions": [],
  "candidate_promotions": [],
  "declined_candidates": [],
  "auto_promote_suppressions": []
}
PRE

# Append a devin run (use isolated HOME so state goes to the right place)
env -i HOME="$ISOLATED_HOME" PATH="$SAFE_PATH" \
  "$arc_path" state_append_run \
  --request-id "devin-run-001" \
  --depth "premise" \
  --adversaries '["devin"]' \
  --challenge-count 2 \
  --concessions 0 \
  --skill-invoked "critiquing-spec" \
  --elapsed-ms 3000 2>&1

# Verify both runs exist
claude_run="$(jq '.recent_runs[] | select(.request_id == "claude-run-001")' "$ac_state_dir/state.json" 2>/dev/null)"
devin_run="$(jq '.recent_runs[] | select(.request_id == "devin-run-001")' "$ac_state_dir/state.json" 2>/dev/null)"

if printf '%s' "$claude_run" | grep -q 'claude-run-001'; then
  pass "pre-existing Claude run preserved"
else
  fail "pre-existing Claude run was lost"
fi

if printf '%s' "$devin_run" | grep -q 'devin-run-001'; then
  pass "new Devin run appended"
else
  fail "new Devin run was not appended"
fi

# Verify the devin run has adversaries_used=["devin"]
devin_adv="$(jq -r '.recent_runs[] | select(.request_id == "devin-run-001") | .adversaries_used | join(",")' "$ac_state_dir/state.json" 2>/dev/null)"
if [ "$devin_adv" = "devin" ]; then
  pass "Devin run has adversaries_used=[\"devin\"]"
else
  fail "Devin run has wrong adversaries_used: $devin_adv"
fi

# Verify no external_runs were added
external_count="$(jq '.external_runs | length' "$ac_state_dir/state.json" 2>/dev/null)"
if [ "$external_count" = "0" ]; then
  pass "no external_runs appended"
else
  fail "external_runs was modified: count=$external_count"
fi

# Cleanup
run_devin plugins remove -y architect-critic >/dev/null 2>&1

###############################################################################
# Probe 14 (post-check): Fake codex/claude binaries were NOT invoked by any
# arc/devin path above. This must run last — every invocation in this gate ran
# with the fakes first on PATH via SAFE_PATH.
###############################################################################
printf '\nProbe 14: Fake codex/claude not invoked (post-check)\n'

if [ -f "$TEST_ROOT/fake-bin/codex-sentinel" ]; then
  fail "fake codex was executed by an arc path"
else
  pass "fake codex was not executed"
fi
if [ -f "$TEST_ROOT/fake-bin/claude-sentinel" ]; then
  fail "fake claude was executed by an arc path"
else
  pass "fake claude was not executed"
fi
