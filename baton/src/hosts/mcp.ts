// A minimal MCP client over streamable HTTP: `initialize`, then one `tools/call`, then the
// session is closed. One session per call keeps the client stateless across engine ticks.
//
// The bearer token is a secret: it is sent only in the Authorization header and never appears
// in an error message, a log line, or a return value.

import { readFileSync, statSync } from "node:fs";
import { HostAuthError, HostDownError } from "../host.ts";

export type Token = { access_token: string; expires_at: number; scope?: string };

const PROTOCOL_VERSION = "2025-06-18";
const TIMEOUT_MS = 30_000;

/** Read the token file. A mode other than 600 is refused before the file is read. */
export function readToken(path: string): Token {
  let mode: number;
  try {
    mode = statSync(path).mode & 0o777;
  } catch {
    throw new HostAuthError(`token file not found: ${path}`);
  }
  if (mode !== 0o600) throw new HostAuthError("token file mode must be 600");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // JSON.parse quotes the text near the fault, which may be token text: say nothing of it.
    throw new HostAuthError(`token file is not valid JSON: ${path}`);
  }
  const t = raw as Partial<Token> | null;
  if (!t || typeof t.access_token !== "string" || !t.access_token || typeof t.expires_at !== "number") {
    throw new HostAuthError(`token file lacks access_token or expires_at: ${path}`);
  }
  return { access_token: t.access_token, expires_at: t.expires_at, scope: typeof t.scope === "string" ? t.scope : undefined };
}

type RpcReply = { id?: unknown; result?: any; error?: unknown };
/** A reply that is no JSON-RPC answer at all: the server's outcome is unknown. */
type Protocol = { protocol: string; error: unknown };

async function post(base: string, token: string, body: object, session?: string): Promise<{ res: Response; session?: string }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
  };
  if (session) {
    headers["mcp-session-id"] = session;
    headers["mcp-protocol-version"] = PROTOCOL_VERSION;
  }
  let res: Response;
  try {
    res = await fetch(base, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const err = e as Error & { code?: string };
    const why = err.name === "TimeoutError" ? `no reply in ${TIMEOUT_MS / 1000} s` : (err.code ?? err.name);
    throw new HostDownError(`host unreachable: ${why}`);
  }
  if (res.status === 401 || res.status === 403) throw new HostAuthError("token rejected");
  if (res.status >= 500) throw new HostDownError(`host returned HTTP ${res.status}`);
  return { res, session: res.headers.get("mcp-session-id") ?? session };
}

/** The JSON-RPC reply with `id`, from a JSON body or a `text/event-stream` body. */
async function reply(res: Response, id: number): Promise<RpcReply | Protocol> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new HostDownError("host reply was cut off");
  }
  if (!res.ok) return { protocol: `HTTP ${res.status}`, error: { http: res.status, body: text.slice(0, 200) } };
  const type = res.headers.get("content-type") ?? "";
  const messages: unknown[] = [];
  if (type.includes("text/event-stream")) {
    for (const event of text.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue;
      try {
        messages.push(JSON.parse(data));
      } catch {
        // a non-JSON event is not ours
      }
    }
  } else {
    try {
      const v = JSON.parse(text);
      messages.push(...(Array.isArray(v) ? v : [v]));
    } catch {
      return { protocol: "reply is not JSON", error: { message: "reply is not JSON" } };
    }
  }
  const mine = messages.find((m) => (m as RpcReply)?.id === id) as RpcReply | undefined;
  return mine ?? { protocol: "no JSON-RPC reply with the request id", error: { message: "no JSON-RPC reply with the request id" } };
}

/** The tool's own result: structured content when present, else its text parsed as JSON. */
function toolResult(result: any): ToolCall {
  let value: unknown = result?.structuredContent;
  if (value === undefined) {
    const text = Array.isArray(result?.content) ? result.content.find((c: any) => c?.type === "text")?.text : undefined;
    if (typeof text === "string") {
      try {
        value = JSON.parse(text);
      } catch {
        value = text;
      }
    } else value = result;
  }
  return result?.isError ? { kind: "tool_error", error: value } : { kind: "result", value };
}

/**
 * One tool call, classified. `result` and `tool_error` are the tool's own answer; `rpc_error`
 * is a JSON-RPC error object; `protocol` is a reply that answers nothing (an HTTP 4xx other
 * than auth, a body that is not JSON, a stream with no reply to the request), so the server's
 * outcome is unknown. `cause` never carries the token.
 */
export type ToolCall =
  | { kind: "result"; value: unknown }
  | { kind: "tool_error"; error: unknown }
  | { kind: "rpc_error"; error: unknown }
  | { kind: "protocol"; cause: string; error: unknown };

const classify = (r: RpcReply | Protocol): ToolCall | null =>
  "protocol" in r ? { kind: "protocol", cause: r.protocol, error: r.error }
    : r.error !== undefined ? { kind: "rpc_error", error: r.error } : null;

/**
 * Call one MCP tool. Auth failures throw `HostAuthError`, an unreachable or failing server
 * throws `HostDownError`; a JSON-RPC, tool or protocol error is returned as `{error}`.
 */
export async function callTool(base: string, token: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const r = await callToolClassified(base, token, name, args);
  return r.kind === "result" ? r.value : { error: r.error };
}

/** `callTool`, with the kind of answer kept: a caller that must tell a refusal from an unknown outcome. */
export async function callToolClassified(base: string, token: string, name: string, args: Record<string, unknown>): Promise<ToolCall> {
  const init = await post(base, token, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "baton", version: "0.3.2" } },
  });
  const hello = await reply(init.res, 1);
  const bad = classify(hello);
  if (bad) return bad;
  const session = init.session;
  try {
    const note = await post(base, token, { jsonrpc: "2.0", method: "notifications/initialized" }, session);
    await note.res.arrayBuffer().catch(() => undefined);
    const call = await post(base, token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }, session);
    const r = await reply(call.res, 2);
    return classify(r) ?? toolResult((r as RpcReply).result);
  } finally {
    if (session) {
      // Best effort: a session the server keeps a little longer harms nothing.
      await fetch(base, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}`, "mcp-session-id": session, "mcp-protocol-version": PROTOCOL_VERSION },
        signal: AbortSignal.timeout(5_000),
      }).then((r) => r.arrayBuffer(), () => undefined).catch(() => undefined);
    }
  }
}
