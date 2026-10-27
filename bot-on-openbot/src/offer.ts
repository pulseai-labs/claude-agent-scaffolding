// The options a notice is asked with, and the one act each label stands for. A tapped label is
// matched back exactly against the offer recorded for its question, so labels within one offer are
// unique; that is what makes the mapping safe.

import { readUnit, reviewedHead, runReadable, stageNames } from "./baton-state.ts";
import type { Notice } from "./notice.ts";

/** The picker JSON `baton screen` prints (baton 0.7.0, src/picker.ts). */
export type Picker = {
  kind: "omp-ask" | "numbered";
  question: string;
  options: { n: number; label: string }[];
  other: number | null;
};

export type Draft = { summary: string; recommended: number | null; why: string };

export type Act =
  | { do: "unpark" } | { do: "unpark-to" } | { do: "unpark-stage"; stage: string }
  | { do: "show" } | { do: "disarm" } | { do: "disarm-yes" } | { do: "no" }
  | { do: "merge"; pr_url: string; head_sha: string } | { do: "merge-yes"; pr_url: string; head_sha: string }
  | { do: "open-pr"; pr_url: string }
  | { do: "pick"; n: number; label: string } | { do: "other" };

export type Offer = { title: string; text: string; options: { label: string; act: Act }[]; allowOther: boolean };

export const LABELS = {
  unpark: "Unpark", unparkTo: "Unpark to stage…", show: "Show question", disarm: "Disarm",
  merge: "Merge", openPr: "Open PR", yes: "Yes", no: "No", cancel: "Cancel",
} as const;

const RECOMMENDED = " (recommended)";

// The notice's offer, or null for a plain message (run-done, plain, or a unit or run baton cannot show).
export function offerFor(n: Notice, message: string, run: string): Offer | null {
  const offer = (title: string, options: Offer["options"]): Offer => ({ title, text: message, options, allowOther: false });
  switch (n.kind) {
    case "run-park":
      if (!runReadable(run)) return null;
      return offer(`${run} parked`, [{ label: LABELS.disarm, act: { do: "disarm" } }]);
    case "unit-park": {
      if (!readUnit(run, n.unit)) return null;
      return offer(`${run}/${n.unit} parked`, [
        { label: LABELS.unpark, act: { do: "unpark" } },
        { label: LABELS.unparkTo, act: { do: "unpark-to" } },
        { label: LABELS.show, act: { do: "show" } },
        { label: LABELS.disarm, act: { do: "disarm" } },
      ]);
    }
    case "unit-move": {
      const u = readUnit(run, n.unit);
      if (!u) return null;
      const options: Offer["options"] = [];
      if (u.pr_url) {
        const head = reviewedHead(run, n.unit);
        if (head) options.push({ label: LABELS.merge, act: { do: "merge", pr_url: u.pr_url, head_sha: head } });
        options.push({ label: LABELS.openPr, act: { do: "open-pr", pr_url: u.pr_url } });
      }
      options.push({ label: LABELS.disarm, act: { do: "disarm" } });
      return offer(`${run}/${n.unit} at ${n.stage}`, options);
    }
    default:
      return null;
  }
}

// A blocked park: the worker's own options (the recommended one first, marked), then the escapes.
// A worker label wins over an escape with the same label; a mark that would repeat a label is dropped.
export function blockedOffer(message: string, run: string, unit: string, picker: Picker | null, draft: Draft | null): Offer {
  const title = `${run}/${unit} waits on a question`;
  const worker = picker?.options ?? [];
  const usable = picker !== null && new Set(worker.map((o) => o.label)).size === worker.length;
  if (!usable) {
    return {
      title,
      text: `${message}\nNo options could be read from the worker's screen: answer it in the Orca terminal`,
      options: escapes([]),
      allowOther: false,
    };
  }
  const plain = worker.map((o) => ({ label: o.label, act: { do: "pick", n: o.n, label: o.label } as Act }));
  const rec = draft?.recommended != null ? worker.find((o) => o.n === draft.recommended) : undefined;
  let options = plain;
  let text = draft ? draft.summary : message;
  if (rec && !worker.some((o) => o.label === rec.label + RECOMMENDED)) {
    options = [
      { label: rec.label + RECOMMENDED, act: { do: "pick", n: rec.n, label: rec.label } },
      ...plain.filter((o) => o.label !== rec.label),
    ];
    text = `${draft!.summary}\nRecommended: ${draft!.why || rec.label}`;
  }
  return { title, text, options: [...options, ...escapes(options.map((o) => o.label))], allowOther: picker.other !== null };
}

function escapes(taken: string[]): Offer["options"] {
  return [
    { label: LABELS.show, act: { do: "show" } as Act },
    { label: LABELS.unpark, act: { do: "unpark" } as Act },
    { label: LABELS.disarm, act: { do: "disarm" } as Act },
  ].filter((o) => !taken.includes(o.label));
}

// Yes carries the act the first tap chose; `_what` names it for the reader of a call site.
export function confirmOffer(_what: "merge" | "disarm", carry: Act, title: string, text: string): Offer {
  return {
    title,
    text,
    options: [{ label: LABELS.yes, act: carry }, { label: LABELS.no, act: { do: "no" } }],
    allowOther: false,
  };
}

// The recipe's stages (sorted; baton stage names are [a-z0-9_-], so none reads as Cancel).
export function stageOffer(run: string, title: string): Offer {
  return {
    title,
    text: "Unpark to which stage?",
    options: [
      ...stageNames(run).map((stage) => ({ label: stage, act: { do: "unpark-stage", stage } as Act })),
      { label: LABELS.cancel, act: { do: "no" } },
    ],
    allowOther: false,
  };
}
