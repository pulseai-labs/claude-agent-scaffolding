import { defaultRunner } from "./actions.ts";
import { readBotConfig, readToken } from "./config.ts";
import { LockHeldError, serve } from "./serve.ts";
import { installService, removeService } from "./service.ts";
import { spoolNotice } from "./spool.ts";
import { statusText } from "./status.ts";
import { makeApi } from "./telegram.ts";

const USAGE = [
  "usage: bot-on-telegram notify <key> <message>",
  "       bot-on-telegram serve",
  "       bot-on-telegram service install|remove",
  "       bot-on-telegram status",
  "",
].join("\n");

const usage = (): number => {
  process.stderr.write(USAGE);
  return 64;
};

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "notify": return notifyCmd(rest);
    case "serve": return rest.length === 0 ? serveCmd() : usage();
    case "service": return rest.length === 1 ? serviceCmd(rest[0]) : usage();
    case "status":
      if (rest.length !== 0) return usage();
      process.stdout.write(statusText());
      return 0;
  }
  return usage();
}

// Spooling needs no config and no network: the service sends later.
function notifyCmd(args: string[]): number {
  if (args.length !== 2) return usage();
  try {
    spoolNotice(args[0], args[1]);
    return 0;
  } catch (e) {
    process.stderr.write(`bot-on-telegram: cannot spool: ${(e as Error).message}\n`);
    return 1;
  }
}

async function serveCmd(): Promise<number> {
  let api, chatId;
  try {
    // Errors name the problem, never the token.
    const token = readToken();
    chatId = readBotConfig().chat_id;
    api = makeApi(token);
  } catch (e) {
    process.stderr.write(`bot-on-telegram: ${(e as Error).message}\n`);
    return 1;
  }
  const stop = Number.parseInt(process.env.BOT_ON_TELEGRAM_STOP_AFTER ?? "", 10); // test hook
  const quit = () => process.exit(0); // 'exit' releases the lock
  process.on("SIGTERM", quit);
  process.on("SIGINT", quit);
  try {
    await serve({ api, chatId, runner: defaultRunner, now: () => new Date(), ...(stop > 0 ? { stopAfter: stop } : {}) });
    return 0;
  } catch (e) {
    process.stderr.write(`bot-on-telegram: ${(e as Error).message}\n`);
    return e instanceof LockHeldError ? 3 : 1;
  }
}

async function serviceCmd(sub: string): Promise<number> {
  if (sub !== "install" && sub !== "remove") return usage();
  try {
    await (sub === "install" ? installService() : removeService());
    return 0;
  } catch (e) {
    process.stderr.write(`bot-on-telegram: ${(e as Error).message}\n`);
    return 1;
  }
}
