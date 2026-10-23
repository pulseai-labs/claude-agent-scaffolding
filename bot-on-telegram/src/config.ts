import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./paths.ts";

export type BotConfig = { chat_id: number };

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
  const chat = (raw as Record<string, unknown>).chat_id;
  if (typeof chat !== "number" || !Number.isInteger(chat)) {
    throw new Error("config chat_id must be an integer");
  }
  return { chat_id: chat };
}

// Error messages name the problem, never the file's content.
export function readToken(): string {
  const file = join(configDir(), "token");
  let mode: number;
  try {
    mode = statSync(file).mode;
  } catch {
    throw new Error("token file missing");
  }
  if ((mode & 0o077) !== 0) throw new Error("token file must be mode 600");
  const token = readFileSync(file, "utf8").trim();
  if (token === "") throw new Error("token file is empty");
  return token;
}
