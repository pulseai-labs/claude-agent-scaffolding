// Shared setup for the screen tests (`baton screen`, `baton answer --screen`): one unit `u1` of run
// `r` in a blocked park on a FakeHost, thread-1, with a screen the test chooses. The pattern is
// blocked.test.ts's `blockedAt1`.

import { afterEach, beforeEach, expect } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import { tick } from "../src/engine.ts";
import type { Forge } from "../src/forge.ts";
import { setHostForTest } from "../src/hosts/select.ts";
import { openStore, type RunState, type UnitState } from "../src/state.ts";
import { FakeHost } from "./fake-host.ts";

const T0 = Date.parse("2026-10-26T10:00:00.000Z");
const FIX = join(import.meta.dir, "fixtures", "orca");

/** A recorded screen, as `Host.screen` returns it. */
export const screenOf = (f: string) => (JSON.parse(readFileSync(join(FIX, f), "utf8")).result.terminal.tail as string[]).join("\n");

const noForge: Forge = {
  view: async () => { throw new Error("no forge in these tests"); },
  merge: async () => { throw new Error("no forge in these tests"); },
};

const SEAT = { ticks: 1000, end: "completed" as const };
const RECIPE = {
  version: 1, name: "rec", params: ["root"], sources: [], seed: [{ id: "u1", stage: "work" }],
  stages: {
    work: {
      kind: "session", instance: "inst", model: "mod", project: "proj",
      cwd: "{param.root}/w/{unit.id}", title: "t {unit.id}", message: "go {unit.id}",
      env: {}, handoff: null, outcomes: [{ when: [{ file: "{run.dir}/out/{unit.id}.done" }], to: "done" }],
    },
    implement: {
      kind: "session", instance: "inst", model: "mod", project: "proj",
      cwd: "{param.root}/w/{unit.id}", title: "impl {unit.id}", message: "go {unit.id}",
      env: {}, handoff: null, outcomes: [{ when: [{ file: "{run.dir}/out/{unit.id}.done" }], to: "done" }],
    },
  },
};

export type Park = {
  host: FakeHost;
  state: () => string;
  runState: () => RunState;
  unit: () => UnitState;
  events: () => any[];
  /** Arm, launch thread-1, block it with `screen`, and tick: the blocked park. */
  blockedAt1: (screen: string) => Promise<FakeHost>;
  /** Arm and launch thread-1 only: a running unit, not parked. */
  launched: () => Promise<FakeHost>;
  /** One tick at minute `min`. */
  tickAt: (min: number) => Promise<void>;
  /** `main(argv)` with stdout and stderr captured. */
  run: (...argv: string[]) => Promise<{ rc: number; out: string; err: string }>;
};

/** Register the env hooks for one test file and return its helpers. */
export function useBlockedPark(): Park {
  const saved = { state: process.env.BATON_STATE_DIR, config: process.env.BATON_CONFIG, home: process.env.HOME };
  let root = "", state = "", clock = T0;
  const p = { host: undefined as unknown as FakeHost } as Park;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "baton-screen-")));
    state = join(root, "state");
    mkdirSync(join(root, "home"));
    process.env.BATON_STATE_DIR = state;
    process.env.BATON_CONFIG = join(root, "config.json");
    process.env.HOME = join(root, "home");
    clock = T0;
  });
  afterEach(() => {
    setHostForTest(null);
    for (const [k, v] of [["BATON_STATE_DIR", saved.state], ["BATON_CONFIG", saved.config], ["HOME", saved.home]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const doTick = () => tick({ store: openStore(state), host: p.host, forge: noForge, now: () => new Date(clock), notify: () => {} });
  p.state = () => state;
  p.runState = () => openStore(state).readRun("r");
  p.unit = () => p.runState().units.u1;
  p.events = () => readFileSync(join(state, "runs", "r", "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  p.tickAt = async (min) => {
    clock = T0 + min * 60_000;
    await doTick();
  };
  p.launched = async () => {
    const file = join(root, "r.recipe.json");
    writeFileSync(file, JSON.stringify(RECIPE));
    mkdirSync(join(root, "w", "u1"), { recursive: true });
    expect(await main(["arm", file, "--run", "r", "--param", `root=${root}`, "--no-timer"])).toBe(0);
    p.host = new FakeHost({ work: SEAT, implement: SEAT }, { withOptional: true });
    setHostForTest(p.host);
    await doTick();
    expect(p.host.launches.length).toBe(1);
    return p.host;
  };
  p.blockedAt1 = async (screen) => {
    await p.launched();
    p.host.block("thread-1");
    p.host.screens["thread-1"] = screen;
    await p.tickAt(1);
    expect(p.unit().parked?.blocked).toEqual({ thread: "thread-1" });
    return p.host;
  };
  p.run = async (...argv) => {
    const realOut = process.stdout.write;
    const realErr = process.stderr.write;
    let out = "", err = "";
    process.stdout.write = ((s: string | Uint8Array) => { out += String(s); return true; }) as typeof process.stdout.write;
    process.stderr.write = ((s: string | Uint8Array) => { err += String(s); return true; }) as typeof process.stderr.write;
    try {
      return { rc: await main(argv), out, err };
    } finally {
      process.stdout.write = realOut;
      process.stderr.write = realErr;
    }
  };
  return p;
}
