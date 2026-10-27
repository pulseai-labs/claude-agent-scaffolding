// Shared test scaffolding: a temp state dir, a hand-written baton run, fake-openbot replies, a seeded
// openbot.db and a recording runner. Nothing here reaches a real openbot-cli, baton or gh.
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner } from "../src/actions.ts";
import { makeOpenBot, type OpenBot } from "../src/openbot.ts";

export const FAKE = join(import.meta.dir, "fake-openbot");
export const FIX = join(import.meta.dir, "fixtures", "openbot");
export const P1 = "2026-10-27T10:00:00.000Z"; // r1/u1: an ordinary park
export const P5 = "2026-10-27T16:50:00.000Z"; // r1/u5: a blocked park
export const PR = "https://github.com/o/r/pull/7";
export const HEAD = "a".repeat(40);

/** The picker screen of the spike (terminal-read-omp-ask.json) as `baton screen` would print it. */
export const COLOURS = {
  kind: "omp-ask", question: "spike: which colour?", other: 5,
  options: ["red", "green", "blue", "amber"].map((label, i) => ({ n: i + 1, label })),
};

export type Env = {
  dir: string;
  bot: OpenBot;
  runner: Runner;
  runs: string[][];
  reply: { fn: (argv: string[]) => { rc: number; stdout: string; stderr: string } };
  replies: Record<string, unknown>;
  setReplies(r: Record<string, unknown>): void;
  delivery(id: string): string;
  status(id: string, state: string, turnId?: string | null, answer?: string | null): void;
  resolve(turnId: string, label: string, mutate?: (p: any) => void): void;
  calls(): { argv: string[]; stdin: string }[];
  runStdins(): string[];
  writeRun(doc: unknown, run?: string): void;
  cleanup(): void;
};

export function makeEnv(): Env {
  const dir = mkdtempSync(join(tmpdir(), "bot-ob-"));
  const fake = join(dir, "fake");
  mkdirSync(fake);
  process.env.FAKE_OPENBOT_DIR = fake;
  process.env.BOT_ON_OPENBOT_STATE_DIR = join(dir, "state");
  process.env.BATON_STATE_DIR = join(dir, "baton");
  const db = join(dir, "openbot.db");
  const d = new Database(db);
  d.exec(readFileSync(join(FIX, "openbot-db-orchestration-events.schema.sql"), "utf8"));
  d.close();
  let seq = 0;
  const runs: string[][] = [];
  const reply = { fn: (_: string[]) => ({ rc: 0, stdout: "", stderr: "" }) };
  const env: Env = {
    dir,
    bot: makeOpenBot({ agent: "Autopilot", cli: [FAKE], db, automationDir: join(dir, "automation") }),
    runs,
    reply,
    runner: async (argv) => {
      runs.push(argv);
      return reply.fn(argv);
    },
    replies: {},
    setReplies(r) {
      Object.assign(env.replies, r);
      writeFileSync(join(fake, "replies.json"), JSON.stringify(env.replies));
      rmSync(join(fake, "counts.json"), { force: true });
    },
    // A fixture file for `run` that returns this deliveryId.
    delivery(id) {
      const f = `run-${id}.json`;
      writeFileSync(join(fake, f), JSON.stringify({ ok: true, exitCode: 0, deliveryId: id, status: "queued" }) + "\n");
      return f;
    },
    status(id, state, turnId = null, answer = null) {
      const f = `status-${id}-${seq++}.json`;
      writeFileSync(join(fake, f), JSON.stringify({ ok: state !== "failed", exitCode: state === "failed" ? 1 : 0, id, status: state, turnId, answer }) + "\n");
      env.setReplies({ [`status ${id}`]: { file: f, rc: state === "failed" ? 1 : 0 } });
    },
    // A prompt.resolved row for `turnId` answered with `label`, from the recorded tap row.
    resolve(turnId, label, mutate) {
      const p = JSON.parse(readFileSync(join(FIX, "openbot-db-prompt-resolved-tap.json"), "utf8"));
      p.detail.turnId = turnId;
      p.changedMessages[0].turnId = turnId;
      p.changedMessages[0].questionPrompt.resolution.responses.reply.answers = [label];
      mutate?.(p);
      const h = new Database(db);
      h.prepare(
        "INSERT INTO orchestration_events (event_id, command_id, aggregate_type, aggregate_id, event_type, occurred_at, payload_json) VALUES (?, ?, 'thread', 't', 'prompt.resolved', 'x', ?)",
      ).run(`e${seq}`, `c${seq++}`, JSON.stringify(p));
      h.close();
    },
    calls() {
      try {
        return readFileSync(join(fake, "argv.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    },
    runStdins: () => env.calls().filter((c) => c.argv[0] === "run").map((c) => c.stdin),
    writeRun(doc, run = "r1") {
      const rd = join(dir, "baton", "runs", run);
      mkdirSync(rd, { recursive: true });
      writeFileSync(join(rd, "run.json"), JSON.stringify(doc));
      writeFileSync(join(rd, "recipe.json"), JSON.stringify({ stages: { build: {}, review: {} } }));
    },
    cleanup() {
      delete process.env.FAKE_OPENBOT_DIR;
      delete process.env.BOT_ON_OPENBOT_STATE_DIR;
      delete process.env.BATON_STATE_DIR;
      rmSync(dir, { recursive: true, force: true });
    },
  };
  env.writeRun(defaultRun());
  env.setReplies({});
  return env;
}

export function defaultRun(over: Record<string, unknown> = {}) {
  return {
    status: "armed",
    units: {
      u1: { id: "u1", stage: "build", parked: { reason: "second prompt", at: P1 }, vars: {} },
      u2: { id: "u2", stage: "review", parked: null, vars: { pr_url: PR } },
      u5: { id: "u5", stage: "build", parked: { reason: "blocked", at: P5, blocked: { thread: "thread-1" } }, vars: {} },
    },
    ...over,
  };
}

/** `baton screen` output for r1/u5 with `picker`. */
export const screenJson = (picker: unknown = COLOURS, parkAt = P5) =>
  JSON.stringify({ park_at: parkAt, thread: "thread-1", screen: "╭─ Ask\n│ spike: which colour?\n│ ❯ ○ red", picker }) + "\n";

/** Captures stderr lines while `f` runs. */
export async function captureErr<T>(f: () => Promise<T>): Promise<{ value: T; err: string[] }> {
  const err: string[] = [];
  const real = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((c: string | Uint8Array) => (err.push(String(c)), true)) as typeof process.stderr.write;
  try {
    return { value: await f(), err };
  } finally {
    process.stderr.write = real;
  }
}
