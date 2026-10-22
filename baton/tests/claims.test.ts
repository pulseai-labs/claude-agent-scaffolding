import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaimBusy, claimKey, claimPath, liveClaim, removeClaim, writeClaim } from "../src/claims.ts";

const saved = { state: process.env.BATON_STATE_DIR, home: process.env.HOME };
let state: string, home: string, proj: string;

beforeEach(() => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "baton-claims-")));
  state = join(base, "state");
  home = join(base, "home");
  proj = join(base, "proj");
  mkdirSync(home);
  mkdirSync(proj);
  process.env.BATON_STATE_DIR = state;
  process.env.HOME = home;
});
afterEach(() => {
  process.env.BATON_STATE_DIR = saved.state;
  process.env.HOME = saved.home;
  if (saved.state === undefined) delete process.env.BATON_STATE_DIR;
});

const sha = (s: string) =>
  new TextDecoder().decode(Bun.spawnSync(["bash", "-c", `printf %s "$1" | sha256sum | cut -d' ' -f1`, "_", s]).stdout).trim();

test("key is sha256 of the realpath", () => {
  const link = join(tmpdir(), `baton-link-${process.pid}-${Date.now()}`);
  symlinkSync(proj, link);
  const want = sha(realpathSync(proj));
  expect(claimKey(proj)).toBe(want);
  expect(claimKey(link)).toBe(want);
  expect(claimPath(want)).toBe(join(state, "claims", `${want}.env`));
});

test("refuses HOME", () => {
  expect(() => writeClaim(home, { A: "1" }, "n1")).toThrow(/home/);
  expect(existsSync(join(state, "claims"))).toBe(false);
});

test("refuses a newline in a value", () => {
  expect(() => writeClaim(proj, { A: "x\ny" }, "n1")).toThrow(/newline/);
  expect(() => writeClaim(proj, { A: "x\0y" }, "n1")).toThrow(/newline/);
  expect(writeClaim(proj, { A: "xy" }, "n1")).toBe(claimKey(proj));
});

test("refuses a key failing the recipe rules", () => {
  for (const k of ["lower", "1A", "A-B", "", "PATH", "HOME", "LD_PRELOAD"]) {
    expect(() => writeClaim(proj, { [k]: "v" }, "n1")).toThrow(/denied claim key/);
  }
});

test("refuses a second nonce on a live claim", () => {
  const key = writeClaim(proj, { A: "1" }, "n1");
  expect(() => writeClaim(proj, { A: "2" }, "n2")).toThrow(ClaimBusy);
  expect(readFileSync(claimPath(key), "utf8")).toBe("# baton n1\nA=1\n");
});

test("rewriting with the same nonce succeeds", () => {
  const key = writeClaim(proj, { A: "1" }, "n1");
  writeClaim(proj, { A: "2" }, "n1");
  expect(readFileSync(claimPath(key), "utf8")).toBe("# baton n1\nA=2\n");
  expect(liveClaim(key)).toBe("n1");
});

test("removeClaim ignores a foreign nonce", () => {
  const key = writeClaim(proj, { A: "1" }, "n1");
  expect(removeClaim(key, "other")).toBe(false);
  expect(existsSync(claimPath(key))).toBe(true);
  expect(removeClaim(key, "n1")).toBe(true);
  expect(existsSync(claimPath(key))).toBe(false);
  expect(liveClaim(key)).toBeNull();
});

test("modes are 700 and 600", () => {
  const key = writeClaim(proj, { A: "1" }, "n1");
  expect(statSync(join(state, "claims")).mode & 0o777).toBe(0o700);
  expect(statSync(claimPath(key)).mode & 0o777).toBe(0o600);
});
