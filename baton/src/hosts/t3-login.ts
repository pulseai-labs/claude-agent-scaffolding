// `baton t3 login`: OAuth 2.1 with PKCE against T3's tailnet endpoint, once per 30 days.
//
// The token is a secret: it goes into the token file and nowhere else. It is never printed,
// and no error message here carries a response body.

import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type LoginOptions = {
  base: string;
  tokenFile: string;
  /** Where the instructions and the authorize URL are written. */
  out: (line: string) => void;
  /** How long to wait for the operator's approval; default 10 minutes. */
  timeoutMs?: number;
};

const b64url = (b: Buffer) => b.toString("base64url");

async function getJson(url: string): Promise<any | undefined> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return r.ok ? await r.json() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A response body parsed as JSON. On a parse failure the error names only the endpoint and the
 * HTTP status: the parser's message quotes the body near the fault, and these bodies may carry
 * the access token.
 */
async function bodyJson(r: Response, endpoint: string): Promise<any> {
  try {
    return await r.json();
  } catch {
    throw new Error(`${endpoint} returned a body that is not JSON (HTTP ${r.status})`);
  }
}

async function discover(base: string): Promise<{ authorization_endpoint: string; token_endpoint: string; registration_endpoint: string }> {
  const u = new URL(base);
  // The resource may name its authorization server; otherwise the origin is the issuer.
  const pr = (await getJson(`${u.origin}/.well-known/oauth-protected-resource${u.pathname === "/" ? "" : u.pathname}`))
    ?? (await getJson(`${u.origin}/.well-known/oauth-protected-resource`));
  const issuer = typeof pr?.authorization_servers?.[0] === "string" ? new URL(pr.authorization_servers[0]) : u;
  const path = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/, "");
  const meta = (await getJson(`${issuer.origin}/.well-known/oauth-authorization-server${path}`))
    ?? (await getJson(`${issuer.origin}/.well-known/oauth-authorization-server`));
  if (!meta?.authorization_endpoint || !meta?.token_endpoint || !meta?.registration_endpoint) {
    throw new Error(`no OAuth metadata at ${issuer.origin} (authorization, token and registration endpoints needed)`);
  }
  return meta;
}

export async function login(opts: LoginOptions): Promise<void> {
  const meta = await discover(opts.base);

  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  let deliver!: (v: { code?: string; error?: string }) => void;
  const arrived = new Promise<{ code?: string; error?: string }>((res) => (deliver = res));
  const listener = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/callback") return new Response("not found", { status: 404 });
      if (url.searchParams.get("state") !== state) return new Response("state mismatch", { status: 400 });
      const code = url.searchParams.get("code");
      deliver(code ? { code } : { error: url.searchParams.get("error") ?? "no code" });
      return new Response("baton: approved. You can close this tab.\n");
    },
  });
  const timer = setTimeout(() => deliver({ error: "timed out waiting for approval" }), opts.timeoutMs ?? 600_000);

  try {
    const redirect = `http://127.0.0.1:${listener.port}/callback`;
    const reg = await fetch(meta.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "baton",
        redirect_uris: [redirect],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const client = reg.ok ? ((await bodyJson(reg, "registration endpoint")) as { client_id?: string }) : {};
    if (!client.client_id) throw new Error(`client registration refused (HTTP ${reg.status})`);

    const auth = new URL(meta.authorization_endpoint);
    for (const [k, v] of Object.entries({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: redirect,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      resource: opts.base,
    })) auth.searchParams.set(k, v);

    opts.out("Approve baton in T3: run `t3 auth pairing create` on the T3 host, open the URL below with it, and approve above read-only.");
    opts.out("");
    opts.out(auth.toString());
    opts.out("");
    opts.out("Waiting for the approval (the code is exchanged the moment it arrives)...");

    const got = await arrived;
    if (!got.code) throw new Error(`authorization failed: ${got.error}`);

    const res = await fetch(meta.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: got.code,
        redirect_uri: redirect,
        client_id: client.client_id,
        code_verifier: verifier,
        resource: opts.base,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const tok = res.ok ? ((await bodyJson(res, "token endpoint")) as { access_token?: string; expires_in?: number; scope?: string }) : {};
    if (!tok.access_token || typeof tok.expires_in !== "number") throw new Error(`token exchange refused (HTTP ${res.status})`);

    mkdirSync(dirname(opts.tokenFile), { recursive: true, mode: 0o700 });
    const tmp = join(dirname(opts.tokenFile), `.t3-token.${process.pid}.tmp`);
    writeFileSync(
      tmp,
      JSON.stringify({
        access_token: tok.access_token,
        client_id: client.client_id,
        expires_at: Math.floor(Date.now() / 1000) + tok.expires_in,
        scope: tok.scope ?? "",
      }),
      { mode: 0o600 },
    );
    chmodSync(tmp, 0o600);
    renameSync(tmp, opts.tokenFile);
    opts.out(`Token written to ${opts.tokenFile}.`);
  } finally {
    clearTimeout(timer);
    listener.stop();
  }
}
