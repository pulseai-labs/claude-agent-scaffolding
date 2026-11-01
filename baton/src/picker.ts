// A worker's live picker, read off its rendered screen, and the fixed keys that answer it.
// Shapes and keys come from the OpenBot-bridge spike (omp v18.11.3, Orca 1.4.238; AI repo
// docs/superpowers/evidence/2026-10-27-openbot-bridge-spike/README.md; recorded screens in
// tests/fixtures/orca/terminal-read-omp-ask*.json and terminal-read-*screen*/numbered*.json).
// The Claude Code and Devin shapes and keys come from the #998 probes (Claude Code 2.1.316, Devin
// 3000.11.234, Orca 1.4.238; AI repo docs/superpowers/evidence/2026-11-01-998-claude-devin-seats/
// README.md; recorded screens in tests/fixtures/orca/terminal-read-{claude,devin}-*.json).
//
// The parse only refuses: anything it is not sure is one live picker of a known kind is null, and
// the caller then offers no worker options and sends nothing.

export type PickerKind = "omp-ask" | "numbered" | "claude-ask" | "devin-ask";
/** `cursor` (devin-ask only) is the option row the cursor is on: free text moves from it. */
export type Picker = { kind: PickerKind; question: string; options: { n: number; label: string }[]; other: number | null; cursor?: number };

/** The footer of a live picker; an answered picker, or the ask tool's call, has none (spike README). */
const LIVE_FOOTER = "⏎ select";
/** The omp-ask row that opens a free-text box (spike README). */
const OTHER_LABEL = "Other (type your own)";
/** The box title per kind: `╭─ Ask` (omp ask tool) and `╭─ Review Mode` (omp `/review`). */
const TITLES: Record<string, PickerKind> = { Ask: "omp-ask", "Review Mode": "numbered" };

/**
 * The footers of a one-question, one-answer picker, whole lines. Another footer means another
 * shape: Devin's two questions (`←→ switch question`) and multi-select (`␣ toggle`), Claude Code's
 * two questions (`Tab/Arrow keys`) and its focused free-text row (a Vim hint).
 */
const CLAUDE_FOOTER = "Enter to select · ↑/↓ to navigate · Esc to cancel";
const DEVIN_FOOTER = "↑↓ select · ↵ confirm · ? help me out · esc cancel";
const RULE = /^─+$/;

/** `│ ❯ ○ red      │` → `❯ ○ red`; a line outside a box is only trimmed. */
const inner = (line: string): string => {
  let s = line.trim();
  if (s.startsWith("│")) s = s.slice(1);
  if (s.endsWith("│")) s = s.slice(0, -1);
  return s.trim();
};

/** One option row of `kind`: its cursor mark and the rest, or null when the line is not a row. */
function row(kind: PickerKind, s: string): { cursor: boolean; num: number | null; label: string } | null {
  const m = kind === "omp-ask" ? /^(❯ +)?○ +(\S.*)$/.exec(s) : /^(❯ +)?(\d+)\. +(\S.*)$/.exec(s);
  if (!m) return null;
  return kind === "omp-ask"
    ? { cursor: m[1] !== undefined, num: null, label: m[2] }
    : { cursor: m[1] !== undefined, num: Number(m[2]), label: m[3] };
}

/** The row block of a claude-ask or devin-ask body: one digit per row, 1..k, one cursor, unique labels. */
function digitRows(
  body: string[],
  rowRe: RegExp,
  descRe: RegExp,
): { question: string; rows: { cursor: boolean; n: number; label: string }[] } | null {
  const first = body.findIndex((l) => rowRe.test(l));
  if (first < 1) return null;
  const question = body
    .slice(0, first)
    .map((l) => l.replace(/^│ /, "").trim())
    .join(" ")
    .trim();
  if (question === "") return null;
  const rows: { cursor: boolean; n: number; label: string }[] = [];
  for (const l of body.slice(first)) {
    const m = rowRe.exec(l);
    if (m) rows.push({ cursor: m[1].trim() !== "", n: Number(m[2]), label: m[3].trim() });
    else if (!descRe.test(l)) return null;
  }
  if (rows.some((r, i) => r.n !== i + 1)) return null;
  if (rows.filter((r) => r.cursor).length !== 1) return null;
  if (new Set(rows.map((r) => r.label)).size !== rows.length) return null;
  return { question, rows };
}

/**
 * Claude Code's AskUserQuestion, one question and one answer: a rule, ` ☐ <header>`, the question
 * (a long one is `│ ` lines), `<n>. <label>` rows with five-space description lines, `Type
 * something.` last, a rule, the `Chat about this` row, the footer as the screen's last line.
 * Options are the rows before `Type something.`; `other` numbers that row. A typed draft replaces
 * the row's label, a multi-select's or two questions' header starts with an arrow, and a cursor on
 * the Chat row leaves no cursor among the rows: all three read as no picker. So does a cursor on
 * the free-text row: a digit there is typed into it, not a selection (review #1022 C1).
 */
function parseClaudeAsk(lines: string[], foot: number): Picker | null {
  const chat = /^(?:❯ |  )(\d)\. Chat about this$/.exec(lines[foot - 1] ?? "");
  if (!chat || !RULE.test(lines[foot - 2] ?? "")) return null;
  let head = foot - 3;
  while (head >= 0 && !lines[head].startsWith(" ☐ ")) {
    if (RULE.test(lines[head])) return null;
    head--;
  }
  if (head < 1 || !RULE.test(lines[head - 1])) return null;
  const blk = digitRows(lines.slice(head + 1, foot - 2), /^(❯ |  )(\d)\. (\S.*)$/, /^ {5}\S/);
  if (!blk || blk.rows.length < 2 || Number(chat[1]) !== blk.rows.length + 1) return null;
  const typed = blk.rows[blk.rows.length - 1];
  if (typed.label !== "Type something." || typed.cursor) return null;
  return {
    kind: "claude-ask",
    question: blk.question,
    options: blk.rows.slice(0, -1).map((r) => ({ n: r.n, label: r.label })),
    other: typed.n,
  };
}

/**
 * Devin's ask_user_question, one question and one answer: a `── <title> ──` line, the question,
 * `<n> <label>` rows with six-space description lines, an unnumbered `Other (type your own)` last,
 * a rule, the footer as the screen's last line. `other` is one past the last option. With the
 * cursor on the Other row Devin drops the row numbers, and that reads as no picker.
 */
function parseDevinAsk(lines: string[], foot: number): Picker | null {
  if (!RULE.test(lines[foot - 1] ?? "")) return null;
  let head = foot - 2;
  while (head >= 0 && !/^── \S.* ─+$/.test(lines[head])) {
    if (RULE.test(lines[head])) return null;
    head--;
  }
  if (head < 0) return null;
  const body = lines.slice(head + 1, foot - 1);
  if (body[body.length - 1] !== `      ${OTHER_LABEL}`) return null;
  const blk = digitRows(body.slice(0, -1), /^  (❭ |  )(\d) (\S.*)$/, /^ {6}\S/);
  if (!blk) return null;
  return {
    kind: "devin-ask",
    question: blk.question,
    options: blk.rows.map((r) => ({ n: r.n, label: r.label })),
    other: blk.rows.length + 1,
    cursor: blk.rows.find((r) => r.cursor)!.n,
  };
}

/**
 * The one live picker on `screen`, or null. A live picker is a box of a known title whose option
 * rows sit in one block, followed by a footer line holding `⏎ select`, with exactly one cursor row.
 * omp-ask: the question is the last text line above the box's first `├` separator, the rows the
 * block below it; the `Other (type your own)` row must be last and sets `other` (its row number),
 * and is left out of `options`. numbered: rows `<n>. <label>` with n = 1..k, no gap; the question
 * is the box title. Repeated labels are null (an answer is
 * checked by its label). claude-ask and devin-ask draw no box: see their parsers.
 */
export function parsePicker(screen: string): Picker | null {
  const lines = screen.split("\n");
  // Claude Code and Devin draw no box: their footer is the screen's last line, or it is no picker.
  const raw = lines.map((l) => l.trimEnd());
  let end = raw.length - 1;
  while (end >= 0 && raw[end] === "") end--;
  if (end >= 0 && raw[end] === CLAUDE_FOOTER) return parseClaudeAsk(raw, end);
  if (end >= 0 && raw[end] === DEVIN_FOOTER) return parseDevinAsk(raw, end);
  const footers = lines.flatMap((l, i) => (l.trim().startsWith("│") && inner(l).includes(LIVE_FOOTER) ? [i] : []));
  if (footers.length !== 1) return null;
  const foot = footers[0];
  let head = foot - 1;
  while (head >= 0 && /^[│├]/.test(lines[head].trim())) head--;
  if (head < 0 || !lines[head].trim().startsWith("╭")) return null;
  const title = lines[head].trim().slice(1).replace(/^[─\s]+/, "").replace(/[─╮\s]+$/, "");
  const kind = Object.prototype.hasOwnProperty.call(TITLES, title) ? TITLES[title] : undefined;
  if (!kind) return null;

  type Line = { text: string; row: ReturnType<typeof row> };
  const toLines = (ls: string[]): Line[] =>
    ls.filter((l) => !l.trim().startsWith("├")).map((l) => ({ text: inner(l), row: row(kind, inner(l)) }));
  let inBox = lines.slice(head + 1, foot);
  // omp-ask draws the question above a `├` separator and the rows below it. The rows are read only
  // below it, so a question line that looks like a row (`○ …`) is never an option (review #937 F1).
  let above: Line[] = [];
  if (kind === "omp-ask") {
    const sep = inBox.findIndex((l) => l.trim().startsWith("├"));
    if (sep < 0) return null;
    above = toLines(inBox.slice(0, sep));
    inBox = inBox.slice(sep + 1);
  }
  const body = toLines(inBox);
  const first = body.findIndex((b) => b.row);
  if (first < 0) return null;
  let last = first;
  while (last + 1 < body.length && body[last + 1].row) last++;
  // Around the block only blank lines; a second block, or any text, is not a picker we know.
  if (body.slice(last + 1).some((b) => b.text !== "")) return null;
  if (kind === "omp-ask" && body.slice(0, first).some((b) => b.text !== "")) return null;
  const rows = body.slice(first, last + 1).map((b) => b.row!);
  if (rows.filter((r) => r.cursor).length !== 1) return null;
  const labels = rows.map((r) => r.label);
  if (new Set(labels).size !== labels.length) return null;

  if (kind === "numbered") {
    if (body.slice(0, first).some((b) => b.text !== "")) return null;
    if (rows.some((r, i) => r.num !== i + 1)) return null;
    return { kind, question: title, options: rows.map((r, i) => ({ n: i + 1, label: r.label })), other: null };
  }
  const text = above.filter((b) => b.text !== "");
  if (text.length === 0) return null;
  const otherAt = labels.indexOf(OTHER_LABEL);
  if (otherAt >= 0 && otherAt !== labels.length - 1) return null;
  const options = (otherAt >= 0 ? labels.slice(0, -1) : labels).map((label, i) => ({ n: i + 1, label }));
  if (options.length === 0) return null;
  return { kind, question: text[text.length - 1].text, options, other: otherAt >= 0 ? otherAt + 1 : null };
}

/**
 * The keys per kind, from the spike README: Up stops at row 1 and Down at the last row (no wrap),
 * Home and PageUp do nothing, so Up × every row (Other included) reaches row 1 from anywhere.
 * Enter is `\r`. Of these two, only omp-ask has a free-text row. claude-ask and devin-ask: see
 * keysFor and textKeys.
 */
const KEYS: Record<"omp-ask" | "numbered", { up: string; down: string; enter: string; text: boolean }> = {
  "omp-ask": { up: "\x1b[A", down: "\x1b[B", enter: "\r", text: true },
  numbered: { up: "\x1b[A", down: "\x1b[B", enter: "\r", text: false },
};

/** Every row on the picker, the Other row included. */
const rowCount = (p: Picker) => p.options.length + (p.other !== null ? 1 : 0);

/** Any byte below 0x20, and DEL: an Enter, an Escape or a control key inside typed text. */
export const CONTROL_BYTE = /[\x00-\x1f\x7f]/;

/** Select option `n` with the cursor anywhere: one send. Throws when `n` is not an option row. */
export function keysFor(p: Picker, n: number): string {
  if (!p.options.some((o) => o.n === n)) throw new Error(`no option ${n} on the picker`);
  // Both draw their rows in a ring, so an Up count reaches no fixed row; a digit selects from anywhere.
  if (p.kind === "claude-ask" || p.kind === "devin-ask") return String(n);
  const k = KEYS[p.kind];
  return k.up.repeat(rowCount(p)) + k.down.repeat(n - 1) + k.enter;
}

/** Open the Other row, type `text`, submit: the sends, in order. Throws with no Other row or bad text. */
export function textKeys(p: Picker, text: string): string[] {
  if (p.other === null || p.kind === "numbered") throw new Error("the picker has no Other row");
  if (text === "") throw new Error("empty text");
  if (CONTROL_BYTE.test(text)) throw new Error("text has a control byte");
  // A digit on Claude Code's free-text row moves there and selects nothing.
  if (p.kind === "claude-ask") return [String(p.other), text, "\r"];
  // Devin's Other row has no digit. Up from row 1 wraps to it, so Up × the cursor's row reaches it.
  if (p.kind === "devin-ask") return [...Array<string>(p.cursor!).fill("\x1b[A"), text, "\r"];
  const k = KEYS[p.kind];
  return [k.up.repeat(rowCount(p)) + k.down.repeat(p.other - 1) + k.enter, text, k.enter];
}
