import { spoolNotice } from "./spool.ts";

const USAGE = [
  "usage: bot-on-openbot notify <key> <message>",
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
