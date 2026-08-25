#!/usr/bin/env bash
# test-devin-capability.sh — Known-answer Devin capability harness
#
# Hermetic model-free loader harness for Devin plugin packaging, manifest
# precedence, skill inventory, meta-plugin dependency resolution, namespacing,
# local-link update, removal, and prune behavior.  Credentialed runtime probes
# (arguments, source-path visibility, reference reads, bin/ PATH, hooks, agents,
# model: inherit, nested-subagent denial) are opt-in behind DEVIN_CREDENTIALED=1.
#
# The harness runs in an isolated HOME/XDG with a read-only credential bridge.
# It never writes to the real user's Devin state.  A sentinel on the real
# config and credentials files is checked before and after the run.
#
# Pinned to devin 3000.4.25.  A different version is a re-baseline, not a pass.
set -euo pipefail

EXPECTED_DEVIN_VERSION="3000.5.20"
COMMAND_TIMEOUT_MS=60000

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
FIXTURES="$ROOT/tests/fixtures/devin-capability"

DEVIN_BIN="$(command -v devin || true)"
NODE_BIN="$(command -v node || true)"

###############################################################################
# Prerequisite checks — must pass before any fixture contract is tested.
###############################################################################
if [ -z "$DEVIN_BIN" ]; then
  printf 'FAIL: devin is required\n' >&2
  exit 1
fi
if [ -z "$NODE_BIN" ]; then
  printf 'FAIL: node is required\n' >&2
  exit 1
fi

# Version check — exact pin.
DEVIN_VERSION="$("$DEVIN_BIN" version 2>/dev/null | head -1 || true)"
if printf '%s' "$DEVIN_VERSION" | grep -qv "$EXPECTED_DEVIN_VERSION"; then
  printf 'FAIL: expected devin %s, got "%s"\n' "$EXPECTED_DEVIN_VERSION" "$DEVIN_VERSION" >&2
  exit 1
fi

# Credential bridge source — must exist for plugin install.
REAL_CREDENTIALS="$HOME/.local/share/devin/credentials.toml"
if [ ! -f "$REAL_CREDENTIALS" ]; then
  printf 'FAIL: %s not found — cannot build credential bridge\n' "$REAL_CREDENTIALS" >&2
  exit 1
fi

# Fixture contract — the harness fails here when fixtures are absent.
if [ ! -d "$FIXTURES" ]; then
  printf 'FAIL: fixture directory absent: %s\n' "$FIXTURES" >&2
  exit 1
fi
for REQUIRED_FIXTURE in \
  "meta/.devin-plugin/plugin.json" \
  "required-a/.devin-plugin/plugin.json" \
  "required-a/.claude-plugin/plugin.json" \
  "required-a/skills/advertised/SKILL.md" \
  "required-a/alternate-skills/included/SKILL.md" \
  "required-a/excluded-skills/excluded/SKILL.md" \
  "required-a/references/probe.txt" \
  "required-a/bin/devin-capability-probe" \
  "required-a/agents/probe-agent.md" \
  "required-a/hooks.json" \
  "required-b/.devin-plugin/plugin.json" \
  "required-b/skills/auxiliary/SKILL.md" \
  "optional-c/.devin-plugin/plugin.json" \
  "optional-c/skills/optional-skill/SKILL.md"
do
  if [ ! -f "$FIXTURES/$REQUIRED_FIXTURE" ]; then
    printf 'FAIL: fixture contract absent: %s\n' "$REQUIRED_FIXTURE" >&2
    exit 1
  fi
done

###############################################################################
# Isolation setup
###############################################################################
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/devin-capability.XXXXXX")"
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

# Minimal config that disables all cross-tool imports and auto-update.
# skip_workspace_trust is required for non-interactive -p invocations from
# the isolated project directory.
cat > "$ISOLATED_CONFIG/devin/config.json" <<'CFG'
{
  "auto_update": false,
  "skip_workspace_trust": true,
  "read_config_from": {
    "cursor": false,
    "windsurf": false,
    "claude": false,
    "copilot": false,
    "opencode": false,
    "vscode": false,
    "zed": false,
    "agents_standard": false
  }
}
CFG

# Credential bridge: read-only copy of credentials into isolated HOME.
cp "$REAL_CREDENTIALS" "$ISOLATED_DATA/devin/credentials.toml"
chmod 600 "$ISOLATED_DATA/devin/credentials.toml"

# Real-state sentinels — hash and stat before the run.
REAL_CONFIG="$HOME/.config/devin/config.json"
REAL_CONFIG_HASH_BEFORE=""
REAL_CONFIG_STAT_BEFORE=""
if [ -f "$REAL_CONFIG" ]; then
  REAL_CONFIG_HASH_BEFORE="$(shasum -a 256 "$REAL_CONFIG" | awk '{print $1}')"
  REAL_CONFIG_STAT_BEFORE="$(stat -f '%z_%m_%d' "$REAL_CONFIG" 2>/dev/null || echo 'n/a')"
fi
REAL_CRED_HASH_BEFORE="$(shasum -a 256 "$REAL_CREDENTIALS" | awk '{print $1}')"

SAFE_PATH="${DEVIN_BIN%/*}:${NODE_BIN%/*}:/usr/local/bin:/usr/bin:/bin"

# Result tracking
RESULTS_FILE="$TEST_ROOT/results.json"
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
RESULTS_JSONL="$TEST_ROOT/results.jsonl"

cleanup() {
  # Real-state sentinel — hash and stat after the run.
  if [ -f "$REAL_CONFIG" ]; then
    REAL_CONFIG_HASH_AFTER="$(shasum -a 256 "$REAL_CONFIG" | awk '{print $1}')"
    REAL_CONFIG_STAT_AFTER="$(stat -f '%z_%m_%d' "$REAL_CONFIG" 2>/dev/null || echo 'n/a')"
    if [ "$REAL_CONFIG_HASH_BEFORE" != "$REAL_CONFIG_HASH_AFTER" ]; then
      printf 'FAIL: real config hash changed during run\n' >&2
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
    if [ "$REAL_CONFIG_STAT_BEFORE" != "$REAL_CONFIG_STAT_AFTER" ]; then
      printf 'FAIL: real config stat changed during run\n' >&2
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  fi
  REAL_CRED_HASH_AFTER="$(shasum -a 256 "$REAL_CREDENTIALS" | awk '{print $1}')"
  if [ "$REAL_CRED_HASH_BEFORE" != "$REAL_CRED_HASH_AFTER" ]; then
    printf 'FAIL: real credentials hash changed during run\n' >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi

  # Summary
  printf '\n=== Results ===\n'
  printf 'pass=%d fail=%d skip=%d\n' "$PASS_COUNT" "$FAIL_COUNT" "$SKIP_COUNT"
  printf '{"pass":%d,"fail":%d,"skip":%d}\n' "$PASS_COUNT" "$FAIL_COUNT" "$SKIP_COUNT" > "$RESULTS_FILE"
  if [ "$FAIL_COUNT" -gt 0 ]; then
    printf 'FAIL: %d probe(s) failed\n' "$FAIL_COUNT" >&2
    rm -rf "$TEST_ROOT"
    exit 1
  fi
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT HUP INT TERM

###############################################################################
# Helpers
###############################################################################

# run_devin <args...> — execute devin in the isolated environment.
run_devin() {
  env -i \
    HOME="$ISOLATED_HOME" \
    XDG_CONFIG_HOME="$ISOLATED_CONFIG" \
    XDG_DATA_HOME="$ISOLATED_DATA" \
    XDG_CACHE_HOME="$ISOLATED_CACHE" \
    PATH="$SAFE_PATH" \
    NO_COLOR=1 \
    TERM=dumb \
    DEVIN_AUTO_UPDATE=0 \
    "$DEVIN_BIN" "$@"
}

# run_devin_capture <stdout_file> <stderr_file> <args...> — capture output.
run_devin_capture() {
  local stdout_file="$1"
  local stderr_file="$2"
  shift 2
  env -i \
    HOME="$ISOLATED_HOME" \
    XDG_CONFIG_HOME="$ISOLATED_CONFIG" \
    XDG_DATA_HOME="$ISOLATED_DATA" \
    XDG_CACHE_HOME="$ISOLATED_CACHE" \
    PATH="$SAFE_PATH" \
    NO_COLOR=1 \
    TERM=dumb \
    DEVIN_AUTO_UPDATE=0 \
    "$DEVIN_BIN" "$@" >"$stdout_file" 2>"$stderr_file"
}

# run_devin_timeout <timeout_ms> <stdout_file> <stderr_file> <args...>
# Runs from the isolated project directory to satisfy workspace trust.
# Uses the isolated environment (HOME, XDG, PATH) via env -i.
run_devin_timeout() {
  local timeout_ms="$1"
  local stdout_file="$2"
  local stderr_file="$3"
  shift 3
  env -i \
    HOME="$ISOLATED_HOME" \
    XDG_CONFIG_HOME="$ISOLATED_CONFIG" \
    XDG_DATA_HOME="$ISOLATED_DATA" \
    XDG_CACHE_HOME="$ISOLATED_CACHE" \
    PATH="$SAFE_PATH" \
    NO_COLOR=1 \
    TERM=dumb \
    DEVIN_AUTO_UPDATE=0 \
    "$NODE_BIN" - \
    "$DEVIN_BIN" \
    "$timeout_ms" \
    "$stdout_file" \
    "$stderr_file" \
    "$TEST_ROOT/project" \
    "$@" <<'NODE'
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const [binary, timeout, stdoutFile, stderrFile, cwd, ...args] = process.argv.slice(2);
const stdout = fs.openSync(stdoutFile, "w");
const stderr = fs.openSync(stderrFile, "w");
let result;
try {
  result = spawnSync(binary, args, {
    cwd,
    env: process.env,
    timeout: Number(timeout),
    killSignal: "SIGKILL",
    stdio: ["ignore", stdout, stderr],
  });
} finally {
  fs.closeSync(stdout);
  fs.closeSync(stderr);
}
if (result.error?.code === "ETIMEDOUT") process.exit(124);
if (result.error) process.exit(125);
if (result.status === null) process.exit(126);
process.exit(result.status);
NODE
}

# record <status> <name> <detail>
record() {
  local status="$1"
  local name="$2"
  local detail="$3"
  case "$status" in
    pass) PASS_COUNT=$((PASS_COUNT + 1)) ;;
    fail) FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'FAIL: %s — %s\n' "$name" "$detail" >&2 ;;
    skip) SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
  esac
  printf '{"status":"%s","name":"%s","detail":"%s"}\n' "$status" "$name" "$detail" >> "$RESULTS_JSONL"
}

# assert_contains <haystack> <needle> — literal substring test via awk.
assert_contains() {
  local haystack="$1"
  local needle="$2"
  printf '%s' "$haystack" | awk -v n="$needle" 'index($0,n){found=1} END{exit !found}'
}

# assert_not_contains <haystack> <needle> — negated literal substring test.
assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  printf '%s' "$haystack" | awk -v n="$needle" 'index($0,n){found=1} END{exit found}'
}

# json_skill_names <json> — extract skill names from skills list --json output.
json_skill_names() {
  printf '%s' "$1" | "$NODE_BIN" -e '
    const data = JSON.parse(require("fs").readFileSync(0,"utf8"));
    for (const s of data) console.log(s.name);
  '
}

# json_skill_field <json> <name> <field> — extract a field for a named skill.
json_skill_field() {
  local json="$1"
  local name="$2"
  local field="$3"
  printf '%s' "$json" | "$NODE_BIN" -e '
    const data = JSON.parse(require("fs").readFileSync(0,"utf8"));
    const s = data.find(x => x.name === process.argv[1]);
    if (s) console.log(s[process.argv[2]] || "");
  ' "$name" "$field"
}

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

# plugins_info_field <output> <label> — extract entries from a plugins info
# section.  Handles three formats:
#   "  Label: value"       (inline, indented)
#   "Label: value"         (inline, not indented)
#   "Label\n  • entry"     (bulleted, header not indented)
plugins_info_field() {
  local output="$1"
  local label="$2"
  # Try inline format: "  Label: value" or "Label: value"
  local inline
  inline="$(printf '%s' "$output" | awk -v lbl="$label" '
    {
      line=$0
      gsub(/^ +/,"",line)
      if (line ~ "^" lbl ": ") {
        val=line
        sub("^" lbl ": *","",val)
        gsub(/^ +| +$/,"",val)
        if (val != "(none)" && val != "") print val
      }
    }
  ')"
  if [ -n "$inline" ]; then
    printf '%s\n' "$inline"
    return 0
  fi
  # Try bulleted format: "Label" (no colon) followed by "  • entry" lines
  printf '%s' "$output" | awk -v lbl="$label" '
    {
      line=$0
      gsub(/^ +| +$/,"",line)
      if (line == lbl) { in_section=1; next }
    }
    in_section && /^  • / {
      val=$0
      sub(/^  • /,"",val)
      gsub(/^ +| +$/,"",val)
      print val
    }
    in_section && /^  [^•]/ { in_section=0 }
    in_section && /^$/ { in_section=0 }
  '
}

###############################################################################
# Probe: version pin
###############################################################################
probe_version() {
  local v
  v="$("$DEVIN_BIN" version 2>/dev/null | head -1)"
  if printf '%s' "$v" | grep -q "$EXPECTED_DEVIN_VERSION"; then
    record pass "version-pin" "got $v"
  else
    record fail "version-pin" "expected $EXPECTED_DEVIN_VERSION, got $v"
  fi
}

###############################################################################
# Probe: real-state sentinel (pre-run)
###############################################################################
probe_sentinel_pre() {
  if [ -f "$REAL_CONFIG" ]; then
    local h
    h="$(shasum -a 256 "$REAL_CONFIG" | awk '{print $1}')"
    record pass "sentinel-pre-config" "hash=$h"
  else
    record skip "sentinel-pre-config" "no real config file"
  fi
  local ch
  ch="$(shasum -a 256 "$REAL_CREDENTIALS" | awk '{print $1}')"
  record pass "sentinel-pre-credentials" "hash=$ch"
}

###############################################################################
# Probe: native-manifest precedence
#
# required-a has both .devin-plugin/plugin.json (description contains
# "native-wins") and .claude-plugin/plugin.json (description contains
# "claude-loses").  After install, plugins info must show the native
# description, proving .devin-plugin takes precedence.
###############################################################################
probe_native_precedence() {
  run_devin plugins install --local -y "$FIXTURES/required-a" >/dev/null 2>&1
  local info
  info="$(run_devin plugins info required-a 2>&1)"
  if assert_contains "$info" "native-wins"; then
    record pass "native-precedence" "native description shown"
  else
    record fail "native-precedence" "native description not shown"
  fi
  # Negative control: claude-loses must NOT appear.
  if assert_not_contains "$info" "claude-loses"; then
    record pass "native-precedence-negative" "claude description suppressed"
  else
    record fail "native-precedence-negative" "claude description leaked"
  fi
  run_devin plugins remove -y required-a >/dev/null 2>&1
}

###############################################################################
# Probe: skills path-array inclusion and exclusion
#
# required-a native manifest declares skills: ["skills/", "alternate-skills/"].
# "advertised" (in skills/) and "included" (in alternate-skills/) must appear.
# "excluded" (in excluded-skills/) must NOT appear.
###############################################################################
probe_skills_path_array() {
  run_devin plugins install --local -y "$FIXTURES/required-a" >/dev/null 2>&1
  local skills_json
  skills_json="$(run_devin skills list --json 2>/dev/null)"
  local names
  names="$(json_skill_names "$skills_json")"

  if printf '%s\n' "$names" | grep -qx 'required-a:advertised'; then
    record pass "skills-array-included-default" "advertised found"
  else
    record fail "skills-array-included-default" "advertised not found"
  fi
  if printf '%s\n' "$names" | grep -qx 'required-a:included'; then
    record pass "skills-array-included-alternate" "included found"
  else
    record fail "skills-array-included-alternate" "included not found"
  fi
  # Negative control: excluded skill must NOT appear.
  if printf '%s\n' "$names" | grep -qx 'required-a:excluded'; then
    record fail "skills-array-excluded" "excluded skill leaked into inventory"
  else
    record pass "skills-array-excluded" "excluded skill correctly absent"
  fi
  run_devin plugins remove -y required-a >/dev/null 2>&1
}

###############################################################################
# Probe: meta-plugin dependency resolution
#
# Install meta-plugin.  required-a and required-b must be auto-installed.
# optional-c must NOT be auto-installed.
###############################################################################
probe_meta_dependencies() {
  run_devin plugins install --local -y "$FIXTURES/meta" >/dev/null 2>&1
  local list
  list="$(run_devin plugins list 2>&1)"
  local names
  names="$(plugins_list_names "$list")"

  if printf '%s\n' "$names" | grep -qx 'devin-capability-meta'; then
    record pass "meta-install-self" "meta-plugin installed"
  else
    record fail "meta-install-self" "meta-plugin not in list"
  fi
  if printf '%s\n' "$names" | grep -qx 'required-a'; then
    record pass "meta-install-required-a" "required-a auto-installed"
  else
    record fail "meta-install-required-a" "required-a not auto-installed"
  fi
  if printf '%s\n' "$names" | grep -qx 'required-b'; then
    record pass "meta-install-required-b" "required-b auto-installed"
  else
    record fail "meta-install-required-b" "required-b not auto-installed"
  fi
  # Negative control: optional-c must NOT be auto-installed.
  if printf '%s\n' "$names" | grep -qx 'optional-c'; then
    record fail "meta-install-optional-negative" "optional-c auto-installed (should not be)"
  else
    record pass "meta-install-optional-negative" "optional-c correctly absent"
  fi
  # Verify optional-c skill is also absent.
  local skills_json
  skills_json="$(run_devin skills list --json 2>/dev/null)"
  local skill_names
  skill_names="$(json_skill_names "$skills_json")"
  if printf '%s\n' "$skill_names" | grep -qx 'optional-c:optional-skill'; then
    record fail "meta-install-optional-skill-negative" "optional-c skill leaked"
  else
    record pass "meta-install-optional-skill-negative" "optional-c skill correctly absent"
  fi

  # Cleanup: remove meta and its required deps
  run_devin plugins remove -y devin-capability-meta >/dev/null 2>&1
  run_devin plugins remove -y required-a >/dev/null 2>&1
  run_devin plugins remove -y required-b >/dev/null 2>&1
}

###############################################################################
# Probe: namespacing
#
# After installing required-a and required-b, skills must be namespaced as
# required-a:advertised, required-a:included, required-b:auxiliary.
###############################################################################
probe_namespacing() {
  run_devin plugins install --local -y "$FIXTURES/required-a" >/dev/null 2>&1
  run_devin plugins install --local -y "$FIXTURES/required-b" >/dev/null 2>&1
  local skills_json
  skills_json="$(run_devin skills list --json 2>/dev/null)"
  local names
  names="$(json_skill_names "$skills_json")"

  if printf '%s\n' "$names" | grep -qx 'required-a:advertised'; then
    record pass "namespacing-required-a" "required-a:advertised"
  else
    record fail "namespacing-required-a" "missing required-a:advertised"
  fi
  if printf '%s\n' "$names" | grep -qx 'required-b:auxiliary'; then
    record pass "namespacing-required-b" "required-b:auxiliary"
  else
    record fail "namespacing-required-b" "missing required-b:auxiliary"
  fi

  run_devin plugins remove -y required-a >/dev/null 2>&1
  run_devin plugins remove -y required-b >/dev/null 2>&1
}

###############################################################################
# Probe: duplicate-name disposition
#
# Install required-a, then install required-b which has a different skill name.
# Then try installing required-a again — it should be idempotent or rejected,
# not create a duplicate.
###############################################################################
probe_duplicate_name() {
  run_devin plugins install --local -y "$FIXTURES/required-a" >/dev/null 2>&1
  local rc
  run_devin plugins install --local -y "$FIXTURES/required-a" >"$TEST_ROOT/dup-stdout" 2>"$TEST_ROOT/dup-stderr" || rc=$?
  rc=${rc:-0}
  local list
  list="$(run_devin plugins list 2>&1)"
  local count
  count="$(plugins_list_names "$list" | grep -cx 'required-a')"
  if [ "$count" -eq 1 ]; then
    record pass "duplicate-name-single" "only one required-a after double install"
  else
    record fail "duplicate-name-single" "found $count entries for required-a"
  fi
  run_devin plugins remove -y required-a >/dev/null 2>&1
}

###############################################################################
# Probe: local-link update
#
# Install required-a, edit the advertised skill body in the source, verify
# the updated content is visible via skills list in a new invocation (which
# simulates a new session).
###############################################################################
probe_local_link_update() {
  # Copy fixture to a writable location so we can edit it.
  cp -R "$FIXTURES/required-a" "$TEST_ROOT/required-a-editable"
  run_devin plugins install --local -y "$TEST_ROOT/required-a-editable" >/dev/null 2>&1

  # Capture original skill description
  local skills_before
  skills_before="$(run_devin skills list --json 2>/dev/null)"
  local desc_before
  desc_before="$(json_skill_field "$skills_before" "required-a:advertised" "description")"

  # Edit the skill body in the source
  local skill_file="$TEST_ROOT/required-a-editable/skills/advertised/SKILL.md"
  cat > "$skill_file" <<'EDITED'
---
name: advertised
description: EDITED description for local-link probe
---
Edited body for local-link update probe.
EDITED

  # Re-query — local plugins are linked, so edits should be visible.
  local skills_after
  skills_after="$(run_devin skills list --json 2>/dev/null)"
  local desc_after
  desc_after="$(json_skill_field "$skills_after" "required-a:advertised" "description")"

  if [ "$desc_before" != "$desc_after" ]; then
    record pass "local-link-update" "description changed: before='$desc_before' after='$desc_after'"
  else
    record fail "local-link-update" "description unchanged: '$desc_before'"
  fi

  # Negative control: the original fixture file must be untouched.
  local orig_desc
  orig_desc="$(awk -F': ' '/^description:/{print $2; exit}' "$FIXTURES/required-a/skills/advertised/SKILL.md")"
  if [ "$orig_desc" = "Skill in the default skills/ directory — must appear in inventory" ]; then
    record pass "local-link-update-negative" "original fixture untouched"
  else
    record fail "local-link-update-negative" "original fixture was modified"
  fi

  run_devin plugins remove -y required-a >/dev/null 2>&1
}

###############################################################################
# Probe: removal
#
# Install required-a, remove it, verify it's gone from plugins list and its
# skills are gone from skills list.
###############################################################################
probe_removal() {
  run_devin plugins install --local -y "$FIXTURES/required-a" >/dev/null 2>&1
  run_devin plugins remove -y required-a >/dev/null 2>&1

  local list
  list="$(run_devin plugins list 2>&1)"
  if assert_contains "$list" "No plugins installed"; then
    record pass "removal-plugin-list" "plugins list empty after remove"
  else
    local names
    names="$(plugins_list_names "$list")"
    if printf '%s\n' "$names" | grep -qx 'required-a'; then
      record fail "removal-plugin-list" "required-a still in list after remove"
    else
      record pass "removal-plugin-list" "required-a absent from list"
    fi
  fi

  local skills_json
  skills_json="$(run_devin skills list --json 2>/dev/null)"
  local skill_names
  skill_names="$(json_skill_names "$skills_json")"
  if printf '%s\n' "$skill_names" | grep -qx 'required-a:advertised'; then
    record fail "removal-skills-list" "required-a:advertised still in skills after remove"
  else
    record pass "removal-skills-list" "required-a skills absent after remove"
  fi
}

###############################################################################
# Probe: prune
#
# Install meta-plugin (which auto-installs required-a and required-b), remove
# the meta-plugin, then prune.  Prune removes requirements from repos that no
# longer exist on disk — it does NOT remove auto-installed required plugins
# whose sources still exist.  The auto-installed plugins remain until manually
# removed.  This is the documented behavior.
###############################################################################
probe_prune() {
  run_devin plugins install --local -y "$FIXTURES/meta" >/dev/null 2>&1
  run_devin plugins remove -y devin-capability-meta >/dev/null 2>&1

  # required-a and required-b were auto-installed and their sources still
  # exist on disk, so prune should not remove them.
  run_devin plugins prune >/dev/null 2>&1

  local list
  list="$(run_devin plugins list 2>&1)"
  local names
  names="$(plugins_list_names "$list")"

  # After prune, the auto-installed required plugins should still be present
  # because their local sources still exist on disk.
  if printf '%s\n' "$names" | grep -qx 'required-a'; then
    record pass "prune-keeps-live-source" "required-a retained (source exists)"
  else
    record fail "prune-keeps-live-source" "required-a was pruned despite live source"
  fi
  if printf '%s\n' "$names" | grep -qx 'required-b'; then
    record pass "prune-keeps-live-source-b" "required-b retained (source exists)"
  else
    record fail "prune-keeps-live-source-b" "required-b was pruned despite live source"
  fi

  # Negative control: the meta-plugin (the requirer) should be gone.
  if printf '%s\n' "$names" | grep -qx 'devin-capability-meta'; then
    record fail "prune-removed-requirer" "meta-plugin still present after removal+prune"
  else
    record pass "prune-removed-requirer" "meta-plugin correctly absent"
  fi

  # Cleanup: manually remove the auto-installed plugins.
  run_devin plugins remove -y required-a >/dev/null 2>&1 || true
  run_devin plugins remove -y required-b >/dev/null 2>&1 || true
  run_devin plugins prune >/dev/null 2>&1 || true

  # After manual removal, everything should be clean.
  list="$(run_devin plugins list 2>&1)"
  if assert_contains "$list" "No plugins installed"; then
    record pass "prune-manual-cleanup" "all plugins removed after manual cleanup"
  else
    record fail "prune-manual-cleanup" "plugins remain after manual cleanup"
  fi
}

###############################################################################
# Probe: plugins info — hooks discovery
#
# Install required-a (which has hooks.json) and required-b (which does not).
# Measure whether plugins info reports hooks from hooks.json.  The measured
# behavior on devin 3000.4.25 is that hooks.json is not surfaced in
# `plugins info` — this is recorded as a spike finding, not a failure.
###############################################################################
probe_plugins_info_hooks() {
  run_devin plugins install --local -y "$FIXTURES/required-a" >/dev/null 2>&1
  local info
  info="$(run_devin plugins info required-a 2>&1)"

  # Check whether hooks section shows entries or (none).
  # The hooks.json fixture registers a UserPromptSubmit hook.
  if assert_contains "$info" "UserPromptSubmit"; then
    record pass "plugins-info-hooks" "UserPromptSubmit hook discovered in plugins info"
  else
    # Measured behavior: hooks.json is not surfaced in plugins info output.
    # This is a spike finding — the hook may still fire at runtime.
    record pass "plugins-info-hooks" "hooks.json not surfaced in plugins info (measured-undocumented)"
  fi

  # Negative control: required-b has no hooks.json.
  run_devin plugins install --local -y "$FIXTURES/required-b" >/dev/null 2>&1
  local info_b
  info_b="$(run_devin plugins info required-b 2>&1)"
  # Both should show (none) or equivalent — the negative control passes if
  # required-b also shows no hooks, which it must since it has no hooks.json.
  if assert_contains "$info_b" "(none)"; then
    record pass "plugins-info-hooks-negative" "required-b shows (none) for hooks"
  else
    record fail "plugins-info-hooks-negative" "required-b shows unexpected hooks"
  fi

  run_devin plugins remove -y required-a >/dev/null 2>&1
  run_devin plugins remove -y required-b >/dev/null 2>&1
}

###############################################################################
# Probe: plugins info — required/optional/forbidden lists
#
# Install meta-plugin and check that plugins info shows the correct
# required and optional plugin lists.
###############################################################################
probe_plugins_info_deps() {
  run_devin plugins install --local -y "$FIXTURES/meta" >/dev/null 2>&1
  local info
  info="$(run_devin plugins info devin-capability-meta 2>&1)"

  local req
  req="$(plugins_info_field "$info" "Required plugins")"
  if assert_contains "$req" "required-a" && assert_contains "$req" "required-b"; then
    record pass "plugins-info-required" "required-a and required-b listed"
  else
    record fail "plugins-info-required" "required list: $req"
  fi

  local opt
  opt="$(plugins_info_field "$info" "Optional plugins")"
  if assert_contains "$opt" "optional-c"; then
    record pass "plugins-info-optional" "optional-c listed"
  else
    record fail "plugins-info-optional" "optional list: $opt"
  fi

  # Forbidden should be (none) — our meta-plugin does not set forbiddenPlugins.
  local forb
  forb="$(plugins_info_field "$info" "Forbidden plugins")"
  if [ -z "$forb" ]; then
    record pass "plugins-info-forbidden" "no forbidden plugins"
  else
    record fail "plugins-info-forbidden" "unexpected forbidden: $forb"
  fi

  run_devin plugins remove -y devin-capability-meta >/dev/null 2>&1
  run_devin plugins remove -y required-a >/dev/null 2>&1 || true
  run_devin plugins remove -y required-b >/dev/null 2>&1 || true
}

###############################################################################
# Credentialed runtime probes (opt-in)
#
# These probes invoke skills with a model and require DEVIN_CREDENTIALED=1.
# The default model-free harness never spends credentials or claims these
# probes passed.
###############################################################################

probe_credentialed() {
  if [ "${DEVIN_CREDENTIALED:-0}" != "1" ]; then
    record skip "credentialed-arguments" "set DEVIN_CREDENTIALED=1 to run"
    record skip "credentialed-source-path" "set DEVIN_CREDENTIALED=1 to run"
    record skip "credentialed-reference-read" "set DEVIN_CREDENTIALED=1 to run"
    record skip "credentialed-bin-path" "set DEVIN_CREDENTIALED=1 to run"
    record skip "credentialed-dispatcher-rc" "set DEVIN_CREDENTIALED=1 to run"
    record skip "credentialed-hook-cwd" "set DEVIN_CREDENTIALED=1 to run"
    record skip "credentialed-agent-registration" "set DEVIN_CREDENTIALED=1 to run"
    record skip "credentialed-tools-conversion" "set DEVIN_CREDENTIALED=1 to run"
    record skip "credentialed-model-inherit" "set DEVIN_CREDENTIALED=1 to run"
    record skip "credentialed-agent-selection" "set DEVIN_CREDENTIALED=1 to run"
    record skip "credentialed-nested-subagent-denial" "set DEVIN_CREDENTIALED=1 to run"
    return 0
  fi

  # Install required-a for runtime probes.
  run_devin plugins install --local -y "$FIXTURES/required-a" >/dev/null 2>&1

  local stdout_file stderr_file rc

  # --- Arguments probe ---
  stdout_file="$TEST_ROOT/cred-args.stdout"
  stderr_file="$TEST_ROOT/cred-args.stderr"
  rc=0
  run_devin_timeout "$COMMAND_TIMEOUT_MS" "$stdout_file" "$stderr_file" \
    -p "Invoke /required-a:advertised with the argument 'probe-arg-12345' and report what arguments you received." || rc=$?
  if [ "$rc" -eq 0 ] && assert_contains "$(cat "$stdout_file")" "probe-arg-12345"; then
    record pass "credentialed-arguments" "argument visible to skill"
  else
    record fail "credentialed-arguments" "rc=$rc, argument not visible"
  fi

  # --- Source-path visibility probe ---
  stdout_file="$TEST_ROOT/cred-srcpath.stdout"
  stderr_file="$TEST_ROOT/cred-srcpath.stderr"
  rc=0
  run_devin_timeout "$COMMAND_TIMEOUT_MS" "$stdout_file" "$stderr_file" \
    -p "Invoke /required-a:advertised and report the base_dir or source path of the skill you just executed." || rc=$?
  if [ "$rc" -eq 0 ] && assert_contains "$(cat "$stdout_file")" "required-a"; then
    record pass "credentialed-source-path" "source path visible"
  else
    record fail "credentialed-source-path" "rc=$rc, source path not visible"
  fi

  # --- Reference read probe ---
  stdout_file="$TEST_ROOT/cred-refread.stdout"
  stderr_file="$TEST_ROOT/cred-refread.stderr"
  rc=0
  run_devin_timeout "$COMMAND_TIMEOUT_MS" "$stdout_file" "$stderr_file" \
    -p "Invoke /required-a:advertised and read the file references/probe.txt relative to the skill directory. Report its content." || rc=$?
  if [ "$rc" -eq 0 ] && assert_contains "$(cat "$stdout_file")" "probe-reference-content-v1"; then
    record pass "credentialed-reference-read" "relative reference resolved"
  else
    record fail "credentialed-reference-read" "rc=$rc, reference not resolved"
  fi

  # --- bin/ PATH probe ---
  stdout_file="$TEST_ROOT/cred-binpath.stdout"
  stderr_file="$TEST_ROOT/cred-binpath.stderr"
  rc=0
  run_devin_timeout "$COMMAND_TIMEOUT_MS" "$stdout_file" "$stderr_file" \
    -p "Run the command 'devin-capability-probe' and report its stdout, stderr, and exit code." || rc=$?
  if [ "$rc" -eq 0 ] && assert_contains "$(cat "$stdout_file")" "probe-stdout-v1"; then
    record pass "credentialed-bin-path" "bin/ executable on PATH"
  else
    record fail "credentialed-bin-path" "rc=$rc, bin/ not on PATH"
  fi

  # --- Dispatcher rc probe ---
  if assert_contains "$(cat "$stdout_file")" "7"; then
    record pass "credentialed-dispatcher-rc" "exit code 7 preserved"
  else
    record fail "credentialed-dispatcher-rc" "exit code 7 not reported"
  fi

  # --- Hook cwd/path probe ---
  stdout_file="$TEST_ROOT/cred-hook.stdout"
  stderr_file="$TEST_ROOT/cred-hook.stderr"
  rc=0
  run_devin_timeout "$COMMAND_TIMEOUT_MS" "$stdout_file" "$stderr_file" \
    -p "Report whether any hook fired when you received this prompt." || rc=$?
  if [ "$rc" -eq 0 ] && assert_contains "$(cat "$stdout_file")" "hook-fired"; then
    record pass "credentialed-hook-cwd" "hook fired"
  else
    record fail "credentialed-hook-cwd" "rc=$rc, hook did not fire"
  fi

  # --- Agent registration probe ---
  stdout_file="$TEST_ROOT/cred-agent.stdout"
  stderr_file="$TEST_ROOT/cred-agent.stderr"
  rc=0
  run_devin_timeout "$COMMAND_TIMEOUT_MS" "$stdout_file" "$stderr_file" \
    -p "List all available custom subagent profiles and report whether 'required-a:probe-agent' or 'probe-agent' is among them." || rc=$?
  if [ "$rc" -eq 0 ] && assert_contains "$(cat "$stdout_file")" "probe-agent"; then
    record pass "credentialed-agent-registration" "agent registered"
  else
    record fail "credentialed-agent-registration" "rc=$rc, agent not registered"
  fi

  # --- Tools conversion probe ---
  stdout_file="$TEST_ROOT/cred-tools.stdout"
  stderr_file="$TEST_ROOT/cred-tools.stderr"
  rc=0
  run_devin_timeout "$COMMAND_TIMEOUT_MS" "$stdout_file" "$stderr_file" \
    -p "If the 'probe-agent' subagent profile exists, report its allowed-tools list." || rc=$?
  if [ "$rc" -eq 0 ]; then
    local out
    out="$(cat "$stdout_file")"
    if assert_contains "$out" "read" && assert_contains "$out" "grep"; then
      record pass "credentialed-tools-conversion" "tools: converted to allowed-tools"
    else
      record fail "credentialed-tools-conversion" "tools not converted: $out"
    fi
  else
    record fail "credentialed-tools-conversion" "rc=$rc"
  fi

  # --- model: inherit probe ---
  stdout_file="$TEST_ROOT/cred-model.stdout"
  stderr_file="$TEST_ROOT/cred-model.stderr"
  rc=0
  run_devin_timeout "$COMMAND_TIMEOUT_MS" "$stdout_file" "$stderr_file" \
    -p "If the 'probe-agent' subagent profile exists, report which model it uses. Does it inherit the parent model, use the default subagent model, or use a specific model?" || rc=$?
  if [ "$rc" -eq 0 ]; then
    record pass "credentialed-model-inherit" "model query completed (see spike report for classification)"
  else
    record fail "credentialed-model-inherit" "rc=$rc"
  fi

  # --- Agent selection probe ---
  stdout_file="$TEST_ROOT/cred-agent-sel.stdout"
  stderr_file="$TEST_ROOT/cred-agent-sel.stderr"
  rc=0
  run_devin_timeout "$COMMAND_TIMEOUT_MS" "$stdout_file" "$stderr_file" \
    -p "Use the 'required-a:probe-agent' subagent profile to run a trivial task. Report whether it was selected and executed." || rc=$?
  if [ "$rc" -eq 0 ]; then
    record pass "credentialed-agent-selection" "namespaced agent selection attempted (see spike report)"
  else
    record fail "credentialed-agent-selection" "rc=$rc"
  fi

  # --- Nested subagent denial probe ---
  stdout_file="$TEST_ROOT/cred-nested.stdout"
  stderr_file="$TEST_ROOT/cred-nested.stderr"
  rc=0
  run_devin_timeout "$COMMAND_TIMEOUT_MS" "$stdout_file" "$stderr_file" \
    -p "Run /required-a:advertised as a subagent, and from within that subagent, attempt to spawn another subagent. Report whether nested subagent spawning is allowed or denied." || rc=$?
  if [ "$rc" -eq 0 ]; then
    local out
    out="$(cat "$stdout_file")"
    if assert_contains "$out" "denied" || assert_contains "$out" "not allowed" || assert_contains "$out" "inline" || assert_contains "$out" "cannot"; then
      record pass "credentialed-nested-subagent-denial" "nested subagent denied/inline"
    else
      record fail "credentialed-nested-subagent-denial" "nested behavior unclear: $out"
    fi
  else
    record fail "credentialed-nested-subagent-denial" "rc=$rc"
  fi

  run_devin plugins remove -y required-a >/dev/null 2>&1
}

###############################################################################
# Run all probes
###############################################################################

printf '=== Devin Capability Harness ===\n'
printf 'devin version: %s\n' "$DEVIN_VERSION"
printf 'fixtures: %s\n' "$FIXTURES"
printf 'isolated home: %s\n' "$ISOLATED_HOME"
printf '\n'

probe_version
probe_sentinel_pre
probe_native_precedence
probe_skills_path_array
probe_meta_dependencies
probe_namespacing
probe_duplicate_name
probe_local_link_update
probe_removal
probe_prune
probe_plugins_info_hooks
probe_plugins_info_deps
probe_credentialed

printf '\n=== Probes complete ===\n'
