import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = join(import.meta.dir, "..", "bin", "bot-on-telegram");
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "bot-cli-")); });
afterEach(() => {
  chmodSync(dir, 0o700);
  rmSync(dir, { recursive: true, force: true });
});

const run = (args: string[], env: Record<string, string> = {}) => {
  const t0 = performance.now();
  const p = Bun.spawnSync([BIN, ...args], {
    env: { ...process.env, BOT_ON_TELEGRAM_STATE_DIR: dir, BOT_ON_TELEGRAM_CONFIG_DIR: join(dir, "nowhere"), ...env },
  });
  return { rc: p.exitCode, ms: performance.now() - t0, err: p.stderr.toString() };
};

test("notify spools one item and exits 0 without any config, in under 500 ms", () => {
  const r = run(["notify", "k", "m"]);
  expect(r.rc).toBe(0);
  expect(r.ms).toBeLessThan(500);
  const files = readdirSync(join(dir, "spool"));
  expect(files.length).toBe(1);
  const item = JSON.parse(readFileSync(join(dir, "spool", files[0]), "utf8"));
  expect(item.key).toBe("k");
  expect(item.message).toBe("m");
});

test("wrong arity and no command exit 64 and spool nothing", () => {
  expect(run(["notify", "k"]).rc).toBe(64);
  expect(run(["notify", "a", "b", "c"]).rc).toBe(64);
  expect(run([]).rc).toBe(64);
  expect(readdirSync(dir)).toEqual([]);
});

test("an unwritable state dir exits 1", () => {
  chmodSync(dir, 0o500);
  const r = run(["notify", "k", "m"], { BOT_ON_TELEGRAM_STATE_DIR: join(dir, "state") });
  if (process.getuid?.() === 0) return; // root ignores mode bits
  expect(r.rc).toBe(1);
  expect(r.err).toContain("cannot spool");
});
