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
const LIVE = "term_9ce372e1-8d73-4999-b4db-e85223e7f6e5"; // terminal-list-working-live.json
const CLAUDE_SEAT = "term_3c68865f-42e7-4da2-959a-2b5c3d35858f"; // terminal-list-claude-devin.json
const DEVIN_SEAT = "term_c20012b6-d68e-4021-bc61-6b6fbde82762"; // the same list
const ABSENT = "term_deadbeef-0000-0000-0000-000000000000"; // in no list

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
const statusWith = (list: string, ps: string, id = HANDLE, read?: string) => {
  replies({ "terminal list": list, "worktree ps": ps, ...(read === undefined ? {} : { "terminal read": read }) });
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
  // [name, terminal list, worktree ps, want, handle, terminal read]
  const rows: [string, string, string, string, string?, string?][] = [
    ["working -> active (recorded live pair)", "terminal-list-working-live.json", "worktree-ps-working-live.json", "active", LIVE],
    ["waiting -> waiting", "terminal-list.json", "EDIT:waiting", "waiting"],
    ["blocked -> waiting (recorded omp ask)", "terminal-list.json", "worktree-ps-omp-ask.json", "waiting"],
    ["waiting -> waiting (recorded Claude Code ask)", "terminal-list-claude-devin.json", "worktree-ps-claude-devin-ask.json", "waiting", CLAUDE_SEAT],
    ["working, programStatus blocked -> waiting (recorded Devin ask)", "terminal-list-claude-devin.json", "worktree-ps-claude-devin-ask.json", "waiting", DEVIN_SEAT],
    ["done -> completed (recorded)", "terminal-list.json", "worktree-ps-done.json", "completed"],
    ["done after a dialog -> completed (recorded)", "terminal-list.json", "worktree-ps-omp-dialog.json", "completed"],
    ["done + interrupted -> interrupted (hand-edited)", "terminal-list.json", "worktree-ps-done-interrupted.edited.json", "interrupted"],
    ["unknown state -> active (hand-edited sleeping)", "terminal-list.json", "worktree-ps-done-sleeping.edited.json", "active"],
    ["no agent row -> active (hand-edited)", "terminal-list.json", "worktree-ps-done-no-agent.edited.json", "active"],
    ["terminal left the list, read says exited -> gone (recorded)", "terminal-list-exited.json", "worktree-ps-done.json", "gone", HANDLE, "terminal-read-exited.json"],
  ];
  for (const [name, list, psName, want, id, read] of rows) {
    test(name, async () => {
      const ps = psName === "EDIT:waiting" ? edited("worktree-ps-done.json", "ps-waiting.json", (o) => (agentOf(o).state = "waiting")) : psName;
      expect((await statusWith(list, ps, id, read)).state).toBe(want as any);
    });
  }

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

describe("gone rests on positive evidence (a terminal missing from a whole list)", () => {
  test("absent + terminal read stale -> gone, whatever the agent rows say; the read names the handle", async () => {
    expect((await statusWith("terminal-list.json", "worktree-ps-done.json", ABSENT, "terminal-read-stale.json")).state).toBe("gone");
    expect(callsTo("terminal read")).toEqual([["terminal", "read", "--terminal", ABSENT, "--json"]]);
  });

  test("absent + terminal read exited -> gone (recorded spike 6 pair)", async () => {
    expect((await statusWith("terminal-list-exited.json", "worktree-ps-done.json", HANDLE, "terminal-read-exited.json")).state).toBe("gone");
  });

  test("absent + each other gone-class code -> gone", async () => {
    for (const code of ["terminal_exited", "terminal_gone", "no_connected_pty", "terminal_not_writable"]) {
      const read = edited("terminal-read-stale.json", `read-${code}.edited.json`, (o) => (o.error.code = o.error.message = code));
      expect([code, (await statusWith("terminal-list.json", "worktree-ps-done.json", ABSENT, read)).state]).toEqual([code, "gone"]);
    }
  });

  test("absent + a running terminal read -> host down, never gone (recorded running read)", async () => {
    const err = await thrown(statusWith("terminal-list.json", "worktree-ps-done.json", ABSENT, "terminal-read-screen.json"));
    expect(err).toBeInstanceOf(HostDownError);
    expect(err.message).toContain("status running");
  });

  test("absent + any other read refusal -> host down (control for the gone codes)", async () => {
    const read = edited("terminal-read-stale.json", "read-other.edited.json", (o) => (o.error.code = o.error.message = "runtime_unavailable"));
    expect(await thrown(statusWith("terminal-list.json", "worktree-ps-done.json", ABSENT, read))).toBeInstanceOf(HostDownError);
  });

  test("a listed terminal is not read again", async () => {
    await statusWith("terminal-list.json", "worktree-ps-done.json");
    expect(callsTo("terminal read")).toEqual([]);
  });
});

describe("the lists must cover the local host (hostScope)", () => {
  const scoped = (name: string, out: string, hostIds: string[], omittedHostIds: string[]) =>
    edited(name, out, (o) => (o.result.hostScope = { hostIds, omittedHostIds }));

  test("local omitted from the terminal list -> host down, not gone", async () => {
    const list = scoped("terminal-list-exited.json", "list-local-omitted.edited.json", [], ["local"]);
    const err = await thrown(statusWith(list, "worktree-ps-done.json", HANDLE, "terminal-read-exited.json"));
    expect(err).toBeInstanceOf(HostDownError);
    expect(err.message).toContain("terminal list does not cover the local host");
  });

  test("local listed and omitted at once -> host down", async () => {
    const list = scoped("terminal-list.json", "list-local-both.edited.json", ["local"], ["local"]);
    expect(await thrown(statusWith(list, "worktree-ps-done.json"))).toBeInstanceOf(HostDownError);
  });

  test("local missing from hostIds (no omission either) -> host down", async () => {
    const list = scoped("terminal-list.json", "list-local-missing.edited.json", ["ssh:box"], []);
    expect(await thrown(statusWith(list, "worktree-ps-done.json"))).toBeInstanceOf(HostDownError);
    const bare = edited("terminal-list.json", "list-no-scope.edited.json", (o) => delete o.result.hostScope);
    expect(await thrown(statusWith(bare, "worktree-ps-done.json"))).toBeInstanceOf(HostDownError);
  });

  test("local omitted from worktree ps -> host down, not active", async () => {
    const ps = scoped("worktree-ps-done.json", "ps-local-omitted.edited.json", [], ["local"]);
    const err = await thrown(statusWith("terminal-list.json", ps));
    expect(err).toBeInstanceOf(HostDownError);
    expect(err.message).toContain("worktree ps does not cover the local host");
    const missing = scoped("worktree-ps-done.json", "ps-local-missing.edited.json", ["ssh:box"], []);
    expect(await thrown(statusWith("terminal-list.json", missing))).toBeInstanceOf(HostDownError);
  });

  test("another host omitted from both lists -> the normal mapping (control)", async () => {
    const list = scoped("terminal-list.json", "list-other-omitted.edited.json", ["local"], ["ssh:box"]);
    const ps = scoped("worktree-ps-done.json", "ps-other-omitted.edited.json", ["local"], ["ssh:box"]);
    expect((await statusWith(list, ps)).state).toBe("completed");
    const gone = scoped("terminal-list-exited.json", "list-exited-other-omitted.edited.json", ["local"], ["ssh:box"]);
    expect((await statusWith(gone, ps, HANDLE, "terminal-read-exited.json")).state).toBe("gone");
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
    // First the recorded live working pair, then the recorded done pair (another handle: no
    // recording has one terminal in both states). A kept cache would not list HANDLE at all.
    replies({
      "terminal list": ["terminal-list-working-live.json", "terminal-list.json"],
      "worktree ps": ["worktree-ps-working-live.json", "worktree-ps-done.json"],
      "terminal send": "terminal-send-escape.json",
    });
    const h = host();
    expect((await h.status(LIVE)).state).toBe("active");
    await h.interrupt(LIVE, "stalled");
    expect((await h.status(HANDLE)).state).toBe("completed");
    expect(callsTo("terminal list")).toHaveLength(2);
    expect(callsTo("worktree ps")).toHaveLength(2);
  });

  test("close drops the cache: the next status spawns again", async () => {
    replies({
      "terminal list": ["terminal-list.json", "terminal-list-exited.json"],
      "worktree ps": "worktree-ps-done.json",
      "terminal read": "terminal-read-stale.json",
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
  test("programStatus turns only a working row into waiting", () => {
    const blocked = { state: "blocked", kind: "question" };
    expect(mapOrcaState(T, { state: "working", programStatus: blocked })).toBe("waiting");
    // The adjacent controls: a working row with any other status stays active, and a finished
    // row with a late blocked status stays finished.
    for (const st of ["working", "idle", "done", undefined]) expect(mapOrcaState(T, { state: "working", programStatus: { state: st } })).toBe("active");
    expect(mapOrcaState(T, { state: "done", programStatus: blocked })).toBe("completed");
  });

  test("interrupted counts only when it is exactly true", () => {
    for (const i of ["true", 1, "yes"]) expect(mapOrcaState(T, { state: "done", interrupted: i })).toBe("completed");
  });
});

describe("interrupt per agent (#998)", () => {
  const sends = () => callsTo("terminal send").map((a) => a[a.indexOf("--text") + 1]);
  /** The recorded pair with the seat's row edited, then one interrupt. */
  async function interruptWith(id: string, edit: (row: any) => void): Promise<string[]> {
    const ps = edited("worktree-ps-claude-devin-ask.json", "ps.json", (o) => {
      for (const row of o.result.worktrees[0].agents) edit(row);
    });
    replies({ "terminal list": "terminal-list-claude-devin.json", "worktree ps": ps, "terminal send": "terminal-send-escape.json" });
    await host().interrupt(id, "stalled");
    return sends();
  }
  const programStatus = (state: string) => (row: any) => (row.programStatus = { state });

  test("a Devin turn at work gets two Escapes, in two sends", async () => {
    expect(await interruptWith(DEVIN_SEAT, programStatus("working"))).toEqual(["\x1b", "\x1b"]);
  });

  test("a Devin picker gets one: one cancels it", async () => {
    expect(await interruptWith(DEVIN_SEAT, () => {})).toEqual(["\x1b"]);
  });

  test("an idle Devin prompt gets one: two open its revert menu", async () => {
    expect(await interruptWith(DEVIN_SEAT, programStatus("idle"))).toEqual(["\x1b"]);
  });

  test("a Claude Code turn at work gets one: one stops it, and two open its rewind menu", async () => {
    expect(await interruptWith(CLAUDE_SEAT, programStatus("working"))).toEqual(["\x1b"]);
  });

  test("an omp turn at work gets one", async () => {
    const ps = edited("worktree-ps-working-live.json", "ps.json", (o) => (o.result.worktrees[0].agents[0].programStatus = { state: "working" }));
    replies({ "terminal list": "terminal-list-working-live.json", "worktree ps": ps, "terminal send": "terminal-send-escape.json" });
    await host().interrupt(LIVE, "stalled");
    expect(sends()).toEqual(["\x1b"]);
  });

  test("a terminal with no agent row gets one", async () => {
    replies({ "terminal list": "terminal-list-claude-devin.json", "worktree ps": "worktree-ps-working-live.json", "terminal send": "terminal-send-escape.json" });
    await host().interrupt(DEVIN_SEAT, "stalled");
    expect(sends()).toEqual(["\x1b"]);
  });

  test("lists that cannot be read still send one: the Escape is not lost to them", async () => {
    replies({ "terminal send": "terminal-send-escape.json" });
    await host().interrupt(DEVIN_SEAT, "stalled");
    expect(sends()).toEqual(["\x1b"]);
  });
});
