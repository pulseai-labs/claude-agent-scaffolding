// The one message a finished run sends: counts read from its event log, on one line.
import type { RunState } from "./state.ts";

export function runSummary(run: RunState, eventsText: string, nowIso: string, ledger?: string): string {
  let parks = 0, unparks = 0, resumed = 0, toYou = 0, drivers = 0;
  const prs: string[] = [];
  for (const line of eventsText.split("\n")) {
    let e: Record<string, unknown>;
    try {
      const v: unknown = JSON.parse(line);
      if (typeof v !== "object" || v === null) continue;
      e = v as Record<string, unknown>;
    } catch { continue; }
    switch (e.kind) {
      case "park": if (e.unit !== undefined) parks++; break;
      case "unpark": if (e.unit !== undefined) unparks++; break;
      case "driver": drivers++; break;
      case "driver resume": resumed++; break;
      case "driver escalate":
      case "driver stop": toYou++; break;
      case "merged": if (typeof e.pr === "string") prs.push(e.pr); break;
    }
  }
  const mins = Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(run.armed_at)) / 60000));
  const wall = `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}m`;
  const merged = prs.length > 0 ? `${prs.length} merged (${prs.join(", ")})` : "0 merged";
  return `baton ${run.id} done — ${Object.keys(run.units).length} units, ${merged}; ` +
    `parks ${parks}: driver resumed ${resumed}, sent to you ${toYou}, operator unparks ${unparks}; ` +
    `drivers ${drivers}; wall ${wall}${ledger !== undefined ? `; ledger ${ledger}` : ""}`;
}
