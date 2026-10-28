import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spoolNotice } from "../src/spool.ts";

const BIN = join(import.meta.dir, "..", "bin", "bot-on-openbot");
const FAKE = join(import.meta.dir, "fake-openbot");
const TOKEN = "FIXTURE-OPENBOT-TOKEN-do-not-leak";
let dir: string;
let cfg: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bot-status-"));
  cfg = join(dir, "cfg");
  mkdirSync(cfg);
  mkdirSync(join(dir, "fake"));
  mkdirSync(join(dir, "automation"));
  writeFileSync(join(dir, "automation", "token"), TOKEN);
  writeFileSync(join(cfg, "config.json"), JSON.stringify({ agent: "Autopilot", cli: [FAKE], automationDir: join(dir, "automation") }));
  const ctl = join(dir, "ctl");
  writeFileSync(ctl, "#!/bin/sh\necho active\n");
  chmodSync(ctl, 0o755);
  list({ ok: true, exitCode: 0, agents: [{ id: "agent-7a6bdc91", name: "Autopilot" }] });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const list = (reply: unknown, rc = 0) =>
  writeFileSync(join(dir, "fake", "replies.json"), JSON.stringify({ list: { stdout: JSON.stringify(reply) + "\n", rc } }));

const status = (batonConfig?: unknown) => {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    BOT_ON_OPENBOT_CONFIG_DIR: cfg,
    BOT_ON_OPENBOT_STATE_DIR: join(dir, "state"),
    BOT_ON_OPENBOT_SYSTEMCTL: join(dir, "ctl"),
    BATON_CONFIG: join(dir, "baton.json"),
    FAKE_OPENBOT_DIR: join(dir, "fake"),
  };
  if (batonConfig !== undefined) writeFileSync(join(dir, "baton.json"), JSON.stringify(batonConfig));
  const p = Bun.spawnSync([BIN, "status"], { env });
  return { rc: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};

test("status reports the agent, service and spool, and never the token", () => {
  process.env.BOT_ON_OPENBOT_STATE_DIR = join(dir, "state");
  spoolNotice("k", "m");
  spoolNotice("k2", "m2");
  delete process.env.BOT_ON_OPENBOT_STATE_DIR;
  const r = status();
  expect(r.rc).toBe(0);
  expect(r.out).toContain("agent: Autopilot (openbot-cli list finds it)");
  expect(r.out).toContain("service: active");
  expect(r.out).toContain("spool: 2");
  expect(r.out).toContain("open deliveries: 0");
  expect(r.out + r.err).not.toContain(TOKEN);
  const argv = readFileSync(join(dir, "fake", "argv.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).argv);
  expect(argv).toEqual([["list", "--json"]]);
});

test("status names the agent and whether openbot-cli list finds it", () => {
  list({ ok: true, exitCode: 0, agents: [{ id: "a", name: "Someone" }] });
  expect(status().out).toContain("agent: Autopilot NOT FOUND by openbot-cli list");
  list({ ok: false, exitCode: 5, error: "OpenBot is not running" }, 5);
  expect(status().out).toContain("agent: Autopilot (openbot-cli list failed: exit 5)");
  // the agent may be named by its id; names match with case ignored, as openbot-cli does
  list({ ok: true, exitCode: 0, agents: [{ id: "a", name: "autopilot " }] });
  expect(status().out).toContain("agent: Autopilot (openbot-cli list finds it)");
  writeFileSync(join(cfg, "config.json"), JSON.stringify({ agent: "Autopilot", cli: [join(dir, "no-such-cli")] }));
  expect(status().out).toContain("agent: Autopilot (openbot-cli could not start)");
  writeFileSync(join(cfg, "config.json"), "{}");
  expect(status().out).toContain("agent: MISSING (config agent must be a non-empty string)");
});

test("baton notify: MISSING when argv[0] does not exist, resolves when it does, unset otherwise", () => {
  expect(status({ notify: [join(dir, "nope"), "notify", "{key}", "{message}"] }).out).toContain(`baton notify: ${join(dir, "nope")} MISSING`);
  expect(status({ notify: [join(dir, "ctl"), "x"] }).out).toContain(`baton notify: ${join(dir, "ctl")} resolves`);
  expect(status({ slots: {} }).out).toContain("baton notify: unset");
  rmSync(join(dir, "baton.json"));
  expect(status().out).toContain("baton notify: unset");
});

test("status prints one agent line per agent, marks open deliveries, and lists once", () => {
  writeFileSync(join(cfg, "config.json"), JSON.stringify({
    agent: "Autopilot", agents: { pulse360: "pulse360_autopilot" }, cli: [FAKE], automationDir: join(dir, "automation"),
  }));
  list({ ok: true, exitCode: 0, agents: [{ id: "agent-7a6bdc91", name: "Autopilot" }, { id: "x", name: "Pulse360_Autopilot" }] });
  let out = status().out;
  expect(out).toContain("agent: Autopilot (openbot-cli list finds it)\n");
  expect(out).toContain("agent: pulse360_autopilot (openbot-cli list finds it)\n");
  const argv = readFileSync(join(dir, "fake", "argv.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).argv);
  expect(argv).toEqual([["list", "--json"]]);

  list({ ok: true, exitCode: 0, agents: [{ id: "agent-7a6bdc91", name: "Autopilot" }] });
  expect(status().out).toContain("agent: pulse360_autopilot NOT FOUND by openbot-cli list");

  // an open record names its agent; a record of an agent in neither place still gets a line
  mkdirSync(join(dir, "state"), { recursive: true });
  writeFileSync(join(dir, "state", "deliveries.jsonl"), [
    { key: "k1", phase: "asked", agent: "pulse360_autopilot", run: "r", title: "t" },
    { key: "k2", phase: "asked", agent: "stray", run: "r", title: "t" },
    { key: "k3", phase: "closed", agent: "Autopilot", run: "r", title: "t" },
    { key: "k4", phase: "asked", run: "r", title: "t" },
  ].map((r) => JSON.stringify(r)).join("\n") + "\n");
  out = status().out;
  expect(out).toContain("agent: pulse360_autopilot NOT FOUND by openbot-cli list, open: k1\n");
  expect(out).toContain("agent: stray NOT FOUND by openbot-cli list, open: k2\n");
  expect(out).toContain("agent: Autopilot (openbot-cli list finds it), open: k4\n");
  expect(out.split("\n").filter((l) => l.startsWith("agent: ")).length).toBe(3);
});

test("status counts agent names differing only in case or spaces as one agent", () => {
  writeFileSync(join(cfg, "config.json"), JSON.stringify({
    agent: "Autopilot", agents: { pulse360: "Pulse360_Autopilot" }, cli: [FAKE], automationDir: join(dir, "automation"),
  }));
  list({ ok: true, exitCode: 0, agents: [{ id: "agent-7a6bdc91", name: "Autopilot" }, { id: "x", name: "pulse360_autopilot" }] });
  mkdirSync(join(dir, "state"), { recursive: true });
  writeFileSync(join(dir, "state", "deliveries.jsonl"), [
    { key: "k1", phase: "asked", agent: "autopilot", run: "r", title: "t" },
    { key: "k2", phase: "asked", run: "r", title: "t" },
    { key: "k3", phase: "asked", agent: "pulse360_autopilot ", run: "r", title: "t" },
  ].map((r) => JSON.stringify(r)).join("\n") + "\n");
  const lines = status().out.split("\n").filter((l) => l.startsWith("agent: "));
  expect(lines).toEqual([
    "agent: Autopilot (openbot-cli list finds it), open: k1, k2",
    "agent: Pulse360_Autopilot (openbot-cli list finds it), open: k3",
  ]);
});
