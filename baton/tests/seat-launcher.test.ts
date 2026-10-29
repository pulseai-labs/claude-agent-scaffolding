import { beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeClaim } from "../src/claims.ts";

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
  writeFileSync(claimFile(proj), GOOD + "EXTRA_KEY=1\nX=$HOME\n");
  writeFileSync(msg, "hello 'x' $HOME");
  const r = run(proj);
  expect(r.rc).toBe(0);
  expect(r.json.argv).toEqual(["worker", "--via", "/v/w", "hello 'x' $HOME"]);
  expect(r.json.env.X).toBe("$HOME");
  expect(r.json.env.EXTRA_KEY).toBe("1");
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

test("a message that cannot be read after its checks refuses nomsg, never an empty prompt (#930)", () => {
  writeFileSync(claimFile(proj), GOOD);
  writeFileSync(msg, "hello");
  // A cat that fails stands in for a file removed between the checks and the read.
  const bin = join(base, "failing-cat");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "cat"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const r = run(proj, msg, { PATH: `${bin}:${process.env.PATH}` });
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

// Claim-file cases carried over from the retired omp-t3-claim launcher's suite (0.6.0): the
// validation they pin is the one baton-seat copied from it.

test("literal values are not expanded", () => {
  writeFileSync(claimFile(proj), GOOD + "Y=`id`\nZ=\"q\"\n");
  const r = run(proj);
  expect(r.rc).toBe(0);
  expect(r.json.env.Y).toBe("`id`");
  expect(r.json.env.Z).toBe('"q"');
});

const asRoot = process.getuid?.() === 0;

test.skipIf(asRoot)("an unreadable claim refuses with invalid 0", () => {
  const f = claimFile(proj);
  writeFileSync(f, GOOD);
  chmodSync(f, 0o000);
  const r = run(proj);
  expect(r.rc).toBe(78);
  expect(existsSync(ran)).toBe(false);
  expect(readFileSync(logFile(), "utf8")).toMatch(/ invalid 0 cwd /);
});

test("control: the same claim at mode 600 runs the seat", () => {
  const f = claimFile(proj);
  writeFileSync(f, GOOD);
  chmodSync(f, 0o600);
  expect(run(proj).rc).toBe(0);
  expect(existsSync(ran)).toBe(true);
});

test("a directory at the claim path refuses with invalid 0", () => {
  mkdirSync(claimFile(proj));
  const r = run(proj);
  expect(r.rc).toBe(78);
  expect(existsSync(ran)).toBe(false);
  expect(readFileSync(logFile(), "utf8")).toMatch(/ invalid 0 cwd /);
});

test("parity: every key claims.ts refuses, the launcher refuses", () => {
  const bad = ["lower", "1A", "A-B", "A B", "", "PATH", "HOME", "USER", "SHELL", "IFS", "ENV", "BASH_ENV", "LD_PRELOAD", "LD_LIBRARY_PATH"];
  const good = ["A", "FOO_1", "EXTRA_KEY"];
  const saved = { s: process.env.BATON_STATE_DIR, h: process.env.HOME };
  process.env.BATON_STATE_DIR = state;
  process.env.HOME = home;
  try {
    for (const k of bad) {
      expect(() => writeClaim(proj, { [k]: "v" }, "n1")).toThrow();
      writeFileSync(claimFile(proj), `${GOOD}${k}=v\n`);
      writeFileSync(msg, "hello");
      expect([k, run(proj).rc]).toEqual([k, 78]);
    }
    for (const k of good) {
      expect(() => writeClaim(proj, { [k]: "v" }, "n1")).not.toThrow();
      writeFileSync(claimFile(proj), `${GOOD}${k}=v\n`);
      writeFileSync(msg, "hello");
      expect([k, run(proj).rc]).toEqual([k, 0]);
    }
  } finally {
    process.env.BATON_STATE_DIR = saved.s;
    process.env.HOME = saved.h;
  }
});

// --- #993: role claims exec the table's argv ---
const roleClaim = (role: string, extra = "") =>
  `# baton n2\nBATON_ROLE=${role}\nBATON_ROLE_TABLE=${join(base, "seats.json")}\n${extra}`;
const writeTable = (t: unknown) => writeFileSync(join(base, "seats.json"), JSON.stringify(t));
const entry = (argv: string[], brief_delivery = "inject") => ({ agent: "x", argv, brief_delivery });

test("role-argv-exact: table argv reaches the agent unchanged", () => {
  const argv = [fake, "a b", "'q'", "$HOME", ";x", "-y"];
  writeTable({ impl: entry(argv) });
  writeFileSync(claimFile(proj), roleClaim("impl"));
  const r = run(proj);
  expect(r.rc).toBe(0);
  expect(r.json.argv).toEqual(["a b", "'q'", "$HOME", ";x", "-y", "hello"]);
});

test("role-inject-message-last, and after a trailing --", () => {
  writeTable({ impl: entry([fake, "--flag", "--"]) });
  writeFileSync(claimFile(proj), roleClaim("impl"));
  writeFileSync(msg, "- looks like a flag\n");
  expect(run(proj).json.argv).toEqual(["--flag", "--", "- looks like a flag\n"]);
  expect(existsSync(msg)).toBe(false);
});

test("role-file-delivery-path: one argument naming a 200 KiB file", () => {
  writeTable({ impl: entry([fake], "file") });
  writeFileSync(claimFile(proj), roleClaim("impl"));
  const big = "x".repeat(200 * 1024);
  writeFileSync(msg, big);
  const r = run(proj);
  expect(r.rc).toBe(0);
  expect(r.json.argv.length).toBe(1);
  const m = r.json.argv[0].match(/^Read (.+) and follow it\.$/);
  expect(m).not.toBeNull();
  expect(m![1]).toBe(join(state, "briefs", "n2.md"));
  expect(readFileSync(m![1], "utf8")).toBe(big);
  expect((require("node:fs").statSync(m![1]).mode & 0o777)).toBe(0o600);
  expect(existsSync(msg)).toBe(false);
});

test("role-inject keeps the size limit", () => {
  writeTable({ impl: entry([fake]) });
  writeFileSync(claimFile(proj), roleClaim("impl"));
  writeFileSync(msg, "x".repeat(131072));
  expect(run(proj).rc).toBe(78);
  expect(readFileSync(logFile(), "utf8")).toMatch(/ toolong cwd /);
});

test("role-missing-in-table-refuses-norole", () => {
  writeTable({ other: entry([fake]) });
  writeFileSync(claimFile(proj), roleClaim("impl"));
  const r = run(proj);
  expect(r.rc).toBe(78);
  expect(existsSync(ran)).toBe(false);
  expect(readFileSync(logFile(), "utf8")).toMatch(/ norole cwd /);
  expect(existsSync(msg)).toBe(true);
});

test("role refusals: noargv and notable", () => {
  writeTable({ impl: entry([]) });
  writeFileSync(claimFile(proj), roleClaim("impl"));
  expect(run(proj).rc).toBe(78);
  expect(readFileSync(logFile(), "utf8")).toMatch(/ noargv cwd /);
  writeFileSync(claimFile(proj), "# baton n2\nBATON_ROLE=impl\nBATON_ROLE_TABLE=" + join(base, "missing.json") + "\n");
  expect(run(proj).rc).toBe(78);
  expect(readFileSync(logFile(), "utf8")).toMatch(/ notable cwd /);
  writeFileSync(join(base, "bad.json"), "{not json");
  writeFileSync(claimFile(proj), "# baton n2\nBATON_ROLE=impl\nBATON_ROLE_TABLE=" + join(base, "bad.json") + "\n");
  expect(run(proj).rc).toBe(78);
  expect(readFileSync(logFile(), "utf8").trim().split("\n").pop()).toMatch(/ notable cwd /);
  expect(existsSync(ran)).toBe(false);
});

test("legacy-omp-claim-unchanged: no BATON_ROLE still execs omp-seat", () => {
  writeFileSync(claimFile(proj), GOOD);
  expect(run(proj).json.argv).toEqual(["worker", "--via", "/v/w", "hello"]);
});
