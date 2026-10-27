// Host selection: `"host"` in the config file names the host the CLI builds (design §4.1).
// Orca is the only host since 0.6.0; the key stays so a config that names it keeps working.

import { existsSync, readFileSync } from "node:fs";
import type { Host } from "../host.ts";
import { configPath } from "../notify.ts";
import { loadOrcaConfig, OrcaHost } from "./orca.ts";

export type HostKind = "orca";

let testHost: Host | null = null;

/** Tests only: `makeHost()` returns `h` until it is reset with `null`. */
export function setHostForTest(h: Host | null): void {
  testHost = h;
}

/** The config's `host`: a missing file or key is `orca`; any other value throws. */
export function hostKind(): HostKind {
  const path = configPath();
  if (!existsSync(path)) return "orca";
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> | null;
  const v = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw.host : undefined;
  if (v === undefined || v === "orca") return "orca";
  throw new Error('config: host must be "orca"');
}

export function makeHost(): Host {
  if (testHost) return testHost;
  hostKind();
  return new OrcaHost(loadOrcaConfig());
}
