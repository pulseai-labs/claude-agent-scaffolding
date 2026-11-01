// The options a notice is asked with, and the one act each label stands for. A tapped label is
// matched back exactly against the offer recorded for its question, so labels within one offer are
// unique; that is what makes the mapping safe.
//
// OpenBot's question tool takes at most MAX_SHOWN options (issue #941: with more, the agent asks with
// none). So an option is shown (a button) or only accepted: an accepted label not shown still matches
// a typed answer exactly, and runs the act recorded with it, the same as a tap.

import { readUnit, reviewedHead, runReadable, stageNames } from "./baton-state.ts";
import type { Notice } from "./notice.ts";

/** The picker JSON `baton screen` prints (baton 0.7.0, src/picker.ts). */
export type Picker = {
  kind: "omp-ask" | "numbered" | "claude-ask" | "devin-ask";
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
  | { do: "pick"; n: number; label: string } | { do: "other" }
  | { do: "more" } | { do: "stages"; from: number };

/** `shown` absent means true. */
export type Option = { label: string; act: Act; shown?: boolean };

/** `back`: the offer Show question asks again, when not this one (the More… question's). */
export type Offer = { title: string; text: string; options: Option[]; allowOther: boolean; back?: Offer };

/** The most options one OpenBot question takes (measured, issue #941). */
export const MAX_SHOWN = 5;
const STAGE_PAGE = MAX_SHOWN - 1;

/** The labels the question shows, in order: what the agent is told to offer and the shape check compares. */
export const shownLabels = (o: Offer): string[] => o.options.filter((x) => x.shown !== false).map((x) => x.label);

export const LABELS = {
  unpark: "Unpark", unparkTo: "Unpark to stage…", show: "Show question", disarm: "Disarm",
  merge: "Merge", openPr: "Open PR", yes: "Yes", no: "No", cancel: "Cancel",
  more: "More…", moreStages: "More stages…",
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

// A blocked park. Up to 4 worker options: they are shown in screen order (the recommended one first,
// marked), then More…, which asks the escapes as a follow-up (the escapes are accepted here too). 5 or more (or a worker label More…):
// the escapes are shown, every worker option is accepted but not shown, and the text's last line asks
// for one label typed exactly. A mark that would repeat a label is dropped.
export function blockedOffer(message: string, run: string, unit: string, picker: Picker | null, draft: Draft | null): Offer {
  const title = `${run}/${unit} waits on a question`;
  const worker = picker?.options ?? [];
  const usable = picker !== null && new Set(worker.map((o) => o.label)).size === worker.length;
  if (!usable) {
    return {
      title,
      text: `${message}\nNo options could be read from the worker's screen: answer it in the Orca terminal`,
      options: escapes(),
      allowOther: false,
    };
  }
  const plain: Option[] = worker.map((o) => ({ label: o.label, act: { do: "pick", n: o.n, label: o.label } }));
  const rec = draft?.recommended != null ? worker.find((o) => o.n === draft.recommended) : undefined;
  const allowOther = picker.other !== null;
  if (worker.length >= MAX_SHOWN || worker.some((o) => o.label === LABELS.more)) {
    const shown = escapes();
    const typed = plain.filter((o) => !shown.some((e) => e.label === o.label)).map((o) => ({ ...o, shown: false }));
    const lines = [draft ? draft.summary : message];
    if (rec) lines.push(`Recommended: ${rec.label}${draft!.why ? ` (${draft!.why})` : ""}`);
    lines.push(`Type one option's exact label to answer: ${typed.map((o) => JSON.stringify(o.label)).join(", ")}`);
    return { title, text: lines.join("\n"), options: [...shown, ...typed], allowOther };
  }
  let options = plain;
  let text = draft ? draft.summary : message;
  if (rec && !worker.some((o) => o.label === rec.label + RECOMMENDED)) {
    options = [
      { label: rec.label + RECOMMENDED, act: { do: "pick", n: rec.n, label: rec.label } },
      ...plain.filter((o) => o.label !== rec.label),
    ];
    text = `${draft!.summary}\nRecommended: ${draft!.why || rec.label}`;
  }
  // The recommended option's own label stays accepted, not shown, so typing it picks that option.
  const alias: Option[] = options[0] && rec && options[0].label !== rec.label
    ? [{ label: rec.label, act: { do: "pick", n: rec.n, label: rec.label }, shown: false }]
    : [];
  // The escapes stay accepted, not shown, so a typed "Disarm" is still Disarm; a worker label wins.
  const taken = [...options, ...alias].map((o) => o.label);
  const typed = escapes().filter((e) => !taken.includes(e.label)).map((e) => ({ ...e, shown: false }));
  return { title, text, options: [...options, { label: LABELS.more, act: { do: "more" } }, ...alias, ...typed], allowOther };
}

function escapes(): Option[] {
  return [
    { label: LABELS.show, act: { do: "show" } },
    { label: LABELS.unpark, act: { do: "unpark" } },
    { label: LABELS.disarm, act: { do: "disarm" } },
  ];
}

// More… on a blocked park: the escapes. Show question there asks the blocked park's own offer again.
export function moreOffer(parent: Offer): Offer {
  return { title: parent.title, text: parent.text, options: escapes(), allowOther: false, back: parent.back ?? parent };
}

// A refused screen answer: asked again with baton's reason, offering only Show question and Disarm.
export function refusedOffer(title: string, text: string): Offer {
  return { title, text, options: [{ label: LABELS.show, act: { do: "show" } }, { label: LABELS.disarm, act: { do: "disarm" } }], allowOther: false };
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

// The recipe's stages (sorted; baton stage names are [a-z0-9_-], so none reads as Cancel or More
// stages…), 4 from `from` shown, then More stages… while more remain, else Cancel. Every stage, and
// Cancel, is accepted on every page, so a stage typed exactly works from any page.
export function stageOffer(run: string, title: string, from = 0): Offer {
  const stages = stageNames(run);
  const page = stages.slice(from, from + STAGE_PAGE);
  const more = from + STAGE_PAGE < stages.length;
  const stage = (s: string, shown: boolean): Option => ({ label: s, act: { do: "unpark-stage", stage: s }, ...(shown ? {} : { shown: false }) });
  const cancel: Option = { label: LABELS.cancel, act: { do: "no" } };
  return {
    title,
    text: "Unpark to which stage?",
    options: [
      ...page.map((s) => stage(s, true)),
      more ? { label: LABELS.moreStages, act: { do: "stages", from: from + STAGE_PAGE } } : cancel,
      ...stages.filter((s) => !page.includes(s)).map((s) => stage(s, false)),
      ...(more ? [{ ...cancel, shown: false }] : []),
    ],
    allowOther: false,
  };
}
