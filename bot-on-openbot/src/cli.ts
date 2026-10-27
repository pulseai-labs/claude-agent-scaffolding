import { defaultRunner } from "./actions.ts";
import { readBotConfig } from "./config.ts";
import { makeOpenBot } from "./openbot.ts";
import { LockHeldError, serve } from "./serve.ts";
import { spoolNotice } from "./spool.ts";

const USAGE = [
  "usage: bot-on-openbot notify <key> <message>",
  "       bot-on-openbot serve",
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
    process.stderr.write(`bot-on-openbot: cannot spool: ${(e as Error).message}\n`);
    return 1;
  }
}

async function serveCmd(): Promise<number> {
  let bot;
  try {
    bot = makeOpenBot(readBotConfig());
  } catch (e) {
    process.stderr.write(`bot-on-openbot: ${(e as Error).message}\n`);
    return 1;
  }
  const stop = Number.parseInt(process.env.BOT_ON_OPENBOT_STOP_AFTER ?? "", 10); // test hook
  const quit = () => process.exit(0); // 'exit' releases the lock
  process.on("SIGTERM", quit);
  process.on("SIGINT", quit);
  try {
    await serve({ bot, runner: defaultRunner, now: () => new Date(), ...(stop > 0 ? { stopAfter: stop } : {}) });
    return 0;
  } catch (e) {
    process.stderr.write(`bot-on-openbot: ${(e as Error).message}\n`);
    return e instanceof LockHeldError ? 3 : 1;
  }
}
