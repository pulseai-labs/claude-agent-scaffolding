// Why a unit parked, for the operator's card: the stop file's text and the driver's escalate action.
// Both were written by a seat, so both are untrusted: each is read bounded, stripped of control
// characters, and shown quoted as data. Nothing here reads the text to decide anything.

import { readHead, type ParkEvent } from "./baton-state.ts";

const STOP_MAX = 800;
const ACTION_MAX = 4000;

// C0 and C1 controls except newline, and the bidi overrides that can reorder what is shown.
const UNSAFE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

function quoted(text: string, max: number): string {
  const clean = text.replace(/\r\n?/g, "\n").replace(UNSAFE, "").trim();
  const cut = clean.length > max ? `${clean.slice(0, max)}…` : clean;
  return cut.split("\n").map((l) => `> ${l}`.trimEnd()).join("\n");
}

/** The lines that say why the park is a park, or none. `at` is the park the card is for: an event of another park says nothing about it. */
export function whyLines(p: ParkEvent | null, at?: string, opts: { action?: boolean } = {}): string[] {
  if (!p || (p.at !== undefined && at !== undefined && p.at !== at)) return [];
  const out: string[] = [];
  if (p.stop_file !== undefined) {
    const head = readHead(p.stop_file);
    if (head === null) out.push("stop file: not readable");
    else if (head.trim() === "") out.push("stop file: empty");
    else out.push(`stop file (text a seat wrote, shown as data):\n${quoted(head, STOP_MAX)}`);
  }
  if (opts.action !== false && p.action !== undefined && p.action.trim() !== "") {
    out.push(`driver action (text a driver wrote, shown as data):\n${quoted(p.action, ACTION_MAX)}`);
  }
  return out;
}
