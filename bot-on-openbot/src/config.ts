import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { configDir } from "./paths.ts";

export type BotConfig = { agent: string; cli: string[]; db: string; automationDir: string };

/** openbot-cli as OpenBot v0.50.x installs it on Linux, run with bun. */
export const DEFAULT_CLI = ["bun", "/opt/OpenBot/app/resources/cli/openbot-cli.mjs"];

const openbotDir = (): string => join(homedir(), ".config", "OpenBot");

// `agent` is the OpenBot agent's name or id; the rest have defaults. Errors name the field, never
// a value: the automation folder beside these holds the token.
export function readBotConfig(): BotConfig {
  const file = join(configDir(), "config.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`config missing or not JSON: ${file}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("config must be a JSON object");
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.agent !== "string" || c.agent.trim() === "") {
    throw new Error("config agent must be a non-empty string");
  }
  let cli = DEFAULT_CLI;
  if (c.cli !== undefined) {
    if (!Array.isArray(c.cli) || c.cli.length === 0 || !c.cli.every((a) => typeof a === "string" && a !== "")) {
      throw new Error("config cli must be a non-empty list of strings");
    }
    cli = c.cli as string[];
  }
  const path = (key: "db" | "automationDir", dflt: string): string => {
    const v = c[key];
    if (v === undefined) return dflt;
    if (typeof v !== "string" || !isAbsolute(v)) throw new Error(`config ${key} must be an absolute path`);
    return v;
  };
  return {
    agent: c.agent,
    cli: [...cli],
    db: path("db", join(openbotDir(), "openbot.db")),
    automationDir: path("automationDir", join(openbotDir(), "automation")),
  };
}
