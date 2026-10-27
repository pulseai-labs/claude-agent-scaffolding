export type Notice =
  | { kind: "unit-park"; run: string; unit: string; at: string }
  | { kind: "unit-move"; run: string; unit: string; stage: string }
  | { kind: "run-park"; run: string }
  | { kind: "run-done"; run: string }
  | { kind: "plain" };

// baton's own id patterns (baton/src/state.ts).
const RUN_ID_RE = /^[a-z0-9_-]+$/;
const UNIT_ID_RE = /^[A-Za-z0-9._-]+$/;
const STAGE_NAME_RE = /^[a-z0-9_-]+$/;

const PLAIN: Notice = { kind: "plain" };

export function parseKey(key: string): Notice {
  const parts = key.split("/");
  const run = parts[0] ?? "";
  if (!RUN_ID_RE.test(run)) return PLAIN;
  if (parts.length === 2 && parts[1] === "done") return { kind: "run-done", run };
  if (parts.length !== 4) return PLAIN;
  const [, second, third, at] = parts as [string, string, string, string];
  if (at === "") return PLAIN;
  // A unit literally named "run" reads as a run park; baton never mints that id on purpose.
  if (second === "run" && third === "park") return { kind: "run-park", run };
  if (!UNIT_ID_RE.test(second)) return PLAIN;
  if (third === "park") return { kind: "unit-park", run, unit: second, at };
  if (!STAGE_NAME_RE.test(third)) return PLAIN;
  return { kind: "unit-move", run, unit: second, stage: third };
}
