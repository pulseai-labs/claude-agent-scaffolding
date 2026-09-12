import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { PLUGIN_CATALOG, getSkillOwner } from "./catalog.js";

const ARCHITECT_CRITIC_OPENCODE_OVERLAY = `## OpenCode host policy (binding)

This package-owned policy overrides every canonical host branch under OpenCode.

| Canonical decision point | Binding OpenCode evaluation |
| --- | --- |
| \`HOST_AGENT\` detection | Set \`HOST_AGENT=opencode\`. |
| Every \`HOST_AGENT=claude\` condition and table row | Evaluate it as \`HOST_AGENT=opencode\`. |
| Every \`HOST_AGENT=claude\` status branch | Report the active OpenCode model as host and Codex availability as adversary status. |
| The \`HOST_AGENT=claude\` foreground close-depth branch | Run Codex as the fresh-frame adversary. |
| The \`HOST_AGENT=claude\` async branch | Reuse the Claude-host Codex spine only after its compatibility smoke passes. |
| Any \`HOST_AGENT=codex\` / Claude-adversary branch | Never select or execute it. |

The active OpenCode model performs the host self-audit in conversation. For async, run a live compatibility smoke before entering the reused Claude-host Codex companion/state spine, record the async host as \`opencode\`, and keep canonical compatibility filenames such as \`claude-audit.json\` when the shared canonical procedure requires them. An explicit async preflight failure must STOP the async request with remediation and no foreground fallback.`;

function contextFor(owner) {
  return {
    root: owner.root,
    dataRoot: join(homedir(), ".claude", owner.name),
  };
}

export function translatePrompt(text, context) {
  if (typeof text !== "string") {
    throw new TypeError("prompt text must be a string");
  }

  let translated = text.replace(
    /\bSkill\(\s*([a-z0-9-]+):([a-z0-9-]+)\s*\)/g,
    (invocation, pluginName, skillName) =>
      getSkillOwner(skillName)?.name === pluginName
        ? `skill(name="${skillName}")`
        : invocation,
  );
  translated = translated.replace(
    /\bTask\(\s*subagent_type="ossify:implementer-agent"/g,
    'task(description="Implement Ossify work item", subagent_type="ossify-implementer-agent"',
  );
  translated = translated.replaceAll("AskUserQuestion", "question");

  if (context?.root) {
    const root = context.root.replace(/\/+$/, "");
    translated = translated.replace(
      /\$(?:\{CLAUDE_PLUGIN_ROOT\}|CLAUDE_PLUGIN_ROOT\b)/g,
      () => root,
    );
    // Plugin-root-relative refs (the token-free convention): a backticked
    // path under a shipped plugin-root dir resolves against the owning
    // plugin's root, not the consumer's cwd. Existence-gated so
    // skill-dir-relative refs (e.g. `references/x` inside a skill's own
    // references/ file) and consumer-side paths (e.g. `tests/x` the plugin
    // does not ship) pass through untouched.
    translated = translated.replace(
      /`((?:skills|references|templates|lib|agents|bin|workflows|commands|rules|tests|hooks|hooks-handlers)\/[^`\s]+)`/g,
      (match, rel) =>
        existsSync(join(root, rel)) ? `\`${root}/${rel}\`` : match,
    );
  }
  const dataRoot =
    context?.dataRoot ??
    (context?.name ? join(homedir(), ".claude", context.name) : undefined);
  if (dataRoot) {
    translated = translated.replace(
      /\$(?:\{CLAUDE_PLUGIN_DATA\}|CLAUDE_PLUGIN_DATA\b)/g,
      () => dataRoot,
    );
  }

  return translated;
}

export function translateOwnedPrompt(text, owner, skillName) {
  if (!PLUGIN_CATALOG.includes(owner)) return text;

  let translated = translatePrompt(text, contextFor(owner));
  if (
    owner.name === "architect-critic" &&
    skillName === "critiquing-spec" &&
    !translated.includes(ARCHITECT_CRITIC_OPENCODE_OVERLAY)
  ) {
    translated += `\n\n${ARCHITECT_CRITIC_OPENCODE_OVERLAY}`;
  }
  return translated;
}

export function translateToolOutput(tool, args, output) {
  if (typeof output?.output !== "string") return;

  const owner =
    (tool === "skill" || tool === "read") &&
    PLUGIN_CATALOG.includes(args?.owner)
      ? args.owner
      : undefined;
  if (owner) {
    output.output = translateOwnedPrompt(
      output.output,
      owner,
      tool === "skill" ? args?.name : undefined,
    );
  }
}
