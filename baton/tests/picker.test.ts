// The picker parser: a live picker on a worker's screen, and the fixed keys that answer it.
// Screens are recorded Orca `terminal read --screen` replies (tests/fixtures/orca/README.md);
// the keys are the spike's (plan 2026-10-27-openbot-bridge, "Spike results and rulings").

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keysFor, parsePicker, textKeys, type Picker } from "../src/picker.ts";

const FIX = join(import.meta.dir, "fixtures", "orca");
const screenOf = (f: string) => (JSON.parse(readFileSync(join(FIX, f), "utf8")).result.terminal.tail as string[]).join("\n");
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const COLOURS = [{ n: 1, label: "red" }, { n: 2, label: "green" }, { n: 3, label: "blue" }, { n: 4, label: "amber" }];
const REVIEW = [
  "Review against a base branch (PR Style)", "Review uncommitted changes", "Review a specific commit",
  "Review a specific PR", "Custom review instructions",
];

/** A numbered picker box as omp draws it, with `rows` as its lines (cursor marks included). */
const reviewBox = (rows: string[], title = "Review Mode") => [
  `╭─ ${title} ──────────╮`,
  "│                    │",
  ...rows.map((r) => `│  ${r}   │`),
  "│                    │",
  "│ ↑/↓ navigate  ⏎ select  ⎋ cancel   │",
  "╰────────────────────╯",
].join("\n");

test("omp ask picker parses in screen order", () => {
  const p = parsePicker(screenOf("terminal-read-omp-ask.json"))!;
  expect(p).toEqual({ kind: "omp-ask", question: "spike: which colour?", options: COLOURS, other: 5 });
});

test("a moved cursor parses the same picker", () => {
  expect(parsePicker(screenOf("terminal-read-omp-ask-moved.json"))).toEqual(parsePicker(screenOf("terminal-read-omp-ask.json")));
});

test("the ask tool's call above the live box is not read: its rows have no footer", () => {
  // The call box lists red..amber with `○` and no Other row; the live box adds Other. other = 5
  // in the first test is the live box's. Here the live box is cut off: the call box alone is null.
  const lines = screenOf("terminal-read-omp-ask.json").split("\n");
  const live = lines.findIndex((l) => l.startsWith("╭─ Ask "));
  expect(live).toBeGreaterThan(0);
  expect(lines.slice(0, live).join("\n")).toContain("○ red");
  expect(parsePicker(lines.slice(0, live).join("\n"))).toBeNull();
});

test("the Custom answer box, and answered pickers, are null", () => {
  for (const f of ["terminal-read-omp-ask-other.json", "terminal-read-omp-ask-answered.json", "terminal-read-omp-ask-answered-other.json"]) {
    expect([f, parsePicker(screenOf(f))]).toEqual([f, null]);
  }
});

test("numbered picker parses", () => {
  const p = parsePicker(screenOf("terminal-read-screen.json"))!;
  expect(p.kind).toBe("numbered");
  expect(p.question).toBe("Review Mode");
  expect(p.options.map((o) => o.label)).toEqual(REVIEW);
  expect(p.options.map((o) => o.n)).toEqual([1, 2, 3, 4, 5]);
  expect(p.other).toBeNull();
  // The cursor on row 3 parses the same.
  expect(parsePicker(screenOf("terminal-read-numbered-row3.json"))).toEqual(p);
});

test("no picker is null", () => expect(parsePicker("just output\n done")).toBeNull());
test("numbers with a gap are null", () => {
  expect(parsePicker("Pick one\n 1. a\n 3. b")).toBeNull();
  expect(parsePicker(reviewBox(["❯ 1. a", "  3. b"]))).toBeNull();
  // The control: the same box with no gap parses.
  expect(parsePicker(reviewBox(["❯ 1. a", "  2. b"]))!.options).toEqual([{ n: 1, label: "a" }, { n: 2, label: "b" }]);
});

test("two option blocks are null", () => {
  expect(parsePicker(reviewBox(["❯ 1. a", "  2. b", "", "  1. c", "  2. d"]))).toBeNull();
  // Two live boxes on one screen.
  const one = reviewBox(["❯ 1. a", "  2. b"]);
  expect(parsePicker(`${one}\n${one}`)).toBeNull();
});

test("a box with no cursor, or two, is null", () => {
  expect(parsePicker(reviewBox(["  1. a", "  2. b"]))).toBeNull();
  expect(parsePicker(reviewBox(["❯ 1. a", "❯ 2. b"]))).toBeNull();
});

test("a box of another title is null", () => {
  expect(parsePicker(reviewBox(["❯ 1. a", "  2. b"], "Model"))).toBeNull();
});

test("text below, or above, the numbered rows is null", () => {
  expect(parsePicker(reviewBox(["❯ 1. a", "  2. b", "", "a note"]))).toBeNull();
  expect(parsePicker(reviewBox(["a note", "", "❯ 1. a", "  2. b"]))).toBeNull();
});

test("an omp ask box with a repeated label, or Other not last, is null", () => {
  const ask = (rows: string[]) => [
    "╭─ Ask ──────╮", "│ q?   │", "├──────┤", ...rows.map((r) => `│ ${r}  │`), "├──────┤",
    "│ ⏎ select · n note · ↑/↓ move · ⎋ cancel │", "╰──────╯",
  ].join("\n");
  expect(parsePicker(ask(["❯ ○ a", "  ○ b", "  ○ Other (type your own)"]))).toEqual({
    kind: "omp-ask", question: "q?", options: [{ n: 1, label: "a" }, { n: 2, label: "b" }], other: 3,
  });
  expect(parsePicker(ask(["❯ ○ a", "  ○ a", "  ○ Other (type your own)"]))).toBeNull();
  expect(parsePicker(ask(["❯ ○ a", "  ○ Other (type your own)", "  ○ b"]))).toBeNull();
  expect(parsePicker(ask(["❯ ○ a", "  ◉ b"]))).toBeNull();
  // No question line above the rows.
  expect(parsePicker(ask(["❯ ○ a", "  ○ b"]).replace("│ q?   │\n", ""))).toBeNull();
});

test("an omp ask question that looks like a row is the question, never an option (review #937 F1)", () => {
  const box = (question: string[], rows: string[]) => [
    "╭─ Ask ──────╮", ...question.map((q) => `│ ${q}   │`), "├──────┤", ...rows.map((r) => `│ ${r}  │`), "├──────┤",
    "│ ⏎ select · n note · ↑/↓ move · ⎋ cancel │", "╰──────╯",
  ].join("\n");
  const rows = ["❯ ○ a", "  ○ b", "  ○ Other (type your own)"];
  const want = { kind: "omp-ask", options: [{ n: 1, label: "a" }, { n: 2, label: "b" }], other: 3 };
  expect(parsePicker(box(["○ q?"], rows))).toEqual({ ...want, question: "○ q?" });
  expect(parsePicker(box(["pick one:", "○ q?"], rows))).toEqual({ ...want, question: "○ q?" });
  // Rows above the separator, or text in the row block, are not a picker we know.
  expect(parsePicker(box(["q?"], ["❯ ○ a", "  ○ b", "note", "  ○ c"]))).toBeNull();
  // With no separator between the question and the rows, the rows cannot be told from the question.
  expect(parsePicker(box(["q?"], rows).replace("├──────┤\n", ""))).toBeNull();
});

const ask = () => parsePicker(screenOf("terminal-read-omp-ask.json"))!;
const numbered = () => parsePicker(screenOf("terminal-read-screen.json"))!;

test("keysFor resets the cursor first", () => {
  // rows counts the Other row: 4 options + Other = 5 Ups for omp-ask, 5 for the numbered picker.
  expect(keysFor(ask(), 2).startsWith(UP.repeat(5))).toBe(true);
  expect(keysFor(ask(), 2)).toBe(UP.repeat(5) + DOWN + "\r");
  expect(keysFor(ask(), 1)).toBe(UP.repeat(5) + "\r");
  expect(keysFor(ask(), 4)).toBe(UP.repeat(5) + DOWN.repeat(3) + "\r");
  expect(keysFor(numbered(), 3)).toBe(UP.repeat(5) + DOWN.repeat(2) + "\r");
});

test("keysFor refuses a row that is not an option", () => {
  const p = ask();
  for (const n of [0, -1, 5, 99, 1.5, NaN]) expect(() => keysFor(p, n)).toThrow();
  expect(() => keysFor(numbered(), 6)).toThrow();
});

test("textKeys is the recorded sequence", () => {
  expect(textKeys(ask(), "hello")).toEqual([UP.repeat(5) + DOWN.repeat(4) + "\r", "hello", "\r"]);
});

test("textKeys throws with no Other row, and on a numbered picker whatever it holds", () => {
  expect(() => textKeys(numbered(), "hello")).toThrow();
  expect(() => textKeys({ ...numbered(), other: 6 }, "hello")).toThrow();
});

test("textKeys throws on empty text or a control byte", () => {
  for (const t of ["", "a\nb", "a\rb", "\x1b", "a\x07", "a\x7f", "\x00"]) expect(() => textKeys(ask(), t)).toThrow();
  expect(textKeys(ask(), "use main, not dev")[1]).toBe("use main, not dev");
});

test("a one-row picker is one Up and Enter", () => {
  const p: Picker = { kind: "numbered", question: "q", options: [{ n: 1, label: "a" }], other: null };
  expect(keysFor(p, 1)).toBe(UP + "\r");
});
