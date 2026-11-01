import type { Picker } from "./offer.ts";

export type Runner = (argv: string[]) => Promise<{ rc: number; stdout: string; stderr: string }>;

const TIMEOUT_MS = 60_000;

// No shell: argv goes straight to exec. A binary that cannot start is a failed result, not a throw.
export const defaultRunner: Runner = async (argv) => {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  } catch {
    return { rc: 127, stdout: "", stderr: `${argv[0]}: could not start` };
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, TIMEOUT_MS);
  try {
    const [stdout, stderr, rc] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    if (timedOut) return { rc: rc === 0 ? 124 : rc, stdout, stderr: `${argv[0]}: timed out after 60 s\n${stderr}` };
    return { rc, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
};

export const unpark = (run: string, unit: string, runner: Runner = defaultRunner) =>
  runner(["baton", "unpark", run, unit]);

export const unparkTo = (run: string, unit: string, stage: string, runner: Runner = defaultRunner) =>
  runner(["baton", "unpark", run, unit, "--to", stage]);

export const disarm = (run: string, runner: Runner = defaultRunner) => runner(["baton", "disarm", run]);

export const merge = (prUrl: string, headSha: string, runner: Runner = defaultRunner) =>
  runner(["gh", "pr", "merge", prUrl, "--merge", "--match-head-commit", headSha]);

export const prView = (prUrl: string, runner: Runner = defaultRunner) =>
  runner(["gh", "pr", "view", prUrl, "--json", "number,baseRefName"]);

// baton 0.7.0: a blocked park's fresh screen and parsed picker, as one JSON line.
export const screen = (run: string, unit: string, runner: Runner = defaultRunner) =>
  runner(["baton", "screen", run, unit]);

// Sends option n only while the same park and the same label on line n are on a fresh screen.
export const answerScreen = (
  run: string, unit: string, parkAt: string, n: number, label: string, runner: Runner = defaultRunner,
) => runner(["baton", "answer", run, unit, "--park", parkAt, "--screen", String(n), label]);

// Types `text` through the picker's Other row, only while the same park and question are on screen.
export const answerText = (
  run: string, unit: string, parkAt: string, text: string, question: string, runner: Runner = defaultRunner,
) => runner(["baton", "answer", run, unit, "--park", parkAt, "--screen-text", text, "--question", question]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// `baton screen`'s one JSON line. A picker of any other shape reads as no picker.
export function parseScreen(stdout: string): { park_at: string; screen: string; picker: Picker | null } | null {
  let v: unknown;
  try {
    v = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!isObj(v) || typeof v.park_at !== "string" || typeof v.screen !== "string") return null;
  return { park_at: v.park_at, screen: v.screen, picker: isPicker(v.picker) ? v.picker : null };
}

function isPicker(p: unknown): p is Picker {
  if (!isObj(p) || !["omp-ask", "numbered", "claude-ask", "devin-ask"].includes(p.kind as string) || typeof p.question !== "string") return false;
  if (!(p.other === null || (typeof p.other === "number" && Number.isInteger(p.other)))) return false;
  return Array.isArray(p.options) && p.options.length > 0 && p.options.every((o, i) =>
    isObj(o) && o.n === i + 1 && typeof o.label === "string" && o.label !== "");
}
