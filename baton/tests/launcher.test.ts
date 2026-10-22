import { beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeClaim } from "../src/claims.ts";

const LAUNCHER = join(import.meta.dir, "..", "bin", "omp-t3-claim");
let base: string, state: string, home: string, proj: string, fake: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "baton-launch-")));
  state = join(base, "state");
  home = join(base, "home");
  proj = join(base, "proj");
  fake = join(base, "fake-omp-t3");
  for (const d of [home, proj, join(state, "claims")]) mkdirSync(d, { recursive: true });
  writeFileSync(
    fake,
    '#!/usr/bin/env bun\nconsole.log(JSON.stringify({ argv: process.argv.slice(2), env: process.env }));\n',
  );
  chmodSync(fake, 0o755);
});

const sha = (s: string) =>
  new TextDecoder().decode(Bun.spawnSync(["bash", "-c", `printf %s "$1" | sha256sum | cut -d' ' -f1`, "_", s]).stdout).trim();
const claimFile = (dir: string) => join(state, "claims", `${sha(realpathSync(dir))}.env`);
const logFile = () => join(state, "claims", "lookup.log");

function run(cwd: string, args: string[] = [], env: Record<string, string> = {}) {
  const p = Bun.spawnSync([LAUNCHER, ...args], {
    cwd, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, HOME: home, BATON_STATE_DIR: state, BATON_OMP_T3: fake, ...env },
  });
  const out = p.stdout.toString();
  return { rc: p.exitCode, out, json: out.trim() ? JSON.parse(out) : null };
}

test("no claim passes argv and env through", () => {
  const r = run(proj, ["--mode", "rpc", "a b"], { KEEP_ME: "kept" });
  expect(r.rc).toBe(0);
  expect(r.json.argv).toEqual(["--mode", "rpc", "a b"]);
  expect(r.json.env.KEEP_ME).toBe("kept");
  expect(readFileSync(logFile(), "utf8")).toMatch(/^\S+ none cwd /);
});

test("HOME probe writes no log line", () => {
  const r = run(home, ["--probe"]);
  expect(r.rc).toBe(0);
  expect(r.json.argv).toEqual(["--probe"]);
  expect(existsSync(logFile())).toBe(false);
});

test("claim values reach the child", () => {
  writeFileSync(claimFile(proj), "# baton n1\nFOO=bar baz\n\nEMPTY=\n");
  const r = run(proj, [], { KEEP_ME: "kept", FOO: "old" });
  expect(r.json.env.FOO).toBe("bar baz");
  expect(r.json.env.EMPTY).toBe("");
  expect(r.json.env.KEEP_ME).toBe("kept");
});

test("literal values are not expanded", () => {
  writeFileSync(claimFile(proj), "# baton n1\nX=$HOME\nY=`id`\nZ=\"q\"\n");
  const r = run(proj);
  expect(r.json.env.X).toBe("$HOME");
  expect(r.json.env.Y).toBe("`id`");
  expect(r.json.env.Z).toBe('"q"');
});

test("invalid claim exits 78 and launches nothing", () => {
  const f = claimFile(proj);
  writeFileSync(f, "# baton n1\nA=1\nnot a pair\n");
  const r = run(proj);
  expect(r.rc).toBe(78);
  expect(r.out).toBe("");
  expect(readFileSync(logFile(), "utf8")).toMatch(/ invalid 3 cwd /);
});

test("control: the same file with the bad line removed launches", () => {
  writeFileSync(claimFile(proj), "# baton n1\nA=1\n");
  const r = run(proj);
  expect(r.rc).toBe(0);
  expect(r.json.env.A).toBe("1");
});

const asRoot = process.getuid?.() === 0;

test.skipIf(asRoot)("an unreadable claim exits 78 and launches nothing", () => {
  const f = claimFile(proj);
  writeFileSync(f, "# baton n1\nA=1\n");
  chmodSync(f, 0o000);
  const r = run(proj);
  expect(r.rc).toBe(78);
  expect(r.out).toBe("");
  expect(readFileSync(logFile(), "utf8")).toMatch(/ invalid 0 cwd /);
});

test("control: the same claim at mode 600 launches", () => {
  const f = claimFile(proj);
  writeFileSync(f, "# baton n1\nA=1\n");
  chmodSync(f, 0o600);
  const r = run(proj);
  expect(r.rc).toBe(0);
  expect(r.json.env.A).toBe("1");
});

test("a directory at the claim path exits 78, logs invalid 0, and launches nothing", () => {
  mkdirSync(claimFile(proj));
  const r = run(proj);
  expect(r.rc).toBe(78);
  expect(r.out).toBe("");
  expect(readFileSync(logFile(), "utf8")).toMatch(/ invalid 0 cwd /);
});

test("a FIFO at the claim path exits 78, logs invalid 0, and does not hang", () => {
  const f = claimFile(proj);
  expect(Bun.spawnSync(["mkfifo", f]).exitCode).toBe(0);
  const p = Bun.spawnSync(["timeout", "5", LAUNCHER], {
    cwd: proj, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, HOME: home, BATON_STATE_DIR: state, BATON_OMP_T3: fake },
  });
  expect(p.exitCode).toBe(78);
  expect(p.stdout.toString()).toBe("");
  expect(readFileSync(logFile(), "utf8")).toMatch(/ invalid 0 cwd /);
});

test("control: a regular claim file at the same path launches", () => {
  writeFileSync(claimFile(proj), "# baton n1\nA=1\n");
  const r = run(proj);
  expect(r.rc).toBe(0);
  expect(r.json.env.A).toBe("1");
  expect(readFileSync(logFile(), "utf8")).toMatch(/ n1 cwd /);
});

test("drop removes only the T3 extension pair", () => {
  writeFileSync(claimFile(proj), "# baton n1\nOMP_T3_DROP_T3_MCP=1\n");
  const a = run(proj, ["--extension", "/x/pi-t3-mcp-extension.ts", "--extension", "/y/other.ts", "--mode", "rpc"]);
  expect(a.json.argv).toEqual(["--extension", "/y/other.ts", "--mode", "rpc"]);
  const b = run(proj, ["--extension=/x/pi-t3-mcp-extension.ts", "--extension=/y/other.ts", "--mode", "rpc"]);
  expect(b.json.argv).toEqual(["--extension=/y/other.ts", "--mode", "rpc"]);
  const c = run(proj, ["--extension", "/x/not-pi-t3-mcp-extension.ts.bak", "--extension", "/y/pi-t3-mcp-extension.ts"]);
  expect(c.json.argv).toEqual(["--extension", "/x/not-pi-t3-mcp-extension.ts.bak"]);
});

test("without the drop key the T3 extension stays", () => {
  writeFileSync(claimFile(proj), "# baton n1\nA=1\n");
  const args = ["--extension", "/x/pi-t3-mcp-extension.ts", "--mode", "rpc"];
  expect(run(proj, args).json.argv).toEqual(args);
});

test("log line names nonce, cwd and dropped count", () => {
  writeFileSync(claimFile(proj), "# baton run1/u/s/1\nOMP_T3_DROP_T3_MCP=1\n");
  run(proj, ["--extension", "/x/pi-t3-mcp-extension.ts"]);
  const line = readFileSync(logFile(), "utf8").trim();
  expect(line).toMatch(
    new RegExp(`^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ run1/u/s/1 cwd ${proj} drop 1 dropped 1$`),
  );
});

test("log rotates past 1 MiB", () => {
  writeFileSync(logFile(), "x".repeat(1048577));
  run(proj);
  expect(readFileSync(logFile() + ".1", "utf8").length).toBe(1048577);
  expect(readFileSync(logFile(), "utf8")).toMatch(/ none cwd /);
});

test("unwritable log still launches", () => {
  mkdirSync(logFile()); // a directory where the log file should be
  const r = run(proj, ["--ok"]);
  expect(r.rc).toBe(0);
  expect(r.json.argv).toEqual(["--ok"]);
});

test("parity: every key claims.ts refuses, the launcher refuses", () => {
  const bad = ["lower", "1A", "A-B", "A B", "", "PATH", "HOME", "USER", "SHELL", "IFS", "ENV", "BASH_ENV", "LD_PRELOAD", "LD_LIBRARY_PATH"];
  const good = ["A", "FOO_1", "OMP_T3_DROP_T3_MCP"];
  const saved = { s: process.env.BATON_STATE_DIR, h: process.env.HOME };
  process.env.BATON_STATE_DIR = state;
  process.env.HOME = home;
  try {
    for (const k of bad) {
      expect(() => writeClaim(proj, { [k]: "v" }, "n1")).toThrow();
      writeFileSync(claimFile(proj), `# baton n1\n${k}=v\n`);
      expect([k, run(proj).rc]).toEqual([k, 78]);
    }
    for (const k of good) {
      expect(() => writeClaim(proj, { [k]: "v" }, "n1")).not.toThrow();
      expect([k, run(proj).rc]).toEqual([k, 0]);
    }
  } finally {
    process.env.BATON_STATE_DIR = saved.s;
    process.env.HOME = saved.h;
  }
});
