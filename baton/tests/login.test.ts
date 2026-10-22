import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { login } from "../src/hosts/t3-login.ts";

const BIN = join(import.meta.dir, "..", "bin", "baton");
const SECRET = "tok-SECRET-9f3a1c";

type Oauth = { origin: string; base: string; registered: any[]; tokenForms: URLSearchParams[]; stop(): void };

/** A stand-in OAuth server: metadata, registration, and a token endpoint that checks PKCE. */
function startOauth(): Oauth {
  const registered: any[] = [];
  const tokenForms: URLSearchParams[] = [];
  let challenge = "";
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const u = new URL(req.url);
      const origin = `http://127.0.0.1:${server.port}`;
      if (u.pathname === "/.well-known/oauth-authorization-server") {
        return Response.json({
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
        });
      }
      if (u.pathname === "/register") {
        registered.push(await req.json());
        return Response.json({ client_id: "cid-1" }, { status: 201 });
      }
      if (u.pathname === "/token") {
        const form = new URLSearchParams(await req.text());
        tokenForms.push(form);
        const ok = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") === challenge;
        if (!ok || form.get("code") !== "the-code") return Response.json({ error: "invalid_grant" }, { status: 400 });
        return Response.json({ access_token: SECRET, token_type: "Bearer", expires_in: 2592000, scope: "read write" });
      }
      return new Response("nf", { status: 404 });
    },
  });
  const o: Oauth = { origin: `http://127.0.0.1:${server.port}`, base: `http://127.0.0.1:${server.port}/mcp`, registered, tokenForms, stop: () => server.stop(true) };
  (o as any).setChallenge = (c: string) => (challenge = c);
  return o;
}

/** The operator's part: open the printed authorize URL, then land on the callback with a code. */
async function approve(o: Oauth, authorizeUrl: string): Promise<void> {
  const a = new URL(authorizeUrl);
  (o as any).setChallenge(a.searchParams.get("code_challenge"));
  const cb = new URL(a.searchParams.get("redirect_uri")!);
  cb.searchParams.set("code", "the-code");
  cb.searchParams.set("state", a.searchParams.get("state")!);
  await fetch(cb);
}

const tmp = () => mkdtempSync(join(tmpdir(), "baton-login-"));

test("login exchanges at once and writes mode 600", async () => {
  const o = startOauth();
  const tokenFile = join(tmp(), "sub", "t3-token.json");
  const out: string[] = [];
  const before = Math.floor(Date.now() / 1000);
  try {
    await login({
      base: o.base,
      tokenFile,
      out: (l) => {
        out.push(l);
        if (l.startsWith("http")) void approve(o, l);
      },
    });
  } finally {
    o.stop();
  }
  expect(o.registered[0].client_name).toBe("baton");
  expect(o.tokenForms).toHaveLength(1);
  expect(o.tokenForms[0].get("resource")).toBe(o.base);
  expect(o.tokenForms[0].get("client_id")).toBe("cid-1");
  expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
  const t = JSON.parse(readFileSync(tokenFile, "utf8"));
  expect(Object.keys(t).sort()).toEqual(["access_token", "client_id", "expires_at", "scope"]);
  expect(t.access_token).toBe(SECRET);
  expect(t.client_id).toBe("cid-1");
  expect(t.scope).toBe("read write");
  expect(t.expires_at).toBeGreaterThanOrEqual(before + 2592000);
  expect(t.expires_at).toBeLessThanOrEqual(before + 2592000 + 30);
  expect(out.join("\n")).toContain("t3 auth pairing create");
  const authz = new URL(out.find((l) => l.startsWith("http"))!);
  expect(authz.searchParams.get("resource")).toBe(o.base);
  expect(authz.searchParams.get("code_challenge_method")).toBe("S256");
});

test("login refuses a callback with the wrong state and fails on a refused exchange", async () => {
  const o = startOauth();
  const tokenFile = join(tmp(), "t3-token.json");
  try {
    await expect(
      login({
        base: o.base,
        tokenFile,
        timeoutMs: 3000,
        out: (l) => {
          if (!l.startsWith("http")) return;
          const a = new URL(l);
          const cb = new URL(a.searchParams.get("redirect_uri")!);
          cb.searchParams.set("code", "the-code");
          cb.searchParams.set("state", "forged");
          void fetch(cb).then((r) => expect(r.status).toBe(400));
        },
      }),
    ).rejects.toThrow(/timed out/);
    // control: a valid state but a code the server refuses ends in an error, with no file
    await expect(
      login({
        base: o.base,
        tokenFile,
        out: (l) => {
          if (!l.startsWith("http")) return;
          const a = new URL(l);
          (o as any).setChallenge(a.searchParams.get("code_challenge"));
          const cb = new URL(a.searchParams.get("redirect_uri")!);
          cb.searchParams.set("code", "wrong-code");
          cb.searchParams.set("state", a.searchParams.get("state")!);
          void fetch(cb);
        },
      }),
    ).rejects.toThrow(/token exchange refused/);
  } finally {
    o.stop();
  }
  expect(() => statSync(tokenFile)).toThrow();
});

test("login never prints the token", async () => {
  const o = startOauth();
  const dir = tmp();
  const tokenFile = join(dir, "t3-token.json");
  const config = join(dir, "config.json");
  writeFileSync(config, JSON.stringify({ t3: { base: o.base, tokenFile } }));
  const p = Bun.spawn([BIN, "t3", "login"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, BATON_CONFIG: config } });
  let out = "";
  const reader = (async () => {
    const dec = new TextDecoder();
    for await (const chunk of p.stdout as unknown as AsyncIterable<Uint8Array>) {
      out += dec.decode(chunk);
      const m = out.match(/^http\S+$/m);
      if (m && !(reader as any).done) {
        (reader as any).done = true;
        await approve(o, m[0]);
      }
    }
  })();
  const [err, rc] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  await reader;
  o.stop();
  expect(rc).toBe(0);
  expect(statSync(tokenFile).size).toBeGreaterThan(0);
  expect(readFileSync(tokenFile, "utf8")).toContain(SECRET); // control: the secret is in the file
  expect(out).not.toContain(SECRET);
  expect(err).not.toContain(SECRET);
});

test("login failure messages do not carry the token", async () => {
  const o = startOauth();
  const log: string[] = [];
  let msg = "";
  try {
    await login({
      base: o.base,
      tokenFile: join(tmp(), "t3-token.json"),
      out: (l) => {
        log.push(l);
        if (!l.startsWith("http")) return;
        const a = new URL(l);
        const cb = new URL(a.searchParams.get("redirect_uri")!);
        cb.searchParams.set("error", "access_denied");
        cb.searchParams.set("state", a.searchParams.get("state")!);
        void fetch(cb);
      },
    });
  } catch (e) {
    msg = (e as Error).message;
  } finally {
    o.stop();
  }
  expect(msg).toContain("access_denied");
  expect(msg).not.toContain(SECRET);
});
