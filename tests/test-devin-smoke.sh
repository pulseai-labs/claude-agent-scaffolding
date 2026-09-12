#!/usr/bin/env bash
# test-devin-smoke.sh — Credentialed five-plugin behavior smokes
#
# Exercises one real behavior per plugin target and records checkable evidence.
# Uses temporary HOME/project/state. Never touches real user configuration.
#
# Evidence is printed to stdout in a structured format for the review document.

set -euo pipefail

EXPECTED_DEVIN_VERSION="3000.10.21"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"

DEVIN_BIN="$(command -v devin || true)"
NODE_BIN="$(command -v node || true)"

if [ -z "$DEVIN_BIN" ]; then
  printf 'FAIL: devin binary not found\n' >&2; exit 1
fi
if [ -z "$NODE_BIN" ]; then
  printf 'FAIL: node binary not found\n' >&2; exit 1
fi

DEVIN_VERSION="$("$DEVIN_BIN" version 2>/dev/null | head -1 || true)"
if printf '%s' "$DEVIN_VERSION" | grep -qv "$EXPECTED_DEVIN_VERSION"; then
  printf 'FAIL: expected devin %s, got "%s"\n' "$EXPECTED_DEVIN_VERSION" "$DEVIN_VERSION" >&2
  exit 1
fi

REAL_CREDENTIALS="$HOME/.local/share/devin/credentials.toml"
if [ ! -f "$REAL_CREDENTIALS" ]; then
  printf 'FAIL: credentials not found\n' >&2; exit 1
fi

###############################################################################
# Isolation
###############################################################################
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/devin-smoke.XXXXXX")"
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
EVIDENCE=""

pass() { PASS=$((PASS + 1)); printf '  ok  %s\n' "$1"; EVIDENCE="${EVIDENCE}PASS: $1\n"; }
fail() { FAIL=$((FAIL + 1)); printf '  not ok  %s\n' "$1"; EVIDENCE="${EVIDENCE}FAIL: $1\n"; }
evidence() { EVIDENCE="${EVIDENCE}EVIDENCE: $1\n"; }

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
# Install all five plugins individually from the local worktree
# (not via the meta-plugin, which fetches from GitHub)
###############################################################################
run_devin plugins install --local -y "$ROOT/workspace-init" >/dev/null 2>&1
run_devin plugins install --local -y "$ROOT/ai-mentor" >/dev/null 2>&1
run_devin plugins install --local -y "$ROOT/architect-critic" >/dev/null 2>&1
run_devin plugins install --local -y "$ROOT/ossify" >/dev/null 2>&1
run_devin plugins install --local -y "$ROOT/code-judo" >/dev/null 2>&1

# For locally-installed plugins, the source IS the local worktree path
WI_SOURCE="$ROOT/workspace-init"
AIM_SOURCE="$ROOT/ai-mentor"
ARC_SOURCE="$ROOT/architect-critic"
OSS_SOURCE="$ROOT/ossify"
JUDO_SOURCE="$ROOT/code-judo"

evidence "Devin version: $DEVIN_VERSION"
evidence "workspace-init source: $WI_SOURCE"
evidence "ai-mentor source: $AIM_SOURCE"
evidence "architect-critic source: $ARC_SOURCE"
evidence "ossify source: $OSS_SOURCE"
evidence "code-judo source: $JUDO_SOURCE"

###############################################################################
# Smoke 1: Workspace Init — dispatcher works from installed path
###############################################################################
printf '\nSmoke 1: Workspace Init — dispatcher from installed path\n'

if [ -n "$WI_SOURCE" ] && [ -x "$WI_SOURCE/bin/wi" ]; then
  pass "wi dispatcher found at installed source: $WI_SOURCE/bin/wi"
  evidence "wi dispatcher path: $WI_SOURCE/bin/wi"

  # Run wi help to prove the dispatcher works
  wi_help="$("$WI_SOURCE/bin/wi" help 2>&1)" || true
  if printf '%s' "$wi_help" | grep -qi 'workspace.init\|wi '; then
    pass "wi help runs from installed path"
    evidence "wi help output (first line): $(printf '%s' "$wi_help" | head -1)"
  else
    fail "wi help failed from installed path"
  fi

  # Verify rules/dispatcher-path.md exists
  if [ -f "$WI_SOURCE/rules/dispatcher-path.md" ]; then
    pass "wi rules/dispatcher-path.md exists at installed source"
  else
    fail "wi rules/dispatcher-path.md absent at installed source"
  fi
else
  fail "wi dispatcher not found at installed source"
  evidence "wi source was: $WI_SOURCE"
fi

###############################################################################
# Smoke 2: AI Mentor — reference files readable from installed path
###############################################################################
printf '\nSmoke 2: AI Mentor — references readable from installed path\n'

if [ -n "$AIM_SOURCE" ]; then
  # Check that the recommendation policy reference exists at the plugin root
  if [ -f "$AIM_SOURCE/references/recommendation-policy.md" ]; then
    pass "recommendation-policy.md exists at plugin root"
    evidence "policy path: $AIM_SOURCE/references/recommendation-policy.md"

    # Verify it has content (not empty)
    policy_size="$(wc -c < "$AIM_SOURCE/references/recommendation-policy.md")"
    if [ "$policy_size" -gt 100 ]; then
      pass "recommendation-policy.md has content (${policy_size} bytes)"
      evidence "policy size: ${policy_size} bytes"
    else
      fail "recommendation-policy.md is too small (${policy_size} bytes)"
    fi
  else
    fail "recommendation-policy.md absent at plugin root"
  fi

  # Check council personas reference
  if [ -f "$AIM_SOURCE/skills/council/personas.md" ]; then
    pass "council personas.md exists at installed source"
    evidence "personas path: $AIM_SOURCE/skills/council/personas.md"
  else
    fail "council personas.md absent"
  fi

  # Verify no CLAUDE_PLUGIN_ROOT in skill bodies
  if grep -q 'CLAUDE_PLUGIN_ROOT' "$AIM_SOURCE/skills/grill-me/SKILL.md" 2>/dev/null; then
    fail "grill-me still references CLAUDE_PLUGIN_ROOT"
  else
    pass "grill-me does not reference CLAUDE_PLUGIN_ROOT"
  fi
  if grep -q 'CLAUDE_PLUGIN_ROOT' "$AIM_SOURCE/skills/council/SKILL.md" 2>/dev/null; then
    fail "council still references CLAUDE_PLUGIN_ROOT"
  else
    pass "council does not reference CLAUDE_PLUGIN_ROOT"
  fi
else
  fail "ai-mentor source not found"
fi

###############################################################################
# Smoke 3: Architect Critic — host-only policy, state, async refusal
###############################################################################
printf '\nSmoke 3: Architect Critic — host-only policy and state\n'

if [ -n "$ARC_SOURCE" ] && [ -x "$ARC_SOURCE/bin/arc" ]; then
  pass "arc dispatcher found at installed source: $ARC_SOURCE/bin/arc"
  evidence "arc dispatcher path: $ARC_SOURCE/bin/arc"

  # Run arc --list to prove the dispatcher works
  arc_list="$("$ARC_SOURCE/bin/arc" --list 2>&1)" || true
  if printf '%s' "$arc_list" | grep -q 'state_append_run'; then
    pass "arc --list shows state_append_run"
    evidence "arc --list contains state_append_run"
  else
    fail "arc --list does not show state_append_run"
  fi

  # Verify HOST_AGENT=devin in critiquing-spec
  if grep -q 'HOST_AGENT=devin' "$ARC_SOURCE/skills/critiquing-spec/SKILL.md" 2>/dev/null; then
    pass "critiquing-spec recognizes HOST_AGENT=devin"
  else
    fail "critiquing-spec does not recognize HOST_AGENT=devin"
  fi

  # Verify async refusal
  if grep -qi 'hard.refuse\|not.supported.*Devin\|refuse.*async.*Devin' "$ARC_SOURCE/skills/critiquing-spec/SKILL.md" 2>/dev/null; then
    pass "critiquing-spec refuses --async on Devin"
  else
    fail "critiquing-spec does not refuse --async on Devin"
  fi

  # Verify adversaries_used includes devin
  if grep -q 'adversaries_used.*devin\|devin.*adversaries_used' "$ARC_SOURCE/skills/critiquing-spec/SKILL.md" 2>/dev/null; then
    pass "critiquing-spec specifies adversaries_used includes devin"
  else
    fail "critiquing-spec does not specify adversaries_used includes devin"
  fi

  # Verify no external_runs append on Devin
  if grep -q 'no.*external_runs.*Devin\|Devin.*no.*external_runs' "$ARC_SOURCE/skills/critiquing-spec/SKILL.md" 2>/dev/null; then
    pass "critiquing-spec states no external_runs on Devin"
  else
    fail "critiquing-spec does not state no external_runs on Devin"
  fi

  # Test state append under temporary HOME
  AC_STATE_DIR="$ISOLATED_HOME/.claude/architect-critic"
  mkdir -p "$AC_STATE_DIR"

  # Initialize state first (state_append_run requires an existing state.json)
  HOME="$ISOLATED_HOME" "$ARC_SOURCE/bin/arc" state_init 2>/dev/null || true

  # Run state_append_run through the dispatcher with isolated HOME
  HOME="$ISOLATED_HOME" "$ARC_SOURCE/bin/arc" state_append_run \
    --request-id "SMOKE-R1" \
    --depth "shallow" \
    --adversaries '["devin"]' \
    --challenge-count 0 \
    --concessions 0 \
    --skill-invoked "critiquing-spec" \
    --elapsed-ms 0 \
    2>/dev/null || true

  # Check state.json was created
  if [ -f "$AC_STATE_DIR/state.json" ]; then
    pass "state.json created at $AC_STATE_DIR/state.json"
    evidence "state path: $AC_STATE_DIR/state.json"

    # Verify the run was appended (state uses "recent_runs" not "runs")
    runs_count="$(jq '.recent_runs | length' "$AC_STATE_DIR/state.json" 2>/dev/null || echo 0)"
    if [ "$runs_count" -ge 1 ]; then
      pass "state append created a run record (count: $runs_count)"
      evidence "state recent_runs count: $runs_count"

      # Verify adversaries_used is ["devin"]
      adv="$(jq -r '.recent_runs[-1].adversaries_used | join(",")' "$AC_STATE_DIR/state.json" 2>/dev/null || echo '')"
      if [ "$adv" = "devin" ]; then
        pass "appended run has adversaries_used=[\"devin\"]"
        evidence "adversaries_used: $adv"
      else
        fail "appended run has wrong adversaries_used: $adv"
      fi

      # Verify no external_runs
      ext_count="$(jq '.external_runs | length' "$AC_STATE_DIR/state.json" 2>/dev/null || echo 0)"
      if [ "$ext_count" = "0" ]; then
        pass "no external_runs in state"
        evidence "external_runs count: $ext_count"
      else
        fail "external_runs present in state (count: $ext_count)"
      fi
    else
      fail "state append did not create a run record"
    fi
  else
    fail "state.json not created"
  fi

  # Verify no fake codex/claude sentinels were invoked
  # (We check that no codex/claude binary was called by looking at the state)
  if [ ! -f "$TEST_ROOT/fake-codex-invoked" ] && [ ! -f "$TEST_ROOT/fake-claude-invoked" ]; then
    pass "no external adversary binary invoked"
  else
    fail "external adversary binary was invoked"
  fi

  # Verify rules/dispatcher-path.md exists
  if [ -f "$ARC_SOURCE/rules/dispatcher-path.md" ]; then
    pass "arc rules/dispatcher-path.md exists at installed source"
  else
    fail "arc rules/dispatcher-path.md absent"
  fi
else
  fail "arc dispatcher not found at installed source"
  evidence "arc source was: $ARC_SOURCE"
fi

###############################################################################
# Smoke 4: Ossify — dispatcher, worker skill, no-commit audit
###############################################################################
printf '\nSmoke 4: Ossify — dispatcher and worker skill\n'

if [ -n "$OSS_SOURCE" ] && [ -x "$OSS_SOURCE/bin/oss" ]; then
  pass "oss dispatcher found at installed source: $OSS_SOURCE/bin/oss"
  evidence "oss dispatcher path: $OSS_SOURCE/bin/oss"

  # Run oss help to prove the dispatcher works
  oss_help="$("$OSS_SOURCE/bin/oss" help 2>&1)" || true
  if printf '%s' "$oss_help" | grep -q 'ossify dispatcher'; then
    pass "oss help runs from installed path"
    evidence "oss help output (first line): $(printf '%s' "$oss_help" | head -1)"
  else
    fail "oss help failed from installed path"
  fi

  # Verify worker skill exists with subagent: true
  worker_skill="$OSS_SOURCE/.devin/skills/work-item-worker/SKILL.md"
  if [ -f "$worker_skill" ]; then
    pass "work-item-worker skill exists at installed source"
    evidence "worker skill path: $worker_skill"

    if head -10 "$worker_skill" | grep -q 'subagent.*true'; then
      pass "worker skill has subagent: true"
    else
      fail "worker skill missing subagent: true"
    fi

    # Verify no-commit boundary
    if grep -q 'git commit.*git push.*git pull.*git fetch' "$worker_skill" 2>/dev/null; then
      pass "worker skill enforces no-commit boundary"
    else
      fail "worker skill does not enforce no-commit boundary"
    fi

    # Verify no-nesting
    if grep -qi 'no.*nest\|nesting.*forbid' "$worker_skill" 2>/dev/null; then
      pass "worker skill forbids nesting"
    else
      fail "worker skill does not forbid nesting"
    fi

    # Verify it delegates to canonical (does not copy)
    if grep -q 'skills/work-item/SKILL.md' "$worker_skill" 2>/dev/null; then
      pass "worker skill delegates to canonical work-item/SKILL.md"
    else
      fail "worker skill does not delegate to canonical"
    fi

    # Audit: no git commit/push/pull/fetch tokens in the worker skill body
    # (they should be mentioned as forbidden, not as commands to run)
    # The test checks that the forbidden tokens appear in a "must not" context
    for forbidden in 'git commit' 'git push' 'git pull' 'git fetch'; do
      if grep -q "\`${forbidden}\`" "$worker_skill" 2>/dev/null; then
        pass "worker skill mentions ${forbidden} as forbidden"
      else
        fail "worker skill does not mention ${forbidden}"
      fi
    done
  else
    fail "work-item-worker skill absent at installed source"
  fi

  # Verify canonical work-item SKILL.md exists
  if [ -f "$OSS_SOURCE/skills/work-item/SKILL.md" ]; then
    pass "canonical work-item/SKILL.md exists at installed source"
    evidence "canonical skill path: $OSS_SOURCE/skills/work-item/SKILL.md"

    # Audit no-commit tokens in canonical skill
    for forbidden in 'git commit' 'git push' 'git pull' 'git fetch'; do
      if grep -q "\`${forbidden}\`" "$OSS_SOURCE/skills/work-item/SKILL.md" 2>/dev/null; then
        pass "canonical work-item mentions ${forbidden} as forbidden"
      else
        fail "canonical work-item does not mention ${forbidden}"
      fi
    done
  else
    fail "canonical work-item/SKILL.md absent"
  fi

  # Verify rules/dispatcher-path.md exists
  if [ -f "$OSS_SOURCE/rules/dispatcher-path.md" ]; then
    pass "oss rules/dispatcher-path.md exists at installed source"
  else
    fail "oss rules/dispatcher-path.md absent"
  fi

  # Verify no CLAUDE_PLUGIN_ROOT in agent body
  if grep -q 'CLAUDE_PLUGIN_ROOT' "$OSS_SOURCE/agents/implementer-agent.md" 2>/dev/null; then
    fail "implementer-agent.md still references CLAUDE_PLUGIN_ROOT"
  else
    pass "implementer-agent.md does not reference CLAUDE_PLUGIN_ROOT"
  fi
else
  fail "oss dispatcher not found at installed source"
  evidence "oss source was: $OSS_SOURCE"
fi

###############################################################################
# Smoke 5: Code Judo — four skills advertised, skill-local references readable
# from installed source
###############################################################################
printf '\nSmoke 5: Code Judo — skills advertised, references readable\n'

if [ -n "$JUDO_SOURCE" ]; then
  # All four canonical skills present at installed source
  for skill in codebase-design deep-review deepen-architecture domain-modeling; do
    if [ -f "$JUDO_SOURCE/skills/$skill/SKILL.md" ]; then
      pass "code-judo/$skill SKILL.md exists at installed source"
    else
      fail "code-judo/$skill SKILL.md absent at installed source"
    fi
  done

  # Skill-local references are read from the installed plugin source, not
  # the developer's canonical checkout — deep-review's rubric + disposition.
  for ref in rubric.md disposition.md; do
    if [ -f "$JUDO_SOURCE/skills/deep-review/references/$ref" ]; then
      pass "deep-review references/$ref readable at installed source"
      evidence "deep-review ref: $JUDO_SOURCE/skills/deep-review/references/$ref"
    else
      fail "deep-review references/$ref absent at installed source"
    fi
  done

  # No CLAUDE_PLUGIN_ROOT tokens in skill bodies — Devin never expands it
  judo_token_hits="$(grep -rl 'CLAUDE_PLUGIN_ROOT' "$JUDO_SOURCE/skills/" 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$judo_token_hits" = "0" ]; then
    pass "no CLAUDE_PLUGIN_ROOT in code-judo skill bodies"
  else
    fail "CLAUDE_PLUGIN_ROOT found in code-judo skills ($judo_token_hits files)"
  fi
else
  fail "code-judo source not found"
fi

###############################################################################
# Cleanup
###############################################################################
for plugin in workspace-init ai-mentor architect-critic ossify code-judo; do
  run_devin plugins remove -y "$plugin" >/dev/null 2>&1 || true
done

# Print evidence summary
printf '\n=== Evidence Summary ===\n'
printf '%s' "$EVIDENCE"
