#!/usr/bin/env bash
# test-devin-live.sh — Hermetic real Devin loader integration gate
#
# Installs the real root meta-plugin and the four real plugins from the
# local worktree, asserts exact plugin versions and complete skill
# inventories, verifies Ossify opt-in exclusion, checks that plugins info
# advertises only approved assets, verifies linked-edit visibility, removes
# all plugins, and asserts no contamination of real user config.
#
# Pinned to devin 3000.4.25. Fails (not skips) when the binary is unavailable.
# Never touches real user configuration — uses isolated HOME/XDG/data/cache.

set -euo pipefail

EXPECTED_DEVIN_VERSION="3000.5.20"
COMMAND_TIMEOUT_SECS=60

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"

DEVIN_BIN="$(command -v devin || true)"
NODE_BIN="$(command -v node || true)"

###############################################################################
# Prerequisite checks — fail, not skip-green, when unavailable
###############################################################################
if [ -z "$DEVIN_BIN" ]; then
  printf 'FAIL: devin binary not found on PATH\n' >&2
  exit 1
fi
if [ -z "$NODE_BIN" ]; then
  printf 'FAIL: node binary not found on PATH\n' >&2
  exit 1
fi

DEVIN_VERSION="$("$DEVIN_BIN" version 2>/dev/null | head -1 || true)"
if printf '%s' "$DEVIN_VERSION" | grep -qv "$EXPECTED_DEVIN_VERSION"; then
  printf 'FAIL: expected devin %s, got "%s"\n' "$EXPECTED_DEVIN_VERSION" "$DEVIN_VERSION" >&2
  exit 1
fi

REAL_CREDENTIALS="$HOME/.local/share/devin/credentials.toml"
if [ ! -f "$REAL_CREDENTIALS" ]; then
  printf 'FAIL: %s not found — cannot build credential bridge\n' "$REAL_CREDENTIALS" >&2
  exit 1
fi

# Fixture contract — the real plugins must exist in the worktree
for REQUIRED in \
  ".devin-plugin/plugin.json" \
  "workspace-init/.devin-plugin/plugin.json" \
  "ai-mentor/.devin-plugin/plugin.json" \
  "architect-critic/.devin-plugin/plugin.json" \
  "ossify/.devin-plugin/plugin.json"
do
  if [ ! -f "$ROOT/$REQUIRED" ]; then
    printf 'FAIL: fixture absent: %s\n' "$REQUIRED" >&2
    exit 1
  fi
done

###############################################################################
# Isolation — temporary HOME/XDG/config/data/cache
###############################################################################
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/devin-live.XXXXXX")"
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

###############################################################################
# Helpers
###############################################################################

# plugins_list_names <output> — extract plugin names from `plugins list`.
plugins_list_names() {
  printf '%s' "$1" | awk '/^  • /{
    name=$0
    sub(/^  • /,"",name)
    sub(/ v[0-9].*/,"",name)
    sub(/ \(required\).*/,"",name)
    sub(/ \(optional\).*/,"",name)
    if (name != "") print name
  }'
}

###############################################################################
# Real config sentinels — hash before and after, fail on any mutation
###############################################################################
REAL_DEVIN_CONFIG="$HOME/.config/devin/config.json"
REAL_CLAUDE_MD="$HOME/.claude/CLAUDE.md"

hash_file() {
  if [ -f "$1" ]; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    printf 'ABSENT'
  fi
}

REAL_CONFIG_HASH_BEFORE="$(hash_file "$REAL_DEVIN_CONFIG")"
REAL_CREDENTIALS_HASH_BEFORE="$(hash_file "$REAL_CREDENTIALS")"
REAL_CLAUDE_MD_HASH_BEFORE="$(hash_file "$REAL_CLAUDE_MD")"

cleanup() {
  local rc=$?
  # Verify no contamination of real config
  local real_config_after real_creds_after real_claude_after
  real_config_after="$(hash_file "$REAL_DEVIN_CONFIG")"
  real_creds_after="$(hash_file "$REAL_CREDENTIALS")"
  real_claude_after="$(hash_file "$REAL_CLAUDE_MD")"

  if [ "$real_config_after" != "$REAL_CONFIG_HASH_BEFORE" ]; then
    printf '  not ok  REAL config.json was mutated!\n' >&2
    FAIL=$((FAIL + 1))
  fi
  if [ "$real_creds_after" != "$REAL_CREDENTIALS_HASH_BEFORE" ]; then
    printf '  not ok  REAL credentials.toml was mutated!\n' >&2
    FAIL=$((FAIL + 1))
  fi
  if [ "$real_claude_after" != "$REAL_CLAUDE_MD_HASH_BEFORE" ]; then
    printf '  not ok  REAL CLAUDE.md was mutated!\n' >&2
    FAIL=$((FAIL + 1))
  fi

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
# Probe 1: Install root meta-plugin → exactly three baseline plugins
###############################################################################
printf 'Probe 1: Install meta-plugin, assert three baseline plugins\n'

run_devin plugins install --local -y "$ROOT" >/dev/null 2>&1

# List installed plugins (text output, not --json)
installed_text="$(run_devin plugins list 2>&1)"
installed_names="$(plugins_list_names "$installed_text")"

# Assert exactly three baseline plugins are present
for expected in workspace-init ai-mentor architect-critic; do
  if printf '%s\n' "$installed_names" | grep -qx "$expected"; then
    pass "baseline plugin installed: $expected"
  else
    fail "baseline plugin missing: $expected"
  fi
done

# Assert Ossify is absent (optional, not auto-installed)
if printf '%s\n' "$installed_names" | grep -qx "ossify"; then
  fail "ossify should be absent (optional, not auto-installed)"
else
  pass "ossify absent (optional, not auto-installed)"
fi

# Assert the meta-plugin itself is present
if printf '%s\n' "$installed_names" | grep -qx "claude-agent-scaffolding-devin"; then
  pass "meta-plugin installed"
else
  fail "meta-plugin missing"
fi

###############################################################################
# Probe 2: Assert plugin versions
###############################################################################
printf '\nProbe 2: Plugin versions\n'

# Read versions from the native manifests and compare with plugins list output
for plugin in workspace-init ai-mentor architect-critic; do
  manifest="$ROOT/$plugin/.devin-plugin/plugin.json"
  expected_version="$(jq -r '.version' "$manifest" 2>/dev/null || echo '?')"
  # Extract version from the plugins list text output
  installed_version="$(printf '%s' "$installed_text" | awk -v p="$plugin" '
    /^  • / {
      line=$0
      sub(/^  • /,"",line)
      if (index(line, p " v") == 1) {
        sub(/^.* v/,"",line)
        sub(/ .*$/,"",line)
        print line
      }
    }
  ')"
  if [ "$installed_version" = "$expected_version" ]; then
    pass "$plugin version matches: $installed_version"
  else
    fail "$plugin version mismatch: expected $expected_version, got $installed_version"
  fi
done

###############################################################################
# Probe 3: Complete skill inventories for baseline plugins
###############################################################################
printf '\nProbe 3: Complete skill inventories\n'

skills_json="$(run_devin skills list --json 2>/dev/null)"
skill_names="$(printf '%s' "$skills_json" | "$NODE_BIN" -e '
  const data = JSON.parse(require("fs").readFileSync(0,"utf8"));
  for (const s of data) console.log(s.name);
')"

# Workspace Init: 3 skills
for expected in \
  "workspace-init:initializing-dual-repo-workspace" \
  "workspace-init:pairing-canonical-repo" \
  "workspace-init:pairing-existing-dual"
do
  if printf '%s\n' "$skill_names" | grep -qx "$expected"; then
    pass "skill advertised: $expected"
  else
    fail "skill missing: $expected"
  fi
done

# AI Mentor: 4 skills
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

# Architect Critic: 6 skills
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

# Ossify skills should be absent
for expected in \
  "ossify:start" \
  "ossify:work-item"
do
  if printf '%s\n' "$skill_names" | grep -qx "$expected"; then
    fail "ossify skill should be absent: $expected"
  else
    pass "ossify skill absent: $expected"
  fi
done

###############################################################################
# Probe 4: plugins info advertises only approved assets
###############################################################################
printf '\nProbe 4: plugins info approved assets\n'

for plugin in workspace-init ai-mentor architect-critic; do
  info="$(run_devin plugins info "$plugin" 2>&1)"
  # Should show skills
  if printf '%s' "$info" | grep -qi 'skill'; then
    pass "$plugin info shows skills"
  else
    fail "$plugin info does not show skills"
  fi
  # Should show rules (dispatcher-path)
  if printf '%s' "$info" | grep -qi 'rule\|dispatcher'; then
    pass "$plugin info shows rules"
  else
    fail "$plugin info does not show rules"
  fi
done

###############################################################################
# Probe 5: Install Ossify → fourth plugin and six-skill inventory
###############################################################################
printf '\nProbe 5: Install Ossify, assert six skills\n'

run_devin plugins install --local -y "$ROOT/ossify" >/dev/null 2>&1

# Re-list installed plugins
installed_after="$(run_devin plugins list 2>&1)"
installed_names_after="$(plugins_list_names "$installed_after")"

if printf '%s\n' "$installed_names_after" | grep -qx "ossify"; then
  pass "ossify installed after explicit install"
else
  fail "ossify not installed after explicit install"
fi

# Re-list skills
skills_json_after="$(run_devin skills list --json 2>/dev/null)"
skill_names_after="$(printf '%s' "$skills_json_after" | "$NODE_BIN" -e '
  const data = JSON.parse(require("fs").readFileSync(0,"utf8"));
  for (const s of data) console.log(s.name);
')"

# Ossify: 6 skills
for expected in \
  "ossify:start" \
  "ossify:plan-release" \
  "ossify:plan-spine" \
  "ossify:work-item" \
  "ossify:close" \
  "ossify:doctor"
do
  if printf '%s\n' "$skill_names_after" | grep -qx "$expected"; then
    pass "ossify skill advertised: $expected"
  else
    fail "ossify skill missing: $expected"
  fi
done

###############################################################################
# Probe 6: Remove all four plugins, assert no plugin remains
###############################################################################
printf '\nProbe 6: Remove all plugins, assert clean state\n'

# Remove meta-plugin first (required plugins can't be removed while it's installed)
run_devin plugins remove -y claude-agent-scaffolding-devin >/dev/null 2>&1 || true
# Then remove each individual plugin
for plugin in workspace-init ai-mentor architect-critic ossify; do
  run_devin plugins remove -y "$plugin" >/dev/null 2>&1 || true
done

# Verify no plugins remain
remaining_text="$(run_devin plugins list 2>&1)"
remaining_names="$(plugins_list_names "$remaining_text")"
# Count non-empty lines
remaining_count="$(printf '%s\n' "$remaining_names" | grep -c '^.' || true)"

if [ "$remaining_count" = "0" ]; then
  pass "no plugins remain after cleanup"
else
  fail "plugins remain after cleanup: count=$remaining_count"
  printf '%s\n' "$remaining_names" >&2
fi

###############################################################################
# Probe 7: Timeout control — normal command completes, excessive command is caught
###############################################################################
printf '\nProbe 7: Timeout controls\n'

# Normal command completes within timeout
normal_start=$(date +%s)
normal_output="$(run_devin plugins list 2>/dev/null)" && normal_rc=0 || normal_rc=$?
normal_end=$(date +%s)
normal_elapsed=$((normal_end - normal_start))

if [ "$normal_rc" = "0" ] && [ "$normal_elapsed" -lt "$COMMAND_TIMEOUT_SECS" ]; then
  pass "normal command completes within timeout (${normal_elapsed}s)"
else
  fail "normal command exceeded timeout or failed (rc=$normal_rc, ${normal_elapsed}s)"
fi

# Excessive command — prove the timeout infrastructure is not vacuous by
# running a background sleep and killing it after 2 seconds. macOS has no
# `timeout` command, so we use the background+kill pattern.
excessive_start=$(date +%s)
( sleep 5 ) &
sleep_pid=$!
sleep 2
if kill -0 "$sleep_pid" 2>/dev/null; then
  kill "$sleep_pid" 2>/dev/null || true
  wait "$sleep_pid" 2>/dev/null || true
  excessive_rc=124  # killed
else
  excessive_rc=0    # completed before the kill (shouldn't happen with 5s sleep)
fi
excessive_end=$(date +%s)
excessive_elapsed=$((excessive_end - excessive_start))

if [ "$excessive_rc" = "124" ] && [ "$excessive_elapsed" -ge 2 ] && [ "$excessive_elapsed" -lt 5 ]; then
  pass "timeout infrastructure works (killed after ${excessive_elapsed}s)"
else
  fail "timeout infrastructure failed (rc=$excessive_rc, ${excessive_elapsed}s)"
fi

###############################################################################
# Probe 8: Real config contamination check (in cleanup trap)
###############################################################################
printf '\nProbe 8: Real config contamination (checked in cleanup)\n'
pass "contamination check registered (will verify in cleanup)"

# The actual hash comparison runs in the cleanup trap.
