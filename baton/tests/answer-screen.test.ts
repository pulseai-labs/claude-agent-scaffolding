// `baton answer <run> <unit> --park <at> --screen <n> <label>` and `--screen-text <text> --question
// <line>`: send the picker's fixed keys only while the same blocked park and the same picker line
// are on the worker's screen. Every check only refuses; nothing is sent unless all pass.

import { expect, test } from "bun:test";
import { main } from "../src/cli.ts";
import { setHostForTest } from "../src/hosts/select.ts";
import { AnswerRefused } from "../src/host.ts";
import { keysFor, parsePicker, textKeys } from "../src/picker.ts";
import { openStore } from "../src/state.ts";
import { screenOf, useBlockedPark } from "./blocked-setup.ts";
import { FakeHost } from "./fake-host.ts";

const p = useBlockedPark();
const ASK = screenOf("terminal-read-omp-ask.json");
const NUMBERED = screenOf("terminal-read-screen.json");
const pick = (...rest: string[]) => p.run("answer", "r", "u1", "--park", p.unit().parked!.at, ...rest);
const answered = () => p.events().filter((e) => e.kind === "answered");

test("screen answer sends the recorded keys", async () => {
  const host = await p.blockedAt1(ASK);
  const r = await pick("--screen", "2", "green");
  expect(r).toMatchObject({ rc: 0, err: "" });
  expect(host.sent).toEqual([{ thread: "thread-1", text: keysFor(parsePicker(ASK)!, 2) }]);
  expect(host.sent[0].text).toBe("\x1b[A".repeat(5) + "\x1b[B" + "\r");
  expect(answered()).toEqual([expect.objectContaining({ kind: "answered", unit: "u1", screen: 2, label: "green" })]);
});

test("screen answer reads the screen fresh: a moved cursor still answers row n", async () => {
  const host = await p.blockedAt1(ASK);
  host.screens["thread-1"] = screenOf("terminal-read-omp-ask-moved.json");
  expect((await pick("--screen", "3", "blue")).rc).toBe(0);
  expect(host.sent).toEqual([{ thread: "thread-1", text: "\x1b[A".repeat(5) + "\x1b[B".repeat(2) + "\r" }]);
});

test("screen answer works on the numbered picker", async () => {
  const host = await p.blockedAt1(NUMBERED);
  expect((await pick("--screen", "4", "Review a specific PR")).rc).toBe(0);
  expect(host.sent).toEqual([{ thread: "thread-1", text: "\x1b[A".repeat(5) + "\x1b[B".repeat(3) + "\r" }]);
});

test("screen answer refuses when line n has another label", async () => {
  const host = await p.blockedAt1(ASK);
  for (const [n, label] of [["2", "blue"], ["2", "Green"], ["2", "green "], ["5", "Other (type your own)"], ["9", "red"]]) {
    const r = await pick("--screen", n, label);
    expect([n, label, r.rc]).toEqual([n, label, 2]);
    expect(r.err).toMatch(/^baton answer: .*\n$/);
  }
  // The screen swapped to another picker before the call.
  host.screens["thread-1"] = NUMBERED;
  const r = await pick("--screen", "2", "green");
  expect(r.rc).toBe(2);
  expect(r.err).toContain('option 2 is not "green"');
  expect(host.sent).toEqual([]);
  expect(answered()).toEqual([]);
});

test("screen answer refuses a different park", async () => {
  const host = await p.blockedAt1(ASK);
  const r = await p.run("answer", "r", "u1", "--park", "2026-10-26T09:00:00.000Z", "--screen", "2", "green");
  expect(r.rc).toBe(2);
  expect(r.err).toContain(`the park is ${p.unit().parked!.at}, not 2026-10-26T09:00:00.000Z`);
  expect(host.sent).toEqual([]);
  // The control: the park's own `at` goes through.
  expect((await pick("--screen", "2", "green")).rc).toBe(0);
});

test("screen answer refuses when the unit is not blocked", async () => {
  const host = await p.blockedAt1(ASK);
  const at = p.unit().parked!.at;
  expect(await main(["unpark", "r", "u1"])).toBe(0);
  const r = await p.run("answer", "r", "u1", "--park", at, "--screen", "2", "green");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("not in a blocked park");
  expect(host.sent).toEqual([]);
});

test("screen answer refuses with no picker on screen", async () => {
  const host = await p.blockedAt1(ASK);
  for (const f of ["terminal-read-omp-ask-other.json", "terminal-read-omp-ask-answered.json"]) {
    host.screens["thread-1"] = screenOf(f);
    const r = await pick("--screen", "2", "green");
    expect([f, r.rc]).toEqual([f, 2]);
    expect(r.err).toContain("no picker on screen");
  }
  expect(host.sent).toEqual([]);
});

test("screen answer refuses an unpark --to in flight", async () => {
  const host = await p.blockedAt1(ASK);
  expect(await main(["unpark", "r", "u1", "--to", "implement"])).toBe(0);
  const r = await pick("--screen", "2", "green");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("unpark --to");
  expect(host.sent).toEqual([]);
});

test("screen answer refuses a disarmed run, and a session that is not the park's thread", async () => {
  const host = await p.blockedAt1(ASK);
  const st = openStore(p.state());
  let run = st.readRun("r");
  run.units.u1.session!.thread_id = "thread-9";
  st.writeRun(run);
  let r = await pick("--screen", "2", "green");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("no live session");
  run = st.readRun("r");
  run.units.u1.session!.thread_id = "thread-1";
  run.status = "disarmed";
  st.writeRun(run);
  r = await pick("--screen", "2", "green");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("disarmed");
  expect(host.sent).toEqual([]);
});

test("screen answer refuses on a host without keys", async () => {
  await p.blockedAt1(ASK);
  const bare = new FakeHost({}, { withOptional: true });
  bare.screens["thread-1"] = ASK;
  delete (bare as { keys?: unknown }).keys;
  setHostForTest(bare);
  const r = await pick("--screen", "2", "green");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("host cannot send keys");
  expect(bare.sent).toEqual([]);
});

test("screen-text sends textKeys while the question line matches", async () => {
  const host = await p.blockedAt1(ASK);
  const r = await pick("--screen-text", "use main", "--question", "spike: which colour?");
  expect(r).toMatchObject({ rc: 0, err: "" });
  expect(host.sent).toEqual(textKeys(parsePicker(ASK)!, "use main").map((text) => ({ thread: "thread-1", text })));
  expect(host.sent.map((s) => s.text)).toEqual(["\x1b[A".repeat(5) + "\x1b[B".repeat(4) + "\r", "use main", "\r"]);
  const ev = answered();
  expect(ev).toEqual([expect.objectContaining({ kind: "answered", unit: "u1", screen_text: true })]);
  expect(JSON.stringify(ev)).not.toContain("use main"); // the text itself is not logged
});

test("screen-text refuses another question line", async () => {
  const host = await p.blockedAt1(ASK);
  for (const q of ["spike: which color?", "spike: which colour? ", "Ask"]) {
    const r = await pick("--screen-text", "use main", "--question", q);
    expect([q, r.rc]).toEqual([q, 2]);
    expect(r.err).toContain("question");
  }
  expect(host.sent).toEqual([]);
});

test("screen-text refuses control bytes", async () => {
  const host = await p.blockedAt1(ASK);
  for (const t of ["a\nb", "a\rb", "\x1b", "a\x07", "a\tb", "a\x7f", "\x1b[A"]) {
    const r = await pick("--screen-text", t, "--question", "spike: which colour?");
    expect([t, r.rc]).toEqual([t, 2]);
    expect(r.err).toContain("control byte");
  }
  expect(host.sent).toEqual([]);
  expect(answered()).toEqual([]);
});

test("bad text is refused before the run is read (picker.ts's own check is the second layer)", async () => {
  await p.blockedAt1(ASK);
  expect((await p.run("answer", "nope", "u1", "--park", "x", "--screen-text", "a\nb", "--question", "q")).err)
    .toBe("baton answer: text has a control byte\n");
  expect((await p.run("answer", "nope", "u1", "--park", "x", "--screen-text", "", "--question", "q")).err)
    .toBe("baton answer: empty text\n");
  // The control: good text on that run reaches the run check.
  expect((await p.run("answer", "nope", "u1", "--park", "x", "--screen-text", "ab", "--question", "q")).err)
    .toBe("baton answer: no such run: nope\n");
});

test("screen-text refuses empty text", async () => {
  const host = await p.blockedAt1(ASK);
  const r = await pick("--screen-text", "", "--question", "spike: which colour?");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("empty");
  expect(host.sent).toEqual([]);
});

test("screen-text refuses a picker with no Other row", async () => {
  const host = await p.blockedAt1(NUMBERED);
  const r = await pick("--screen-text", "use main", "--question", "Review Mode");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("no Other row");
  expect(host.sent).toEqual([]);
});

test("a host that refuses the keys is rc 2 and records no event; host down is rc 4", async () => {
  const host = await p.blockedAt1(ASK);
  host.keys = async () => { throw new AnswerRefused("terminal gone"); };
  const r = await pick("--screen", "2", "green");
  expect(r.rc).toBe(2);
  expect(r.err).toBe("baton answer: terminal gone\n");
  const h2 = new FakeHost({}, { withOptional: true });
  h2.screens["thread-1"] = ASK;
  h2.down = "unreachable";
  setHostForTest(h2);
  expect((await pick("--screen", "2", "green")).rc).toBe(4);
  h2.down = "auth";
  expect((await pick("--screen", "2", "green")).rc).toBe(3);
  expect(answered()).toEqual([]);
});

test("the new forms parse exactly; anything else is usage", async () => {
  const host = await p.blockedAt1(ASK);
  const at = p.unit().parked!.at;
  const bad: string[][] = [
    ["--park", at, "--screen", "2"],
    ["--park", at, "--screen", "0", "red"],
    ["--park", at, "--screen", "-1", "red"],
    ["--park", at, "--screen", "02", "green"],
    ["--park", at, "--screen", "2.0", "green"],
    ["--park", at, "--screen", "x", "green"],
    ["--screen", "2", "green", "--park", at],
    ["--park", at, "--screen", "2", "green", "--question", "q"],
    ["--park", at, "--screen-text", "use main"],
    ["--park", at, "--screen-text", "use main", "--park", at],
    ["--park", at, "--question", "q", "--screen-text", "use main"],
    ["--park", at, "--screen", "2", "green", "extra"],
    ["--park", at, "--screen", "2", "green", "x", "y"],
    ["--pork", at, "--screen", "2", "green"],
  ];
  for (const b of bad) expect([b, (await p.run("answer", "r", "u1", ...b)).rc]).toEqual([b, 64]);
  expect(host.sent).toEqual([]);
});

test("the old form still refuses on a host without respond", async () => {
  await p.blockedAt1(ASK);
  setHostForTest(new FakeHost({}, { withOptional: false }));
  const r = await p.run("answer", "r", "u1", "green");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("host cannot answer");
  // A three-argument call is the old form, whatever its label.
  expect((await p.run("answer", "r", "u1", "--screen")).err).toContain("host cannot answer");
});
