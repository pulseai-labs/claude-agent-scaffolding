import { beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LAUNCHER = join(import.meta.dir, "..", "bin", "baton-seat");
let base: string, state: string, home: string, proj: string, fake: string, msg: string, ran: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "baton-seat-")));
  state = join(base, "state");
  home = join(base, "home");
  proj = join(base, "proj");
  fake = join(base, "fake-omp-seat");
  msg = join(base, "msg.txt");
  ran = join(base, "ran");
  for (const d of [home, proj, join(state, "claims")]) mkdirSync(d, { recursive: true });
  // The fake seat records that it ran, then prints argv and env as JSON.
  writeFileSync(
    fake,
    `#!/usr/bin/env bun\nrequire("node:fs").writeFileSync(${JSON.stringify(ran)}, "1");\n` +
      "console.log(JSON.stringify({ argv: process.argv.slice(2), env: process.env }));\n",
  );
  chmodSync(fake, 0o755);
  writeFileSync(msg, "hello");
});

const sha = (s: string) =>
  new TextDecoder().decode(Bun.spawnSync(["bash", "-c", `printf %s "$1" | sha256sum | cut -d' ' -f1`, "_", s]).stdout).trim();
const claimFile = (dir: string) => join(state, "claims", `${sha(realpathSync(dir))}.env`);
const logFile = () => join(state, "claims", "seat.log");
const GOOD = "# baton n1\nOMP_T3_SEAT=worker\nOMP_T3_VIA=/v/w\n";

function run(cwd: string, file: string | null = msg, env: Record<string, string> = {}) {
  const p = Bun.spawnSync([LAUNCHER, ...(file === null ? [] : [file])], {
    cwd, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, HOME: home, BATON_STATE_DIR: state, BATON_OMP_SEAT: fake, ...env },
  });
  const out = p.stdout.toString();
  return { rc: p.exitCode, out, err: p.stderr.toString(), json: out.trim() ? JSON.parse(out) : null };
}

test("claim values reach the seat and argv is exact", () => {
  writeFileSync(claimFile(proj), GOOD + "OMP_T3_DROP_T3_MCP=1\nX=$HOME\n");
  writeFileSync(msg, "hello 'x' $HOME");
  const r = run(proj);
  expect(r.rc).toBe(0);
  expect(r.json.argv).toEqual(["worker", "--via", "/v/w", "hello 'x' $HOME"]);
  expect(r.json.env.X).toBe("$HOME");
  expect(r.json.env.OMP_T3_DROP_T3_MCP).toBe("1");
  expect(readFileSync(logFile(), "utf8")).toMatch(new RegExp(`^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ n1 cwd ${proj}\\n$`));
});

test("the message keeps newlines, including trailing ones", () => {
  writeFileSync(claimFile(proj), GOOD);
  writeFileSync(msg, "line one\n\nline two\n\n");
  expect(run(proj).json.argv[3]).toBe("line one\n\nline two\n\n");
});

test("no claim refuses", () => {
  const r = run(proj);
  expect(r.rc).toBe(78);
  expect(existsSync(ran)).toBe(false);
  expect(r.err.trim().split("\n").length).toBe(1);
  expect(readFileSync(logFile(), "utf8")).toMatch(/ none cwd /);
  expect(existsSync(msg)).toBe(true);
});

test("bad claim line refuses", () => {
  writeFileSync(claimFile(proj), "# baton n1\nOMP_T3_SEAT=worker\nnot a pair\n");
  const r = run(proj);
  expect(r.rc).toBe(78);
  expect(existsSync(ran)).toBe(false);
  expect(readFileSync(logFile(), "utf8")).toMatch(/ invalid 3 cwd /);
});

test("denied key refuses", () => {
  writeFileSync(claimFile(proj), GOOD + "PATH=/evil\n");
  const r = run(proj);
  expect(r.rc).toBe(78);
  expect(existsSync(ran)).toBe(false);
  expect(readFileSync(logFile(), "utf8")).toMatch(/ invalid 4 cwd /);
});

test("a FIFO at the claim path refuses without hanging", () => {
  expect(Bun.spawnSync(["mkfifo", claimFile(proj)]).exitCode).toBe(0);
  const t = Date.now();
  const r = run(proj);
  expect(Date.now() - t).toBeLessThan(2000);
  expect(r.rc).toBe(78);
  expect(readFileSync(logFile(), "utf8")).toMatch(/ invalid 0 cwd /);
});

test("claim without OMP_T3_SEAT refuses even when the environment has one", () => {
  writeFileSync(claimFile(proj), "# baton n1\nOMP_T3_VIA=/v/w\n");
  const r = run(proj, msg, { OMP_T3_SEAT: "inherited" });
  expect(r.rc).toBe(78);
  expect(existsSync(ran)).toBe(false);
  expect(readFileSync(logFile(), "utf8")).toMatch(/ noseat cwd /);
  expect(existsSync(msg)).toBe(true);
});

test("missing message file refuses", () => {
  writeFileSync(claimFile(proj), GOOD);
  for (const file of [join(base, "absent.txt"), null]) {
    const r = run(proj, file);
    expect(r.rc).toBe(78);
    expect(r.err.trim().split("\n").length).toBe(1);
  }
  expect(existsSync(ran)).toBe(false);
  expect(readFileSync(logFile(), "utf8").trim().split("\n").every((l) => / nomsg cwd /.test(l))).toBe(true);
});

test("FIFO message file refuses without hanging", () => {
  writeFileSync(claimFile(proj), GOOD);
  const fifo = join(base, "fifo");
  expect(Bun.spawnSync(["mkfifo", fifo]).exitCode).toBe(0);
  const t = Date.now();
  const r = run(proj, fifo);
  expect(Date.now() - t).toBeLessThan(2000);
  expect(r.rc).toBe(78);
  expect(existsSync(ran)).toBe(false);
  expect(readFileSync(logFile(), "utf8")).toMatch(/ nomsg cwd /);
});

test("message file is removed after reading, so a re-run starts no second seat", () => {
  writeFileSync(claimFile(proj), GOOD);
  expect(run(proj).rc).toBe(0);
  expect(existsSync(msg)).toBe(false);
  rmRan();
  const r = run(proj);
  expect(r.rc).toBe(78);
  expect(existsSync(ran)).toBe(false);
  expect(readFileSync(logFile(), "utf8")).toMatch(/ nomsg cwd /);
});

function rmRan() {
  Bun.spawnSync(["rm", "-f", ran]);
}

test("oversized message is refused; the adjacent size runs", () => {
  writeFileSync(claimFile(proj), GOOD);
  writeFileSync(msg, "a".repeat(131072));
  const big = run(proj);
  expect(big.rc).toBe(78);
  expect(existsSync(ran)).toBe(false);
  expect(readFileSync(logFile(), "utf8")).toMatch(/ toolong cwd /);
  writeFileSync(msg, "a".repeat(131071));
  const ok = run(proj);
  expect(ok.rc).toBe(0);
  expect(ok.json.argv[3]).toBe("a".repeat(131071));
});

test("log rotates past 1 MiB", () => {
  writeFileSync(logFile(), "x".repeat(1048577));
  run(proj);
  expect(readFileSync(logFile() + ".1", "utf8").length).toBe(1048577);
  expect(readFileSync(logFile(), "utf8")).toMatch(/ none cwd /);
});

test("a claim key cannot replace the exec target: OMP_SEAT=/bin/false still runs the seat", () => {
  writeFileSync(claimFile(proj), GOOD + "OMP_SEAT=/bin/false\n");
  const r = run(proj);
  expect(r.rc).toBe(0);
  expect(existsSync(ran)).toBe(true);
  expect(r.json.argv).toEqual(["worker", "--via", "/v/w", "hello"]);
  expect(r.json.env.OMP_SEAT).toBe("/bin/false"); // exported like any claim key, just not used
});

test("a seat program that cannot run refuses noexec and keeps the message file", () => {
  writeFileSync(claimFile(proj), GOOD);
  const plain = join(base, "not-executable");
  writeFileSync(plain, "#!/bin/sh\nexit 0\n");
  chmodSync(plain, 0o644);
  for (const target of [plain, join(base, "absent-seat"), base]) {
    const r = run(proj, msg, { BATON_OMP_SEAT: target });
    expect([target, r.rc]).toEqual([target, 78]);
    expect(r.err.trim().split("\n").length).toBe(1);
    expect(existsSync(msg)).toBe(true);
  }
  expect(existsSync(ran)).toBe(false);
  const lines = readFileSync(logFile(), "utf8").trim().split("\n");
  expect(lines.length).toBe(3);
  expect(lines.every((l) => / noexec cwd /.test(l))).toBe(true);
  // Control: the same claim and message with a runnable seat start it.
  expect(run(proj).rc).toBe(0);
  expect(existsSync(ran)).toBe(true);
});
