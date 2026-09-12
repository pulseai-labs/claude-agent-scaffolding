import { readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveEnabledPlugins } from "../lib/catalog.js";
import { parseMarkdown } from "../lib/markdown.js";
import { createRuntime } from "../lib/runtime.js";
import { translatePrompt } from "../lib/translate.js";

const wrapperDirectory = fileURLToPath(new URL("../bin", import.meta.url));

export async function ScaffoldingPlugin(input, options = {}) {
  const selected = resolveEnabledPlugins(options);
  const skillPaths = selected.map(({ root }) => join(root, "skills"));
  const aliases = [];
  const ossify = selected.find(({ name }) => name === "ossify");
  let implementerAgent;

  if (ossify) {
    const agentPath = join(ossify.root, "agents", "implementer-agent.md");
    const markdown = await readFile(agentPath, "utf8");
    const { frontmatter, body } = parseMarkdown(markdown, agentPath);
    const canonicalTools = ["Bash", "Read", "Write", "Edit", "Glob", "Grep"];
    const tools =
      typeof frontmatter.tools === "string"
        ? frontmatter.tools.split(",").map((tool) => tool.trim())
        : [];
    if (
      frontmatter.name !== "implementer-agent" ||
      typeof frontmatter.description !== "string" ||
      frontmatter.model !== "inherit" ||
      tools.length !== canonicalTools.length ||
      canonicalTools.some((tool) => !tools.includes(tool))
    ) {
      throw new Error(`${agentPath}: unsupported canonical agent contract`);
    }

    implementerAgent = {
      description: translatePrompt(frontmatter.description, ossify),
      mode: "subagent",
      // Canonical bodies reference skills/ paths relative to the plugin root
      // (CLAUDE_PLUGIN_ROOT-free); the installed OpenCode prompt absolutizes
      // them so the worker resolves real files, not the consumer's cwd.
      prompt: translatePrompt(body, ossify).replaceAll(
        "`skills/",
        `\`${ossify.root.replace(/\/+$/, "")}/skills/`,
      ),
      permission: {
        "*": "deny",
        read: "allow",
        edit: "allow",
        glob: "allow",
        grep: "allow",
        bash: "allow",
        task: "deny",
        external_directory: {
          "*": "ask",
          [join(ossify.root, ".")]: "allow",
          [join(ossify.root, "**")]: "allow",
        },
      },
    };
  }

  for (const plugin of selected) {
    for (const command of plugin.commands) {
      const commandPath = join(plugin.root, "commands", `${command.name}.md`);
      const markdown = await readFile(commandPath, "utf8");
      const { frontmatter } = parseMarkdown(markdown, commandPath);
      const argumentsLine =
        command.name === "critique-doctor"
          ? ""
          : "\n\nArguments: $ARGUMENTS";
      aliases.push([
        command.name,
        {
          description: frontmatter.description,
          template:
            `Use OpenCode's \`skill\` tool to invoke the unqualified ` +
            `\`${command.skill}\` skill and follow it exactly.${argumentsLine}`,
        },
        plugin,
      ]);
    }
  }
  const registeredCommands = new Map();
  const registeredAgents = new Set();
  const runtime = createRuntime({
    selected,
    registeredCommands,
    registeredAgents,
    directory: input.directory,
  });
  const runtimeShellEnv = runtime["shell.env"];

  return {
    config: async (config) => {
      if (
        implementerAgent &&
        config.agent &&
        Object.hasOwn(config.agent, "ossify-implementer-agent") &&
        config.agent["ossify-implementer-agent"] !== implementerAgent
      ) {
        registeredAgents.delete("ossify-implementer-agent");
        throw new Error(
          "ossify-implementer-agent is reserved by Ossify; config collision",
        );
      }

      config.skills ??= {};
      config.skills.paths ??= [];
      for (const skillPath of skillPaths) {
        if (!config.skills.paths.includes(skillPath)) {
          config.skills.paths.push(skillPath);
        }
      }

      if (implementerAgent) {
        config.agent ??= {};
        config.agent["ossify-implementer-agent"] ??= implementerAgent;
        registeredAgents.add("ossify-implementer-agent");
      }

      config.command ??= {};
      for (const [name, command, owner] of aliases) {
        config.command[name] ??= command;
        if (config.command[name] === command) {
          registeredCommands.set(name, owner);
        } else {
          registeredCommands.delete(name);
        }
      }
    },
    ...runtime,
    "shell.env": async (input, output) => {
      await runtimeShellEnv(input, output);
      const callerPath = output.env.PATH ?? process.env.PATH ?? "";
      const pathEntries = callerPath
        ? callerPath
            .split(delimiter)
            .filter((entry) => entry !== wrapperDirectory)
        : [];
      output.env.PATH = [wrapperDirectory, ...pathEntries].join(delimiter);
      output.env.OPENCODE_SCAFFOLDING_PLUGINS = selected
        .map(({ name }) => name)
        .join(":");
    },
  };
}
