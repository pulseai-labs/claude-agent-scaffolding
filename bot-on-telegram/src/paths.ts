import { homedir } from "node:os";
import { join } from "node:path";

export const configDir = (): string =>
  process.env.BOT_ON_TELEGRAM_CONFIG_DIR || join(homedir(), ".config", "bot-on-telegram");

export const stateDir = (): string =>
  process.env.BOT_ON_TELEGRAM_STATE_DIR || join(homedir(), ".local", "state", "bot-on-telegram");

export const batonStateDir = (): string =>
  process.env.BATON_STATE_DIR || join(homedir(), ".local", "state", "baton");
