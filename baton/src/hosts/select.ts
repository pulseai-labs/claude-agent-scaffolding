// Host selection: `"host"` in the config file names the host the CLI builds (design §4.1).

import { existsSync, readFileSync } from "node:fs";
import type { Host } from "../host.ts";
import { configPath } from "../notify.ts";
import { loadOrcaConfig, OrcaHost } from "./orca.ts";
import { loadT3Config, T3Host } from "./t3.ts";

export type HostKind = "t3" | "orca";

let testHost: Host | null = null;

/** Tests only: `makeHost()` returns `h` until it is reset with `null`. */
export function setHostForTest(h: Host | null): void {
  testHost = h;
}

/** The config's `host`: a missing file or key is `t3`; any value other than `t3` or `orca` throws. */
export function hostKind(): HostKind {
  const path = configPath();
  if (!existsSync(path)) return "t3";
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> | null;
  const v = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw.host : undefined;
  if (v === undefined) return "t3";
  if (v === "t3" || v === "orca") return v;
  throw new Error('config: host must be "t3" or "orca"');
}

export function makeHost(): Host {
  if (testHost) return testHost;
  if (hostKind() === "orca") return new OrcaHost(loadOrcaConfig());
  return new T3Host(loadT3Config());
}
