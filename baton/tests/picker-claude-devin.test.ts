// The Claude Code and Devin pickers, on screens recorded by the #998 probes: what parses, what
// reads as no picker, and the keys each kind gets.

import { describe, expect, test } from "bun:test";
import { keysFor, parsePicker, textKeys } from "../src/picker.ts";
import { screenOf } from "./blocked-setup.ts";

const CLAUDE = screenOf("terminal-read-claude-ask.json");
const CLAUDE_LONG = screenOf("terminal-read-claude-ask-long.json");
const DEVIN = screenOf("terminal-read-devin-ask.json");
const DEVIN_LONG = screenOf("terminal-read-devin-ask-long.json");
const LONG_QUESTION =
  "We found two ways to carry the probe across the staging boundary, and each one changes what the verifier reads at close, so which of the two ways should this work item take, given the brief says nothing on it at all?";

describe("claude-ask", () => {
  test("a recorded picker parses; the free-text and Chat rows are not options", () => {
    expect(parsePicker(CLAUDE)).toEqual({
      kind: "claude-ask",
      question: "Which colour for the probe?",
      options: [
        { n: 1, label: "red" },
        { n: 2, label: "green" },
        { n: 3, label: "blue" },
      ],
      other: 4,
    });
  });

  test("a long question is its gutter lines, joined; a wrapped description is no row", () => {
    expect(parsePicker(CLAUDE_LONG)).toEqual({
      kind: "claude-ask",
      question: LONG_QUESTION,
      options: [
        { n: 1, label: "Keep it (Recommended)" },
        { n: 2, label: "Move it" },
      ],
      other: 3,
    });
  });

  test("the cursor on the free-text row reads as no picker, with or without its Vim footer", () => {
    const s = CLAUDE.replace("❯ 1. red", "  1. red").replace("  4. Type something.", "❯ 4. Type something.");
    expect(parsePicker(s)).toBeNull();
    expect(parsePicker(s.replace("· Esc to cancel", "· ctrl+g to edit in Vim · Esc to cancel"))).toBeNull();
    // The adjacent control: the Vim footer alone, on a cursor elsewhere, is another shape too.
    expect(parsePicker(CLAUDE.replace("· Esc to cancel", "· ctrl+g to edit in Vim · Esc to cancel"))).toBeNull();
    // And the cursor on another row still parses.
    expect(parsePicker(CLAUDE.replace("❯ 1. red", "  1. red").replace("  3. blue", "❯ 3. blue"))?.kind).toBe("claude-ask");
  });

  test("two questions, a multi-select and a typed draft read as no picker", () => {
    expect(parsePicker(screenOf("terminal-read-claude-two-questions.json"))).toBeNull();
    expect(parsePicker(screenOf("terminal-read-claude-multi.json"))).toBeNull();
    expect(parsePicker(screenOf("terminal-read-claude-ask-typed.json"))).toBeNull();
  });

  test.each([
    ["the footer is not the last line", (s: string) => s + "\n● a reply below it"],
    ["no Chat row", (s: string) => s.replace("  5. Chat about this", "  5. Something else")],
    ["the Chat row has the wrong number", (s: string) => s.replace("  5. Chat about this", "  6. Chat about this")],
    ["no rule above the Chat row", (s: string) => s.replace(/─+\n  5\. Chat/, "text\n  5. Chat")],
    ["a header with arrows", (s: string) => s.replace(" ☐ Colour", "←  ☐ Colour  ✔ Submit  →")],
    ["a blank question", (s: string) => s.replace("Which colour for the probe?\n❯", "\n❯")],
    ["no rule above the header", (s: string) => s.replace(/─+\n ☐ Colour/, "text\n ☐ Colour")],
    ["no header", (s: string) => s.replace(" ☐ Colour", " Colour")],
    ["no free-text row", (s: string) => s.replace("  4. Type something.", "  4. Something else")],
    ["a row number gap", (s: string) => s.replace("  3. blue", "  7. blue")],
    ["two cursors", (s: string) => s.replace("  2. green", "❯ 2. green")],
    ["no cursor", (s: string) => s.replace("❯ 1. red", "  1. red")],
    ["a repeated label", (s: string) => s.replace("  2. green", "  2. red")],
    ["a stray line among the rows", (s: string) => s.replace("     Green", "Green")],
    ["no question", (s: string) => s.replace("Which colour for the probe?\n❯", "❯")],
    ["another footer", (s: string) => s.replace("Enter to select · ↑/↓ to navigate", "Enter to select · Tab/Arrow keys to navigate")],
  ])("refused: %s", (_name, edit) => {
    const s = edit(CLAUDE);
    expect(s).not.toBe(CLAUDE);
    expect(parsePicker(s)).toBeNull();
  });

  test("a digit selects an option; the free-text row is no option", () => {
    const p = parsePicker(CLAUDE)!;
    expect(keysFor(p, 2)).toBe("2");
    expect(() => keysFor(p, 4)).toThrow("no option 4");
  });

  test("free text: the digit that moves to the row, the text, Enter", () => {
    expect(textKeys(parsePicker(CLAUDE)!, "teal")).toEqual(["4", "teal", "\r"]);
    expect(() => textKeys(parsePicker(CLAUDE)!, "a\rb")).toThrow("control byte");
  });
});

describe("devin-ask", () => {
  test("a recorded picker parses; the Other row is not an option", () => {
    expect(parsePicker(DEVIN)).toEqual({
      kind: "devin-ask",
      question: "Which colour for the probe?",
      options: [
        { n: 1, label: "red" },
        { n: 2, label: "green" },
        { n: 3, label: "blue" },
      ],
      other: 4,
      cursor: 1,
    });
  });

  test("a wrapped question is joined; a wrapped description is no row", () => {
    expect(parsePicker(DEVIN_LONG)).toEqual({
      kind: "devin-ask",
      question: LONG_QUESTION,
      options: [
        { n: 1, label: "Keep it (Recommended)" },
        { n: 2, label: "Move it" },
      ],
      other: 3,
      cursor: 1,
    });
  });

  test("two questions, a multi-select and the cursor on Other read as no picker", () => {
    expect(parsePicker(screenOf("terminal-read-devin-two-questions.json"))).toBeNull();
    expect(parsePicker(screenOf("terminal-read-devin-multi.json"))).toBeNull();
    expect(parsePicker(screenOf("terminal-read-devin-ask-other.json"))).toBeNull();
  });

  test.each([
    ["the footer is not the last line", (s: string) => s + "\n a reply below it"],
    ["no rule above the footer", (s: string) => s.replace(/─+\n↑↓/, "text\n↑↓")],
    ["a blank question", (s: string) => s.replace("  Which colour for the probe?\n", "\n")],
    ["no title line", (s: string) => s.replace(/── Probe colour ─+\n/, "")],
    ["no Other row", (s: string) => s.replace("      Other (type your own)\n", "")],
    ["a row number gap", (s: string) => s.replace("    3 blue", "    7 blue")],
    ["two cursors", (s: string) => s.replace("    2 green", "  ❭ 2 green")],
    ["no cursor", (s: string) => s.replace("  ❭ 1 red", "    1 red")],
    ["a repeated label", (s: string) => s.replace("    2 green", "    2 red")],
    ["a stray line among the rows", (s: string) => s.replace("      Green probe colour", "Green probe colour")],
    ["no question", (s: string) => s.replace("  Which colour for the probe?\n", "")],
    ["another footer", (s: string) => s.replace("↵ confirm", "␣ toggle · ↵ confirm")],
  ])("refused: %s", (_name, edit) => {
    const s = edit(DEVIN);
    expect(s).not.toBe(DEVIN);
    expect(parsePicker(s)).toBeNull();
  });

  test("a digit selects an option; the Other row is no option", () => {
    const p = parsePicker(DEVIN)!;
    expect(keysFor(p, 3)).toBe("3");
    expect(() => keysFor(p, 4)).toThrow("no option 4");
  });

  test("free text: Up × the cursor's row wraps to Other, one send each, then the text and Enter", () => {
    expect(textKeys(parsePicker(DEVIN)!, "teal")).toEqual(["\x1b[A", "teal", "\r"]);
    const moved = DEVIN.replace("  ❭ 1 red", "    1 red").replace("    3 blue", "  ❭ 3 blue");
    expect(parsePicker(moved)?.cursor).toBe(3);
    expect(textKeys(parsePicker(moved)!, "teal")).toEqual(["\x1b[A", "\x1b[A", "\x1b[A", "teal", "\r"]);
  });
});

test("a screen with both footers takes the last line's kind only", () => {
  // A Devin reply quoting Claude Code's footer above Devin's live picker reads as Devin's.
  expect(parsePicker("Enter to select · ↑/↓ to navigate · Esc to cancel\n" + DEVIN)?.kind).toBe("devin-ask");
});
