import { homedir } from "node:os";
import { join } from "node:path";

export const configDir = (): string =>
  process.env.BOT_ON_OPENBOT_CONFIG_DIR || join(homedir(), ".config", "bot-on-openbot");

export const stateDir = (): string =>
  process.env.BOT_ON_OPENBOT_STATE_DIR || join(homedir(), ".local", "state", "bot-on-openbot");

export const batonStateDir = (): string =>
  process.env.BATON_STATE_DIR || join(homedir(), ".local", "state", "baton");
