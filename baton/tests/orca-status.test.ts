import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDownError } from "../src/host.ts";
import { mapOrcaState, OrcaHost } from "../src/hosts/orca.ts";

const FAKE = join(import.meta.dir, "fake-orca");
const FIXTURES = join(import.meta.dir, "fixtures", "orca");
const HANDLE = "term_3a3a4b2c-380f-4bcc-a4e0-9053d6206ec7"; // terminal-list.json
const PANE = "65ef09a7-ba88-45eb-a72c-543f923e6b3b:037f73cd-bff0-448b-a33b-44fb694b1693"; // tabId:leafId of that row

let base: string, fakeDir: string, state: string;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ["BATON_STATE_DIR", "FAKE_ORCA_DIR"]) saved[k] = process.env[k];
  base = realpathSync(mkdtempSync(join(tmpdir(), "baton-orca-status-")));
  fakeDir = join(base, "fake");
  state = join(base, "state");
  mkdirSync(fakeDir);
  mkdirSync(state);
  process.env.FAKE_ORCA_DIR = fakeDir;
  process.env.BATON_STATE_DIR = state;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function replies(map: Record<string, string | string[]>): void {
  writeFileSync(join(fakeDir, "replies.json"), JSON.stringify({ "repo list": "repo-list.json", ...map }));
}
const recorded = (name: string): any => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
/** A copy of a recorded fixture with `edit` applied, written next to the replies. */
function edited(name: string, out: string, edit: (o: any) => void): string {
  const o = recorded(name);
  edit(o);
  writeFileSync(join(fakeDir, out), JSON.stringify(o));
  return out;
}
const agentOf = (o: any) => o.result.worktrees[0].agents[0];
const argvLog = (): string[][] =>
  existsSync(join(fakeDir, "argv.jsonl"))
    ? readFileSync(join(fakeDir, "argv.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
const callsTo = (sub: string) => argvLog().filter((a) => a.slice(0, 2).join(" ") === sub);
const host = () => new OrcaHost({ cli: FAKE, launcher: "/opt/bin/baton-seat" });
const statusWith = (list: string, ps: string, id = HANDLE) => {
  replies({ "terminal list": list, "worktree ps": ps });
  return host().status(id);
};
async function thrown(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected a rejection");
}

describe("status mapping, from recorded and hand-edited 1.4.238 fixtures", () => {
  // worktree-ps-working.json is a recorded `done` row (identical to -done), so the working row
  // is a hand-edited copy of -done with state "working".
  const rows: [string, string, string, string][] = [
    ["working -> active (hand-edited)", "terminal-list.json", "worktree-ps-working.edited.json", "active"],
    ["waiting -> waiting", "terminal-list.json", "EDIT:waiting", "waiting"],
    ["blocked -> waiting (recorded omp ask)", "terminal-list.json", "worktree-ps-omp-ask.json", "waiting"],
    ["done -> completed (recorded)", "terminal-list.json", "worktree-ps-done.json", "completed"],
    ["done after a dialog -> completed (recorded)", "terminal-list.json", "worktree-ps-omp-dialog.json", "completed"],
    ["done + interrupted -> interrupted (hand-edited)", "terminal-list.json", "worktree-ps-done-interrupted.edited.json", "interrupted"],
    ["unknown state -> active (hand-edited sleeping)", "terminal-list.json", "worktree-ps-done-sleeping.edited.json", "active"],
    ["no agent row -> active (hand-edited)", "terminal-list.json", "worktree-ps-done-no-agent.edited.json", "active"],
    ["terminal left the list -> gone (recorded)", "terminal-list-exited.json", "worktree-ps-done.json", "gone"],
  ];
  for (const [name, list, psName, want] of rows) {
    test(name, async () => {
      const ps = psName === "EDIT:waiting" ? edited("worktree-ps-done.json", "ps-waiting.json", (o) => (agentOf(o).state = "waiting")) : psName;
      expect((await statusWith(list, ps)).state).toBe(want as any);
    });
  }

  test("a terminal that is not in the list is gone, whatever the agent rows say", async () => {
    // The stale case: an id Orca does not list (terminal-read-stale.json is the same handle seen by `terminal read`).
    expect((await statusWith("terminal-list.json", "worktree-ps-done.json", "term_deadbeef-0000-0000-0000-000000000000")).state).toBe("gone");
  });

  test("an agent row of another pane is not this terminal's row (no row -> active)", async () => {
    const ps = edited("worktree-ps-done.json", "ps-other-pane.json", (o) => (agentOf(o).paneKey = "other-tab:other-leaf"));
    expect((await statusWith("terminal-list.json", ps)).state).toBe("active");
  });

  test("the join takes the row whose paneKey is tabId:leafId, across worktrees", async () => {
    const ps = edited("worktree-ps-done.json", "ps-two-worktrees.json", (o) => {
      const other = structuredClone(o.result.worktrees[0]);
      other.agents[0].paneKey = "x:y";
      other.agents[0].state = "working";
      o.result.worktrees.unshift(other); // an unrelated working agent comes first
    });
    expect((await statusWith("terminal-list.json", ps)).state).toBe("completed");
  });

  test("activity is updatedAt|stateStartedAt and changes when updatedAt changes", async () => {
    const a = await statusWith("terminal-list.json", "worktree-ps-done.json");
    expect(a.activity).toBe("1793033531004|1793033531004");
    const ps = edited("worktree-ps-done.json", "ps-later.json", (o) => (agentOf(o).updatedAt = 1793033999999));
    const b = await statusWith("terminal-list.json", ps);
    expect(b.activity).toBe("1793033999999|1793033531004");
    expect(b.activity).not.toBe(a.activity);
  });

  test("activity ignores lastOutputAt (it moves every ~5 s with no input, spike 8)", async () => {
    const a = await statusWith("terminal-list.json", "worktree-ps-done.json");
    const list = edited("terminal-list.json", "list-output.json", (o) => (o.result.terminals[0].lastOutputAt += 5000));
    const ps = edited("worktree-ps-done.json", "ps-output.json", (o) => (o.result.worktrees[0].lastOutputAt += 5000));
    expect((await statusWith(list, ps)).activity).toBe(a.activity);
  });

  test("no agent row: activity is the empty pair; pending is never set; failed is never returned", async () => {
    const s = await statusWith("terminal-list.json", "worktree-ps-done-no-agent.edited.json");
    expect(s).toEqual({ state: "active", activity: "|" });
    const blocked = await statusWith("terminal-list.json", "worktree-ps-omp-ask.json");
    expect(blocked.pending).toBeUndefined();
  });

  test("a truncated terminal list is host down, never gone (Review Focus 2)", async () => {
    const err = await thrown(statusWith("terminal-list-truncated.edited.json", "worktree-ps-done.json"));
    expect(err).toBeInstanceOf(HostDownError);
    expect(err.message).toContain("truncated");
  });

  test("a truncated worktree list is host down, never active or gone", async () => {
    const err = await thrown(statusWith("terminal-list.json", "worktree-ps-done-truncated.edited.json"));
    expect(err).toBeInstanceOf(HostDownError);
    expect(err.message).toContain("truncated");
  });

  test("a truncated list that omits the terminal is still host down, not gone", async () => {
    const list = edited("terminal-list-truncated.edited.json", "list-trunc-empty.json", (o) => (o.result.terminals = []));
    expect(await thrown(statusWith(list, "worktree-ps-done.json"))).toBeInstanceOf(HostDownError);
  });

  test("an error reply from either list is host down", async () => {
    expect(await thrown(statusWith("terminal-read-stale.json", "worktree-ps-done.json"))).toBeInstanceOf(HostDownError);
    expect(await thrown(statusWith("terminal-list.json", "terminal-read-stale.json"))).toBeInstanceOf(HostDownError);
  });

  test("the lists are asked for with --limit 1000", async () => {
    await statusWith("terminal-list.json", "worktree-ps-done.json");
    expect(callsTo("terminal list")[0]).toEqual(["terminal", "list", "--limit", "1000", "--json"]);
    expect(callsTo("worktree ps")[0]).toEqual(["worktree", "ps", "--limit", "1000", "--json"]);
  });
});

describe("the per-instance list cache", () => {
  test("two status calls in one instance spawn each list once", async () => {
    replies({ "terminal list": "terminal-list.json", "worktree ps": "worktree-ps-done.json" });
    const h = host();
    await h.status(HANDLE);
    await h.status(HANDLE);
    expect(callsTo("terminal list")).toHaveLength(1);
    expect(callsTo("worktree ps")).toHaveLength(1);
  });

  test("a second instance asks again", async () => {
    replies({ "terminal list": "terminal-list.json", "worktree ps": "worktree-ps-done.json" });
    await host().status(HANDLE);
    await host().status(HANDLE);
    expect(callsTo("terminal list")).toHaveLength(2);
  });

  test("a failed read is not cached", async () => {
    replies({ "terminal list": ["terminal-read-stale.json", "terminal-list.json"], "worktree ps": "worktree-ps-done.json" });
    const h = host();
    await thrown(h.status(HANDLE));
    expect((await h.status(HANDLE)).state).toBe("completed");
  });

  test("interrupt drops the cache: the next status spawns again and sees the new state", async () => {
    replies({
      "terminal list": "terminal-list.json",
      "worktree ps": ["worktree-ps-working.edited.json", "worktree-ps-done.json"],
      "terminal send": "terminal-send-escape.json",
    });
    const h = host();
    expect((await h.status(HANDLE)).state).toBe("active");
    await h.interrupt(HANDLE, "stalled");
    expect((await h.status(HANDLE)).state).toBe("completed");
    expect(callsTo("terminal list")).toHaveLength(2);
    expect(callsTo("worktree ps")).toHaveLength(2);
  });

  test("close drops the cache: the next status spawns again", async () => {
    replies({
      "terminal list": ["terminal-list.json", "terminal-list-exited.json"],
      "worktree ps": "worktree-ps-done.json",
      "terminal close": edited("worktree-ps-done.json", "closed.json", (o) => (o.result = { close: { handle: HANDLE } })),
    });
    const h = host();
    expect((await h.status(HANDLE)).state).toBe("completed");
    await h.close!(HANDLE);
    expect((await h.status(HANDLE)).state).toBe("gone");
  });

  test("launch drops the cache: the next status spawns again", async () => {
    replies({
      "terminal list": "terminal-list.json",
      "worktree ps": "worktree-ps-done.json",
      "terminal create": "terminal-create.json",
    });
    const h = host();
    await h.status(HANDLE);
    await h.launch({ nonce: "r/u/s/1", title: "w [baton r/u/s/1]", project: "pilot-fourseat", instance: "i", model: "m", cwd: "/home/dev/projects/pilot-fourseat", message: "go" });
    await h.status(HANDLE);
    expect(callsTo("terminal list")).toHaveLength(2);
    expect(callsTo("worktree ps")).toHaveLength(2);
  });
});

describe("mapOrcaState", () => {
  const T = { tabId: "t", leafId: "l" };
  test("table over the closed rows", () => {
    expect(mapOrcaState(undefined, undefined)).toBe("gone");
    expect(mapOrcaState(undefined, { state: "working" })).toBe("gone");
    expect(mapOrcaState(T, { state: "working" })).toBe("active");
    expect(mapOrcaState(T, { state: "waiting" })).toBe("waiting");
    expect(mapOrcaState(T, { state: "blocked" })).toBe("waiting");
    expect(mapOrcaState(T, { state: "done" })).toBe("completed");
    expect(mapOrcaState(T, { state: "done", interrupted: false })).toBe("completed");
    expect(mapOrcaState(T, { state: "done", interrupted: true })).toBe("interrupted");
    expect(mapOrcaState(T, undefined)).toBe("active");
  });
  test("anything else is active, never completed", () => {
    for (const a of [{}, { state: "sleeping" }, { state: "" }, { state: null }, { state: 7 }, { state: "DONE" }, { state: "done " }, { state: "failed" }, { state: "error" }]) {
      expect(mapOrcaState(T, a)).toBe("active");
    }
  });
  test("interrupted counts only when it is exactly true", () => {
    for (const i of ["true", 1, "yes"]) expect(mapOrcaState(T, { state: "done", interrupted: i })).toBe("completed");
  });
});
