// A local stand-in for T3's streamable-HTTP `/mcp` endpoint. It speaks just enough MCP for
// baton's client: `initialize` (issuing a session id), `notifications/initialized`, `tools/call`,
// and the closing `DELETE`. Nothing here talks to a real service.

export type ToolReply = { result?: unknown; isError?: boolean; rpcError?: { code: number; message: string } };
export type ToolHandler = (name: string, args: Record<string, unknown>) => ToolReply;
export type Seen = { method: string; headers: Record<string, string>; body: any };

export type StubOptions = {
  token: string;
  tools?: ToolHandler;
  sse?: boolean;
  /** Force this HTTP status on every POST. */
  status?: number;
};

export type Stub = { url: string; seen: Seen[]; calls: { name: string; args: Record<string, unknown> }[]; stop(): void };

const SESSION = "stub-session-1";

export function startStub(opts: StubOptions): Stub {
  const seen: Seen[] = [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => (headers[k] = v));
      if (req.method === "DELETE") {
        seen.push({ method: "DELETE", headers, body: null });
        return new Response(null, { status: 204 });
      }
      const body = await req.json();
      seen.push({ method: body.method, headers, body });
      if (opts.status) return new Response("nope", { status: opts.status });
      if (headers.authorization !== `Bearer ${opts.token}`) return new Response("unauthorized", { status: 401 });
      const reply = (msg: unknown, extra: Record<string, string> = {}) => {
        if (opts.sse) {
          const text = `event: message\ndata: ${JSON.stringify(msg)}\n\n`;
          return new Response(text, { headers: { "content-type": "text/event-stream", ...extra } });
        }
        return Response.json(msg, { headers: extra });
      };
      if (body.method === "initialize") {
        return reply(
          { jsonrpc: "2.0", id: body.id, result: { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "stub", version: "0" } } },
          { "mcp-session-id": SESSION },
        );
      }
      if (headers["mcp-session-id"] !== SESSION) return new Response("bad session", { status: 400 });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/call") {
        const { name, arguments: args } = body.params;
        calls.push({ name, args });
        const r = opts.tools ? opts.tools(name, args) : { result: {} };
        if (r.rpcError) return reply({ jsonrpc: "2.0", id: body.id, error: r.rpcError });
        return reply({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: JSON.stringify(r.result) }],
            structuredContent: r.result,
            isError: r.isError ?? false,
          },
        });
      }
      return reply({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "method not found" } });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/mcp`, seen, calls, stop: () => server.stop(true) };
}
