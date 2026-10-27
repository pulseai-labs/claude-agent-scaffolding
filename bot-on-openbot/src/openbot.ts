// The OpenBot side: `openbot-cli` for runs and their status, openbot.db (read-only) for the label
// the operator chose, and the Local scripts HTTP API for the pending question and its answer.
// Shapes come from the spike recordings in tests/fixtures/openbot/ (OpenBot v0.50.x, 2026-10-27).
//
// A delivery's `answer` from `status` is the model's text. It is shown or parsed as a draft, never
// mapped to a command: the label comes only from openbot.db (spike ruling (a)).

import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Prompt = { requestId: string; questionId: string; header: string; question: string; options: string[] };
export type Delivery = { state: "queued" | "running" | "completed" | "failed"; turnId: string | null; text: string | null };
export type Resolved = { questionId: string; answer: string } | "none" | "unreadable";

/** OpenBot cannot be reached, gave no JSON, or its db cannot be opened: try again on a later loop. */
export class OpenBotDown extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenBotDown";
  }
}

/** OpenBot refused (exit 1 on run: the hourly limit, or a refusal; an unknown delivery on status). */
export class OpenBotRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenBotRefused";
  }
}

export interface OpenBot {
  run(task: string, id: string): Promise<{ deliveryId: string }>;
  status(deliveryId: string): Promise<Delivery>;
  resolved(turnId: string): Promise<Resolved>;
  pending(): Promise<Prompt[]>;
  answer(prompt: Prompt, label: string): Promise<"ok" | "closed">;
}

export type OpenBotConfig = { agent: string; cli: string[]; db: string; automationDir: string };

const TIMEOUT_MS = 60_000;
const HTTP_TIMEOUT_MS = 30_000;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const oneLine = (s: unknown): string => (typeof s === "string" ? s.split("\n")[0]!.slice(0, 200) : "");

// No shell: argv goes straight to exec, the task on stdin. Exit codes are openbot-cli's own:
// 0 done, 1 failed or refused, 2 usage, 3 waits for a person, 4 timed out, 5 unreachable.
async function cli(cfg: OpenBotConfig, args: string[], stdin?: string): Promise<{ rc: number; json: Record<string, unknown> | null }> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([...cfg.cli, ...args], {
      stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env }, // the environment as it is now, not as the process started
    });
  } catch {
    throw new OpenBotDown(`openbot-cli ${args[0]}: could not start`);
  }
  const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
  try {
    const [stdout, rc] = await Promise.all([new Response(proc.stdout as ReadableStream).text(), proc.exited]);
    let json: Record<string, unknown> | null = null;
    try {
      const v: unknown = JSON.parse(stdout);
      if (isObj(v)) json = v;
    } catch {
      // judged below
    }
    return { rc, json };
  } finally {
    clearTimeout(timer);
  }
}

const STATES: Record<string, Delivery["state"]> = {
  queued: "queued", running: "running", completed: "completed",
  failed: "failed", interrupted: "failed", cancelled: "failed",
};

// One `prompt.resolved` payload → the one answer it holds, or unreadable. The path is the recorded
// one (openbot-db-prompt-resolved-tap.json, -free-text.json): changedMessages[] holds exactly one
// questionPrompt of exactly one question; resolution.responses.<that question id>.answers is ["<label>"].
function answerOf(payload: unknown, turnId: string): Resolved {
  if (!isObj(payload) || !Array.isArray(payload.changedMessages)) return "unreadable";
  const prompts = payload.changedMessages.filter((m) => isObj(m) && m.questionPrompt !== undefined);
  if (prompts.length !== 1) return "unreadable";
  const m = prompts[0] as Record<string, unknown>;
  if (m.turnId !== turnId || !isObj(m.questionPrompt)) return "unreadable";
  const qp = m.questionPrompt;
  if (!Array.isArray(qp.questions) || qp.questions.length !== 1) return "unreadable";
  const q = qp.questions[0];
  if (!isObj(q) || typeof q.id !== "string" || q.id === "") return "unreadable";
  if (!isObj(qp.resolution) || !isObj(qp.resolution.responses)) return "unreadable";
  const r = Object.hasOwn(qp.resolution.responses, q.id) ? qp.resolution.responses[q.id] : undefined;
  if (!isObj(r) || !Array.isArray(r.answers) || r.answers.length !== 1) return "unreadable";
  const answer = r.answers[0];
  if (typeof answer !== "string") return "unreadable";
  return { questionId: q.id, answer };
}

export function makeOpenBot(cfg: OpenBotConfig): OpenBot {
  // The automation folder's url and token, read fresh each call (OpenBot rewrites them on restart).
  // Every message below is our own text: never the token, never a raw fetch error.
  const connection = (): { url: string; token: string } => {
    try {
      const url = readFileSync(join(cfg.automationDir, "url"), "utf8").trim();
      const token = readFileSync(join(cfg.automationDir, "token"), "utf8").trim();
      if (url === "" || token === "") throw new Error();
      return { url, token };
    } catch {
      throw new OpenBotDown(`OpenBot automation url or token missing in ${cfg.automationDir}`);
    }
  };
  const http = async (what: string, method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: unknown }> => {
    const { url, token } = connection();
    let res: Response;
    try {
      res = await fetch(url + path, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch {
      throw new OpenBotDown(`OpenBot ${what}: no answer`);
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // judged by its status
    }
    return { status: res.status, json };
  };
  // The agent's id, found as openbot-cli finds it: by id, or the one agent with that name (case ignored).
  const agentId = async (): Promise<string> => {
    const r = await http("agents", "GET", "/v1/agents");
    if (r.status !== 200 || !Array.isArray(r.json)) throw new OpenBotDown(`OpenBot agents: HTTP ${r.status}`);
    const agents = r.json.filter((a): a is { id: string; name: string } => isObj(a) && typeof a.id === "string" && typeof a.name === "string");
    const byId = agents.find((a) => a.id === cfg.agent);
    if (byId) return byId.id;
    const want = cfg.agent.trim().toLocaleLowerCase();
    const named = agents.filter((a) => a.name.trim().toLocaleLowerCase() === want);
    if (named.length !== 1) throw new OpenBotDown(`OpenBot agents: ${named.length} agents match the configured name`);
    return named[0]!.id;
  };

  return {
    // `run <agent> - --id <id> --json`, no --wait (run-queued.json: {deliveryId, status: "queued"}).
    async run(task, id) {
      const { rc, json } = await cli(cfg, ["run", cfg.agent, "-", "--id", id, "--json"], task);
      if (rc === 1 || rc === 2) throw new OpenBotRefused(`openbot-cli run: exit ${rc}: ${oneLine(json?.error)}`);
      if (rc !== 0 || !json || typeof json.deliveryId !== "string" || json.deliveryId === "") {
        throw new OpenBotDown(`openbot-cli run: exit ${rc}${json ? `: ${oneLine(json.error)}` : ", no JSON"}`);
      }
      return { deliveryId: json.deliveryId };
    },

    // `status <agent> <deliveryId> --json` (status-*.json: {status, turnId, answer}); exit 1 when it failed.
    async status(deliveryId) {
      const { rc, json } = await cli(cfg, ["status", cfg.agent, deliveryId, "--json"]);
      if (rc !== 0 && rc !== 1) throw new OpenBotDown(`openbot-cli status: exit ${rc}`);
      if (!json) throw new OpenBotDown("openbot-cli status: no JSON");
      if (json.status === undefined && rc === 1) throw new OpenBotRefused(`openbot-cli status: ${oneLine(json.error)}`);
      const state = typeof json.status === "string" && Object.hasOwn(STATES, json.status) ? STATES[json.status]! : null;
      if (!state) throw new OpenBotDown("openbot-cli status: a delivery state this bot does not know");
      return {
        state,
        turnId: typeof json.turnId === "string" && json.turnId !== "" ? json.turnId : null,
        text: typeof json.answer === "string" ? json.answer : null,
      };
    },

    // openbot.db, read-only: the `prompt.resolved` rows whose payload_json.detail.turnId is this turn.
    async resolved(turnId) {
      let db: Database;
      try {
        db = new Database(cfg.db, { readonly: true });
      } catch {
        throw new OpenBotDown(`openbot.db cannot be opened: ${cfg.db}`);
      }
      try {
        let rows: { payload_json: unknown }[];
        try {
          rows = db.query(
            "SELECT payload_json FROM orchestration_events WHERE event_type = 'prompt.resolved' AND json_extract(payload_json, '$.detail.turnId') = ? ORDER BY sequence",
          ).all(turnId) as { payload_json: unknown }[];
        } catch {
          return "unreadable"; // the table or its columns changed shape
        }
        if (rows.length === 0) return "none";
        if (rows.length > 1) return "unreadable";
        let payload: unknown;
        try {
          payload = JSON.parse(String(rows[0]!.payload_json));
        } catch {
          return "unreadable";
        }
        return answerOf(payload, turnId);
      } finally {
        db.close();
      }
    },

    // GET /v1/agents/<id>/pending (pending-prompt.json): prompts[].{requestId, questions[0].{id, header, question, options[].label}}.
    // `options: null` is a question asked with no options (pending-prompt-no-options.json): it is kept,
    // with none, so the bridge can find it by its title and dismiss it. Any other shape is left out.
    async pending() {
      const id = await agentId();
      const r = await http("pending", "GET", `/v1/agents/${encodeURIComponent(id)}/pending`);
      if (r.status !== 200 || !isObj(r.json) || !Array.isArray(r.json.prompts)) throw new OpenBotDown(`OpenBot pending: HTTP ${r.status}`);
      const out: Prompt[] = [];
      for (const p of r.json.prompts) {
        if (!isObj(p) || typeof p.requestId !== "string" || !Array.isArray(p.questions) || p.questions.length !== 1) continue;
        const q = p.questions[0];
        if (!isObj(q) || typeof q.id !== "string" || typeof q.question !== "string") continue;
        const options: unknown[] | null = q.options === null ? [] : Array.isArray(q.options) ? q.options : null;
        if (options === null) continue;
        const labels = options.map((o) => (isObj(o) && typeof o.label === "string" ? o.label : null));
        if (labels.some((l) => l === null)) continue;
        const header = typeof q.header === "string" ? q.header : "";
        out.push({ requestId: p.requestId, questionId: q.id, header, question: q.question, options: labels as string[] });
      }
      return out;
    },

    // POST …/prompts/<requestId>/answer {"answers":{"<question id>":["<label>"]}}: 200 sent, 409 closed
    // (answer-unoffered-label.txt, answer-second-409.txt).
    async answer(prompt, label) {
      const id = await agentId();
      const path = `/v1/agents/${encodeURIComponent(id)}/prompts/${encodeURIComponent(prompt.requestId)}/answer`;
      const r = await http("answer", "POST", path, { answers: { [prompt.questionId]: [label] } });
      if (r.status === 409) return "closed";
      if (r.status >= 200 && r.status < 300) return "ok";
      throw new OpenBotDown(`OpenBot answer: HTTP ${r.status}`);
    },
  };
}
