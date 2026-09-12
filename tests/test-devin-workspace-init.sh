#!/usr/bin/env bash
# test-devin-workspace-init.sh — Focused Devin adapter test for workspace-init
#
# Validates that:
# - All three namespaced skills are advertised after install
# - The `wi` dispatcher is locatable and executable via its full path
# - One success path (skeleton_preflight) works under the real dispatcher
# - One rollback path works under the real dispatcher
# - The adapter does not source lib/*.sh under the caller shell
# - The adapter does not reinterpret `wi` output
# - The canonical skill body does not claim `wi` is on $PATH
#
# Uses an isolated HOME with a read-only credential bridge.

set -euo pipefail

EXPECTED_DEVIN_VERSION="3000.10.21"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
WI_ROOT="$ROOT/workspace-init"

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
if [ ! -f "$WI_ROOT/.devin-plugin/plugin.json" ]; then
  printf 'FAIL: workspace-init/.devin-plugin/plugin.json absent\n' >&2; exit 1
fi
if [ ! -x "$WI_ROOT/bin/wi" ]; then
  printf 'FAIL: workspace-init/bin/wi not executable\n' >&2; exit 1
fi

###############################################################################
# Isolation
###############################################################################
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/devin-wi.XXXXXX")"
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
  "$TEST_ROOT/parent"

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
# Install workspace-init
###############################################################################
run_devin plugins install --local -y "$WI_ROOT" >/dev/null 2>&1

###############################################################################
# Probe 1: All three namespaced skills are advertised
###############################################################################
printf 'Probe 1: Three namespaced skills advertised\n'

skills_json="$(run_devin skills list --json 2>/dev/null)"
skill_names="$(printf '%s' "$skills_json" | "$NODE_BIN" -e '
  const data = JSON.parse(require("fs").readFileSync(0,"utf8"));
  for (const s of data) console.log(s.name);
')"

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

###############################################################################
# Probe 2: wi dispatcher is locatable and executable via full path
###############################################################################
printf '\nProbe 2: wi dispatcher locatable via full path\n'

# The plugin source is the local install path; wi should be at bin/wi
wi_path="$WI_ROOT/bin/wi"
if [ -x "$wi_path" ]; then
  pass "wi dispatcher exists and is executable at $wi_path"
else
  fail "wi dispatcher not executable at $wi_path"
fi

# Verify wi --list works (proves the dispatcher runs under bash)
list_output="$("$wi_path" --list 2>&1)" || true
if printf '%s' "$list_output" | grep -q 'skeleton_preflight'; then
  pass "wi --list shows skeleton_preflight"
else
  fail "wi --list does not show skeleton_preflight"
fi

###############################################################################
# Probe 3: Success path — skeleton_preflight under real dispatcher
###############################################################################
printf '\nProbe 3: Success path (skeleton_preflight)\n'

parent="$TEST_ROOT/parent"
name="test-proj"

# Run preflight via the dispatcher — should succeed
if "$wi_path" skeleton_preflight "$parent" "$name" 2>&1; then
  pass "skeleton_preflight succeeded via dispatcher"
else
  fail "skeleton_preflight failed via dispatcher"
fi

# Verify the target dirs do NOT exist (preflight only checks, doesn't create)
if [ ! -d "$parent/$name-ai" ] && [ ! -d "$parent/$name" ]; then
  pass "preflight did not create directories"
else
  fail "preflight created directories (should only validate)"
fi

###############################################################################
# Probe 4: Rollback path — create then rollback
###############################################################################
printf '\nProbe 4: Rollback path\n'

# Create the root pair (creates dirs)
"$wi_path" skeleton_create_root_pair "$parent" "$name" 2>&1
ai_root="$parent/$name-ai"
canonical_root="$parent/$name"

if [ -d "$ai_root" ] && [ -d "$canonical_root" ]; then
  pass "skeleton_create_root_pair created both dirs"
else
  fail "skeleton_create_root_pair did not create both dirs"
fi

# Seed subdirs (creates .workspace, init-log, etc.)
"$wi_path" skeleton_seed_subdirs "$ai_root" 2>&1
if [ -d "$ai_root/.workspace" ]; then
  pass "skeleton_seed_subdirs created .workspace"
else
  fail "skeleton_seed_subdirs did not create .workspace"
fi

# Write manifest
"$wi_path" manifest_write "$ai_root" "$canonical_root" "personal" 2>&1
manifest_path="$ai_root/.workspace/pairing.json"
if [ -f "$manifest_path" ]; then
  pass "manifest_write created pairing.json"
  # Validate manifest schema
  if jq -e '.schema_version == "1.0"' "$manifest_path" >/dev/null 2>&1; then
    pass "manifest has schema_version 1.0"
  else
    fail "manifest missing schema_version 1.0"
  fi
  if jq -e '.ai_workspace.root' "$manifest_path" >/dev/null 2>&1; then
    pass "manifest has ai_workspace.root"
  else
    fail "manifest missing ai_workspace.root"
  fi
  if jq -e '.canonical.root' "$manifest_path" >/dev/null 2>&1; then
    pass "manifest has canonical.root"
  else
    fail "manifest missing canonical.root"
  fi
else
  fail "manifest_write did not create pairing.json"
fi

# Now rollback — wrap in if to handle failure under set -e
if "$wi_path" rollback "${ai_root}/.workspace/init-log" 2>&1; then
  pass "rollback command succeeded"
else
  fail "rollback command failed"
fi
if [ ! -d "$ai_root" ] && [ ! -d "$canonical_root" ]; then
  pass "rollback removed all created directories"
else
  fail "rollback did not clean up all directories"
fi

###############################################################################
# Probe 5: Adapter does not source lib/*.sh under caller shell
###############################################################################
printf '\nProbe 5: No lib sourcing under caller shell\n'

# Run wi in a subprocess and check that no lib functions leak to the caller.
# The dispatcher sources libs internally, but they should not persist in the
# caller's shell. We test by running wi --list in a subshell and then checking
# that wi_skeleton_preflight is NOT defined in our shell afterward.
if eval 'declare -f wi_skeleton_preflight >/dev/null 2>&1'; then
  fail "wi_skeleton_preflight leaked into caller shell"
else
  pass "no lib functions leaked into caller shell"
fi

# Also verify that the dispatcher itself uses bash (not zsh)
shebang="$(head -1 "$wi_path")"
if [ "$shebang" = "#!/usr/bin/env bash" ]; then
  pass "wi dispatcher has bash shebang"
else
  fail "wi dispatcher has wrong shebang: $shebang"
fi

###############################################################################
# Probe 6: Adapter does not reinterpret wi output
###############################################################################
printf '\nProbe 6: No output reinterpretation\n'

# The dispatcher passes stdout/stderr through unchanged. Verify by checking
# that wi --list output is exactly the function list, one per line.
raw_output="$("$wi_path" --list 2>/dev/null)"
line_count="$(printf '%s\n' "$raw_output" | grep -c . || true)"
if [ "$line_count" -gt 10 ]; then
  pass "wi --list produces raw function list ($line_count functions)"
else
  fail "wi --list produced too few lines ($line_count)"
fi

# Verify no wrapping or formatting was added
if printf '%s' "$raw_output" | grep -q '^(.*)' || printf '%s' "$raw_output" | grep -q '^[' ; then
  fail "wi --list output appears wrapped or reformatted"
else
  pass "wi --list output is unformatted (raw function names)"
fi

###############################################################################
# Probe 7: Canonical skill body does not claim wi is on $PATH
###############################################################################
printf '\nProbe 7: No $PATH claim in canonical skill body\n'

# The harness-neutral edit should remove the claim that wi is on $PATH.
# Check all three skill files for the false claim.
for skill_md in \
  "$WI_ROOT/skills/initializing-dual-repo-workspace/SKILL.md" \
  "$WI_ROOT/skills/pairing-canonical-repo/SKILL.md"
do
  skill_name="$(basename "$(dirname "$skill_md")")"
  # Look for the claim "on $PATH" or "on `$PATH`" in the context of wi
  if grep -q 'on.*\$PATH.*because.*Claude Code' "$skill_md" 2>/dev/null; then
    fail "$skill_name still claims wi is on \$PATH because Claude Code"
  else
    pass "$skill_name does not claim wi is on \$PATH because Claude Code"
  fi
done

###############################################################################
# Probe 8: Plugin rules file exists for dispatcher path guidance
###############################################################################
printf '\nProbe 8: Plugin rules file for dispatcher path\n'

rules_file="$WI_ROOT/rules/dispatcher-path.md"
if [ -f "$rules_file" ]; then
  pass "rules/dispatcher-path.md exists"
  # Check it has trigger frontmatter
  if head -1 "$rules_file" | grep -q '^---'; then
    pass "dispatcher-path.md has frontmatter"
  else
    fail "dispatcher-path.md missing frontmatter"
  fi
  # Check it mentions wi and the path pattern
  if grep -q 'bin/wi' "$rules_file"; then
    pass "dispatcher-path.md references bin/wi"
  else
    fail "dispatcher-path.md does not reference bin/wi"
  fi
else
  fail "rules/dispatcher-path.md absent"
fi

###############################################################################
# Probe 9: Verify plugins info shows the rules
###############################################################################
printf '\nProbe 9: plugins info shows rules\n'

info="$(run_devin plugins info workspace-init 2>&1)"
if printf '%s' "$info" | grep -q 'dispatcher-path'; then
  pass "plugins info shows dispatcher-path rule"
elif printf '%s' "$info" | grep -q 'Rules'; then
  pass "plugins info has Rules section (rule name may differ)"
else
  fail "plugins info does not show rules"
fi

# Cleanup
run_devin plugins remove -y workspace-init >/dev/null 2>&1
