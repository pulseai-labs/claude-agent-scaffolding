import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type Call = { method: string; body: Record<string, unknown>; token: string };
type Scripted = { error_code: number; description: string; parameters?: { retry_after: number }; status?: number };

// A fake of the Bot API. node:http lets a "drop" destroy the socket before any
// response byte, so the client's fetch() itself rejects (a connection reset),
// not merely a 5xx response.
export class FakeTelegram {
  calls: Call[] = [];
  drops = 0; // drop the next N connections
  failures: Scripted[] = []; // answer the next calls with these ok:false replies
  dropped = 0;
  updates: { update_id: number }[] = []; // what getUpdates serves; like Telegram, ids below `offset` are confirmed and dropped
  private nextMessageId = 100;
  private server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (this.drops > 0) {
        this.drops--;
        this.dropped++;
        req.socket.destroy();
        return;
      }
      const m = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(req.url ?? "");
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      this.calls.push({ method: m?.[2] ?? "", body, token: m?.[1] ?? "" });
      const f = this.failures.shift();
      if (f) {
        res.writeHead(f.status ?? (f.error_code >= 500 || f.error_code === 429 ? f.error_code : 400), { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error_code: f.error_code, description: f.description, parameters: f.parameters }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      if (m?.[2] === "getUpdates") {
        const off = typeof body.offset === "number" ? body.offset : 0;
        this.updates = this.updates.filter((u) => u.update_id >= off);
        res.end(JSON.stringify({ ok: true, result: this.updates }));
        return;
      }
      res.end(JSON.stringify({ ok: true, result: { message_id: this.nextMessageId++ } }));
    });
  });

  async start(): Promise<string> {
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  stop(): void {
    this.server.closeAllConnections();
    this.server.close();
  }
}
