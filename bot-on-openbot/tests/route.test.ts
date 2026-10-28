import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner } from "../src/actions.ts";
import type { BotConfig } from "../src/config.ts";
import { OpenBotDown, type OpenBot } from "../src/openbot.ts";
import { makeRouter, repoName } from "../src/route.ts";

test("repoName reads the repo from a GitHub origin", () => {
  for (const u of [
    "https://github.com/pulseai-labs/pulse360.git",
    "https://github.com/pulseai-labs/pulse360",
    "git@github.com:pulseai-labs/pulse360.git",
    "ssh://git@github.com/pulseai-labs/pulse360",
  ]) expect(repoName(u)).toBe("pulse360");
});

test("repoName rejects anything else", () => {
  for (const u of [
    "https://gitlab.com/o/r", "https://github.com/o/r/tree/main", "https://github.com/o/",
    "https://github.com/o/r/", "https://GitHub.com/o/r", "",
  ]) expect(repoName(u)).toBeNull();
});

const baseCfg = (agents: Record<string, string> = {}): BotConfig =>
  ({ agent: "Autopilot", agents, cli: [], db: "/x", automationDir: "/x" });

function setup(opts: { agents?: Record<string, string>; repo?: unknown; git?: { rc: number; stdout: string }; known?: string[]; down?: boolean }) {
  const root = mkdtempSync(join(tmpdir(), "bot-route-"));
  process.env.BATON_STATE_DIR = root;
  mkdirSync(join(root, "runs", "r1"), { recursive: true });
  writeFileSync(join(root, "runs", "r1", "run.json"), JSON.stringify(opts.repo === undefined ? {} : { params: { repo: opts.repo } }));
  const known = new Set(opts.known ?? ["pulse360_autopilot", "p_bot"]);
  const asked: string[] = [];
  const botFor = (agent: string) => ({
    exists: async () => {
      asked.push(agent);
      if (opts.down) throw new OpenBotDown("down");
      return known.has(agent);
    },
  }) as unknown as OpenBot;
  const argvs: string[][] = [];
  const runner: Runner = async (argv) => {
    argvs.push(argv);
    const g = opts.git ?? { rc: 0, stdout: "https://github.com/o/pulse360.git\n" };
    return { rc: g.rc, stdout: g.stdout, stderr: "" };
  };
  const router = makeRouter(baseCfg(opts.agents), botFor, runner);
  return { router, known, asked, argvs, done: () => { delete process.env.BATON_STATE_DIR; rmSync(root, { recursive: true, force: true }); } };
}
const parked = { kind: "run-park", run: "r1" } as const;

test("a spine run goes to <name>_autopilot", async () => {
  const t = setup({ repo: "/r" });
  try {
    expect(await t.router(parked)).toEqual({ agent: "pulse360_autopilot" });
    expect(t.argvs).toEqual([["git", "-C", "/r", "remote", "get-url", "origin"]]);
  } finally { t.done(); }
});

test("a plain notice goes to the default agent with no note", async () => {
  const t = setup({ repo: "/r" });
  try {
    expect(await t.router({ kind: "plain" })).toEqual({ agent: "Autopilot" });
    expect(t.argvs).toEqual([]);
  } finally { t.done(); }
});

test("the agents map overrides the convention", async () => {
  const t = setup({ repo: "/r", agents: { pulse360: "p_bot" } });
  try {
    expect(await t.router(parked)).toEqual({ agent: "p_bot" });
  } finally { t.done(); }
});

test("a repo named like an inherited property uses the convention", async () => {
  const t = setup({ repo: "/r", git: { rc: 0, stdout: "https://github.com/o/constructor\n" }, known: ["constructor_autopilot"] });
  try {
    expect(await t.router(parked)).toEqual({ agent: "constructor_autopilot" });
  } finally { t.done(); }
});

test("no params.repo falls back with a note", async () => {
  const t = setup({});
  try {
    expect(await t.router(parked)).toEqual({ agent: "Autopilot", note: "[run r1: no project — sent to Autopilot]" });
  } finally { t.done(); }
});

test("git fails falls back", async () => {
  const t = setup({ repo: "/x", git: { rc: 128, stdout: "" } });
  try {
    expect(await t.router(parked)).toEqual({ agent: "Autopilot", note: "[run r1: no GitHub origin for /x — sent to Autopilot]" });
  } finally { t.done(); }
});

test("a non-GitHub origin falls back", async () => {
  const t = setup({ repo: "/x", git: { rc: 0, stdout: "https://gitlab.com/o/r\n" } });
  try {
    expect(await t.router(parked)).toEqual({ agent: "Autopilot", note: "[run r1: no GitHub origin for /x — sent to Autopilot]" });
  } finally { t.done(); }
});

test("a missing agent falls back and is not cached", async () => {
  const t = setup({ repo: "/r", known: [] });
  try {
    expect(await t.router(parked)).toEqual({
      agent: "Autopilot", note: "[pulse360: no OpenBot agent pulse360_autopilot — sent to Autopilot]",
    });
    t.known.add("pulse360_autopilot");
    expect(await t.router(parked)).toEqual({ agent: "pulse360_autopilot" });
  } finally { t.done(); }
});

test("a found route is cached per run", async () => {
  const t = setup({ repo: "/r" });
  try {
    await t.router(parked);
    await t.router({ kind: "run-done", run: "r1" });
    expect(t.argvs.length).toBe(1);
    expect(t.asked.length).toBe(1);
  } finally { t.done(); }
});

test("a forgotten run is resolved again", async () => {
  const t = setup({ repo: "/r" });
  try {
    expect(await t.router(parked)).toEqual({ agent: "pulse360_autopilot" });
    t.known.delete("pulse360_autopilot");
    expect(await t.router(parked)).toEqual({ agent: "pulse360_autopilot" }); // cached
    t.router.forget("r1");
    expect(await t.router(parked)).toEqual({
      agent: "Autopilot", note: "[pulse360: no OpenBot agent pulse360_autopilot — sent to Autopilot]",
    });
    t.router.forget("r-unknown"); // nothing cached: a no-op
  } finally { t.done(); }
});

test("OpenBot down rejects", async () => {
  const t = setup({ repo: "/r", down: true });
  try {
    await expect(t.router(parked)).rejects.toBeInstanceOf(OpenBotDown);
  } finally { t.done(); }
});
