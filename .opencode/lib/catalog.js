import { fileURLToPath } from "node:url";

function definePlugin({ name, defaultEnabled, skills, commands = [] }) {
  return Object.freeze({
    name,
    root: fileURLToPath(new URL(`../../${name}/`, import.meta.url)),
    defaultEnabled,
    skills: Object.freeze(skills),
    commands: Object.freeze(
      commands.map((command) => Object.freeze(command)),
    ),
  });
}

export const PLUGIN_CATALOG = Object.freeze([
  definePlugin({
    name: "workspace-init",
    defaultEnabled: true,
    skills: [
      "initializing-dual-repo-workspace",
      "pairing-canonical-repo",
      "pairing-existing-dual",
    ],
    commands: [
      {
        name: "init-workspace",
        skill: "initializing-dual-repo-workspace",
      },
      { name: "pair-workspace", skill: "pairing-canonical-repo" },
      { name: "pair-existing-dual", skill: "pairing-existing-dual" },
    ],
  }),
  definePlugin({
    name: "ai-mentor",
    defaultEnabled: true,
    skills: ["grill-me", "council", "eli10", "fool"],
  }),
  definePlugin({
    name: "architect-critic",
    defaultEnabled: true,
    skills: [
      "critiquing-spec",
      "reviewing-critique-history",
      "listing-principles",
      "promoting-principle",
      "checking-adversary-readiness",
      "managing-async-critique",
    ],
    commands: [
      { name: "critique", skill: "critiquing-spec" },
      { name: "critique-list", skill: "reviewing-critique-history" },
      { name: "principles-list", skill: "listing-principles" },
      { name: "promote-principle", skill: "promoting-principle" },
      { name: "critique-doctor", skill: "checking-adversary-readiness" },
      { name: "critique-jobs", skill: "managing-async-critique" },
    ],
  }),
  definePlugin({
    name: "ossify",
    defaultEnabled: false,
    skills: ["start", "adopt", "plan-spine", "work-item", "close", "plan-release", "doctor", "challenge", "wayfinder"],
  }),
]);

export function resolveEnabledPlugins(options = {}) {
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options))
  ) {
    throw new TypeError("options must be a plain object");
  }

  for (const key of Reflect.ownKeys(options)) {
    if (key !== "plugins") {
      throw new TypeError(`Unknown OpenCode option: ${String(key)}`);
    }
  }

  const requested =
    options.plugins === undefined
      ? PLUGIN_CATALOG.filter(({ defaultEnabled }) => defaultEnabled).map(
          ({ name }) => name,
        )
      : options.plugins;

  if (!Array.isArray(requested)) {
    throw new TypeError("plugins must be an array");
  }

  const requestedNames = new Set(requested);
  for (const name of requestedNames) {
    if (!PLUGIN_CATALOG.some((plugin) => plugin.name === name)) {
      throw new Error(`Unknown OpenCode plugin: ${name}`);
    }
  }

  return Object.freeze(
    PLUGIN_CATALOG.filter(({ name }) => requestedNames.has(name)),
  );
}

export function getSkillOwner(skillName) {
  return PLUGIN_CATALOG.find(({ skills }) => skills.includes(skillName));
}

export function getCommandOwner(commandName) {
  return PLUGIN_CATALOG.find(({ commands }) =>
    commands.some(({ name }) => name === commandName),
  );
}
