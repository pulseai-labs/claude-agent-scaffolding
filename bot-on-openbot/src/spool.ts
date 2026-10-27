import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "./paths.ts";

export type SpoolItem = { key: string; message: string; at: string };

let counter = 0;

const spoolDir = (): string => join(stateDir(), "spool");
const badDir = (): string => join(stateDir(), "spool-bad");

export function spoolNotice(key: string, message: string): string {
  const dir = spoolDir();
  mkdirSync(dir, { recursive: true });
  const name =
    `${String(Date.now()).padStart(13, "0")}-${String(counter++ % 1_000_000).padStart(6, "0")}-` +
    randomBytes(4).toString("hex");
  const item: SpoolItem = { key, message, at: new Date().toISOString() };
  const tmp = join(dir, `.${name}.tmp`);
  const dest = join(dir, `${name}.json`);
  writeFileSync(tmp, JSON.stringify(item));
  renameSync(tmp, dest);
  return dest;
}

const isItem = (v: unknown): v is SpoolItem =>
  typeof v === "object" && v !== null &&
  typeof (v as SpoolItem).key === "string" &&
  typeof (v as SpoolItem).message === "string" &&
  typeof (v as SpoolItem).at === "string";

export function listSpool(): { path: string; item: SpoolItem }[] {
  let names: string[];
  try {
    names = readdirSync(spoolDir());
  } catch {
    return [];
  }
  const out: { path: string; item: SpoolItem }[] = [];
  for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
    const path = join(spoolDir(), name);
    try {
      const item: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!isItem(item)) throw new Error("bad shape");
      out.push({ path, item });
    } catch {
      mkdirSync(badDir(), { recursive: true });
      renameSync(path, join(badDir(), name));
      // The name only: the content is whatever was malformed, and may hold anything.
      process.stderr.write(`bot-on-openbot: set aside malformed spool file ${name}\n`);
    }
  }
  return out;
}

export function removeSpool(path: string): void {
  rmSync(path, { force: true });
}
