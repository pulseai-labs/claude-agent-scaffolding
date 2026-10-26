// The T3 Code host: baton's Host interface over T3's tailnet `/mcp` endpoint.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HostAuthError, HostDownError, LaunchError, type Host, type LaunchRequest, type PendingQuestion, type PendingRequest, type ThreadStatus } from "../host.ts";
import { bindLaunchDir, git, isLaunchDir, releaseLaunchDir } from "./launch-dir.ts";
import { callTool, callToolClassified, readToken, type ToolCall } from "./mcp.ts";

export type T3Config = { base: string; tokenFile: string };

export const DEFAULT_T3_BASE = "https://draco-desk.tail71316d.ts.net:8445/mcp";
const DEFAULT_TOKEN_FILE = "~/.config/spine-autopilot/t3-token.json";

const expandHome = (p: string) => (p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

/** `${BATON_CONFIG:-~/.config/baton/config.json}`'s optional `t3` block, over the defaults. */
export function loadT3Config(): T3Config {
  const path = process.env.BATON_CONFIG || join(homedir(), ".config", "baton", "config.json");
  let t3: Partial<T3Config> = {};
  let text: string | undefined;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    // no config file: defaults
  }
  if (text !== undefined) {
    const raw = JSON.parse(text) as { t3?: Partial<T3Config> };
    t3 = raw?.t3 ?? {};
  }
  return {
    base: typeof t3.base === "string" && t3.base ? t3.base : DEFAULT_T3_BASE,
    tokenFile: expandHome(typeof t3.tokenFile === "string" && t3.tokenFile ? t3.tokenFile : DEFAULT_TOKEN_FILE),
  };
}

// Field names below come from live T3 0.1.0 replies (tests/fixtures/t3/) and, for the launch
// reply, from the t3_thread_launch success schema in the installed server.

type Project = { id: string; title: string; workspaceRoot: string; deletedAt?: string | null };
type ToolError = { error: { code?: string; message?: string } | unknown };

const FAILED = new Set(["failed", "cancelled", "rolled_back"]);

const isToolError = (r: unknown): r is ToolError =>
  r !== null && typeof r === "object" && "error" in r && Object.keys(r as object).length === 1;
const errorCode = (r: ToolError): string | undefined => (r.error as { code?: string } | null)?.code;
const describe = (r: ToolError): string => {
  const e = r.error as { code?: string; message?: string } | null;
  return [e?.code, e?.message].filter(Boolean).join(": ") || JSON.stringify(r.error);
};

const NONCE_TAG = /\[baton ([^\]]+)\]\s*$/;

export class T3Host implements Host {
  private base: string;
  private tokenFile: string;

  constructor({ base, tokenFile }: T3Config) {
    this.base = base;
    this.tokenFile = tokenFile;
  }

  private token(): string {
    const t = readToken(this.tokenFile);
    if (t.expires_at * 1000 <= Date.now()) throw new HostAuthError("token expired");
    return t.access_token;
  }

  private async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    return callTool(this.base, this.token(), name, args);
  }

  /** The one live project titled `title`, across every page; else LaunchError. */
  private async project(title: string): Promise<Project> {
    const found: Project[] = [];
    let cursor: number | null = null;
    for (let page = 0; page < 100; page++) {
      const args: Record<string, unknown> = { limit: 100 };
      if (cursor !== null) args.cursor = cursor;
      const r = await this.call("t3_project_list", args);
      if (isToolError(r)) throw new HostDownError(`t3_project_list: ${describe(r)}`);
      const { projects, nextCursor } = r as { projects: Project[]; nextCursor: number | null };
      found.push(...projects.filter((p) => p.title === title && !p.deletedAt));
      if (nextCursor === null || nextCursor === undefined) break;
      cursor = nextCursor;
    }
    if (found.length !== 1) {
      throw new LaunchError(found.length ? `${found.length} T3 projects are titled "${title}"` : `no T3 project titled "${title}"`);
    }
    return found[0];
  }

  async bind(project: string, cwd: string, nonce: string, mode: "worktree" | "root"): Promise<string> {
    const p = await this.project(project);
    return bindLaunchDir(p.workspaceRoot, cwd, nonce, mode);
  }

  async release(_project: string, cwd: string, dir: string): Promise<void> {
    releaseLaunchDir(cwd, dir);
  }

  async launch(r: LaunchRequest): Promise<{ threadId: string }> {
    const head = git(r.cwd, "branch", "--show-current");
    if (!head.ok) throw new LaunchError(`not a git checkout: ${r.cwd}`);
    const strategy: Record<string, string> = { type: "existing_worktree", worktreePath: r.cwd };
    if (head.out) strategy.branch = head.out;
    else if (!isLaunchDir(r.cwd)) throw new LaunchError(`detached HEAD in ${r.cwd}`);
    const p = await this.project(r.project);
    const res: ToolCall = await callToolClassified(this.base, this.token(), "t3_thread_launch", {
      projectId: p.id,
      title: r.title,
      modelSelection: { instanceId: r.instance, model: r.model },
      runtimeMode: "full-access",
      workspaceStrategy: strategy,
      message: r.message,
    });
    // Only T3's own tool error for the launch is a refusal. Anything else that is not a
    // success with a thread id may still have created the thread: the outcome is unknown, so
    // the engine keeps session, claim and directory and step 0 finds the thread by nonce.
    if (res.kind === "tool_error") throw new LaunchError(`t3_thread_launch: ${describe({ error: res.error })}`);
    if (res.kind === "protocol") throw new HostDownError(`t3_thread_launch outcome unknown: ${res.cause}`);
    if (res.kind === "rpc_error") {
      throw new HostDownError(`t3_thread_launch outcome unknown: JSON-RPC error ${describe({ error: res.error })}`);
    }
    const threadId = (res.value as { threadId?: unknown } | null)?.threadId;
    if (typeof threadId !== "string" || !threadId) throw new HostDownError("t3_thread_launch outcome unknown: reply has no threadId");
    return { threadId };
  }

  private async read(threadId: string): Promise<any | "gone"> {
    const r = await this.call("t3_thread_read", { threadId, limit: 1, runLimit: 1 });
    if (isToolError(r)) {
      if (errorCode(r) === "thread_not_found") return "gone";
      throw new HostDownError(`t3_thread_read: ${describe(r)}`);
    }
    return r;
  }

  async status(threadId: string): Promise<ThreadStatus> {
    const r = await this.read(threadId);
    if (r === "gone") return { state: "gone", activity: "" };
    const st = this.mapState(r);
    if (!(r.thread?.pendingRequestCount > 0)) return st;
    const pending = await this.pendingRequest(threadId);
    return pending ? { ...st, pending } : st;
  }

  /** The thread's first pending request; undefined when the list is empty (a race, not an error). */
  private async pendingRequest(threadId: string): Promise<PendingRequest | undefined> {
    const list = await this.call("t3_pending_request_list", { threadId });
    if (isToolError(list)) throw new HostDownError(`t3_pending_request_list: ${describe(list)}`);
    const requestId = (list as { requestIds?: string[] }).requestIds?.[0];
    if (!requestId) return undefined;
    const read = await this.call("t3_pending_request_read", { threadId, requestId });
    if (isToolError(read)) throw new HostDownError(`t3_pending_request_read: ${describe(read)}`);
    const questions = ((read as { questions?: any[] }).questions ?? []).map((q) => {
      const out: PendingQuestion = {
        id: q.id,
        header: q.header,
        question: q.question,
        options: (q.options ?? []).map((o: any) => (o.description === undefined ? { label: o.label } : { label: o.label, description: o.description })),
      };
      if (q.multiSelect !== undefined) out.multiSelect = q.multiSelect;
      return out;
    });
    return { id: requestId, questions };
  }

  private mapState(r: any): ThreadStatus {
    const run = r.recentRuns?.[0];
    const activity = `${r.thread?.updatedAt ?? ""} ${run?.runId ?? ""}`;
    const st: string | undefined = run?.status;
    // Turn end is the run's status with no active run; `thread.settled` is never read.
    if (st === "completed" && r.thread?.activeRunId == null) return { state: "completed", activity };
    // A failure run is final only with no active run: run status alone never ends a thread.
    if (st !== undefined && FAILED.has(st) && r.thread?.activeRunId == null) return { state: "failed", activity };
    // An interrupt is often an operator steering the thread: not a failure (see host.ts).
    if (st === "interrupted" && r.thread?.activeRunId == null) return { state: "interrupted", activity };
    if (st === "waiting") return { state: "waiting", activity };
    return { state: "active", activity };
  }

  async interrupt(threadId: string, reason: string): Promise<void> {
    const r = await this.read(threadId);
    if (r === "gone") return;
    const nonce = NONCE_TAG.exec(String(r.thread?.title ?? ""))?.[1];
    const args: Record<string, unknown> = { threadId, reason };
    if (nonce) args.clientRequestId = nonce;
    const res = await this.call("t3_thread_interrupt", args);
    if (isToolError(res)) {
      if (errorCode(res) === "thread_not_found") return;
      throw new HostDownError(`t3_thread_interrupt: ${describe(res)}`);
    }
  }

  async findByNonce(project: string, nonce: string): Promise<string[]> {
    const p = await this.project(project);
    const r = await this.call("t3_thread_list", { projectId: p.id, titleContains: `[baton ${nonce}]`, limit: 5 });
    if (isToolError(r)) throw new HostDownError(`t3_thread_list: ${describe(r)}`);
    return ((r as { threads?: { threadId: string }[] }).threads ?? []).map((t) => t.threadId);
  }
}
