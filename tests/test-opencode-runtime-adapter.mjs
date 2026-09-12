import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const marketplaceUrl = new URL(".opencode/plugins/marketplace.js", root);
const catalogUrl = new URL(".opencode/lib/catalog.js", root);
const markdownUrl = new URL(".opencode/lib/markdown.js", root);
const runtimeUrl = new URL(".opencode/lib/runtime.js", root);
const translateUrl = new URL(".opencode/lib/translate.js", root);
const ossifyAgentUrl = new URL("ossify/agents/implementer-agent.md", root);
const installGuideUrl = new URL(".opencode/INSTALL.md", root);
const readmeUrl = new URL("README.md", root);
const aiMentorManifestUrl = new URL(
  "ai-mentor/.claude-plugin/plugin.json",
  root,
);
const architectCriticManifestUrl = new URL(
  "architect-critic/.claude-plugin/plugin.json",
  root,
);
const ossifyReadmeUrl = new URL("ossify/README.md", root);
const ossifyManifestUrl = new URL("ossify/.claude-plugin/plugin.json", root);
const codeJudoManifestUrl = new URL("code-judo/.claude-plugin/plugin.json", root);
const orcaCrewManifestUrl = new URL("orca-crew/.claude-plugin/plugin.json", root);
const gitignoreUrl = new URL(".gitignore", root);
const wrapperDirectory = fileURLToPath(new URL(".opencode/bin", root));
const selectedPluginsEnvironment = "OPENCODE_SCAFFOLDING_PLUGINS";
const exampleBundleSpec =
  "github:draco28/claude-agent-scaffolding#bundle-v0.1.0";

async function applyPluginConfig(options, config = {}) {
  const { ScaffoldingPlugin } = await import(marketplaceUrl);
  const hooks = await ScaffoldingPlugin({}, options);
  await hooks.config(config);
  return config;
}

async function createPluginHooks(options, directory = fileURLToPath(root)) {
  const { ScaffoldingPlugin } = await import(marketplaceUrl);
  return ScaffoldingPlugin({ directory }, options);
}

async function createRegisteredOssifyHooks(directory) {
  const hooks = await createPluginHooks({ plugins: ["ossify"] }, directory);
  await hooks.config({});
  return hooks;
}

async function trackOssifySession(hooks, sessionID) {
  await hooks["chat.message"](
    { sessionID, agent: "ossify-implementer-agent" },
    { message: { role: "user" }, parts: [] },
  );
}

function transformOutput(sessionID, text = "Audit this spec") {
  const messageID = `message-${sessionID}`;
  return {
    messages: [
      {
        info: {
          id: messageID,
          sessionID,
          role: "user",
          time: { created: 1 },
          agent: "build",
          model: { providerID: "test", modelID: "test" },
        },
        parts: [
          {
            id: `part-${sessionID}`,
            sessionID,
            messageID,
            type: "text",
            text,
            synthetic: false,
            metadata: { fixture: true },
          },
        ],
      },
    ],
  };
}

async function createLifecycleRuntime(t, handlerSource, options = {}) {
  const fixture = await mkdtemp(join(tmpdir(), "opencode-architect-lifecycle-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  if (handlerSource !== undefined) {
    const handlers = join(fixture, "hooks-handlers");
    await mkdir(handlers, { recursive: true });
    await writeFile(join(handlers, "session-start.sh"), handlerSource, {
      encoding: "utf8",
      mode: options.mode ?? 0o755,
    });
  }

  const { createRuntime } = await import(runtimeUrl);
  return {
    fixture,
    hooks: createRuntime({
      selected: [{ name: options.plugin ?? "architect-critic", root: fixture }],
      registeredCommands: new Map(),
      registeredAgents: new Set(),
      directory: fixture,
      sessionStartTimeoutMs: options.sessionStartTimeoutMs,
    }),
  };
}

const expectedPlugins = [
  "workspace-init",
  "ai-mentor",
  "architect-critic",
  "ossify",
];

const excludedPlugins = [
  "scaffold",
  "scaffold-onboard",
  "scaffold-dev",
  "claude-security-audit",
  // Deferred to code-judo v0.2, not forgotten: it ships on Claude Code and Codex
  // only. Listing it here makes the exclusion a checked decision rather than an
  // absence nobody can tell apart from an oversight.
  "code-judo",
  // Not in the OpenCode bundle in 0.1.0: it ships on Claude Code and Codex only.
  // Listed so the exclusion is a checked decision, not an oversight.
  "orca-crew",
];

const expectedAliases = {
  "init-workspace": "initializing-dual-repo-workspace",
  "pair-workspace": "pairing-canonical-repo",
  "pair-existing-dual": "pairing-existing-dual",
  critique: "critiquing-spec",
  "critique-list": "reviewing-critique-history",
  "principles-list": "listing-principles",
  "promote-principle": "promoting-principle",
  "critique-doctor": "checking-adversary-readiness",
  "critique-jobs": "managing-async-critique",
};

function parseJsonFences(source) {
  return [...source.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) =>
    JSON.parse(match[1]),
  );
}

function markdownSection(source, heading, level = 2) {
  const marker = `${"#".repeat(level)} ${heading}`;
  const start = source.indexOf(`${marker}\n`);
  assert.notEqual(start, -1, `missing Markdown section: ${marker}`);
  const bodyStart = start + marker.length + 1;
  const boundary = new RegExp(`^#{1,${level}}\\s+`, "m").exec(
    source.slice(bodyStart),
  );
  return source.slice(
    bodyStart,
    boundary ? bodyStart + boundary.index : source.length,
  );
}

function parseMarkdownTable(section) {
  const lines = section
    .split("\n")
    .filter((line) => /^\|.*\|$/.test(line.trim()));
  assert.ok(lines.length >= 2, "Markdown section must contain a table");
  const cells = (line) =>
    line
      .trim()
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
  const headers = cells(lines[0]);
  assert.ok(
    cells(lines[1]).every((cell) => /^:?-+:?$/.test(cell)),
    "Markdown table must have a separator row",
  );
  return lines.slice(2).map((line) =>
    Object.fromEntries(headers.map((header, index) => [header, cells(line)[index]])),
  );
}

function inlineCodeValues(source) {
  return [...source.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function shellCommands(source) {
  return [...source.matchAll(/```sh\n([\s\S]*?)\n```/g)].flatMap((match) =>
    match[1]
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function normalizeWhitespace(source) {
  return source.replace(/\s+/g, " ").trim();
}

test("root package declares the OpenCode bundle contract", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("package.json", root), "utf8"),
  );

  assert.equal(packageJson.name, "claude-agent-scaffolding-opencode");
  assert.equal(packageJson.version, "0.1.0");
  assert.equal(packageJson.type, "module");
  assert.deepEqual(packageJson.exports, {
    ".": "./.opencode/plugins/marketplace.js",
    "./server": "./.opencode/plugins/marketplace.js",
  });
  assert.deepEqual(packageJson.engines, { opencode: ">=1.18.13" });
  assert.deepEqual(packageJson.os, ["darwin", "linux"]);
  assert.deepEqual(packageJson.dependencies, {});
  assert.deepEqual(packageJson.files, [
    ".opencode",
    "workspace-init",
    "ai-mentor",
    "architect-critic",
    "ossify",
    "LICENSE",
  ]);
});

test("Task 8 documents pinned native OpenCode installation shapes", async () => {
  const guide = await readFile(installGuideUrl, "utf8");
  const configs = parseJsonFences(guide);
  const allPlugins = [
    "workspace-init",
    "ai-mentor",
    "architect-critic",
    "ossify",
  ];

  assert.ok(
    configs.some(
      (config) =>
        JSON.stringify(config.plugin) === JSON.stringify([exampleBundleSpec]),
    ),
    "default install must be a plain pinned GitHub package spec",
  );
  assert.ok(
    configs.some(
      (config) =>
        JSON.stringify(config.plugin) ===
        JSON.stringify([[exampleBundleSpec, { plugins: allPlugins }]]),
    ),
    "Ossify install must use the native [specifier, options] tuple",
  );
  assert.match(guide, /example release tag.*not.*published/is);
  assert.match(guide, /installation starts.*after.*immutable tag.*published/is);
  assert.doesNotMatch(
    guide,
    /github:draco28\/claude-agent-scaffolding#(?:main|master|head|latest)\b/i,
  );
});

test("Task 8 documents exact native skills, aliases, and runtime requirements", async () => {
  const guide = await readFile(installGuideUrl, "utf8");
  const inventory = parseMarkdownTable(
    markdownSection(guide, "Native Skills And Commands"),
  );
  const expectedInventory = {
    "workspace-init": [
      "/initializing-dual-repo-workspace",
      "/pairing-canonical-repo",
      "/pairing-existing-dual",
    ],
    "ai-mentor": ["/grill-me", "/council", "/eli10", "/fool"],
    "architect-critic": [
      "/critiquing-spec",
      "/reviewing-critique-history",
      "/listing-principles",
      "/promoting-principle",
      "/checking-adversary-readiness",
      "/managing-async-critique",
    ],
    ossify: ["/start", "/adopt", "/plan-spine", "/work-item", "/close", "/plan-release", "/doctor", "/challenge", "/wayfinder"],
  };

  for (const requirement of [
    /OpenCode\s*>=\s*1\.18\.13/,
    /macOS.*Linux/i,
    /Windows.*unsupported/i,
    /\bBash\b/,
    /\bGit\b/,
    /\bjq\b/,
    /\bNode\.js\b/,
    /synchronous close-depth foreground[\s\S]*Codex CLI\s*>=\s*0\.125/i,
  ]) {
    assert.match(guide, requirement);
  }
  assert.deepEqual(
    Object.fromEntries(
      inventory.map((row) => [
        inlineCodeValues(row.Plugin)[0],
        inlineCodeValues(row["Native commands"]),
      ]),
    ),
    expectedInventory,
  );
  assert.deepEqual(
    inventory.map((row) => row.Availability),
    ["Default", "Default", "Default", "Opt-in"],
  );

  const aliases = parseMarkdownTable(markdownSection(guide, "Differing Aliases"));
  assert.deepEqual(
    Object.fromEntries(
      aliases.map((row) => [
        inlineCodeValues(row.Alias)[0],
        inlineCodeValues(row["Native skill"])[0],
      ]),
    ),
    Object.fromEntries(
      Object.entries(expectedAliases).map(([alias, skill]) => [
        `/${alias}`,
        skill,
      ]),
    ),
  );
  assert.equal(aliases.length, 9);
});

test("Task 9 documents the bounded Ossify Git guard and OpenCode async prerequisites", async () => {
  const guide = await readFile(installGuideUrl, "utf8");
  const requirements = normalizeWhitespace(
    markdownSection(guide, "Requirements"),
  );
  const invocation = normalizeWhitespace(
    markdownSection(guide, "Differing Aliases"),
  );

  assert.doesNotMatch(
    guide,
    /(?:subagent|implementer)[^.]*cannot run Git commit, push,\s*pull, or fetch through Bash/i,
  );
  assert.doesNotMatch(
    invocation,
    /pre-hook[^.]*\b(?:guarantees?|ensures?|prevents?|blocks?)\b[^.]*\bGit (?:commit|push|pull|fetch)\b/i,
  );
  assert.doesNotMatch(
    invocation,
    /\b(?:absolute|complete) (?:mechanical )?guarantee\b|\bmechanically (?:blocks?|prevents?|guarantees?)\b/i,
  );
  assert.match(
    invocation,
    /canonical.*(?:worker prompt|contract).*(?:forbids|prohibits).*Git commit.*push.*pull.*fetch.*anywhere.*Bash (?:tool-call )?log/i,
  );
  assert.match(
    invocation,
    /pre-hook.*(?:audits|scans).*full literal command text.*(?:direct|normalized).*literal Git forms.*unknown.*alias-capable.*subcommands/i,
  );
  assert.match(invocation, /not an OS\/process sandbox/i);
  assert.match(
    invocation,
    /dynamically substituted executable names.*indirect helper programs.*outside.*mechanical boundary/i,
  );
  assert.match(
    invocation,
    /pin.*review.*trusted package.*prompt\/transcript audit.*residual boundary/i,
  );

  assert.match(
    requirements,
    /synchronous.*close-depth.*foreground.*requires.*authenticated Codex CLI >=0\.125/i,
  );
  assert.match(
    requirements,
    /OpenCode async.*compatible `codex-companion\.mjs`/i,
  );
  assert.match(
    requirements,
    /`ARCHITECT_CRITIC_CODEX_COMPANION`.*absolute path.*canonical OpenAI Codex Claude-plugin cache/i,
  );
  assert.match(
    requirements,
    /root bundle does not ship.*compatible live companion.*packaged test shim.*not supported.*live use/i,
  );
  assert.match(requirements, /`\/critique-doctor`.*live compatibility smoke/i);
  assert.match(
    requirements,
    /explicit async.*stops.*remediation.*never falls back.*foreground/i,
  );
  assert.match(
    requirements,
    /synchronous `\/critique --close`.*(?:remains|is).*option.*companion.*unavailable/i,
  );
});

test("Task 9 keeps root README versions aligned with parsed plugin manifests", async () => {
  const [
    rootReadme,
    aiMentorManifestSource,
    architectCriticManifestSource,
    ossifyManifestSource,
    codeJudoManifestSource,
    orcaCrewManifestSource,
  ] = await Promise.all([
    readFile(readmeUrl, "utf8"),
    readFile(aiMentorManifestUrl, "utf8"),
    readFile(architectCriticManifestUrl, "utf8"),
    readFile(ossifyManifestUrl, "utf8"),
    readFile(codeJudoManifestUrl, "utf8"),
    readFile(orcaCrewManifestUrl, "utf8"),
  ]);
  const manifests = [
    JSON.parse(aiMentorManifestSource),
    JSON.parse(architectCriticManifestSource),
    JSON.parse(ossifyManifestSource),
    JSON.parse(codeJudoManifestSource),
    JSON.parse(orcaCrewManifestSource),
  ];
  const pluginRows = parseMarkdownTable(markdownSection(rootReadme, "Plugins"));
  const layout = markdownSection(rootReadme, "Layout");

  assert.doesNotMatch(rootReadme, /ai-mentor[^\n]*v2\.3\.0/i);
  assert.doesNotMatch(rootReadme, /architect-critic[^\n]*v0\.5\.1/i);

  for (const manifest of manifests) {
    const row = pluginRows.find(
      (candidate) => inlineCodeValues(candidate.Plugin)[0] === manifest.name,
    );
    assert.ok(row, `root inventory must include ${manifest.name}`);
    assert.equal(
      row.Version,
      `v${manifest.version}`,
      `${manifest.name} table version must match its manifest`,
    );
    assert.match(
      layout,
      new RegExp(
        `(?:├──|└──) ${manifest.name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\/.*\\(v${manifest.version.replace(/\\./g, "\\.")}\\)`,
      ),
      `${manifest.name} layout version must match its manifest`,
    );
  }
});

test("ossify/README.md version stays aligned with its manifest (#366)", async () => {
  // #366: ossify/README.md:1 drifted from the manifest version twice before
  // (f20474e, e2a9566) and nothing caught it — the check above only reads the
  // ROOT README. ossify is the only plugin whose own README stamps a version
  // in its title line, so this is a dedicated assertion rather than a loop
  // over `manifests` like the check above.
  const [ossifyReadme, ossifyManifestSource] = await Promise.all([
    readFile(ossifyReadmeUrl, "utf8"),
    readFile(ossifyManifestUrl, "utf8"),
  ]);
  const manifest = JSON.parse(ossifyManifestSource);
  const firstLine = ossifyReadme.split("\n", 1)[0];
  assert.equal(
    firstLine,
    `# ossify (v${manifest.version})`,
    "ossify/README.md:1 must match ossify/.claude-plugin/plugin.json's version",
  );
});

test("Task 8 documents actual OpenCode collision and cache diagnostics", async () => {
  const guide = await readFile(installGuideUrl, "utf8");
  const diagnostics = markdownSection(guide, "Diagnostics");
  const normalized = normalizeWhitespace(diagnostics);

  assert.deepEqual(shellCommands(diagnostics), [
    "opencode debug paths",
    'find "<cache>/packages" -type f -path "*/node_modules/claude-agent-scaffolding-opencode/package.json" -print',
    "opencode --print-logs --log-level WARN debug skill",
    "opencode --print-logs --log-level ERROR debug config",
    "opencode --print-logs --log-level DEBUG debug config",
    "opencode debug agent ossify-implementer-agent",
  ]);
  assert.ok(
    normalized.includes(
      "OpenCode 1.18.13 warns and overwrites duplicate skills; it does not fail loading for that collision.",
    ),
  );
  assert.ok(
    normalized.includes(
      "`debug skill` shows only the winning definition, while the WARN log names the duplicate.",
    ),
  );
  assert.ok(
    normalized.includes(
      "OpenCode catches adapter config-hook errors, so `opencode debug config` can still exit 0.",
    ),
  );
  assert.match(
    diagnostics,
    /reserved `ossify-implementer-agent` collision.*selected package skill paths, aliases, and Ossify agent.*absent/is,
  );
  assert.match(
    diagnostics,
    /Caller-defined command collisions remain caller-preserved/,
  );
  assert.doesNotMatch(diagnostics, /~\/\.cache\/opencode\/node_modules/);
  assert.doesNotMatch(diagnostics, /delete the whole OpenCode cache/i);
});

test("Task 8 documents verifiable targeted package cache discovery", async () => {
  const guide = await readFile(installGuideUrl, "utf8");
  const requirements = markdownSection(guide, "Requirements");
  const diagnostics = markdownSection(guide, "Diagnostics");
  const normalized = normalizeWhitespace(diagnostics);
  const discoveryCommand =
    'find "<cache>/packages" -type f -path "*/node_modules/claude-agent-scaffolding-opencode/package.json" -print';

  assert.doesNotMatch(
    normalized,
    /Use (?:the )?DEBUG log(?:'s)? resolved target|DEBUG logs? (?:identify|show|provide).*resolved plugin target/i,
  );
  assert.match(requirements, /`find`/);
  assert.ok(shellCommands(diagnostics).includes(discoveryCommand));
  assert.ok(
    normalized.includes(
      "Use the `cache` value from `opencode debug paths` as `<cache>`.",
    ),
  );
  assert.ok(
    normalized.includes(
      "If multiple immutable tags are cached, inspect each matching cache entry root's package metadata and dependency spec, then compare its recorded dependency with the configured pinned GitHub spec.",
    ),
  );
  assert.doesNotMatch(
    normalized,
    /cache entry root is the directory directly below `<cache>\/packages`/i,
  );
  assert.ok(
    normalized.includes(
      "For each matched package.json path, apply `dirname` three times: the first parent is the installed package directory, the second is `node_modules`, and the third is the cache entry root immediately before `node_modules`.",
    ),
  );
  assert.ok(
    normalized.includes(
      "Inspect `<entry-root>/package.json` and compare its recorded dependency spec with the configured pinned GitHub spec.",
    ),
  );
  assert.ok(
    normalized.includes(
      "Inspect only the matched cache entry's `node_modules/claude-agent-scaffolding-opencode` subtree.",
    ),
  );
  assert.ok(
    normalized.includes(
      "DEBUG logs remain useful for load failures and collisions, but OpenCode 1.18.13 does not log successful resolved plugin targets.",
    ),
  );
});

test("Task 8 documents update policy and the implemented trust boundary", async () => {
  const guide = await readFile(installGuideUrl, "utf8");

  assert.match(guide, /config.*plugin tag.*options.*restart OpenCode/is);
  assert.match(
    guide,
    /review.*new immutable `bundle-v<semver>` tag.*change.*pinned spec.*restart/is,
  );
  assert.match(guide, /ossify-implementer-agent/);
  assert.match(guide, /~\/\.config\/opencode/);
  assert.doesNotMatch(guide, /rm\s+-rf/);

  for (const boundary of [
    /trusted startup JavaScript/i,
    /mutates.*resolved config/i,
    /injects.*shell environment.*wrappers/is,
    /Architect Critic.*session.*handler/is,
    /guards?.*Ossify.*Bash/is,
    /security audit.*model-free gates.*before tagging/is,
  ]) {
    assert.match(guide, boundary);
  }
  assert.match(
    guide,
    /do not independently read credentials or invoke a model at\s+startup/i,
  );
});

test("Task 8 reconciles registered Ossify availability across shipped surfaces", async () => {
  // The release roadmap was a third surface here until AI-process docs stopped
  // being tracked in this repo. The consistency check is the point, not the
  // count: every SHIPPED surface that describes ossify's status must agree.
  // As of v1.0.0 that status is: registered in BOTH marketplaces, and still an
  // explicit opt-in inside the OpenCode bundle. Those are separate surfaces and
  // the second did not change when the first did.
  const [rootReadme, ossifyReadme, manifestSource] = await Promise.all([
    readFile(readmeUrl, "utf8"),
    readFile(ossifyReadmeUrl, "utf8"),
    readFile(ossifyManifestUrl, "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);
  const intro = rootReadme.slice(0, rootReadme.indexOf("## Plugins"));
  const pluginRows = parseMarkdownTable(markdownSection(rootReadme, "Plugins"));
  const ossifyRow = pluginRows.find(
    (row) => inlineCodeValues(row.Plugin)[0] === "ossify",
  );
  const openCode = markdownSection(rootReadme, "OpenCode", 3);
  const localClaude = markdownSection(
    rootReadme,
    "Local Claude Code Development",
    3,
  );
  const localCodex = markdownSection(rootReadme, "Local Codex Development", 3);
  const layout = markdownSection(rootReadme, "Layout");

  assert.match(intro, /Claude Code and Codex plugin marketplace.*OpenCode adapter/is);
  assert.ok(ossifyRow, "root inventory must include Ossify");
  assert.match(ossifyRow.Scope, /Project-level \(continuous\)/);
  assert.match(
    ossifyRow.Purpose,
    /In the Claude and Codex marketplaces as of v1\.0\.0/i,
  );
  assert.match(
    markdownSection(rootReadme, "Plugins"),
    /Ossify is an alternate replacement lifecycle.*`scaffold-onboard`.*`scaffold-dev`/is,
  );
  assert.doesNotMatch(
    markdownSection(rootReadme, "Plugins"),
    /eight plugins.*compose without overlap/i,
  );
  assert.match(openCode, /\.opencode\/INSTALL\.md/);
  assert.ok(
    normalizeWhitespace(openCode).includes(
      "Task 7 validates the native export and options shapes with a direct `file://` package spec.",
    ),
  );
  assert.ok(
    normalizeWhitespace(openCode).includes(
      "GitHub transport begins only after the first gated immutable `bundle-v<semver>` tag is published.",
    ),
  );
  assert.doesNotMatch(openCode, /For local (?:Claude|Codex) development/);
  assert.match(localClaude, /\/plugin marketplace add \/home\/pras/);
  assert.match(localCodex, /codex plugin marketplace add \/home\/pras/);
  for (const entry of [
    "package.json",
    ".opencode/",
    "workspace-init/",
    "ai-mentor/",
    "scaffold-onboard/",
    "scaffold-dev/",
    "scaffold/",
    "architect-critic/",
    "claude-security-audit/",
    "ossify/",
    "docs/",
  ]) {
    assert.ok(layout.includes(entry), `root layout must include ${entry}`);
  }
  for (const source of [rootReadme, ossifyReadme]) {
    assert.ok(
      normalizeWhitespace(source)
        .toLowerCase()
        .includes(
          "bundle installability begins only after an immutable bundle tag is published",
        ),
    );
    assert.match(source, /in the Claude and Codex marketplaces as of v1\.0\.0/i);
  }
  for (const source of [rootReadme, ossifyReadme, manifest.description]) {
    assert.doesNotMatch(source, /experimental/i);
  }
  assert.match(ossifyReadme, /explicit.*allowlist/is);
  assert.match(ossifyReadme, /Plan D/i);
  assert.match(manifest.version, /^1\./);
  assert.ok(manifest.description.length <= 1024);
  assert.doesNotMatch(manifest.description, /not installable/i);
});

test("Task 8 ignores only observed OpenCode project runtime artifacts", async () => {
  const lines = (await readFile(gitignoreUrl, "utf8"))
    .split("\n")
    .filter((line) => line.startsWith(".opencode/"));

  assert.deepEqual(lines, [
    ".opencode/.gitignore",
    ".opencode/node_modules/",
    ".opencode/package.json",
    ".opencode/package-lock.json",
    ".opencode/bun.lock",
  ]);
  assert.ok(!lines.includes(".opencode/"));
});

test("default selection contains only the three stable plugins", async () => {
  const { resolveEnabledPlugins } = await import(catalogUrl);
  const selected = resolveEnabledPlugins();

  assert.deepEqual(
    selected.map(({ name }) => name),
    expectedPlugins.slice(0, 3),
  );
  assert.ok(Object.isFrozen(selected));
  assert.ok(selected.every(Object.isFrozen));
});

test("the explicit allowlist contains exactly four immutable definitions", async () => {
  const { PLUGIN_CATALOG, resolveEnabledPlugins } = await import(catalogUrl);
  const selected = resolveEnabledPlugins({ plugins: expectedPlugins });

  assert.deepEqual(
    selected.map(({ name }) => name),
    expectedPlugins,
  );
  assert.deepEqual(
    PLUGIN_CATALOG.map(({ name }) => name),
    expectedPlugins,
  );
  assert.ok(Object.isFrozen(PLUGIN_CATALOG));
  assert.ok(
    PLUGIN_CATALOG.every(
      (plugin) =>
        Object.isFrozen(plugin) &&
        Object.isFrozen(plugin.skills) &&
        Object.isFrozen(plugin.commands),
    ),
  );
  const aliases = PLUGIN_CATALOG.flatMap(({ commands }) => commands);
  assert.equal(aliases.length, 9);
  assert.ok(aliases.every(Object.isFrozen));
});

test("skill and command ownership comes from catalog metadata", async () => {
  const { getCommandOwner, getSkillOwner } = await import(catalogUrl);

  assert.equal(getSkillOwner("grill-me")?.name, "ai-mentor");
  assert.equal(getSkillOwner("plan-release")?.name, "ossify");
  assert.equal(getCommandOwner("init-workspace")?.name, "workspace-init");
  assert.equal(getCommandOwner("critique-jobs")?.name, "architect-critic");
  assert.equal(getSkillOwner("missing"), undefined);
  assert.equal(getCommandOwner("missing"), undefined);
});

test("unknown and malformed plugin selections are rejected", async () => {
  const { resolveEnabledPlugins } = await import(catalogUrl);

  assert.throws(
    () => resolveEnabledPlugins({ plugins: ["workspace-init", "unknown"] }),
    /Unknown OpenCode plugin: unknown/,
  );
  assert.throws(
    () => resolveEnabledPlugins({ plugins: "workspace-init" }),
    /plugins must be an array/,
  );
});

test("options accept only undefined or a plain object with optional plugins", async () => {
  const { resolveEnabledPlugins } = await import(catalogUrl);
  const defaults = expectedPlugins.slice(0, 3);

  for (const options of [undefined, {}, { plugins: undefined }]) {
    assert.deepEqual(
      resolveEnabledPlugins(options).map(({ name }) => name),
      defaults,
    );
  }

  const invalidContainers = [
    null,
    [],
    "workspace-init",
    1,
    true,
    () => {},
    new Date(),
  ];
  for (const options of invalidContainers) {
    assert.throws(
      () => resolveEnabledPlugins(options),
      /options must be a plain object/,
    );
  }
});

test("options reject unknown and misspelled keys", async () => {
  const { resolveEnabledPlugins } = await import(catalogUrl);

  assert.throws(
    () => resolveEnabledPlugins({ plugin: ["workspace-init"] }),
    /Unknown OpenCode option: plugin/,
  );
  assert.throws(
    () => resolveEnabledPlugins({ plugins: [], extra: true }),
    /Unknown OpenCode option: extra/,
  );
});

test("excluded plugins cannot enter the catalog or package payload", async () => {
  const { PLUGIN_CATALOG, resolveEnabledPlugins } = await import(catalogUrl);
  const packageJson = JSON.parse(
    await readFile(new URL("package.json", root), "utf8"),
  );

  for (const name of excludedPlugins) {
    assert.ok(!PLUGIN_CATALOG.some((plugin) => plugin.name === name));
    assert.ok(!packageJson.files.includes(name));
    assert.throws(
      () => resolveEnabledPlugins({ plugins: [name] }),
      new RegExp(`Unknown OpenCode plugin: ${name}`),
    );
  }
});

test("plugin entrypoint applies strict selection before returning hooks", async () => {
  const { ScaffoldingPlugin } = await import(marketplaceUrl);

  const hooks = await ScaffoldingPlugin({}, { plugins: ["ossify"] });
  assert.deepEqual(Object.keys(hooks), [
    "config",
    "chat.message",
    "command.execute.before",
    "tool.execute.before",
    "tool.execute.after",
    "shell.env",
    "experimental.chat.messages.transform",
  ]);
  assert.equal(typeof hooks.config, "function");
  await assert.rejects(
    ScaffoldingPlugin({}, { plugins: ["scaffold"] }),
    /Unknown OpenCode plugin: scaffold/,
  );
  await assert.rejects(
    ScaffoldingPlugin({}, null),
    /options must be a plain object/,
  );
});

test("markdown parser accepts the supported flat frontmatter subset", async () => {
  const { parseMarkdown } = await import(markdownUrl);
  const parsed = parseMarkdown(
    "---\r\n" +
      "name: sample-skill\r\n" +
      "description: Plain value: with colon\r\n" +
      'quoted: "Double-quoted value"\r\n' +
      "hint: 'It''s supported'\r\n" +
      'allowed-tools: ["Read", "Bash"]\r\n' +
      "---\r\n\r\nPrompt body\r\n",
    "supported.md",
  );

  assert.deepEqual(parsed, {
    frontmatter: {
      name: "sample-skill",
      description: "Plain value: with colon",
      quoted: "Double-quoted value",
      hint: "It's supported",
      "allowed-tools": ["Read", "Bash"],
    },
    body: "Prompt body",
  });
});

test("markdown parser rejects ambiguous or unsupported frontmatter", async () => {
  const { parseMarkdown } = await import(markdownUrl);
  const invalid = [
    ["duplicate key", "name: first\nname: second"],
    ["indented or nested value", "name: first\n  nested: value"],
    ["block scalar", "description: |\nname: first"],
    ["malformed line", "name first"],
    ["ambiguous comment", "description: value # comment"],
    ["invalid double-quoted value", 'description: "unterminated'],
    ["invalid single-quoted value", "description: 'can't'"],
    ["invalid string list", 'allowed-tools: "Read"'],
    ["invalid string list", "allowed-tools: 'Read'"],
    ["flow mapping", "metadata: {owner: team}"],
    ["flow sequence", "metadata: [owner, team]"],
    ["anchor", "description: &shared value"],
    ["alias", "description: *shared"],
    ["unsupported YAML construct", "description: !custom value"],
    ["unsupported YAML construct", "description: - sequence item"],
  ];

  for (const [expectedError, frontmatter] of invalid) {
    assert.throws(
      () => parseMarkdown(`---\n${frontmatter}\n---\nBody`, "fixture.md"),
      new RegExp(`fixture\\.md: frontmatter line \\d+: ${expectedError}`),
    );
  }
});

test("selected plugins append only their exact canonical skill paths", async () => {
  const config = await applyPluginConfig(
    { plugins: ["workspace-init", "ossify"] },
    {},
  );

  assert.deepEqual(config.skills.paths, [
    fileURLToPath(new URL("workspace-init/skills", root)),
    fileURLToPath(new URL("ossify/skills", root)),
  ]);
});

test("config registration is idempotent and preserves caller config", async () => {
  const { ScaffoldingPlugin } = await import(marketplaceUrl);
  const hooks = await ScaffoldingPlugin({});
  const existingCommand = { template: "Keep this command" };
  const existingCritique = { template: "Use my critique workflow" };
  const config = {
    skills: {
      paths: ["/user/skills"],
      urls: ["https://example.com/skills/index.json"],
    },
    command: { existing: existingCommand, critique: existingCritique },
    permission: { skill: "ask" },
  };

  await hooks.config(config);
  await hooks.config(config);

  assert.deepEqual(config.skills, {
    paths: [
      "/user/skills",
      fileURLToPath(new URL("workspace-init/skills", root)),
      fileURLToPath(new URL("ai-mentor/skills", root)),
      fileURLToPath(new URL("architect-critic/skills", root)),
    ],
    urls: ["https://example.com/skills/index.json"],
  });
  assert.strictEqual(config.command.existing, existingCommand);
  assert.strictEqual(config.command.critique, existingCritique);
  assert.deepEqual(config.permission, { skill: "ask" });
  assert.equal(new Set(config.skills.paths).size, config.skills.paths.length);
});

test("canonical skills satisfy OpenCode frontmatter and uniqueness rules", async () => {
  const { PLUGIN_CATALOG } = await import(catalogUrl);
  const { parseMarkdown } = await import(markdownUrl);
  const names = new Set();

  for (const plugin of PLUGIN_CATALOG) {
    for (const skill of plugin.skills) {
      const source = await readFile(
        join(plugin.root, "skills", skill, "SKILL.md"),
        "utf8",
      );
      const { frontmatter } = parseMarkdown(source);

      assert.equal(frontmatter.name, skill);
      assert.match(frontmatter.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(frontmatter.name.length >= 1 && frontmatter.name.length <= 64);
      assert.ok(
        frontmatter.description.length >= 1 &&
          frontmatter.description.length <= 1024,
      );
      assert.ok(!names.has(frontmatter.name), `duplicate skill: ${skill}`);
      names.add(frontmatter.name);
    }
  }

  assert.equal(
    names.size,
    PLUGIN_CATALOG.reduce((total, plugin) => total + plugin.skills.length, 0),
  );
});

test("default config registers exactly the nine canonical command aliases", async () => {
  const { PLUGIN_CATALOG } = await import(catalogUrl);
  const { parseMarkdown } = await import(markdownUrl);
  const config = await applyPluginConfig(undefined, {});
  const expectedNames = Object.keys(expectedAliases);

  assert.deepEqual(Object.keys(config.command), expectedNames);
  assert.equal(expectedNames.length, 9);

  for (const [alias, skill] of Object.entries(expectedAliases)) {
    const plugin = PLUGIN_CATALOG.find(({ commands }) =>
      commands.some(({ name }) => name === alias),
    );
    const commandPath = join(plugin.root, "commands", `${alias}.md`);
    const source = await readFile(commandPath, "utf8");
    const { frontmatter } = parseMarkdown(source, commandPath);
    const argumentsLine =
      alias === "critique-doctor" ? "" : "\n\nArguments: $ARGUMENTS";

    assert.deepEqual(config.command[alias], {
      description: frontmatter.description,
      template:
        `Use OpenCode's \`skill\` tool to invoke the unqualified ` +
        `\`${skill}\` skill and follow it exactly.${argumentsLine}`,
    });
    assert.ok(!config.command[alias].template.includes("Skill("));
  }
});

test("same-named AI Mentor and Ossify skills do not get aliases", async () => {
  const config = await applyPluginConfig(
    { plugins: ["ai-mentor", "ossify"] },
    {},
  );

  assert.deepEqual(config.command, {});
});

test("Ossify selection registers the translated canonical implementer agent", async () => {
  const config = await applyPluginConfig({ plugins: ["ossify"] }, {});
  const agent = config.agent["ossify-implementer-agent"];
  const canonical = await readFile(ossifyAgentUrl, "utf8");
  const { parseMarkdown } = await import(markdownUrl);
  const { frontmatter, body } = parseMarkdown(
    canonical,
    fileURLToPath(ossifyAgentUrl),
  );
  const ossifyRoot = fileURLToPath(new URL("ossify", root)).replace(/\/$/, "");
  const externalDirectory = {
    "*": "ask",
    [ossifyRoot]: "allow",
    [join(ossifyRoot, "**")]: "allow",
  };

  assert.equal(agent.description, frontmatter.description);
  assert.equal(agent.mode, "subagent");
  assert.ok(!Object.hasOwn(agent, "model"));
  assert.equal(
    agent.prompt,
    body.replaceAll("${CLAUDE_PLUGIN_ROOT}", ossifyRoot),
  );
  assert.ok(!agent.prompt.includes("CLAUDE_PLUGIN_ROOT"));
  assert.ok(
    agent.prompt.includes(
      '{"mode": "complete", "report_path": "<abs path to report.md>", "summary": "<one-line>", "stage_status": "all_staged | partial | none"}',
    ),
  );
  assert.ok(
    agent.prompt.includes(
      '{"mode": "gaps-surfaced", "gaps": [{"section": "<ref>", "question": "<concrete question>", "severity": "blocking | nice-to-have"}, ...]}',
    ),
  );
  assert.match(agent.prompt, /You never commit\./);
  assert.deepEqual(Object.keys(agent.permission), [
    "*",
    "read",
    "edit",
    "glob",
    "grep",
    "bash",
    "task",
    "external_directory",
  ]);
  assert.deepEqual(agent.permission, {
    "*": "deny",
    read: "allow",
    edit: "allow",
    glob: "allow",
    grep: "allow",
    bash: "allow",
    task: "deny",
    external_directory: externalDirectory,
  });
  assert.deepEqual(Object.keys(agent.permission.external_directory), [
    "*",
    ossifyRoot,
    join(ossifyRoot, "**"),
  ]);
  const wildcardMatch = (input, pattern) => {
    const escaped = pattern
      .replaceAll("\\", "/")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`, process.platform === "win32" ? "si" : "s").test(
      input.replaceAll("\\", "/"),
    );
  };
  const permissionAction = (permission, path) => {
    const configured = agent.permission[permission];
    if (typeof configured === "string") return configured;
    return (
      Object.entries(configured).findLast(([pattern]) =>
        wildcardMatch(path, pattern),
      )?.[1] ?? "ask"
    );
  };
  const packageFile = join(ossifyRoot, "skills", "work-item", "SKILL.md");
  const siblingFile = join(ossifyRoot, "..", "ai-mentor", "README.md");
  const outsideFile = join(tmpdir(), "outside-opencode-project.txt");

  assert.equal(agent.permission.edit, "allow");
  assert.equal(permissionAction("external_directory", ossifyRoot), "allow");
  assert.equal(permissionAction("external_directory", packageFile), "allow");
  assert.equal(permissionAction("external_directory", siblingFile), "ask");
  assert.equal(permissionAction("external_directory", outsideFile), "ask");
});

test("the Ossify implementer agent is absent unless Ossify is selected", async () => {
  const defaultConfig = await applyPluginConfig(undefined, {});
  const withoutOssify = await applyPluginConfig(
    { plugins: ["workspace-init", "ai-mentor"] },
    {},
  );

  assert.ok(!defaultConfig.agent?.["ossify-implementer-agent"]);
  assert.ok(!withoutOssify.agent?.["ossify-implementer-agent"]);
});

test("Ossify rejects caller config that collides with its reserved agent", async () => {
  const callerAgent = {
    description: "Caller-owned agent",
    mode: "subagent",
  };
  for (const existing of [callerAgent, undefined]) {
    const hooks = await createPluginHooks({ plugins: ["ossify"] });
    const config = {
      agent: { "ossify-implementer-agent": existing },
    };

    await assert.rejects(
      hooks.config(config),
      /ossify-implementer-agent.*reserved.*collision/i,
    );
    assert.ok(Object.hasOwn(config.agent, "ossify-implementer-agent"));
    assert.strictEqual(config.agent["ossify-implementer-agent"], existing);
  }
});

test("non-Ossify config preserves the same caller-defined agent name", async () => {
  const callerAgent = {
    description: "Caller-owned agent",
    mode: "subagent",
  };
  const config = {
    agent: { "ossify-implementer-agent": callerAgent },
  };

  await applyPluginConfig({ plugins: ["workspace-init"] }, config);

  assert.strictEqual(config.agent["ossify-implementer-agent"], callerAgent);
});

test("prompt translation emits the complete OpenCode 1.18.13 task schema", async () => {
  const { translatePrompt } = await import(translateUrl);
  const translated = translatePrompt(
    'Skill(ai-mentor:grill-me)\n' +
      'Task(subagent_type="ossify:implementer-agent", prompt=<brief>)\n' +
      'task(description="Existing task", subagent_type="general", prompt="Keep me")\n' +
      'Task(subagent_type="other:agent", prompt=<other>)\n' +
      "Use AskUserQuestion if needed.",
    { root: "/opt/plugins/ossify" },
  );

  assert.equal(
    translated,
    'skill(name="grill-me")\n' +
      'task(description="Implement Ossify work item", subagent_type="ossify-implementer-agent", prompt=<brief>)\n' +
      'task(description="Existing task", subagent_type="general", prompt="Keep me")\n' +
      'Task(subagent_type="other:agent", prompt=<other>)\n' +
      "Use question if needed.",
  );
});

test("prompt translation resolves package placeholders in either shell form", async () => {
  const { translatePrompt } = await import(translateUrl);
  const translated = translatePrompt(
    "${CLAUDE_PLUGIN_ROOT}/references/policy.md\n" +
      "${CLAUDE_PLUGIN_DATA}/run.json\n" +
      "$CLAUDE_PLUGIN_ROOT/templates/default.md\n" +
      "$CLAUDE_PLUGIN_DATA/cache.json",
    {
      root: "/opt/plugins/ai-mentor",
      dataRoot: "/var/data/ai-mentor",
    },
  );

  assert.equal(
    translated,
    "/opt/plugins/ai-mentor/references/policy.md\n" +
      "/var/data/ai-mentor/run.json\n" +
      "/opt/plugins/ai-mentor/templates/default.md\n" +
      "/var/data/ai-mentor/cache.json",
  );
});

test("prompt path substitution preserves replacement tokens literally", async () => {
  const { translatePrompt } = await import(translateUrl);
  const rootPath = "/tmp/plugin-$&-$'-$`";
  const dataPath = "/tmp/data-$&-$'-$`";

  assert.equal(
    translatePrompt("${CLAUDE_PLUGIN_ROOT}/artifact", {
      root: rootPath,
      dataRoot: "/tmp/data",
    }),
    `${rootPath}/artifact`,
  );
  assert.equal(
    translatePrompt("$CLAUDE_PLUGIN_DATA/artifact", {
      root: "/tmp/plugin",
      dataRoot: dataPath,
    }),
    `${dataPath}/artifact`,
  );
});

test("auto-skill command translation requires selected package base metadata", async (t) => {
  const { getSkillOwner } = await import(catalogUrl);
  const hooks = await createPluginHooks({ plugins: ["ossify"] });
  const owner = getSkillOwner("plan-spine");
  const canonicalDirectory = join(owner.root, "skills", "plan-spine");
  const externalDirectory = await mkdtemp(
    join(tmpdir(), "opencode-colliding-command-"),
  );
  t.after(() => rm(externalDirectory, { recursive: true, force: true }));
  await writeFile(
    join(externalDirectory, "SKILL.md"),
    "---\nname: plan-spine\ndescription: External collision\n---\nExternal",
    "utf8",
  );
  const invocation = "Skill(ai-mentor:grill-me)";
  const cases = [
    ["canonical marker", canonicalDirectory, true],
    ["external collision", externalDirectory, false],
    ["absent marker", undefined, false],
    ["malformed marker", "", false],
    ["unresolvable marker", join(externalDirectory, "missing"), false],
  ];

  const mismatches = {};
  for (const [label, baseDirectory, shouldTranslate] of cases) {
    const marker =
      baseDirectory === undefined
        ? ""
        : `\nBase directory for this skill: ${baseDirectory}`;
    const output = { parts: [{ type: "text", text: invocation + marker }] };
    await hooks["command.execute.before"](
      {
        command: "plan-spine",
        sessionID: `auto-${label}`,
        arguments: "r1.s1",
      },
      output,
    );
    const expected =
      (shouldTranslate ? 'skill(name="grill-me")' : invocation) + marker;
    if (output.parts[0].text !== expected) {
      mismatches[label] = { actual: output.parts[0].text, expected };
    }
  }
  assert.deepEqual(mismatches, {});

  for (const command of ["critique", "project-command"]) {
    const unowned = {
      parts: [{ type: "text", text: "Skill(ai-mentor:grill-me)" }],
    };
    await hooks["command.execute.before"](
      { command, sessionID: "unowned", arguments: "" },
      unowned,
    );
    assert.equal(unowned.parts[0].text, "Skill(ai-mentor:grill-me)");
  }
});

test("registered package aliases translate without skill base metadata", async () => {
  const hooks = await createPluginHooks({ plugins: ["architect-critic"] });
  await hooks.config({});
  const output = {
    parts: [{ type: "text", text: "Skill(ai-mentor:grill-me)" }],
  };

  await hooks["command.execute.before"](
    { command: "critique", sessionID: "registered-alias", arguments: "" },
    output,
  );

  assert.equal(output.parts[0].text, 'skill(name="grill-me")');
});

test("caller-defined command collisions are not treated as package content", async () => {
  const hooks = await createPluginHooks({ plugins: ["architect-critic"] });
  const config = {
    command: {
      critique: { template: "Skill(ai-mentor:grill-me)" },
    },
  };
  await hooks.config(config);
  const output = {
    parts: [{ type: "text", text: config.command.critique.template }],
  };

  await hooks["command.execute.before"](
    { command: "critique", sessionID: "custom-command", arguments: "" },
    output,
  );

  assert.equal(output.parts[0].text, "Skill(ai-mentor:grill-me)");
});

test("skill output translation requires selected package directory evidence", async (t) => {
  const { getSkillOwner } = await import(catalogUrl);
  const hooks = await createPluginHooks({ plugins: ["ai-mentor"] });
  const owner = getSkillOwner("grill-me");
  const canonicalDirectory = join(owner.root, "skills", "grill-me");
  const externalDirectory = await mkdtemp(
    join(tmpdir(), "opencode-colliding-skill-"),
  );
  t.after(() => rm(externalDirectory, { recursive: true, force: true }));
  await writeFile(
    join(externalDirectory, "SKILL.md"),
    "---\nname: grill-me\ndescription: External collision\n---\nExternal",
    "utf8",
  );
  const source =
    "Policy: ${CLAUDE_PLUGIN_ROOT}/references/recommendation-policy.md\n" +
    "Use AskUserQuestion.";
  const translated =
    `Policy: ${join(owner.root, "references/recommendation-policy.md")}\n` +
    "Use question.";
  const cases = [
    ["canonical directory", { dir: canonicalDirectory }, translated],
    ["external collision", { dir: externalDirectory }, source],
    ["absent metadata", undefined, source],
    ["malformed metadata", { dir: 42 }, source],
    [
      "unresolvable metadata",
      { dir: join(externalDirectory, "missing") },
      source,
    ],
  ];

  const mismatches = {};
  for (const [label, metadata, expected] of cases) {
    const output = { output: source, metadata };
    await hooks["tool.execute.after"](
      {
        tool: "skill",
        sessionID: "skill-owner",
        callID: `skill-${label}`,
        args: { name: "grill-me" },
      },
      output,
    );
    if (output.output !== expected) {
      mismatches[label] = { actual: output.output, expected };
    }
  }
  assert.deepEqual(mismatches, {});
});

test("read translation uses real targets within selected plugin roots", async (t) => {
  const { getSkillOwner } = await import(catalogUrl);
  const hooks = await createPluginHooks({ plugins: ["ai-mentor"] });
  const owner = getSkillOwner("grill-me");
  const inside = join(owner.root, "skills", "grill-me", "SKILL.md");
  const outsideDirectory = await mkdtemp(
    join(tmpdir(), "opencode-runtime-read-"),
  );
  const siblingDirectory = await mkdtemp(`${owner.root.slice(0, -1)}-copy-`);
  const outsideFile = join(outsideDirectory, "project-notes.md");
  const outsideToInside = join(outsideDirectory, "package-skill.md");
  const insideToOutside = join(
    owner.root,
    `.opencode-runtime-outside-${process.pid}-${Date.now()}.md`,
  );
  const siblingFile = join(siblingDirectory, "reference.md");
  const nonexistent = join(
    owner.root,
    `.opencode-runtime-missing-${process.pid}-${Date.now()}.md`,
  );
  t.after(async () => {
    await rm(insideToOutside, { force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
    await rm(siblingDirectory, { recursive: true, force: true });
  });
  await writeFile(outsideFile, "project content", "utf8");
  await writeFile(siblingFile, "sibling content", "utf8");
  await symlink(inside, outsideToInside);
  await symlink(outsideFile, insideToOutside);

  const cases = [
    ["real package file", inside, true],
    ["outside symlink to package file", outsideToInside, true],
    ["package symlink to outside file", insideToOutside, false],
    ["existing sibling-prefix file", siblingFile, false],
    ["nonexistent package path", nonexistent, false],
  ];
  const source = "${CLAUDE_PLUGIN_ROOT}/marker AskUserQuestion";
  const translated = `${owner.root.slice(0, -1)}/marker question`;

  const mismatches = {};
  for (const [label, filePath, shouldTranslate] of cases) {
    const output = { output: source };
    await hooks["tool.execute.after"](
      {
        tool: "read",
        sessionID: "read-owner",
        callID: `read-${label}`,
        args: { filePath },
      },
      output,
    );
    const expected = shouldTranslate ? translated : source;
    if (output.output !== expected) {
      mismatches[label] = { actual: output.output, expected };
    }
  }
  assert.deepEqual(mismatches, {});
});

test("Task 6 lifecycle prepends status to the first user text without changing message shape", async (t) => {
  const { fixture, hooks } = await createLifecycleRuntime(
    t,
    '#!/bin/sh\nprintf "%s|%s\\n" "$CLAUDE_PLUGIN_ROOT" "$HOME"\n',
  );
  const output = transformOutput("task-6-shape", "Audit this spec");
  output.messages.unshift({
    info: {
      id: "assistant-message",
      sessionID: "task-6-shape",
      role: "assistant",
      time: { created: 0 },
    },
    parts: [
      {
        id: "assistant-part",
        sessionID: "task-6-shape",
        messageID: "assistant-message",
        type: "text",
        text: "Earlier answer",
      },
    ],
  });
  output.messages[1].parts.unshift({
    id: "file-part",
    sessionID: "task-6-shape",
    messageID: "message-task-6-shape",
    type: "file",
    mime: "text/plain",
    url: "file:///tmp/spec.md",
  });
  output.messages.push(transformOutput("task-6-shape", "Later request").messages[0]);
  const before = structuredClone(output);

  await hooks["experimental.chat.messages.transform"]({}, output);

  const expected = structuredClone(before);
  expected.messages[1].parts[1].text =
    `${fixture}|${process.env.HOME}\n` + before.messages[1].parts[1].text;
  assert.deepEqual(output, expected);
});

test("Task 6 lifecycle marks repeated and concurrent session transforms attempted once", async (t) => {
  const { fixture, hooks } = await createLifecycleRuntime(
    t,
    '#!/bin/sh\nprintf "call\\n" >> "$CLAUDE_PLUGIN_ROOT/calls"\nsleep 0.1\nprintf "ready\\n"\n',
  );
  const first = transformOutput("task-6-dedup", "First");
  const concurrent = transformOutput("task-6-dedup", "Concurrent");

  await Promise.all([
    hooks["experimental.chat.messages.transform"]({}, first),
    hooks["experimental.chat.messages.transform"]({}, concurrent),
  ]);
  await hooks["experimental.chat.messages.transform"](
    {},
    transformOutput("task-6-dedup", "Repeated"),
  );

  assert.equal(await readFile(join(fixture, "calls"), "utf8"), "call\n");
  assert.deepEqual(
    [first.messages[0].parts[0].text, concurrent.messages[0].parts[0].text].sort(),
    ["Concurrent", "ready\nFirst"].sort(),
  );
});

test("Task 6 lifecycle runs independent session IDs independently", async (t) => {
  const { fixture, hooks } = await createLifecycleRuntime(
    t,
    '#!/bin/sh\nprintf "call\\n" >> "$CLAUDE_PLUGIN_ROOT/calls"\nprintf "status\\n"\n',
  );
  const first = transformOutput("task-6-independent-a", "A");
  const second = transformOutput("task-6-independent-b", "B");

  await hooks["experimental.chat.messages.transform"]({}, first);
  await hooks["experimental.chat.messages.transform"]({}, second);

  assert.equal(await readFile(join(fixture, "calls"), "utf8"), "call\ncall\n");
  assert.equal(first.messages[0].parts[0].text, "status\nA");
  assert.equal(second.messages[0].parts[0].text, "status\nB");
});

test("Task 6 lifecycle failures, missing handlers, and empty output fail open once", async (t) => {
  const cases = [
    ["failure", '#!/bin/sh\nprintf "call\\n" >> "$CLAUDE_PLUGIN_ROOT/calls"\nexit 9\n'],
    ["empty", '#!/bin/sh\nprintf "call\\n" >> "$CLAUDE_PLUGIN_ROOT/calls"\n'],
    ["nonexecutable", "#!/bin/sh\nprintf unexpected\n", { mode: 0o644 }],
    ["missing", undefined],
  ];

  for (const [label, source, options] of cases) {
    const { fixture, hooks } = await createLifecycleRuntime(t, source, options);
    const first = transformOutput(`task-6-${label}`, "Unchanged");
    const second = transformOutput(`task-6-${label}`, "Also unchanged");
    const firstBefore = structuredClone(first);
    const secondBefore = structuredClone(second);

    await hooks["experimental.chat.messages.transform"]({}, first);
    await hooks["experimental.chat.messages.transform"]({}, second);

    assert.deepEqual(first, firstBefore, label);
    assert.deepEqual(second, secondBefore, label);
    if (label === "failure" || label === "empty") {
      assert.equal(await readFile(join(fixture, "calls"), "utf8"), "call\n");
    }
  }
});

test("Task 6 lifecycle hard-kills a hanging handler and fails open once", async (t) => {
  const { hooks } = await createLifecycleRuntime(
    t,
    '#!/bin/sh\nexec node -e \'process.on("SIGTERM", () => {}); setTimeout(() => {}, 500)\'\n',
    { sessionStartTimeoutMs: 150 },
  );
  const first = transformOutput("task-6-timeout", "Unchanged");
  const second = transformOutput("task-6-timeout", "Also unchanged");
  const firstBefore = structuredClone(first);
  const secondBefore = structuredClone(second);
  const started = Date.now();

  await hooks["experimental.chat.messages.transform"]({}, first);
  const elapsedMs = Date.now() - started;
  const repeatedStarted = Date.now();
  await hooks["experimental.chat.messages.transform"]({}, second);
  const repeatedElapsedMs = Date.now() - repeatedStarted;

  assert.ok(elapsedMs < 400, `hanging handler returned after ${elapsedMs}ms`);
  assert.ok(
    repeatedElapsedMs < 100,
    `repeated transform returned after ${repeatedElapsedMs}ms`,
  );
  assert.deepEqual(first, firstBefore);
  assert.deepEqual(second, secondBefore);
});

test("Task 6 lifecycle tolerates missing state, missing users, and malformed transforms", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "opencode-architect-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  t.after(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  });
  const hooks = await createPluginHooks({ plugins: ["architect-critic"] });
  const missingState = transformOutput("task-6-missing-state", "Request");

  await hooks["experimental.chat.messages.transform"]({}, missingState);
  assert.match(
    missingState.messages[0].parts[0].text,
    /^architect-critic v0\.3 installed; principles loaded from \(shipped defaults only\)\nRequest$/,
  );

  const malformed = [
    undefined,
    {},
    { messages: null },
    { messages: [] },
    { messages: [{ info: { role: "assistant", sessionID: "assistant-only" }, parts: [] }] },
    { messages: [{ info: { role: "user" }, parts: [] }] },
    { messages: [{ info: { role: "user", sessionID: "no-parts" }, parts: null }] },
    {
      messages: [
        {
          info: { role: "user", sessionID: "no-text" },
          parts: [{ type: "file", url: "file:///tmp/spec.md" }],
        },
      ],
    },
  ];
  for (const output of malformed) {
    const before = structuredClone(output);
    await hooks["experimental.chat.messages.transform"]({}, output);
    assert.deepEqual(output, before);
  }
});

test("Task 6 lifecycle excludes unselected Architect Critic and Workspace Init commit hooks", async (t) => {
  const { fixture, hooks } = await createLifecycleRuntime(
    t,
    '#!/bin/sh\nprintf "executed\\n" > "$CLAUDE_PLUGIN_ROOT/commit-hook-ran"\n',
    { plugin: "workspace-init" },
  );
  const gitHookDirectory = join(fixture, "hooks");
  await mkdir(gitHookDirectory);
  await writeFile(
    join(gitHookDirectory, "commit-msg.tmpl"),
    '#!/bin/sh\nprintf "executed\\n" > "$CLAUDE_PLUGIN_ROOT/commit-hook-ran"\n',
    { encoding: "utf8", mode: 0o755 },
  );
  const output = transformOutput("task-6-workspace-init", "Initialize workspace");
  const before = structuredClone(output);

  await hooks["experimental.chat.messages.transform"]({}, output);

  assert.deepEqual(output, before);
  await assert.rejects(readFile(join(fixture, "commit-hook-ran"), "utf8"), {
    code: "ENOENT",
  });
});

test("Task 6 overlay reaches owned critique commands and skill output exactly once", async (t) => {
  const hooks = await createPluginHooks({ plugins: ["architect-critic"] });
  const skillDirectory = fileURLToPath(
    new URL("architect-critic/skills/critiquing-spec", root),
  );
  const marker = "OpenCode host policy (binding)";
  const commandOutput = {
    parts: [
      {
        type: "text",
        text: `Canonical critique\nBase directory for this skill: ${skillDirectory}`,
      },
    ],
  };
  const skillOutput = {
    output: await readFile(join(skillDirectory, "SKILL.md"), "utf8"),
    metadata: { dir: skillDirectory },
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await hooks["command.execute.before"](
      {
        command: "critiquing-spec",
        sessionID: "task-6-overlay-command",
        arguments: "",
      },
      commandOutput,
    );
    await hooks["tool.execute.after"](
      {
        tool: "skill",
        sessionID: "task-6-overlay-skill",
        callID: `task-6-overlay-skill-${attempt}`,
        args: { name: "critiquing-spec" },
      },
      skillOutput,
    );
  }

  assert.equal(commandOutput.parts[0].text.split(marker).length - 1, 1);
  assert.equal(skillOutput.output.split(marker).length - 1, 1);

  const readOutput = { output: "Canonical critique read" };
  await hooks["tool.execute.after"](
    {
      tool: "read",
      sessionID: "task-6-overlay-read",
      callID: "task-6-overlay-read-call",
      args: { filePath: join(skillDirectory, "SKILL.md") },
    },
    readOutput,
  );
  assert.equal(readOutput.output, "Canonical critique read");

  const externalDirectory = await mkdtemp(
    join(tmpdir(), "opencode-colliding-critique-"),
  );
  t.after(() => rm(externalDirectory, { recursive: true, force: true }));
  const collisionOutput = {
    parts: [
      {
        type: "text",
        text: `External critique\nBase directory for this skill: ${externalDirectory}`,
      },
    ],
  };
  const beforeCollision = structuredClone(collisionOutput);
  await hooks["command.execute.before"](
    {
      command: "critiquing-spec",
      sessionID: "task-6-overlay-collision",
      arguments: "",
    },
    collisionOutput,
  );
  assert.deepEqual(collisionOutput, beforeCollision);
});

test("Task 6 overlay binds the OpenCode Architect Critic host policy", async () => {
  const hooks = await createPluginHooks({ plugins: ["architect-critic"] });
  const skillDirectory = fileURLToPath(
    new URL("architect-critic/skills/critiquing-spec", root),
  );
  const output = {
    output: await readFile(join(skillDirectory, "SKILL.md"), "utf8"),
    metadata: { dir: skillDirectory },
  };

  await hooks["tool.execute.after"](
    {
      tool: "skill",
      sessionID: "task-6-policy",
      callID: "task-6-policy-call",
      args: { name: "critiquing-spec" },
    },
    output,
  );

  const policy = markdownSection(
    output.output,
    "OpenCode host policy (binding)",
  );
  assert.deepEqual(parseMarkdownTable(policy), [
    {
      "Canonical decision point": "`HOST_AGENT` detection",
      "Binding OpenCode evaluation": "Set `HOST_AGENT=opencode`.",
    },
    {
      "Canonical decision point": "Every `HOST_AGENT=claude` condition and table row",
      "Binding OpenCode evaluation": "Evaluate it as `HOST_AGENT=opencode`.",
    },
    {
      "Canonical decision point": "Every `HOST_AGENT=claude` status branch",
      "Binding OpenCode evaluation": "Report the active OpenCode model as host and Codex availability as adversary status.",
    },
    {
      "Canonical decision point": "The `HOST_AGENT=claude` foreground close-depth branch",
      "Binding OpenCode evaluation": "Run Codex as the fresh-frame adversary.",
    },
    {
      "Canonical decision point": "The `HOST_AGENT=claude` async branch",
      "Binding OpenCode evaluation": "Reuse the Claude-host Codex spine only after its compatibility smoke passes.",
    },
    {
      "Canonical decision point": "Any `HOST_AGENT=codex` / Claude-adversary branch",
      "Binding OpenCode evaluation": "Never select or execute it.",
    },
  ]);
  assert.match(policy, /active OpenCode model performs the host self-audit/i);
  assert.match(policy, /record the async host as `opencode`/i);
  assert.match(policy, /keep canonical compatibility filenames.*`claude-audit\.json`/i);
  assert.match(policy, /explicit async preflight failure.*STOP.*no foreground fallback/is);
});

test("Task 6 overlay is restricted to the selected canonical critique workflow", async () => {
  const cases = [
    ["unselected", ["workspace-init"], "critiquing-spec"],
    ["other Architect Critic skill", ["architect-critic"], "listing-principles"],
  ];

  for (const [label, plugins, skill] of cases) {
    const hooks = await createPluginHooks({ plugins });
    const skillDirectory = fileURLToPath(
      new URL(`architect-critic/skills/${skill}`, root),
    );
    const output = {
      output: await readFile(join(skillDirectory, "SKILL.md"), "utf8"),
      metadata: { dir: skillDirectory },
    };
    const before = output.output;

    await hooks["tool.execute.after"](
      {
        tool: "skill",
        sessionID: `task-6-overlay-${label}`,
        callID: `task-6-overlay-${label}-call`,
        args: { name: skill },
      },
      output,
    );

    assert.ok(!output.output.includes("OpenCode host policy (binding)"), label);
    if (label === "unselected") assert.equal(output.output, before);
  }
});

test("Architect Critic command arguments survive their message then expire", async () => {
  const hooks = await createPluginHooks({ plugins: ["architect-critic"] });
  await hooks.config({});
  const commandOutput = {
    parts: [{ type: "text", text: "Run the native skill." }],
  };
  await hooks["command.execute.before"](
    {
      command: "critique",
      sessionID: "command-session",
      arguments: 'SPEC.md --close',
    },
    commandOutput,
  );

  await hooks["chat.message"](
    { sessionID: "command-session" },
    { message: { role: "user" }, parts: commandOutput.parts },
  );
  const commandEnv = { env: {} };
  await hooks["shell.env"](
    { cwd: fileURLToPath(root), sessionID: "command-session" },
    commandEnv,
  );
  assert.equal(commandEnv.env.ARCHITECT_CRITIC_ARGS, "SPEC.md --close");

  await hooks["chat.message"](
    { sessionID: "command-session" },
    {
      message: { role: "user" },
      parts: [{ type: "text", text: "Now do something unrelated" }],
    },
  );
  const expiredEnv = { env: {} };
  await hooks["shell.env"](
    { cwd: fileURLToPath(root), sessionID: "command-session" },
    expiredEnv,
  );
  assert.ok(!Object.hasOwn(expiredEnv.env, "ARCHITECT_CRITIC_ARGS"));
});

test("standalone cross-skill literal exports carry arguments by session", async () => {
  const hooks = await createPluginHooks({
    plugins: ["architect-critic", "ossify"],
  });
  await hooks["tool.execute.before"](
    { tool: "bash", sessionID: "cross-skill", callID: "call-4" },
    {
      args: {
        command:
          'export ARCHITECT_CRITIC_ARGS="--spec \\"/tmp/SPINE.md\\" --close"',
      },
    },
  );

  const capturedEnv = { env: {} };
  await hooks["shell.env"](
    { cwd: fileURLToPath(root), sessionID: "cross-skill" },
    capturedEnv,
  );
  assert.equal(
    capturedEnv.env.ARCHITECT_CRITIC_ARGS,
    '--spec "/tmp/SPINE.md" --close',
  );

  await hooks["tool.execute.before"](
    { tool: "bash", sessionID: "single-quoted", callID: "call-5" },
    {
      args: {
        command:
          "export ARCHITECT_CRITIC_ARGS='--spec \"/tmp/SPINE 2.md\" --close'",
      },
    },
  );
  const singleQuotedEnv = { env: {} };
  await hooks["shell.env"](
    { cwd: fileURLToPath(root), sessionID: "single-quoted" },
    singleQuotedEnv,
  );
  assert.equal(
    singleQuotedEnv.env.ARCHITECT_CRITIC_ARGS,
    '--spec "/tmp/SPINE 2.md" --close',
  );

  const otherEnv = { env: {} };
  await hooks["shell.env"](
    { cwd: fileURLToPath(root), sessionID: "other-session" },
    otherEnv,
  );
  assert.ok(!Object.hasOwn(otherEnv.env, "ARCHITECT_CRITIC_ARGS"));

  await hooks["chat.message"](
    { sessionID: "cross-skill" },
    {
      message: { role: "user" },
      parts: [{ type: "text", text: "New request" }],
    },
  );
  const clearedEnv = { env: {} };
  await hooks["shell.env"](
    { cwd: fileURLToPath(root), sessionID: "cross-skill" },
    clearedEnv,
  );
  assert.ok(!Object.hasOwn(clearedEnv.env, "ARCHITECT_CRITIC_ARGS"));
});

test("cross-skill export capture rejects non-literal or compound shell", async () => {
  const hooks = await createPluginHooks({ plugins: ["architect-critic"] });
  const rejected = [
    ["variable expansion", 'export ARCHITECT_CRITIC_ARGS="--spec $spec --close"'],
    [
      "dollar command substitution",
      'export ARCHITECT_CRITIC_ARGS="--spec $(pwd)/SPEC.md --close"',
    ],
    [
      "backtick command substitution",
      'export ARCHITECT_CRITIC_ARGS="--spec `pwd`/SPEC.md --close"',
    ],
    ["unquoted value", "export ARCHITECT_CRITIC_ARGS=--close"],
    ["unterminated quote", 'export ARCHITECT_CRITIC_ARGS="--close'],
    [
      "comment",
      'export ARCHITECT_CRITIC_ARGS="--close" # retain this value',
    ],
    ["pipeline", 'export ARCHITECT_CRITIC_ARGS="--close" | cat'],
    [
      "following command",
      'export ARCHITECT_CRITIC_ARGS="--close"; printf done',
    ],
    [
      "preceding command",
      'printf ready\nexport ARCHITECT_CRITIC_ARGS="--close"',
    ],
    [
      "multiple lines",
      'export ARCHITECT_CRITIC_ARGS="--close"\nprintf done',
    ],
    [
      "heredoc",
      'cat <<EOF\nexport ARCHITECT_CRITIC_ARGS="--close"\nEOF',
    ],
  ];

  const captured = [];
  for (const [label, command] of rejected) {
    const sessionID = `rejected-${label}`;
    await hooks["tool.execute.before"](
      { tool: "bash", sessionID, callID: `call-${label}` },
      { args: { command } },
    );
    const output = { env: {} };
    await hooks["shell.env"](
      { cwd: fileURLToPath(root), sessionID },
      output,
    );
    if (Object.hasOwn(output.env, "ARCHITECT_CRITIC_ARGS")) {
      captured.push(label);
    }
  }
  assert.deepEqual(captured, []);
});

test("Ossify package write guard rejects worktree-relative existing, new, and lexical targets", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const sessionID = "ossify-relative-package-write";
  await trackOssifySession(hooks, sessionID);
  const targets = [
    "ossify/skills/work-item/SKILL.md",
    "ossify/skills/work-item/new-runtime-guard-file.md",
    "tests/../ossify/README.md",
  ];

  for (const tool of ["edit", "write"]) {
    for (const [index, filePath] of targets.entries()) {
      await assert.rejects(
        hooks["tool.execute.before"](
          { tool, sessionID, callID: `${tool}-relative-${index}` },
          { args: { filePath } },
        ),
        /Ossify package is read-only/i,
        `${tool}: ${filePath}`,
      );
    }
  }
});

test("Ossify package write guard rejects absolute package targets", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const sessionID = "ossify-absolute-package-write";
  await trackOssifySession(hooks, sessionID);
  const ossifyRoot = fileURLToPath(new URL("ossify", root)).replace(/\/$/, "");
  const targets = [
    ossifyRoot,
    join(ossifyRoot, "skills", "work-item", "SKILL.md"),
    join(ossifyRoot, "skills", "work-item", "new-runtime-guard-file.md"),
  ];

  for (const tool of ["edit", "write"]) {
    for (const [index, filePath] of targets.entries()) {
      await assert.rejects(
        hooks["tool.execute.before"](
          { tool, sessionID, callID: `${tool}-absolute-${index}` },
          { args: { filePath } },
        ),
        /Ossify package is read-only/i,
        `${tool}: ${filePath}`,
      );
    }
  }
});

test("Ossify package write guard leaves project and external sibling targets unchanged", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "opencode-ossify-write-project-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const existingProjectFile = join(project, "existing.txt");
  await writeFile(existingProjectFile, "project fixture\n", "utf8");
  const hooks = await createRegisteredOssifyHooks(project);
  const sessionID = "ossify-allowed-project-write";
  await trackOssifySession(hooks, sessionID);
  const targets = [
    "existing.txt",
    "new/project-file.txt",
    fileURLToPath(new URL("ai-mentor/README.md", root)),
    join(fileURLToPath(new URL("ai-mentor", root)), "new-sibling-file.md"),
  ];

  for (const tool of ["edit", "write"]) {
    for (const [index, filePath] of targets.entries()) {
      const output = { args: { filePath, content: "unchanged" } };
      const before = structuredClone(output);
      await hooks["tool.execute.before"](
        { tool, sessionID, callID: `${tool}-allowed-${index}` },
        output,
      );
      assert.deepEqual(output, before, `${tool}: ${filePath}`);
    }
  }
});

test("Ossify package write guard rejects a project symlink into the package", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "opencode-ossify-write-symlink-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const ossifyRoot = fileURLToPath(new URL("ossify", root)).replace(/\/$/, "");
  await symlink(ossifyRoot, join(project, "package-link"));
  const hooks = await createRegisteredOssifyHooks(project);
  const sessionID = "ossify-symlink-package-write";
  await trackOssifySession(hooks, sessionID);

  for (const tool of ["edit", "write"]) {
    for (const filePath of [
      "package-link/README.md",
      "package-link/new-runtime-guard-file.md",
    ]) {
      await assert.rejects(
        hooks["tool.execute.before"](
          { tool, sessionID, callID: `${tool}-symlink-${filePath}` },
          { args: { filePath } },
        ),
        /Ossify package is read-only/i,
        `${tool}: ${filePath}`,
      );
    }
  }
});

test("Ossify package write guard does not trust reserved-name sessions before registration", async () => {
  const hooks = await createPluginHooks({ plugins: ["ossify"] });
  const sessionID = "ossify-unregistered-package-write";
  await trackOssifySession(hooks, sessionID);

  for (const tool of ["edit", "write"]) {
    const output = {
      args: { filePath: "ossify/README.md", content: "unchanged" },
    };
    const before = structuredClone(output);
    await hooks["tool.execute.before"](
      { tool, sessionID, callID: `${tool}-unregistered` },
      output,
    );
    assert.deepEqual(output, before, tool);
  }
});

test("Ossify package write guard leaves primary and other-agent sessions unchanged", async () => {
  const hooks = await createRegisteredOssifyHooks();
  await hooks["chat.message"](
    { sessionID: "other-agent-package-write", agent: "build" },
    { message: { role: "user" }, parts: [] },
  );

  for (const [label, sessionID] of [
    ["primary", "untracked-primary-package-write"],
    ["other agent", "other-agent-package-write"],
  ]) {
    for (const tool of ["edit", "write"]) {
      const output = {
        args: { filePath: "ossify/README.md", content: "unchanged" },
      };
      const before = structuredClone(output);
      await hooks["tool.execute.before"](
        { tool, sessionID, callID: `${tool}-${label}` },
        output,
      );
      assert.deepEqual(output, before, `${label}: ${tool}`);
    }
  }
});

test("Ossify package write guard rejects Bash redirects into the package (Codex C3)", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const sessionID = "ossify-bash-redirect-package-write";
  await trackOssifySession(hooks, sessionID);
  const ossifyRoot = fileURLToPath(new URL("ossify", root)).replace(/\/$/, "");

  // > and >> redirects whose target resolves inside the package root.
  const rejected = [
    ["relative redirect", `printf x > ossify/lib/state.sh`],
    ["relative append", `printf x >> ossify/lib/state.sh`],
    ["absolute redirect", `printf x > ${ossifyRoot}/lib/state.sh`],
    ["lexical traversal", `printf x > tests/../ossify/README.md`],
    ["redirect mid-pipeline", `echo y | tee /dev/null > ossify/README.md`],
  ];
  for (const [label, command] of rejected) {
    await assert.rejects(
      hooks["tool.execute.before"](
        { tool: "bash", sessionID, callID: `reject-${label}` },
        { args: { command } },
      ),
      /Ossify package is read-only/i,
      `${label}: ${command}`,
    );
  }

  // A quoted ">" is NOT a redirect, and a redirect into the project/external
  // tree is allowed — both must pass through unchanged (no false positives).
  const project = await mkdtemp(join(tmpdir(), "opencode-ossify-bash-redirect-"));
  const projectHooks = await createRegisteredOssifyHooks(project);
  const projectSession = "ossify-bash-redirect-project";
  await trackOssifySession(projectHooks, projectSession);
  const allowed = [
    `echo ">" unrelated`,
    `printf x > existing.txt`,
    `printf x >> new/project-file.txt`,
  ];
  for (const [index, command] of allowed.entries()) {
    const output = { args: { command } };
    const before = structuredClone(output);
    await projectHooks["tool.execute.before"](
      { tool: "bash", sessionID: projectSession, callID: `allow-${index}` },
      output,
    );
    assert.deepEqual(output, before, `allowed: ${command}`);
  }
});

test("Ossify package write guard fails closed on malformed target-session calls", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const sessionID = "ossify-malformed-package-write";
  await trackOssifySession(hooks, sessionID);
  const malformed = [
    undefined,
    null,
    { args: {} },
    { args: { filePath: null } },
    { args: { filePath: 42 } },
    { args: { filePath: "" } },
    { args: { filePath: "   " } },
  ];

  for (const tool of ["edit", "write"]) {
    for (const [index, output] of malformed.entries()) {
      await assert.rejects(
        hooks["tool.execute.before"](
          { tool, sessionID, callID: `${tool}-malformed-${index}` },
          output,
        ),
        /Ossify package is read-only.*valid nonempty filePath/i,
        `${tool}: ${index}`,
      );
    }
  }
});

test("Ossify implementer sessions reject forbidden Git verbs anywhere in bash logs", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const forbidden = [
    ["ordinary commit", "git commit -m work"],
    ["ordinary push", "git push origin topic"],
    ["ordinary pull", "git pull --ff-only"],
    ["ordinary fetch", "git fetch --all"],
    ["worktree option", "git -C /tmp/worktree commit -m work"],
    ["git directory option", "git --git-dir /tmp/repo/.git push"],
    ["equals git directory", "git --git-dir=/tmp/repo/.git pull"],
    [
      "work tree option",
      "git --git-dir=/tmp/repo/.git --work-tree /tmp/repo fetch",
    ],
    ["config option", "git -c user.name=worker commit -m work"],
    [
      "combined global options",
      "git -C /tmp/repo -c user.email=worker@example.test push",
    ],
    ["absolute executable", "/usr/bin/git commit -m work"],
    ["path executable", "./tools/git fetch origin"],
    ["quoted executable", "\"/usr/local/bin/git\" pull"],
    ["single-quoted full command", "printf '%s\\n' 'git commit -m work'"],
    ["double-quoted full command", 'printf "%s\\n" "git fetch --all"'],
    ["ANSI-C nested commit", "bash -c $'git commit -m nested'"],
    ["ANSI-C eval push", "eval $'git push origin topic'"],
    [
      "ANSI-C hex whitespace",
      String.raw`bash -c $'git\x20commit -m nested'`,
    ],
    [
      "ANSI-C eval hex whitespace",
      String.raw`eval $'git\x20push origin topic'`,
    ],
    ["ANSI-C tab whitespace", String.raw`bash -c $'git\tpull --ff-only'`],
    ["ANSI-C octal whitespace", String.raw`bash -c $'git\040fetch --all'`],
    [
      "ANSI-C short Unicode whitespace",
      String.raw`bash -c $'git\u0020commit -m nested'`,
    ],
    [
      "ANSI-C long Unicode whitespace",
      String.raw`bash -c $'git\U00000020push origin topic'`,
    ],
    ["quoted executable piece", "/usr/bin/'git' fetch origin"],
    [
      "review repro quoted worktree",
      'git -C "/tmp/ossify worktree" commit -m work',
    ],
    [
      "review repro quoted git directories",
      'git --git-dir "/tmp/repo data/.git" --work-tree "/tmp/work tree" push',
    ],
    [
      "review repro quoted executable and exec path",
      '"/opt/git tools/bin/git" --exec-path="/opt/git tools/libexec" fetch',
    ],
    [
      "escaped worktree whitespace",
      String.raw`git -C /tmp/ossify\ worktree pull`,
    ],
    ["namespace equals", 'git --namespace="worker namespace" commit'],
    ["super prefix", 'git --super-prefix "worker prefix/" push'],
    [
      "config environment",
      "git --config-env safe.directory=SAFE_DIRECTORY fetch",
    ],
    ["attribute source", 'git --attr-source "topic branch" commit'],
    ["comment", 'git status --short # never run "git fetch" here'],
    ["leading hash boundary", "#git commit -m work"],
    ["inline hash boundary", "echo ok #git fetch --all"],
    ["quoted hash boundary", `printf '%s\\n' "#git push origin topic"`],
    [
      "heredoc",
      'cat <<\'EOF\' > instructions.txt\nNever run "git pull" here.\nEOF',
    ],
    [
      "heredoc hash boundary",
      'cat <<\'EOF\' > instructions.txt\n"#git pull"\nEOF',
    ],
    ["pipeline", "printf ready | git fetch origin"],
    ["tab whitespace", "git\tcommit -m work"],
    ["multiline whitespace", "git\nfetch --all"],
  ];

  const rejected = [];
  for (const [label, command] of forbidden) {
    const sessionID = `ossify-forbidden-${label}`;
    await hooks["chat.message"](
      { sessionID, agent: "ossify-implementer-agent" },
      { message: { role: "user" }, parts: [] },
    );
    await assert.rejects(
      hooks["tool.execute.before"](
        { tool: "bash", sessionID, callID: `call-${label}` },
        { args: { command } },
      ),
      /ossify-implementer-agent.*git (?:commit|push|pull|fetch)/i,
    );
    rejected.push(label);
  }

  assert.deepEqual(
    rejected,
    forbidden.map(([label]) => label),
  );
});

test("Ossify Git guard allows only canonical operations in representative literal forms", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const sessionID = "ossify-allowed-git";
  await hooks["chat.message"](
    { sessionID, agent: "ossify-implementer-agent" },
    { message: { role: "user" }, parts: [] },
  );
  const operations = [
    "status --porcelain",
    "rev-parse --abbrev-ref HEAD",
    "diff --cached",
    "add -A",
  ];
  const allowed = operations.flatMap((operation) => [
    `git ${operation}`,
    `/usr/bin/git ${operation}`,
    `git -C /tmp/worktree --git-dir=.git -c color.ui=false ${operation}`,
    `'git ${operation}'`,
    `bash -c "git ${operation}"`,
  ]);
  allowed.push(
    "git --exec-path commit",
    "git --html-path commit",
    "git --man-path push",
    "git --info-path pull",
    "git --version fetch",
    "git -v commit",
    "git --help push",
    "git -h pull",
    "git --list-cmds commit",
    "git --list-cmds=builtins commit",
    "git --config-env safe.directory=SAFE_DIRECTORY status --short",
    "git -ccolor.ui=false status --short",
    'git -C /tmp/"repo data" status --short',
    'git -c color.ui="auto always" status --short',
    "git --version; commit is-a-different-command",
    "npm test",
    "printf '%s\\n' ready",
    "cat <<'EOF'\nit's ready\nEOF",
  );

  for (const [index, command] of allowed.entries()) {
    const output = { args: { command, description: "unchanged" } };
    const before = structuredClone(output);
    await hooks["tool.execute.before"](
      { tool: "bash", sessionID, callID: `allowed-${index}` },
      output,
    );
    assert.deepEqual(output, before, command);
  }
});

test("Ossify Git guard rejects aliases and every non-canonical Git subcommand", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const sessionID = "ossify-git-aliases";
  await hooks["chat.message"](
    { sessionID, agent: "ossify-implementer-agent" },
    { message: { role: "user" }, parts: [] },
  );
  const forbidden = [
    [
      "direct commit",
      "git -c alias.ci=commit ci -m work",
      /inline git alias/i,
    ],
    [
      "direct pull",
      "git -c alias.update=pull update --ff-only",
      /inline git alias/i,
    ],
    [
      "shell push",
      "git -c 'alias.publish=!git push origin topic' publish",
      /inline git alias/i,
    ],
    [
      "shell fetch",
      "git -c 'alias.sync=!git fetch --all' sync",
      /inline git alias/i,
    ],
    [
      "chained aliases",
      "git -c alias.a=b -c alias.b=commit a",
      /inline git alias/i,
    ],
    [
      "case-insensitive alias key",
      "git -c ALIAS.ci=commit ci",
      /inline git alias/i,
    ],
    [
      "attached alias config",
      "git -calias.ci=commit status",
      /inline git alias/i,
    ],
    [
      "attached uppercase alias config",
      "git -cALIAS.ci=commit status",
      /inline git alias/i,
    ],
    [
      "attached mixed-case alias config",
      "git -cAlias.CI=commit status",
      /inline git alias/i,
    ],
    [
      "attached equals alias config",
      "git -c=alias.ci=commit status",
      /inline git alias/i,
    ],
    [
      "config environment alias",
      "COMMIT_ALIAS=commit git --config-env=alias.ci=COMMIT_ALIAS ci",
      /inline git alias/i,
    ],
    [
      "separate config environment alias",
      "COMMIT_ALIAS=commit git --config-env ALIAS.ci=COMMIT_ALIAS ci",
      /inline git alias/i,
    ],
    [
      "safe direct alias",
      "git -c alias.st=status st --short",
      /inline git alias/i,
    ],
    [
      "safe config environment alias",
      "SAFE_ALIAS=status git --config-env=alias.st=SAFE_ALIAS st --short",
      /inline git alias/i,
    ],
    [
      "unknown configured alias",
      "git ci -m work",
      /unknown git subcommand.*ci/i,
    ],
    [
      "environment-configured alias",
      "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git ci -m work",
      /unknown git subcommand.*ci/i,
    ],
    [
      "quoted unknown path-qualified operation",
      "printf '%s\\n' '/usr/bin/git banana'",
      /unknown git subcommand.*banana/i,
    ],
    ["branch builtin", "git branch --show-current", /git subcommand.*branch/i],
    ["log builtin", "git log -1 --oneline", /git subcommand.*log/i],
    ["show builtin", "git show --stat HEAD", /git subcommand.*show/i],
    ["worktree builtin", "git worktree list", /git subcommand.*worktree/i],
    [
      "repository alias using version-dependent repo name",
      "git -C /tmp/repo repo",
      /git subcommand.*repo/i,
    ],
    [
      "environment alias using version-dependent backfill name",
      "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.backfill GIT_CONFIG_VALUE_0=status git backfill",
      /git subcommand.*backfill/i,
    ],
    ["deprecated stage name", "git stage -A", /git subcommand.*stage/i],
    [
      "allowed occurrence before denied occurrence",
      `printf '%s\\n' "git status; git branch --show-current"`,
      /git subcommand.*branch/i,
    ],
    [
      "nested allowed occurrence before forbidden occurrence",
      "bash -c 'git status; git commit -m nested'",
      /git commit/i,
    ],
    [
      "deprecated whatchanged name",
      "git whatchanged --oneline",
      /git subcommand.*whatchanged/i,
    ],
    [
      "safe inline config before non-canonical operation",
      "git -c color.ui=false branch --show-current",
      /git subcommand.*branch/i,
    ],
    [
      "inline config without a canonical operation",
      "git -c color.ui=false",
      /canonical git subcommand/i,
    ],
    [
      "dispatcher builtin",
      "git for-each-repo --config=maintenance.repo commit",
      /git subcommand.*for-each-repo/i,
    ],
  ];

  for (const [label, command, error] of forbidden) {
    await assert.rejects(
      hooks["tool.execute.before"](
        { tool: "bash", sessionID, callID: `alias-${label}` },
        { args: { command } },
      ),
      error,
      label,
    );
  }
});

test("Ossify Git guard normalizes shell quote syntax across the full command text", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const sessionID = "ossify-nested-shell";
  await hooks["chat.message"](
    { sessionID, agent: "ossify-implementer-agent" },
    { message: { role: "user" }, parts: [] },
  );
  const forbidden = [
    ["bash commit", "bash -c 'git commit -m nested'"],
    ["path sh push", '"/bin/sh" -c "git push origin topic"'],
    ["path zsh pull", "/bin/zsh -c 'git pull --ff-only'"],
    ["eval fetch", "eval 'git fetch --all'"],
    ["nested eval", `bash -c "eval 'git commit -m deep'"`],
    ["bash separator commit", 'bash -c -- "git commit -m nested"'],
    ["sh separator push", "sh -c -- 'git push origin topic'"],
    ["zsh separator fetch", "zsh -c -- 'git fetch --all'"],
    ["combined bash options", "bash -lc -- 'git pull --ff-only'"],
    ["combined sh options", "sh -xec -- 'git commit -m nested'"],
    ["single-quoted prose", "printf '%s\\n' 'git commit -m nested'"],
    ["double-quoted prose", 'printf "%s\\n" "git fetch --all"'],
    ["ANSI-C shell string", "bash -c $'git push origin topic'"],
    ["ANSI-C eval string", "eval $'git pull --ff-only'"],
  ];

  for (const [label, command] of forbidden) {
    await assert.rejects(
      hooks["tool.execute.before"](
        { tool: "bash", sessionID, callID: `nested-${label}` },
        { args: { command } },
      ),
      /ossify-implementer-agent.*git (?:commit|push|pull|fetch)/i,
      label,
    );
  }

  for (const command of [
    "sh -c 'git status --short'",
    'bash -c "git diff --cached"',
    "zsh -c 'git add -A'",
    "eval 'git rev-parse HEAD'",
    "bash -c -- 'git status --short'",
    "sh -ec -- 'git diff --cached'",
    "zsh -fc -- 'git add -A'",
  ]) {
    const output = { args: { command } };
    await hooks["tool.execute.before"](
      { tool: "bash", sessionID, callID: `allowed-nested-${command}` },
      output,
    );
    assert.equal(output.args.command, command);
  }
});

test("Ossify Git guard is not a shell validator", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const sessionID = "ossify-literal-audit-not-shell-validator";
  await hooks["chat.message"](
    { sessionID, agent: "ossify-implementer-agent" },
    { message: { role: "user" }, parts: [] },
  );
  const allowed = [
    "cat <<'EOF'\nit's ready\nEOF",
    "printf %s it's",
    "printf %s it's; git -C /tmp status",
    `printf 'oops; git -C "/tmp/repo data" status`,
    `printf "oops; git -c color.ui='auto always' status`,
    "printf `oops; git -C \"/tmp/repo data\" status",
    `printf $'oops; git -c color.ui="auto always" status`,
    "bash -c",
    "sh -xec --",
  ];
  const rejected = [];
  for (const [index, command] of allowed.entries()) {
    const output = { args: { command } };
    try {
      await hooks["tool.execute.before"](
        { tool: "bash", sessionID, callID: `literal-audit-${index}` },
        output,
      );
      assert.equal(output.args.command, command);
    } catch (error) {
      rejected.push([command, error.message]);
    }
  }
  assert.deepEqual(rejected, []);
});

test("Ossify Git guard decodes bounded ANSI-C whitespace escapes", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const sessionID = "ossify-ansi-c-whitespace";
  await hooks["chat.message"](
    { sessionID, agent: "ossify-implementer-agent" },
    { message: { role: "user" }, parts: [] },
  );
  const forbidden = [
    ["hex tab", String.raw`bash -c $'git\x09commit -m nested'`],
    [
      "nested outer quote hex tab",
      String.raw`printf "%s" "bash -c $'git\x09commit -m work'"`,
    ],
    ["three-digit octal tab", String.raw`bash -c $'git\011push origin topic'`],
    ["two-digit octal tab", String.raw`bash -c $'git\11pull --ff-only'`],
    ["short Unicode tab", String.raw`bash -c $'git\u0009fetch --all'`],
    ["long Unicode tab", String.raw`bash -c $'git\U00000009commit -m nested'`],
  ];
  const accepted = [];
  for (const [label, command] of forbidden) {
    try {
      await hooks["tool.execute.before"](
        { tool: "bash", sessionID, callID: `ansi-whitespace-${label}` },
        { args: { command } },
      );
      accepted.push(label);
    } catch (error) {
      assert.match(
        error.message,
        /ossify-implementer-agent.*git (?:commit|push|pull|fetch)/i,
        label,
      );
    }
  }
  assert.deepEqual(accepted, []);

  const rejectedNonBoundaries = [];
  for (const [label, command] of [
    ["vertical tab", String.raw`$'git\x0bcommit -m work'`],
    ["form feed", String.raw`$'git\014push origin topic'`],
    ["non-breaking space", String.raw`$'git\u00a0pull --ff-only'`],
  ]) {
    const output = { args: { command } };
    try {
      await hooks["tool.execute.before"](
        { tool: "bash", sessionID, callID: `ansi-non-boundary-${label}` },
        output,
      );
      assert.equal(output.args.command, command, label);
    } catch (error) {
      rejectedNonBoundaries.push([label, error.message]);
    }
  }
  assert.deepEqual(rejectedNonBoundaries, []);
});

test("Ossify Git guard preserves shell-concatenated option pieces", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const sessionID = "ossify-concatenated-options";
  await hooks["chat.message"](
    { sessionID, agent: "ossify-implementer-agent" },
    { message: { role: "user" }, parts: [] },
  );
  const aliases = [
    'git -ca"lias".ci=commit status',
    'git -calias"."ci=commit status',
    'git -c a"lias".ci=commit status',
    'git --config-env=a"lias".ci=ENV status',
    "git -ca'lias'.ci=commit status",
    "git -c a'lias'.ci=commit status",
    "git --config-env=a'lias'.ci=ENV status",
  ];
  const accepted = [];
  for (const [index, command] of aliases.entries()) {
    try {
      await hooks["tool.execute.before"](
        { tool: "bash", sessionID, callID: `concatenated-alias-${index}` },
        { args: { command } },
      );
      accepted.push(command);
    } catch (error) {
      assert.match(error.message, /inline git alias/i, command);
    }
  }
  assert.deepEqual(accepted, []);

  for (const [index, command] of [
    'git -cu"ser".name=worker status',
    'git -c u"ser".name=worker status',
    'git --config-env=c"olor".ui=ENV status',
  ].entries()) {
    await hooks["tool.execute.before"](
      { tool: "bash", sessionID, callID: `concatenated-safe-${index}` },
      { args: { command } },
    );
  }
});

test("Ossify Git guard keeps quoted separators inside option values", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const sessionID = "ossify-quoted-option-separators";
  await hooks["chat.message"](
    { sessionID, agent: "ossify-implementer-agent" },
    { message: { role: "user" }, parts: [] },
  );
  const allowed = [
    'git -c user.name="A#B" status',
    'git -C "/tmp/#repo" status',
    'git -c core.editor="printf a;b" diff',
  ];
  const rejected = [];
  for (const [index, command] of allowed.entries()) {
    try {
      await hooks["tool.execute.before"](
        { tool: "bash", sessionID, callID: `quoted-separator-${index}` },
        { args: { command } },
      );
    } catch (error) {
      rejected.push([command, error.message]);
    }
  }
  assert.deepEqual(rejected, []);
});

test("Ossify Git guard groups nested quoted option values", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const sessionID = "ossify-nested-quoted-options";
  await hooks["chat.message"](
    { sessionID, agent: "ossify-implementer-agent" },
    { message: { role: "user" }, parts: [] },
  );
  const allowed = [
    `bash -c 'git -C "/tmp/repo data" status'`,
    `'git -C "/tmp/repo data" rev-parse HEAD'`,
    `bash -c "git -c color.ui='auto always' diff"`,
    `bash -c 'git -c user.name="A#B" add -A'`,
  ];
  const rejected = [];

  for (const [index, command] of allowed.entries()) {
    try {
      await hooks["tool.execute.before"](
        { tool: "bash", sessionID, callID: `nested-quoted-${index}` },
        { args: { command } },
      );
    } catch (error) {
      rejected.push([command, error.message]);
    }
  }

  assert.deepEqual(rejected, []);
});

test("Ossify Git guard finds forbidden verbs after nested quoted values", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const sessionID = "ossify-nested-quoted-forbidden";
  await hooks["chat.message"](
    { sessionID, agent: "ossify-implementer-agent" },
    { message: { role: "user" }, parts: [] },
  );

  await assert.rejects(
    hooks["tool.execute.before"](
      { tool: "bash", sessionID, callID: "nested-quoted-commit" },
      { args: { command: `bash -c 'git -C "/tmp/repo data" commit -m work'` } },
    ),
    /ossify-implementer-agent.*git commit/i,
  );
});

test("Ossify Git guard treats contraction apostrophes as plain text", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const sessionID = "ossify-contraction-apostrophe";
  await hooks["chat.message"](
    { sessionID, agent: "ossify-implementer-agent" },
    { message: { role: "user" }, parts: [] },
  );
  const command = "printf %s it's git -C /tmp status";

  await hooks["tool.execute.before"](
    { tool: "bash", sessionID, callID: "contraction-apostrophe" },
    { args: { command } },
  );
});

test("Git guard applies only to Ossify implementer bash sessions", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const cases = [
    ["untracked session", "bash", "untracked"],
    ["other agent", "bash", "other-agent"],
    ["non-bash tool", "read", "ossify-read"],
  ];
  await hooks["chat.message"](
    { sessionID: "other-agent", agent: "build" },
    { message: { role: "user" }, parts: [] },
  );
  await hooks["chat.message"](
    { sessionID: "ossify-read", agent: "ossify-implementer-agent" },
    { message: { role: "user" }, parts: [] },
  );

  for (const [label, tool, sessionID] of cases) {
    const output = { args: { command: "git commit -m work" } };
    const before = structuredClone(output);
    await hooks["tool.execute.before"](
      { tool, sessionID, callID: label },
      output,
    );
    assert.deepEqual(output, before, label);
  }

  await hooks["chat.message"](
    { sessionID: "ossify-read", agent: "build" },
    { message: { role: "user" }, parts: [] },
  );
  await hooks["tool.execute.before"](
    { tool: "bash", sessionID: "ossify-read", callID: "agent-changed" },
    { args: { command: "git push" } },
  );
});

test("chat messages without a valid agent preserve tracked session identity", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const followups = [
    ["missing", {}],
    ["undefined", { agent: undefined }],
    ["empty", { agent: "" }],
    ["blank", { agent: "   " }],
  ];

  for (const [label, followup] of followups) {
    const sessionID = `ossify-agent-preserved-${label}`;
    await hooks["chat.message"](
      { sessionID, agent: "ossify-implementer-agent" },
      { message: { role: "user" }, parts: [] },
    );
    await hooks["chat.message"](
      { sessionID, ...followup },
      { message: { role: "user" }, parts: [] },
    );

    await assert.rejects(
      hooks["tool.execute.before"](
        { tool: "bash", sessionID, callID: `preserved-${label}` },
        { args: { command: "git commit -m work" } },
      ),
      /ossify-implementer-agent.*git commit/i,
      label,
    );
  }
});

test("Git guard does not trust reserved-name sessions before agent registration", async () => {
  const hooks = await createPluginHooks({ plugins: ["ossify"] });
  const sessionID = "ossify-unvalidated-agent";
  await hooks["chat.message"](
    { sessionID, agent: "ossify-implementer-agent" },
    { message: { role: "user" }, parts: [] },
  );
  const output = { args: { command: "git commit -m work" } };

  await hooks["tool.execute.before"](
    { tool: "bash", sessionID, callID: "unvalidated-agent" },
    output,
  );

  assert.equal(output.args.command, "git commit -m work");
});

test("Git guard fails closed on malformed Ossify implementer bash calls", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const sessionID = "ossify-malformed-bash";
  await hooks["chat.message"](
    { sessionID, agent: "ossify-implementer-agent" },
    { message: { role: "user" }, parts: [] },
  );

  for (const command of [undefined, null, 42]) {
    await assert.rejects(
      hooks["tool.execute.before"](
        {
          tool: "bash",
          sessionID: "untracked",
          callID: `malformed-${command}`,
        },
        { args: { command } },
      ),
      /valid bash command/i,
    );
  }

  for (const invalidSessionID of [undefined, null, "", "   ", 42]) {
    await assert.rejects(
      hooks["tool.execute.before"](
        {
          tool: "bash",
          sessionID: invalidSessionID,
          callID: `malformed-session-${invalidSessionID}`,
        },
        { args: { command: "git status --short" } },
      ),
      /valid nonempty sessionID/i,
    );
  }

  const nonBashOutput = { args: { command: 42 } };
  const before = structuredClone(nonBashOutput);
  await hooks["tool.execute.before"](
    { tool: "read", callID: "non-bash-malformed" },
    nonBashOutput,
  );
  assert.deepEqual(nonBashOutput, before);
});

test("Git guard boundary excludes deliberately shell-obfuscated executable names", async () => {
  const hooks = await createRegisteredOssifyHooks();
  const sessionID = "ossify-obfuscated-git";
  await hooks["chat.message"](
    { sessionID, agent: "ossify-implementer-agent" },
    { message: { role: "user" }, parts: [] },
  );
  const boundaryExamples = [
    "g''it commit -m work",
    "$GIT push origin topic",
    String.raw`bash -c $'\x67it commit -m work'`,
    String.raw`printf "%s" "bash -c $'\x67it commit -m work'"`,
  ];

  for (const command of boundaryExamples) {
    const output = { args: { command } };
    await hooks["tool.execute.before"](
      { tool: "bash", sessionID, callID: `boundary-${command}` },
      output,
    );
    assert.equal(output.args.command, command);
  }
});

test("shell environment exposes capabilities and prepends wrappers idempotently", async () => {
  const hooks = await createPluginHooks();
  const callerPath = ["/caller/bin", wrapperDirectory, "/caller/tools"].join(
    delimiter,
  );
  const output = { env: { PATH: callerPath } };

  await hooks["shell.env"](
    { cwd: fileURLToPath(root), sessionID: "wrapper-path" },
    output,
  );
  await hooks["shell.env"](
    { cwd: fileURLToPath(root), sessionID: "wrapper-path" },
    output,
  );

  assert.deepEqual(output.env.PATH.split(delimiter), [
    wrapperDirectory,
    "/caller/bin",
    "/caller/tools",
  ]);
  assert.equal(
    output.env[selectedPluginsEnvironment],
    expectedPlugins.slice(0, 3).join(":"),
  );
});

test("default capabilities reject the experimental oss wrapper", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "opencode-wrapper-default-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const hooks = await createPluginHooks();
  const output = { env: { PATH: process.env.PATH ?? "" } };
  await hooks["shell.env"](
    { cwd: fixture, sessionID: "default-wrapper" },
    output,
  );

  const result = spawnSync("oss", ["--help"], {
    cwd: fixture,
    encoding: "utf8",
    env: { ...process.env, ...output.env },
  });

  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /ossify.*not selected/i);
});

test("each wrapper rejects execution when its owning plugin is not selected", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "opencode-wrapper-rejection-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const hooks = await createPluginHooks({ plugins: ["ai-mentor"] });
  const output = { env: { PATH: process.env.PATH ?? "" } };
  await hooks["shell.env"](
    { cwd: fixture, sessionID: "unselected-wrappers" },
    output,
  );

  for (const [command, owner] of [
    ["wi", "workspace-init"],
    ["arc", "architect-critic"],
    ["oss", "ossify"],
  ]) {
    const result = spawnSync(command, ["--list"], {
      cwd: fixture,
      encoding: "utf8",
      env: { ...process.env, ...output.env },
    });
    assert.equal(result.status, 2, command);
    assert.equal(result.stdout, "", command);
    assert.match(result.stderr, new RegExp(`${owner}.*not selected`, "i"));
  }
});

test("arc wrapper exports the shared Architect Critic data fallback", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "opencode-wrapper-arc-data-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const adapterBin = join(fixture, ".opencode", "bin");
  const canonicalBin = join(fixture, "architect-critic", "bin");
  const home = join(fixture, "home");
  await mkdir(adapterBin, { recursive: true });
  await mkdir(canonicalBin, { recursive: true });
  await mkdir(home);
  await writeFile(
    join(adapterBin, "arc"),
    await readFile(join(wrapperDirectory, "arc"), "utf8"),
    { encoding: "utf8", mode: 0o755 },
  );
  await writeFile(
    join(canonicalBin, "arc"),
    '#!/bin/sh\nprintf "%s\\n" "${CLAUDE_PLUGIN_DATA-}"\n',
    { encoding: "utf8", mode: 0o755 },
  );
  const env = {
    ...process.env,
    HOME: home,
    OPENCODE_SCAFFOLDING_PLUGINS: "architect-critic",
  };
  delete env.CLAUDE_PLUGIN_DATA;

  const result = spawnSync(join(adapterBin, "arc"), [], {
    cwd: await realpath(fixture),
    encoding: "utf8",
    env,
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `${join(home, ".claude/architect-critic")}\n`);

  const staleResult = spawnSync(join(adapterBin, "arc"), [], {
    cwd: await realpath(fixture),
    encoding: "utf8",
    env: { ...env, CLAUDE_PLUGIN_DATA: join(fixture, "stale-plugin-data") },
  });
  assert.deepEqual(
    {
      status: staleResult.status,
      stdout: staleResult.stdout,
      stderr: staleResult.stderr,
    },
    { status: result.status, stdout: result.stdout, stderr: result.stderr },
  );
});

test("arc wrapper reaches canonical --list without HOME or plugin data", () => {
  const env = {
    PATH: ["/usr/bin", "/bin"].join(delimiter),
    OPENCODE_SCAFFOLDING_PLUGINS: "architect-critic",
  };
  const args = ["--list"];
  const wrapped = spawnSync(join(wrapperDirectory, "arc"), args, {
    encoding: "utf8",
    env,
  });
  const canonical = spawnSync(
    fileURLToPath(new URL("architect-critic/bin/arc", root)),
    args,
    { encoding: "utf8", env },
  );

  assert.deepEqual(
    {
      status: wrapped.status,
      stdout: wrapped.stdout,
      stderr: wrapped.stderr,
    },
    {
      status: canonical.status,
      stdout: canonical.stdout,
      stderr: canonical.stderr,
    },
  );
  assert.equal(wrapped.status, 0);
});

test("all-four capabilities self-locate wi and arc without changing output", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "opencode-wrapper-location-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const hooks = await createPluginHooks({ plugins: expectedPlugins });
  const output = { env: { PATH: process.env.PATH ?? "" } };
  await hooks["shell.env"](
    { cwd: fixture, sessionID: "all-wrapper-location" },
    output,
  );
  const env = {
    ...process.env,
    ...output.env,
    CLAUDE_PLUGIN_ROOT: "/stale/plugin/root",
    PLUGIN_ROOT: "/stale/plugin/root",
  };

  assert.equal(
    env[selectedPluginsEnvironment],
    expectedPlugins.join(":"),
  );
  for (const [command, canonical] of [
    ["wi", fileURLToPath(new URL("workspace-init/bin/wi", root))],
    ["arc", fileURLToPath(new URL("architect-critic/bin/arc", root))],
  ]) {
    const wrapped = spawnSync(command, ["--list"], {
      cwd: fixture,
      encoding: "utf8",
      env,
    });
    const direct = spawnSync(canonical, ["--list"], {
      cwd: fixture,
      encoding: "utf8",
      env,
    });
    assert.deepEqual(
      {
        status: wrapped.status,
        stdout: wrapped.stdout,
        stderr: wrapped.stderr,
      },
      { status: direct.status, stdout: direct.stdout, stderr: direct.stderr },
      `${command} wrapper must preserve its canonical dispatcher result`,
    );
    assert.equal(wrapped.status, 0);
    assert.notEqual(wrapped.stdout, "");
  }
});

test("oss critic detection delegates every result to the canonical dispatcher", async (t) => {
  const path = ["/usr/bin", "/bin"].join(delimiter);
  const home = await mkdtemp(join(tmpdir(), "opencode-oss-cache-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const canonical = fileURLToPath(new URL("ossify/bin/oss", root));
  const bundledRoot = fileURLToPath(new URL("architect-critic", root)).replace(
    /\/$/,
    "",
  );
  const missingRoot = join(home, "missing-architect-critic");
  await mkdir(
    join(
      home,
      ".claude/plugins/cache/vendor/architect-critic/v0.2/skills/critiquing-spec",
    ),
    { recursive: true },
  );
  await writeFile(
    join(
      home,
      ".claude/plugins/cache/vendor/architect-critic/v0.2/skills/critiquing-spec/SKILL.md",
    ),
    "canonical fixture\n",
    "utf8",
  );
  const cases = [
    {
      label: "bundled override",
      env: {
        HOME: home,
        OSS_ARCHITECT_CRITIC_ROOT: bundledRoot,
        OPENCODE_SCAFFOLDING_PLUGINS: "ossify:architect-critic",
      },
      expected: { status: 0, stdout: "v0.3\n", stderr: "" },
    },
    {
      label: "empty HOME with selected capability",
      env: {
        HOME: "",
        OSS_ARCHITECT_CRITIC_ROOT: bundledRoot,
        OPENCODE_SCAFFOLDING_PLUGINS: "ossify:architect-critic",
      },
      expected: { status: 0, stdout: "v0.3\n", stderr: "" },
    },
    {
      label: "missing override falls through to ambient cache",
      env: {
        HOME: home,
        CLAUDE_PLUGINS_DIR: join(home, ".claude/plugins/cache"),
        OSS_ARCHITECT_CRITIC_ROOT: missingRoot,
        OPENCODE_SCAFFOLDING_PLUGINS: "ossify",
      },
      expected: { status: 0, stdout: "v0.2\n", stderr: "" },
    },
    {
      label: "no architect-critic capability leaves override unset",
      env: { HOME: "", OPENCODE_SCAFFOLDING_PLUGINS: "ossify" },
      expected: { status: 1, stdout: "absent\n", stderr: "" },
    },
  ];

  for (const { label, env, expected } of cases) {
    const wrapped = spawnSync(join(wrapperDirectory, "oss"), ["critic_detect"], {
      encoding: "utf8",
      env: { PATH: path, ...env },
    });
    const direct = spawnSync(canonical, ["critic_detect"], {
      encoding: "utf8",
      env: { PATH: path, ...env },
    });
    const wrappedResult = {
      status: wrapped.status,
      stdout: wrapped.stdout,
      stderr: wrapped.stderr,
    };
    const canonicalResult = {
      status: direct.status,
      stdout: direct.stdout,
      stderr: direct.stderr,
    };

    assert.deepEqual(wrappedResult, canonicalResult, label);
    assert.deepEqual(canonicalResult, expected, label);
  }

  const wrapperSource = await readFile(new URL(".opencode/bin/oss", root), "utf8");
  assert.ok(!wrapperSource.includes("critic_detect"));
  assert.doesNotMatch(wrapperSource, /echo\s+["']v0\.[23]/);
  assert.match(wrapperSource, /unset OSS_ARCHITECT_CRITIC_ROOT/);
});

test("oss wrapper preserves verify_step and redgate dispositions", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "opencode-wrapper-gates-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await writeFile(join(fixture, "passes"), "#!/bin/sh\nexit 0\n", {
    encoding: "utf8",
    mode: 0o755,
  });
  await writeFile(join(fixture, "fails"), "#!/bin/sh\nexit 1\n", {
    encoding: "utf8",
    mode: 0o755,
  });

  const hooks = await createPluginHooks({ plugins: expectedPlugins });
  const output = { env: { PATH: process.env.PATH ?? "" } };
  await hooks["shell.env"](
    { cwd: fixture, sessionID: "all-wrapper-gates" },
    output,
  );
  const env = { ...process.env, ...output.env, OSS_ROOT: "/stale/ossify" };
  const canonical = fileURLToPath(new URL("ossify/bin/oss", root));
  const cases = [
    ["verify_step pass", ["verify_step", fixture, "./fails", "exit 1"], 0],
    ["verify_step failure", ["verify_step", fixture, "./fails", "exit 0"], 1],
    ["verify_step malformed", ["verify_step", fixture, "./passes", "invalid"], 2],
    ["redgate RED", ["redgate", fixture, "./fails", "exit 0"], 0],
    ["redgate already GREEN", ["redgate", fixture, "./passes", "exit 0"], 1],
    ["redgate error", ["redgate", fixture, "./missing", "exit 0"], 2],
  ];

  for (const [label, args, status] of cases) {
    const wrapped = spawnSync("oss", args, {
      cwd: fixture,
      encoding: "utf8",
      env,
    });
    const direct = spawnSync(canonical, args, {
      cwd: fixture,
      encoding: "utf8",
      env,
    });
    assert.deepEqual(
      {
        status: wrapped.status,
        stdout: wrapped.stdout,
        stderr: wrapped.stderr,
      },
      { status: direct.status, stdout: direct.stdout, stderr: direct.stderr },
      `${label} must pass through unchanged`,
    );
    assert.equal(wrapped.status, status, label);
  }
});
