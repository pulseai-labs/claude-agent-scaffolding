#!/usr/bin/env bash
set -euo pipefail

EXPECTED_OPENCODE_VERSION="1.18.13"
COMMAND_TIMEOUT_MS=60000

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
OPENCODE_BIN="$(command -v opencode || true)"
NODE_BIN="$(command -v node || true)"

if [ -z "$OPENCODE_BIN" ]; then
  printf 'FAIL: opencode is required\n' >&2
  exit 1
fi
if [ -z "$NODE_BIN" ]; then
  printf 'FAIL: node is required\n' >&2
  exit 1
fi

PACKAGE_SPEC="$("$NODE_BIN" -e \
  'process.stdout.write(require("node:url").pathToFileURL(process.argv[1]).href)' \
  "$ROOT")"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/opencode-live.XXXXXX")"
TEST_ROOT="$(cd "$TEST_ROOT" && pwd -P)"
trap 'rm -rf "$TEST_ROOT"' EXIT HUP INT TERM

SAFE_PATH="${OPENCODE_BIN%/*}:${NODE_BIN%/*}:/usr/local/bin:/usr/bin:/bin"

print_file() {
  local file="$1"
  while IFS= read -r line || [ -n "$line" ]; do
    printf '  %s\n' "$line" >&2
  done < "$file"
}

print_command_failure() {
  local label="$1"
  local status="$2"
  local stdout_file="$3"
  local stderr_file="$4"

  printf 'FAIL: %s (exit %s)\n' "$label" "$status" >&2
  printf 'stdout:\n' >&2
  print_file "$stdout_file"
  printf 'stderr:\n' >&2
  print_file "$stderr_file"
}

seed_opencode_directory() {
  local directory="$1"
  mkdir -p "$directory/node_modules"
  printf '%s\n' \
    '{"dependencies":{"@opencode-ai/plugin":"1.18.13"}}' \
    > "$directory/package.json"
  printf '%s\n' \
    '{"lockfileVersion":3,"packages":{"":{"dependencies":{"@opencode-ai/plugin":"1.18.13"}}}}' \
    > "$directory/package-lock.json"
}

prepare_case() {
  local case_root="$1"
  local selection="$2"

  mkdir -p \
    "$case_root/home" \
    "$case_root/config/opencode" \
    "$case_root/data" \
    "$case_root/cache/npm" \
    "$case_root/state" \
    "$case_root/tmp" \
    "$case_root/project" \
    "$case_root/config-dir" \
    "$case_root/managed-empty" \
    "$case_root/managed-contamination" \
    "$case_root/bin"

  seed_opencode_directory "$case_root/config/opencode"
  seed_opencode_directory "$case_root/config-dir"

  printf '%s\n' '#!/bin/sh' 'exit 1' > "$case_root/bin/plutil"
  chmod +x "$case_root/bin/plutil"
  printf '%s\n' '{}' > "$case_root/config/tui.json"
  printf '%s\n' \
    '{"provider":{"managed-poison":{"models":{"poison":{}}}},"model":"managed-poison/poison","permission":"deny","plugin":["managed-poison-plugin"],"agent":{"managed-poison-agent":{"description":"managed contamination","mode":"subagent","prompt":"managed contamination"}},"skills":{"paths":["/managed-poison/skills"]}}' \
    > "$case_root/managed-contamination/opencode.json"

  "$NODE_BIN" - "$case_root/config/opencode-test.json" "$PACKAGE_SPEC" "$selection" <<'NODE'
const fs = require("node:fs");

const [file, spec, selection] = process.argv.slice(2);
const plugins = ["workspace-init", "ai-mentor", "architect-critic", "ossify"];
const plugin = selection === "default" ? [spec] : [[spec, { plugins }]];
fs.writeFileSync(
  file,
  JSON.stringify({ autoupdate: false, share: "disabled", plugin }) + "\n",
);
NODE
}

run_opencode_with_timeout() {
  local case_root="$1"
  local stdout_file="$2"
  local stderr_file="$3"
  local timeout_ms="$4"
  shift 4

  env -i \
    HOME="$case_root/home" \
    XDG_CONFIG_HOME="$case_root/config" \
    XDG_DATA_HOME="$case_root/data" \
    XDG_CACHE_HOME="$case_root/cache" \
    XDG_STATE_HOME="$case_root/state" \
    TMPDIR="$case_root/tmp" \
    OPENCODE_TEST_HOME="$case_root/home" \
    OPENCODE_TEST_MANAGED_CONFIG_DIR="$case_root/managed-empty" \
    OPENCODE_CONFIG="$case_root/config/opencode-test.json" \
    OPENCODE_CONFIG_DIR="$case_root/config-dir" \
    OPENCODE_CONFIG_CONTENT='{"autoupdate":false,"share":"disabled"}' \
    OPENCODE_TUI_CONFIG="$case_root/config/tui.json" \
    OPENCODE_DB="$case_root/state/opencode.db" \
    OPENCODE_DISABLE_PROJECT_CONFIG=1 \
    OPENCODE_DISABLE_DEFAULT_PLUGINS=1 \
    OPENCODE_DISABLE_EXTERNAL_SKILLS=1 \
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1 \
    OPENCODE_DISABLE_AUTOUPDATE=1 \
    OPENCODE_DISABLE_MODELS_FETCH=1 \
    OPENCODE_CLIENT=cli \
    NPM_CONFIG_OFFLINE=true \
    npm_config_offline=true \
    npm_config_cache="$case_root/cache/npm" \
    GIT_CONFIG_GLOBAL=/dev/null \
    GIT_CONFIG_SYSTEM=/dev/null \
    GIT_CONFIG_NOSYSTEM=1 \
    CI=1 \
    NO_COLOR=1 \
    TERM=dumb \
    PATH="$case_root/bin:$SAFE_PATH" \
    "$NODE_BIN" - \
      "$OPENCODE_BIN" \
      "$case_root/project" \
      "$timeout_ms" \
      "$stdout_file" \
      "$stderr_file" \
      "$@" <<'NODE'
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const [binary, cwd, timeout, stdoutFile, stderrFile, ...args] =
  process.argv.slice(2);
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
if (result.error) fs.appendFileSync(stderrFile, `${result.error.message}\n`);

if (result.error?.code === "ETIMEDOUT") process.exit(124);
if (result.error) process.exit(125);
if (result.status === null) process.exit(126);
process.exit(result.status);
NODE
}

run_opencode() {
  local case_root="$1"
  local stdout_file="$2"
  local stderr_file="$3"
  shift 3
  run_opencode_with_timeout \
    "$case_root" "$stdout_file" "$stderr_file" "$COMMAND_TIMEOUT_MS" "$@"
}

capture_success() {
  local label="$1"
  local output="$2"
  local case_root="$3"
  local error="$output.stderr"
  local status
  shift 3

  if run_opencode "$case_root" "$output" "$error" "$@"; then
    status=0
  else
    status=$?
    print_command_failure "$label" "$status" "$output" "$error"
    exit 1
  fi
  if [ -s "$error" ]; then
    print_command_failure "$label wrote unexpected stderr" "$status" "$output" "$error"
    exit 1
  fi
}

DEFAULT_CASE="$TEST_ROOT/default"
ALL_CASE="$TEST_ROOT/all"
prepare_case "$DEFAULT_CASE" default
prepare_case "$ALL_CASE" all

printf '%s\n' '#!/bin/sh' "trap '' TERM" 'exec sleep 3' \
  > "$TEST_ROOT/ignore-term.sh"
chmod +x "$TEST_ROOT/ignore-term.sh"

capture_success "default: opencode --version" \
  "$TEST_ROOT/version.txt" "$DEFAULT_CASE" --version
ACTUAL_VERSION="$(tr -d '[:space:]' < "$TEST_ROOT/version.txt")"
if [ "$ACTUAL_VERSION" != "$EXPECTED_OPENCODE_VERSION" ]; then
  printf 'FAIL: expected OpenCode %s, got %s\n' \
    "$EXPECTED_OPENCODE_VERSION" "$ACTUAL_VERSION" >&2
  exit 1
fi

TIMEOUT_RC=0
if run_opencode_with_timeout \
  "$DEFAULT_CASE" \
  "$TEST_ROOT/timeout.stdout" \
  "$TEST_ROOT/timeout.stderr" \
  100 \
  debug wait; then
  printf 'FAIL: default: debug wait did not time out\n' >&2
  exit 1
else
  TIMEOUT_RC=$?
fi
if [ "$TIMEOUT_RC" -ne 124 ]; then
  print_command_failure \
    "default: debug wait timeout control" \
    "$TIMEOUT_RC" \
    "$TEST_ROOT/timeout.stdout" \
    "$TEST_ROOT/timeout.stderr"
  exit 1
fi

HARD_TIMEOUT_START="$("$NODE_BIN" -e 'process.stdout.write(String(Date.now()))')"
HARD_TIMEOUT_RC=0
if (
  OPENCODE_BIN="$TEST_ROOT/ignore-term.sh"
  run_opencode_with_timeout \
    "$DEFAULT_CASE" \
    "$TEST_ROOT/hard-timeout.stdout" \
    "$TEST_ROOT/hard-timeout.stderr" \
    500
); then
  printf 'FAIL: SIGTERM-ignoring timeout control unexpectedly succeeded\n' >&2
  exit 1
else
  HARD_TIMEOUT_RC=$?
fi
HARD_TIMEOUT_END="$("$NODE_BIN" -e 'process.stdout.write(String(Date.now()))')"
HARD_TIMEOUT_ELAPSED=$((HARD_TIMEOUT_END - HARD_TIMEOUT_START))
if [ "$HARD_TIMEOUT_RC" -ne 124 ] || [ "$HARD_TIMEOUT_ELAPSED" -ge 1500 ]; then
  print_command_failure \
    "SIGTERM-ignoring timeout control (${HARD_TIMEOUT_ELAPSED}ms, expected <1500ms)" \
    "$HARD_TIMEOUT_RC" \
    "$TEST_ROOT/hard-timeout.stdout" \
    "$TEST_ROOT/hard-timeout.stderr"
  exit 1
fi

capture_success "default: debug paths" \
  "$TEST_ROOT/default-paths.txt" "$DEFAULT_CASE" debug paths
capture_success "default: debug config" \
  "$TEST_ROOT/default-config.json" "$DEFAULT_CASE" debug config
capture_success "default: debug skill" \
  "$TEST_ROOT/default-skills.json" "$DEFAULT_CASE" debug skill

DEFAULT_AGENT_RC=0
if run_opencode \
  "$DEFAULT_CASE" \
  "$TEST_ROOT/default-agent.stdout" \
  "$TEST_ROOT/default-agent.stderr" \
  debug agent ossify-implementer-agent; then
  print_command_failure \
    "default: debug agent unexpectedly found Ossify agent" \
    0 \
    "$TEST_ROOT/default-agent.stdout" \
    "$TEST_ROOT/default-agent.stderr"
  exit 1
else
  DEFAULT_AGENT_RC=$?
fi
if [ "$DEFAULT_AGENT_RC" -ne 1 ]; then
  print_command_failure \
    "default: debug agent missing-agent expectation" \
    "$DEFAULT_AGENT_RC" \
    "$TEST_ROOT/default-agent.stdout" \
    "$TEST_ROOT/default-agent.stderr"
  exit 1
fi

capture_success "all-four: debug paths" \
  "$TEST_ROOT/all-paths.txt" "$ALL_CASE" debug paths
capture_success "all-four: debug config" \
  "$TEST_ROOT/all-config.json" "$ALL_CASE" debug config
capture_success "all-four: debug skill" \
  "$TEST_ROOT/all-skills.json" "$ALL_CASE" debug skill
capture_success "all-four: debug agent ossify-implementer-agent" \
  "$TEST_ROOT/all-agent.json" "$ALL_CASE" \
  debug agent ossify-implementer-agent

"$NODE_BIN" - \
  "$ROOT" \
  "$PACKAGE_SPEC" \
  "$DEFAULT_CASE" \
  "$ALL_CASE" \
  "$TEST_ROOT/default-paths.txt" \
  "$TEST_ROOT/default-config.json" \
  "$TEST_ROOT/default-skills.json" \
  "$TEST_ROOT/default-agent.stdout" \
  "$TEST_ROOT/default-agent.stderr" \
  "$TEST_ROOT/all-paths.txt" \
  "$TEST_ROOT/all-config.json" \
  "$TEST_ROOT/all-skills.json" \
  "$TEST_ROOT/all-agent.json" <<'NODE'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const [
  root,
  packageSpec,
  defaultCase,
  allCase,
  defaultPathsFile,
  defaultConfigFile,
  defaultSkillsFile,
  defaultAgentStdoutFile,
  defaultAgentStderrFile,
  allPathsFile,
  allConfigFile,
  allSkillsFile,
  allAgentFile,
] = process.argv.slice(2);

const readJson = (file) => {
  const source = fs.readFileSync(file, "utf8");
  try {
    return JSON.parse(source);
  } catch (error) {
    console.error(`invalid JSON from ${file}: ${source.length} bytes`);
    console.error(`final bytes: ${JSON.stringify(source.slice(-120))}`);
    throw error;
  }
};
const sorted = (values) => [...values].sort();
const unique = (values, label) =>
  assert.equal(new Set(values).size, values.length, `${label} contains duplicates`);

const pluginSkills = {
  "workspace-init": [
    "initializing-dual-repo-workspace",
    "pairing-canonical-repo",
    "pairing-existing-dual",
  ],
  "ai-mentor": ["grill-me", "council", "eli10", "fool"],
  "architect-critic": [
    "critiquing-spec",
    "reviewing-critique-history",
    "listing-principles",
    "promoting-principle",
    "checking-adversary-readiness",
    "managing-async-critique",
  ],
  ossify: ["start", "adopt", "plan-spine", "work-item", "close", "plan-release", "doctor", "challenge", "wayfinder"],
};

function command(description, skill, hasArguments = true) {
  return {
    description,
    template:
      `Use OpenCode's \`skill\` tool to invoke the unqualified ` +
      `\`${skill}\` skill and follow it exactly.` +
      (hasArguments ? "\n\nArguments: $ARGUMENTS" : ""),
  };
}

const expectedCommands = {
  "init-workspace": command(
    "Bootstrap a fresh dual-repo workspace (AI workspace + canonical). Wraps the initializing-dual-repo-workspace skill.",
    "initializing-dual-repo-workspace",
  ),
  "pair-workspace": command(
    "Pair a new AI workspace with an existing canonical repository (Scenario A). Wraps the pairing-canonical-repo skill.",
    "pairing-canonical-repo",
  ),
  "pair-existing-dual": command(
    "Pair an already-populated AI workspace with an already-populated canonical repository (Scenario C). Wraps the pairing-existing-dual skill.",
    "pairing-existing-dual",
  ),
  critique: command(
    "Run an architect-critic audit on a spec or plan",
    "critiquing-spec",
  ),
  "critique-list": command(
    "Show recent architect-critic runs",
    "reviewing-critique-history",
  ),
  "principles-list": command(
    "Show the merged principles set (shipped + user + project + memory-bank)",
    "listing-principles",
  ),
  "promote-principle": command(
    "Promote a principle to user-global or project-scoped principles.md",
    "promoting-principle",
  ),
  "critique-doctor": command(
    "Check external-adversary readiness (codex/claude installed, authed, schema-capable) before a deep critique",
    "checking-adversary-readiness",
    false,
  ),
  "critique-jobs": command(
    "Manage background async critique jobs \u2014 status / result / cancel / resume",
    "managing-async-critique",
  ),
};

const ossifyRoot = path.join(root, "ossify");
const expectedExternalDirectory = {
  "*": "ask",
  [ossifyRoot]: "allow",
  [path.join(ossifyRoot, "**")]: "allow",
};
const expectedAgentPermission = {
  "*": "deny",
  read: "allow",
  edit: "allow",
  glob: "allow",
  grep: "allow",
  bash: "allow",
  task: "deny",
  external_directory: expectedExternalDirectory,
};

const expectedResolvedPermissionRules = [
  { permission: "*", action: "deny", pattern: "*" },
  { permission: "read", action: "allow", pattern: "*" },
  { permission: "edit", action: "allow", pattern: "*" },
  { permission: "glob", action: "allow", pattern: "*" },
  { permission: "grep", action: "allow", pattern: "*" },
  { permission: "bash", action: "allow", pattern: "*" },
  { permission: "task", action: "deny", pattern: "*" },
  { permission: "external_directory", pattern: "*", action: "ask" },
  { permission: "external_directory", pattern: ossifyRoot, action: "allow" },
  {
    permission: "external_directory",
    pattern: path.join(ossifyRoot, "**"),
    action: "allow",
  },
];

const expectedTools = {
  invalid: false,
  question: false,
  bash: true,
  read: true,
  glob: true,
  grep: true,
  edit: true,
  write: true,
  task: false,
  webfetch: false,
  todowrite: false,
  websearch: false,
  skill: false,
};

function parsePaths(file) {
  const result = {};
  for (const line of fs.readFileSync(file, "utf8").trim().split("\n")) {
    const match = line.match(/^(\S+)\s+(.+)$/);
    assert.ok(match, `malformed debug paths line: ${line}`);
    result[match[1]] = match[2];
  }
  return result;
}

function assertIsolatedPaths(file, caseRoot) {
  const actual = parsePaths(file);
  assert.equal(actual.home, path.join(caseRoot, "home"));
  assert.equal(actual.data, path.join(caseRoot, "data", "opencode"));
  assert.equal(actual.cache, path.join(caseRoot, "cache", "opencode"));
  assert.equal(actual.config, path.join(caseRoot, "config", "opencode"));
  assert.equal(actual.state, path.join(caseRoot, "state", "opencode"));
  assert.equal(actual.tmp, path.join(caseRoot, "tmp", "opencode"));
}

function expectedSkillEntries(names) {
  return names.flatMap((plugin) =>
    pluginSkills[plugin].map((name) => [
      name,
      path.join(root, plugin, "skills", name, "SKILL.md"),
    ]),
  );
}

function assertSkills(actual, selected) {
  assert.ok(Array.isArray(actual), "debug skill output must be an array");
  const names = actual.map(({ name }) => name);
  const locations = actual.map(({ location }) => location);
  unique(names, "skill names");
  unique(locations, "skill locations");

  const expected = [
    ["customize-opencode", "<built-in>"],
    ...expectedSkillEntries(selected),
  ];
  assert.deepEqual(sorted(names), sorted(expected.map(([name]) => name)));
  assert.deepEqual(
    sorted(actual.map(({ name, location }) => `${name}\0${location}`)),
    sorted(expected.map(([name, location]) => `${name}\0${location}`)),
  );
}

function assertNoManagedContamination(config, poison) {
  assert.ok(!Object.hasOwn(config, "provider"), "unexpected provider config");
  assert.ok(!Object.hasOwn(config, "model"), "unexpected model config");
  assert.ok(!Object.hasOwn(config, "permission"), "unexpected permission config");
  assert.ok(!config.plugin.some((entry) => JSON.stringify(entry).includes("managed-poison")));
  assert.ok(!Object.hasOwn(config.agent ?? {}, "managed-poison-agent"));
  assert.ok(!(config.skills?.paths ?? []).includes(poison.skills.paths[0]));
}

function assertContaminationIsDetected(config, poison) {
  const controls = [
    { ...structuredClone(config), provider: poison.provider },
    { ...structuredClone(config), model: poison.model },
    { ...structuredClone(config), permission: poison.permission },
    { ...structuredClone(config), plugin: [...config.plugin, ...poison.plugin] },
    {
      ...structuredClone(config),
      agent: { ...config.agent, ...poison.agent },
    },
    {
      ...structuredClone(config),
      skills: {
        ...config.skills,
        paths: [...config.skills.paths, ...poison.skills.paths],
      },
    },
  ];
  for (const contaminated of controls) {
    assert.throws(
      () => assertNoManagedContamination(contaminated, poison),
      assert.AssertionError,
    );
  }
}

function assertSelection(config, skills, selected, caseRoot, expectedSpec) {
  const expectedPaths = selected.map((plugin) => path.join(root, plugin, "skills"));
  const poison = readJson(path.join(caseRoot, "managed-contamination", "opencode.json"));
  const expectedKeys = [
    "$schema",
    "agent",
    "autoupdate",
    "command",
    "mode",
    "plugin",
    "plugin_origins",
    "share",
    "skills",
    "username",
  ];

  assert.deepEqual(sorted(Object.keys(config)), expectedKeys);
  assert.equal(config.$schema, "https://opencode.ai/config.json");
  assert.equal(config.autoupdate, false);
  assert.equal(config.share, "disabled");
  assert.deepEqual(config.mode, {});
  assert.equal(typeof config.username, "string");
  assert.deepEqual(config.skills?.paths, expectedPaths);
  unique(config.skills.paths, "configured skill paths");
  assert.deepEqual(config.command, expectedCommands);
  unique(Object.keys(config.command), "command aliases");
  assertSkills(skills, selected);

  assert.deepEqual(config.plugin, [expectedSpec]);
  assert.deepEqual(config.plugin_origins, [
    {
      spec: expectedSpec,
      source: path.join(caseRoot, "config", "opencode-test.json"),
      scope: "global",
    },
  ]);

  assertNoManagedContamination(config, poison);
  assertContaminationIsDetected(config, poison);

  for (const excluded of [
    "scaffold",
    "scaffold-onboard",
    "scaffold-dev",
    "claude-security-audit",
    "code-judo",
    "orca-crew",
  ]) {
    const excludedRoot = path.join(root, excluded) + path.sep;
    assert.ok(!config.skills.paths.some((entry) => entry.startsWith(excludedRoot)));
    assert.ok(!skills.some(({ location }) => location.startsWith(excludedRoot)));
  }
}

function assertResolvedAgent(agent, configuredAgent) {
  assert.deepEqual(sorted(Object.keys(agent)), [
    "description",
    "mode",
    "name",
    "native",
    "options",
    "permission",
    "prompt",
    "tools",
  ]);
  assert.equal(agent.name, "ossify-implementer-agent");
  assert.equal(agent.mode, "subagent");
  assert.equal(agent.native, false);
  assert.deepEqual(agent.options, {});
  assert.ok(!Object.hasOwn(agent, "model"));
  assert.equal(agent.description, configuredAgent.description);
  assert.equal(agent.prompt, configuredAgent.prompt);
  assert.deepEqual(agent.tools, expectedTools);

  let sequenceCount = 0;
  for (
    let index = 0;
    index <= agent.permission.length - expectedResolvedPermissionRules.length;
    index += 1
  ) {
    if (
      JSON.stringify(
        agent.permission.slice(index, index + expectedResolvedPermissionRules.length),
      ) === JSON.stringify(expectedResolvedPermissionRules)
    ) {
      sequenceCount += 1;
    }
  }
  assert.equal(
    sequenceCount,
    1,
    `resolved permissions must contain the exact package rule sequence once:\n${JSON.stringify(agent.permission, null, 2)}`,
  );

  const wildcardMatch = (input, pattern) => {
    const normalized = input.replaceAll("\\", "/");
    const escaped = pattern
      .replaceAll("\\", "/")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`, process.platform === "win32" ? "si" : "s").test(normalized);
  };
  const permissionAction = (permission, pattern) =>
    agent.permission.findLast(
      (rule) =>
        wildcardMatch(permission, rule.permission) &&
        wildcardMatch(pattern, rule.pattern),
    )?.action ?? "ask";
  const packageRoot = ossifyRoot;
  const packageFile = path.join(ossifyRoot, "skills", "work-item", "SKILL.md");
  const siblingFile = path.join(path.dirname(ossifyRoot), "ai-mentor", "README.md");
  const outsideFile = path.join(allCase, "outside", "file.txt");

  assert.equal(permissionAction("edit", "*"), "allow");
  assert.equal(permissionAction("external_directory", packageRoot), "allow");
  assert.equal(permissionAction("external_directory", packageFile), "allow");
  assert.equal(permissionAction("external_directory", siblingFile), "ask");
  assert.equal(permissionAction("external_directory", outsideFile), "ask");

  assert.equal(permissionAction("external_directory", path.join(ossifyRoot, "*")), "allow");
  assert.equal(
    permissionAction("external_directory", path.join(ossifyRoot, "skills", "work-item", "*")),
    "allow",
  );
  assert.equal(
    permissionAction("external_directory", path.join(path.dirname(ossifyRoot), "ai-mentor", "*")),
    "ask",
  );
  assert.equal(permissionAction("external_directory", path.join(allCase, "outside", "*")), "ask");
}

assertIsolatedPaths(defaultPathsFile, defaultCase);
assertIsolatedPaths(allPathsFile, allCase);

const defaultConfig = readJson(defaultConfigFile);
const defaultSkills = readJson(defaultSkillsFile);
assertSelection(
  defaultConfig,
  defaultSkills,
  ["workspace-init", "ai-mentor", "architect-critic"],
  defaultCase,
  packageSpec,
);
assert.deepEqual(defaultConfig.agent, {});
assert.equal(fs.readFileSync(defaultAgentStdoutFile, "utf8"), "");
assert.match(
  fs.readFileSync(defaultAgentStderrFile, "utf8"),
  /^Agent ossify-implementer-agent not found,/,
);

const allPlugins = ["workspace-init", "ai-mentor", "architect-critic", "ossify"];
const allSpec = [packageSpec, { plugins: allPlugins }];
const allConfig = readJson(allConfigFile);
const allSkills = readJson(allSkillsFile);
assertSelection(allConfig, allSkills, allPlugins, allCase, allSpec);
assert.deepEqual(Object.keys(allConfig.agent ?? {}), ["ossify-implementer-agent"]);

const configuredAgent = allConfig.agent["ossify-implementer-agent"];
assert.deepEqual(Object.keys(configuredAgent), [
  "description",
  "mode",
  "prompt",
  "permission",
]);
assert.equal(configuredAgent.mode, "subagent");
assert.ok(!Object.hasOwn(configuredAgent, "model"));
assert.deepEqual(Object.keys(configuredAgent.permission), [
  "*",
  "read",
  "edit",
  "glob",
  "grep",
  "bash",
  "task",
  "external_directory",
]);
assert.deepEqual(configuredAgent.permission, expectedAgentPermission);
assert.equal(configuredAgent.permission.edit, "allow");
assert.deepEqual(Object.keys(configuredAgent.permission.external_directory), [
  "*",
  ossifyRoot,
  path.join(ossifyRoot, "**"),
]);
assert.match(configuredAgent.prompt, /You are ossify's work-item executor/);
assert.ok(
  configuredAgent.prompt.includes(
    path.join(root, "ossify", "skills", "work-item", "SKILL.md"),
  ),
);
assert.ok(!configuredAgent.prompt.includes("CLAUDE_PLUGIN_ROOT"));

assertResolvedAgent(readJson(allAgentFile), configuredAgent);
NODE

printf 'OpenCode %s native package loader integration: PASS\n' \
  "$EXPECTED_OPENCODE_VERSION"
