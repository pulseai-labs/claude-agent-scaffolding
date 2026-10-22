import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "..", "src");
const NAMES = /ossify|\boss\b|spine|work[ _-]?item|\bseat\b|molt|SEAT_MODS_|MOLT_|OMP_|crew/i;

function tsFiles(dir: string, skip: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (p === skip) continue;
    if (statSync(p).isDirectory()) out.push(...tsFiles(p, skip));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function hits(files: string[]): string[] {
  const found: string[] = [];
  for (const f of files) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (NAMES.test(line)) found.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  return found;
}

describe("neutrality", () => {
  test("engine source names no workflow", () => {
    const files = tsFiles(SRC, join(SRC, "hosts"));
    expect(files.length).toBeGreaterThan(0);
    expect(hits(files).map((h) => relative(SRC, h))).toEqual([]);
  });

  test("control: the same scan reports a file that names a workflow", () => {
    const dir = mkdtempSync(join(tmpdir(), "baton-neutral-"));
    const f = join(dir, "leak.ts");
    writeFileSync(f, "// a spine runs here\nexport const x = 1;\n");
    expect(hits([f]).length).toBe(1);
  });
});
