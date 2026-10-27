// A worker's live picker, read off its rendered screen, and the fixed keys that answer it.
// Shapes and keys come from the OpenBot-bridge spike (omp v18.11.3, Orca 1.4.238; AI repo
// docs/superpowers/evidence/2026-10-27-openbot-bridge-spike/README.md; recorded screens in
// tests/fixtures/orca/terminal-read-omp-ask*.json and terminal-read-*screen*/numbered*.json).
//
// The parse only refuses: anything it is not sure is one live picker of a known kind is null, and
// the caller then offers no worker options and sends nothing.

export type PickerKind = "omp-ask" | "numbered";
export type Picker = { kind: PickerKind; question: string; options: { n: number; label: string }[]; other: number | null };

/** The footer of a live picker; an answered picker, or the ask tool's call, has none (spike README). */
const LIVE_FOOTER = "⏎ select";
/** The omp-ask row that opens a free-text box (spike README). */
const OTHER_LABEL = "Other (type your own)";
/** The box title per kind: `╭─ Ask` (omp ask tool) and `╭─ Review Mode` (omp `/review`). */
const TITLES: Record<string, PickerKind> = { Ask: "omp-ask", "Review Mode": "numbered" };

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

/**
 * The one live picker on `screen`, or null. A live picker is a box of a known title whose option
 * rows sit in one block, followed by a footer line holding `⏎ select`, with exactly one cursor row.
 * omp-ask: the question is the last text line above the rows; the `Other (type your own)` row must be
 * last and sets `other` (its row number), and is left out of `options`. numbered: rows `<n>. <label>`
 * with n = 1..k, no gap; the question is the box title. Repeated labels are null (an answer is
 * checked by its label).
 */
export function parsePicker(screen: string): Picker | null {
  const lines = screen.split("\n");
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
  const body: Line[] = lines.slice(head + 1, foot)
    .filter((l) => !l.trim().startsWith("├"))
    .map((l) => ({ text: inner(l), row: row(kind, inner(l)) }));
  const first = body.findIndex((b) => b.row);
  if (first < 0) return null;
  let last = first;
  while (last + 1 < body.length && body[last + 1].row) last++;
  // Below the block only blank lines; a second block, or any text, is not a picker we know.
  if (body.slice(last + 1).some((b) => b.text !== "")) return null;
  const rows = body.slice(first, last + 1).map((b) => b.row!);
  if (rows.filter((r) => r.cursor).length !== 1) return null;
  const labels = rows.map((r) => r.label);
  if (new Set(labels).size !== labels.length) return null;

  if (kind === "numbered") {
    if (body.slice(0, first).some((b) => b.text !== "")) return null;
    if (rows.some((r, i) => r.num !== i + 1)) return null;
    return { kind, question: title, options: rows.map((r, i) => ({ n: i + 1, label: r.label })), other: null };
  }
  const text = body.slice(0, first).filter((b) => b.text !== "");
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
 * Enter is `\r`. Only omp-ask has a free-text row.
 */
const KEYS: Record<PickerKind, { up: string; down: string; enter: string; text: boolean }> = {
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
  const k = KEYS[p.kind];
  return k.up.repeat(rowCount(p)) + k.down.repeat(n - 1) + k.enter;
}

/** Open the Other row, type `text`, submit: three sends, in order. Throws with no Other row or bad text. */
export function textKeys(p: Picker, text: string): string[] {
  const k = KEYS[p.kind];
  if (!k.text || p.other === null) throw new Error("the picker has no Other row");
  if (text === "") throw new Error("empty text");
  if (CONTROL_BYTE.test(text)) throw new Error("text has a control byte");
  return [k.up.repeat(rowCount(p)) + k.down.repeat(p.other - 1) + k.enter, text, k.enter];
}
