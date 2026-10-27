// `baton screen <run> <unit>`: a blocked park's fresh screen and the picker parsed from it, as one
// JSON line. It reads only; it takes no lock and sends nothing.

import { expect, test } from "bun:test";
import { main } from "../src/cli.ts";
import { setHostForTest } from "../src/hosts/select.ts";
import { parsePicker } from "../src/picker.ts";
import { openStore } from "../src/state.ts";
import { screenOf, useBlockedPark } from "./blocked-setup.ts";
import { FakeHost } from "./fake-host.ts";

const p = useBlockedPark();
const ASK = screenOf("terminal-read-omp-ask.json");

test("screen prints the park and the parsed picker", async () => {
  const host = await p.blockedAt1(ASK);
  const r = await p.run("screen", "r", "u1");
  expect(r.rc).toBe(0);
  expect(r.err).toBe("");
  expect(r.out.endsWith("\n")).toBe(true);
  expect(r.out.trimEnd().split("\n").length).toBe(1);
  const j = JSON.parse(r.out);
  expect(Object.keys(j).sort()).toEqual(["park_at", "picker", "screen", "thread"]);
  expect(j.park_at).toBe(p.unit().parked!.at);
  expect(j.thread).toBe("thread-1");
  expect(j.screen).toBe(ASK);
  expect(j.picker).toEqual(parsePicker(ASK));
  expect(j.picker.options.map((o: { label: string }) => o.label)).toEqual(["red", "green", "blue", "amber"]);
  // A fresh read: the screen the host shows now, not the one at park time.
  host.screens["thread-1"] = screenOf("terminal-read-omp-ask-moved.json");
  expect(JSON.parse((await p.run("screen", "r", "u1")).out).screen).toBe(host.screens["thread-1"]);
  expect(host.sent).toEqual([]);
});

test("screen with no picker prints picker null", async () => {
  await p.blockedAt1("just output\n done");
  const r = await p.run("screen", "r", "u1");
  expect(r.rc).toBe(0);
  expect(JSON.parse(r.out)).toMatchObject({ thread: "thread-1", screen: "just output\n done", picker: null });
});

test("screen on a unit not in a blocked park refuses", async () => {
  await p.launched();
  const r = await p.run("screen", "r", "u1");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("not in a blocked park");
  expect(r.out).toBe("");
});

test("screen on a park of another reason refuses (control: the blocked park reads)", async () => {
  await p.blockedAt1(ASK);
  expect((await p.run("screen", "r", "u1")).rc).toBe(0);
  const st = openStore(p.state());
  const at = p.unit().parked!.at;
  // Either half missing refuses: another reason with the blocked record, or no blocked record.
  for (const parked of [{ reason: "stop", at, blocked: { thread: "thread-1" } }, { reason: "blocked", at }]) {
    const run = st.readRun("r");
    run.units.u1.parked = parked;
    st.writeRun(run);
    const r = await p.run("screen", "r", "u1");
    expect([parked, r.rc]).toEqual([parked, 2]);
    expect(r.err).toContain("not in a blocked park");
  }
});

test("screen refuses while an unpark --to is in flight", async () => {
  await p.blockedAt1(ASK);
  expect(await main(["unpark", "r", "u1", "--to", "implement"])).toBe(0);
  const r = await p.run("screen", "r", "u1");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("unpark --to");
});

test("screen on a host without screen refuses", async () => {
  await p.blockedAt1(ASK);
  setHostForTest(new FakeHost({}, { withOptional: false }));
  const r = await p.run("screen", "r", "u1");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("host cannot read a screen");
  expect(r.out).toBe("");
});

test("host down is rc 4, host auth rc 3", async () => {
  const host = await p.blockedAt1(ASK);
  host.down = "unreachable";
  expect((await p.run("screen", "r", "u1")).rc).toBe(4);
  host.down = "auth";
  expect((await p.run("screen", "r", "u1")).rc).toBe(3);
});

test("unknown run or unit refuses; a wrong argument count is usage", async () => {
  await p.blockedAt1(ASK);
  expect(await p.run("screen", "nope", "u1")).toMatchObject({ rc: 2, err: "baton screen: no such run: nope\n" });
  expect(await p.run("screen", "r", "nope")).toMatchObject({ rc: 2, err: "baton screen: no such unit: nope\n" });
  expect((await p.run("screen", "r", "constructor")).rc).toBe(2);
  expect((await p.run("screen", "r")).rc).toBe(64);
  expect((await p.run("screen", "r", "u1", "x")).rc).toBe(64);
});
