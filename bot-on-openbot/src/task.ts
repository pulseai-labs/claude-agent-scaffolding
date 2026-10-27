// The fixed task wording the OpenBot agent gets, and the parse of its draft reply. The wording is
// fixed text plus data, never an instruction taken from a notice or a screen (design §6.2); the
// draft is model text, so anything the parse cannot use falls back to a question with no draft.

import type { Draft, Offer, Picker } from "./offer.ts";

/** The screen's last characters that go into a draft; one request may be 32 KiB. */
export const SCREEN_MAX_CHARS = 8000;
const SUMMARY_MAX = 2000;
const WHY_MAX = 300;

// A sentence gets a full stop unless it already ends in one (the spike's task-ask-1.txt wording).
const stop = (s: string): string => (/[.!?…]$/.test(s) ? s : `${s}.`);

// `firm`: the second ask of a question the agent asked without its options (issue #939).
export function askTask(o: Offer, firm = false): string {
  if (!firm) {
    return [
      `Ask the operator one question. Title: ${stop(o.title)} Show this text: ${stop(o.text)} Offer exactly these options, verbatim, in this order:`,
      ...o.options.map((x) => `- ${x.label}`),
      ...(o.allowOther ? ["Also let the operator type their own answer."] : []),
      "Do not answer it yourself.",
    ].join("\n");
  }
  return [
    `Ask the operator one question. Use your question tool. Title: ${stop(o.title)} Show this text in the question: ${stop(o.text)} Give the question tool exactly these options, each as a separate choice, verbatim, in this order:`,
    ...o.options.map((x) => `- ${x.label}`),
    "Each option must be its own choice in the question tool, never as text inside the question.",
    ...(o.allowOther ? ["Also let the operator type their own answer."] : []),
    "Do not answer it yourself.",
  ].join("\n");
}

export function draftTask(screen: string, picker: Picker): string {
  return [
    "A worker waits on a question on its terminal. Read the screen below. Do not ask the operator anything and do not run any tool. Reply with one JSON object and nothing else:",
    '{"summary": "<one paragraph: what the worker asks and what each choice means>", "recommended": <the number of the option you recommend, or null>, "why": "<one line>"}',
    "The options are:",
    ...picker.options.map((o) => `${o.n}. ${o.label}`),
    "Screen:",
    screen.slice(-SCREEN_MAX_CHARS),
  ].join("\n");
}

export function messageTask(text: string): string {
  return `Send the operator this message, verbatim, and nothing else: ${text}`;
}

const FENCE = /^```(?:json)?\n([\s\S]*)\n```$/;

// The reply must be exactly one JSON object (one surrounding ``` fence is stripped). A summary is
// required; a recommendation that is not an option number on the picker is dropped, not guessed.
export function parseDraft(reply: string, picker: Picker): Draft | null {
  let body = reply.trim();
  const fenced = FENCE.exec(body);
  if (fenced) body = fenced[1]!.trim();
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const d = v as Record<string, unknown>;
  if (typeof d.summary !== "string" || d.summary.trim() === "") return null;
  const n = d.recommended;
  const recommended = typeof n === "number" && picker.options.some((o) => o.n === n) ? n : null;
  return {
    summary: d.summary.trim().slice(0, SUMMARY_MAX),
    recommended,
    why: typeof d.why === "string" ? d.why.trim().slice(0, WHY_MAX) : "",
  };
}
