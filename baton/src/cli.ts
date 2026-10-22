import { readFileSync } from "node:fs";
import { validate } from "./recipe.ts";

const USAGE = "usage: baton validate <recipe.json>\n";

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === "validate") return validateCmd(rest);
  process.stderr.write(USAGE);
  return 64;
}

function validateCmd(args: string[]): number {
  if (args.length !== 1) {
    process.stderr.write(USAGE);
    return 64;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(args[0], "utf8"));
  } catch (e) {
    process.stderr.write(`${args[0]}: ${(e as Error).message}\n`);
    return 2;
  }
  const res = validate(raw);
  if (res.ok) return 0;
  process.stderr.write(res.errors.join("\n") + "\n");
  return 2;
}
