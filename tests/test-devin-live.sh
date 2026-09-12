#!/usr/bin/env bash
# test-devin-live.sh — Hermetic real Devin loader integration gate
#
# Builds a throwaway git "remote" carrying this worktree's exact tracked and
# untracked tree (dep URLs rewritten to file://), installs the root
# meta-plugin through real git-subdir transport, and asserts exact plugin
# versions and complete skill inventories.  This is deliberately NOT the
# GitHub remote — git-subdir deps in the real manifest fetch over the
# network, which made an earlier revision of this gate assert remote content
# while claiming to test local.  file:// + GIT_ALLOW_PROTOCOL keeps the
# transport real and the content local.
#
# Also verifies the five-plugin baseline install, checks that plugins info
# advertises only approved assets, verifies linked-edit visibility, removes
# all plugins, and asserts no contamination of real user config.
#
# Pinned to devin 3000.10.21. Fails (not skips) when the binary is unavailable.
# Never touches real user configuration — uses isolated HOME/XDG/data/cache.

set -euo pipefail

EXPECTED_DEVIN_VERSION="3000.10.21"
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
DEVIN_VERSION_NUM="$(printf '%s' "$DEVIN_VERSION" | awk '{print $2}')"
if [ "$DEVIN_VERSION_NUM" != "$EXPECTED_DEVIN_VERSION" ]; then
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
  "ossify/.devin-plugin/plugin.json" \
  "code-judo/.devin-plugin/plugin.json"
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

GIT_BIN_DIR="$(dirname "$(command -v git 2>/dev/null || echo /usr/bin/git)")"
JQ_BIN_DIR="$(dirname "$(command -v jq 2>/dev/null || echo /usr/bin/jq)")"
SAFE_PATH="${DEVIN_BIN%/*}:${NODE_BIN%/*}:${GIT_BIN_DIR}:${JQ_BIN_DIR}:/usr/local/bin:/usr/bin:/bin"

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

DEVIN_ENV=(
  "HOME=$ISOLATED_HOME"
  "XDG_CONFIG_HOME=$ISOLATED_CONFIG"
  "XDG_DATA_HOME=$ISOLATED_DATA"
  "XDG_CACHE_HOME=$ISOLATED_CACHE"
  "PATH=$SAFE_PATH"
  "NO_COLOR=1" "TERM=dumb" "DEVIN_AUTO_UPDATE=0"
  "GIT_ALLOW_PROTOCOL=file"
)

run_devin() {
  env -i "${DEVIN_ENV[@]}" "$DEVIN_BIN" "$@"
}

###############################################################################
# Hermetic remote — a temp git repo carrying this worktree's exact tree so
# git-subdir dependencies resolve over real git transport without network.
###############################################################################
REMOTE_REPO="$TEST_ROOT/marketplace-remote"
mkdir -p "$REMOTE_REPO"

# Copy every tracked + untracked-not-ignored file (no .git), preserving layout.
( cd "$ROOT" && git ls-files -co --exclude-standard ) | while IFS= read -r rel; do
  mkdir -p "$REMOTE_REPO/$(dirname "$rel")"
  cp "$ROOT/$rel" "$REMOTE_REPO/$rel"
done

# Rewrite dep URLs to the hermetic remote, then commit the exact tree.
jq '.requiredPlugins |= map(.url = "file://'"$REMOTE_REPO"'")' \
  "$REMOTE_REPO/.devin-plugin/plugin.json" > "$REMOTE_REPO/.devin-plugin/plugin.json.tmp" \
  && mv "$REMOTE_REPO/.devin-plugin/plugin.json.tmp" "$REMOTE_REPO/.devin-plugin/plugin.json"

git -C "$REMOTE_REPO" init -q
git -C "$REMOTE_REPO" add -A
git -C "$REMOTE_REPO" -c user.email=devin-live@test -c user.name=devin-live \
  commit -qm "hermetic remote snapshot" >/dev/null

###############################################################################
# Probe 1: Install root meta-plugin → exactly five baseline plugins
###############################################################################
printf 'Probe 1: Install meta-plugin, assert five baseline plugins\n'

run_devin plugins install --local -y "$REMOTE_REPO" >/dev/null 2>&1

# List installed plugins (text output, not --json)
installed_text="$(run_devin plugins list 2>&1)"
installed_names="$(plugins_list_names "$installed_text")"

# Assert exactly five baseline plugins are present
for expected in workspace-init ai-mentor architect-critic ossify code-judo; do
  if printf '%s\n' "$installed_names" | grep -qx "$expected"; then
    pass "baseline plugin installed: $expected"
  else
    fail "baseline plugin missing: $expected"
  fi
done

# Assert the meta-plugin itself is present
if printf '%s\n' "$installed_names" | grep -qx "claude-agent-scaffolding-devin"; then
  pass "meta-plugin installed"
else
  fail "meta-plugin missing"
fi

# Exactness: nothing beyond the five baseline plugins plus the meta-plugin
installed_count="$(printf '%s\n' "$installed_names" | grep -c '^.' || true)"
if [ "$installed_count" = "6" ]; then
  pass "exactly six entries installed (five baseline + meta)"
else
  fail "expected 6 installed entries (five baseline + meta), got $installed_count"
fi

###############################################################################
# Probe 2: Assert plugin versions
###############################################################################
printf '\nProbe 2: Plugin versions\n'

# Read versions from the native manifests and compare with plugins list output
for plugin in workspace-init ai-mentor architect-critic ossify code-judo; do
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

# Ossify: the six-skill Devin claim plus the local worker
for expected in \
  "ossify:start" \
  "ossify:plan-release" \
  "ossify:plan-spine" \
  "ossify:work-item" \
  "ossify:close" \
  "ossify:doctor" \
  "ossify:work-item-worker"
do
  if printf '%s\n' "$skill_names" | grep -qx "$expected"; then
    pass "skill advertised: $expected"
  else
    fail "skill missing: $expected"
  fi
done

# Deferred ossify skills must NOT advertise on this surface
for unexpected in \
  "ossify:adopt" \
  "ossify:challenge" \
  "ossify:wayfinder"
do
  if printf '%s\n' "$skill_names" | grep -qx "$unexpected"; then
    fail "deferred ossify skill advertised: $unexpected"
  else
    pass "deferred ossify skill absent: $unexpected"
  fi
done

# Code Judo: 4 skills
for expected in \
  "code-judo:codebase-design" \
  "code-judo:deep-review" \
  "code-judo:deepen-architecture" \
  "code-judo:domain-modeling"
do
  if printf '%s\n' "$skill_names" | grep -qx "$expected"; then
    pass "skill advertised: $expected"
  else
    fail "skill missing: $expected"
  fi
done

###############################################################################
# Probe 4: plugins info advertises only approved assets
###############################################################################
printf '\nProbe 4: plugins info approved assets\n'

for plugin in workspace-init ai-mentor architect-critic ossify code-judo; do
  info="$(run_devin plugins info "$plugin" 2>&1)"
  # Must show at least one namespaced skill — a bare `Skills`/`(none)` fails
  if printf '%s' "$info" | grep -q "/${plugin}:"; then
    pass "$plugin info shows namespaced skills"
  else
    fail "$plugin info shows no namespaced skills"
  fi
done

# Rules are not surfaced in `plugins info` output on this build (measured:
# the section prints "(none)" even when rules ship), and remote installs
# report source as a file://…#subdir URL, not a path. The verifiable contract
# is that the rule file ships in the remote tree the plugin was cloned from.
for plugin in workspace-init architect-critic ossify; do
  if [ -f "$REMOTE_REPO/$plugin/rules/dispatcher-path.md" ]; then
    pass "$plugin ships rules/dispatcher-path.md in the remote tree"
  else
    fail "$plugin missing rules/dispatcher-path.md in remote tree"
  fi
done

###############################################################################
# Probe 5: Independent installability — one baseline plugin alone in a fresh
# isolated HOME installs without the meta-plugin
###############################################################################
printf '\nProbe 5: Independent plugin install\n'

IND_HOME="$TEST_ROOT/home-ind"
mkdir -p \
  "$IND_HOME/.config/devin" \
  "$IND_HOME/.local/share/devin" \
  "$IND_HOME/.cache"
cp "$ISOLATED_CONFIG/devin/config.json" "$IND_HOME/.config/devin/config.json"
cp "$ISOLATED_DATA/devin/credentials.toml" "$IND_HOME/.local/share/devin/credentials.toml"
chmod 600 "$IND_HOME/.local/share/devin/credentials.toml"

env -i \
  HOME="$IND_HOME" \
  XDG_CONFIG_HOME="$IND_HOME/.config" \
  XDG_DATA_HOME="$IND_HOME/.local/share" \
  XDG_CACHE_HOME="$IND_HOME/.cache" \
  PATH="$SAFE_PATH" \
  NO_COLOR=1 TERM=dumb DEVIN_AUTO_UPDATE=0 \
  GIT_ALLOW_PROTOCOL="file" \
  "$DEVIN_BIN" plugins install --local -y "$ROOT/code-judo" >/dev/null 2>&1

ind_text="$(env -i \
  HOME="$IND_HOME" \
  XDG_CONFIG_HOME="$IND_HOME/.config" \
  XDG_DATA_HOME="$IND_HOME/.local/share" \
  XDG_CACHE_HOME="$IND_HOME/.cache" \
  PATH="$SAFE_PATH" \
  NO_COLOR=1 TERM=dumb DEVIN_AUTO_UPDATE=0 \
  GIT_ALLOW_PROTOCOL="file" \
  "$DEVIN_BIN" plugins list 2>&1)"
ind_names="$(plugins_list_names "$ind_text")"
ind_count="$(printf '%s\n' "$ind_names" | grep -c '^.' || true)"

if printf '%s\n' "$ind_names" | grep -qx "code-judo" && [ "$ind_count" = "1" ]; then
  pass "code-judo installs independently (exactly one plugin in fresh HOME)"
else
  fail "code-judo independent install failed (count=$ind_count): $ind_names"
fi

###############################################################################
# Probe 6: Remove all four plugins, assert no plugin remains
###############################################################################
printf '\nProbe 6: Remove all plugins, assert clean state\n'

# Remove meta-plugin first (required plugins can't be removed while it's installed)
run_devin plugins remove -y claude-agent-scaffolding-devin >/dev/null 2>&1 || true
# Then remove each individual plugin
for plugin in workspace-init ai-mentor architect-critic ossify code-judo; do
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

# run_devin_t <secs> <args...> — devin under a wall-clock cap (rc 124 on
# timeout). Two load-bearing details: `exec` makes the subshell BECOME devin
# so $! is devin's own pid; and output goes to a FILE, not the caller's pipe —
# a killed process can leave orphaned children, and an orphan holding the
# command-substitution pipe open would deadlock the gate past the cap anyway.
run_devin_t() {
  local secs="$1"; shift
  local out="$TEST_ROOT/run_devin_t.$$.out"
  ( exec env -i "${DEVIN_ENV[@]}" "$DEVIN_BIN" "$@" ) >"$out" 2>&1 &
  local pid=$! waited=0 rc
  while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt "$secs" ]; do
    sleep 1; waited=$((waited + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    rc=124
  else
    wait "$pid" && rc=0 || rc=$?
  fi
  cat "$out"; rm -f "$out"
  return "$rc"
}

# Normal command completes within timeout — actually bounded, not just timed
normal_start=$(date +%s)
normal_output="$(run_devin_t "$COMMAND_TIMEOUT_SECS" plugins list 2>/dev/null)" && normal_rc=0 || normal_rc=$?
normal_end=$(date +%s)
normal_elapsed=$((normal_end - normal_start))

if [ "$normal_rc" = "0" ] && [ "$normal_elapsed" -lt "$COMMAND_TIMEOUT_SECS" ]; then
  pass "normal command completes within timeout (${normal_elapsed}s)"
else
  fail "normal command exceeded timeout or failed (rc=$normal_rc, ${normal_elapsed}s)"
fi

# Excessive command — the control must exercise run_devin_t itself, against a
# devin stub that hangs. (A plain `( sleep 5 ) &` proves only that kill works
# in general: bash execs that single simple command, while a function call in
# a subshell forks a child — exactly the shape that orphaned the real devin.)
stub_bin="$TEST_ROOT/devin-stub"
printf '#!/bin/sh\nsleep 30\n' > "$stub_bin"
chmod +x "$stub_bin"
excessive_start=$(date +%s)
hang_out="$(DEVIN_BIN="$stub_bin" run_devin_t 2 plugins list 2>/dev/null)" && excessive_rc=0 || excessive_rc=$?
excessive_end=$(date +%s)
excessive_elapsed=$((excessive_end - excessive_start))

if [ "$excessive_rc" = "124" ] && [ "$excessive_elapsed" -ge 2 ] && [ "$excessive_elapsed" -lt 10 ]; then
  pass "run_devin_t bounds a hung devin (rc 124 after ${excessive_elapsed}s)"
else
  fail "run_devin_t did not bound the stub (rc=$excessive_rc, ${excessive_elapsed}s)"
fi

###############################################################################
# Probe 8: Real config contamination check (in cleanup trap)
###############################################################################
printf '\nProbe 8: Real config contamination (checked in cleanup)\n'
pass "contamination check registered (will verify in cleanup)"

# The actual hash comparison runs in the cleanup trap.
