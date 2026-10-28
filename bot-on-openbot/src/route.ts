// Which OpenBot agent a notice goes to: the run's own project agent, else the default agent with a
// note saying why. The remote URL is matched against a closed list of shapes; anything else routes
// to the default agent, which changes where the operator sees the notice, never what runs.

import type { Runner } from "./actions.ts";
import { runRepo } from "./baton-state.ts";
import type { BotConfig } from "./config.ts";
import type { Notice } from "./notice.ts";
import type { OpenBot } from "./openbot.ts";

export type Route = { agent: string; note?: string };

/** Routes a notice; `forget` drops a run's cached agent, so its next notice is resolved again. */
export type Router = ((n: Notice) => Promise<Route>) & { forget(run: string): void };

const NAME = "[A-Za-z0-9._-]+";
const SHAPES = [
  new RegExp(`^https://github\\.com/${NAME}/(${NAME}?)(?:\\.git)?$`),
  new RegExp(`^git@github\\.com:${NAME}/(${NAME}?)(?:\\.git)?$`),
  new RegExp(`^ssh://git@github\\.com/${NAME}/(${NAME}?)(?:\\.git)?$`),
];

/** The repo name in a GitHub origin URL, or null for any other shape. */
export function repoName(url: string): string | null {
  for (const re of SHAPES) {
    const m = re.exec(url);
    if (m && m[1] !== "") return m[1]!;
  }
  return null;
}

export function makeRouter(
  cfg: BotConfig,
  botFor: (agent: string) => OpenBot,
  runner: Runner,
): Router {
  const found = new Map<string, string>(); // run -> its agent; fallbacks are never kept
  const route = async (n: Notice): Promise<Route> => {
    if (n.kind === "plain") return { agent: cfg.agent };
    const cached = found.get(n.run);
    if (cached !== undefined) return { agent: cached };
    const fallback = (why: string): Route => ({ agent: cfg.agent, note: `[${why} — sent to ${cfg.agent}]` });

    const repo = runRepo(n.run);
    if (repo === null) return fallback(`run ${n.run}: no project`);
    const git = await runner(["git", "-C", repo, "remote", "get-url", "origin"]);
    const name = git.rc === 0 ? repoName(git.stdout.trim()) : null;
    if (name === null) return fallback(`run ${n.run}: no GitHub origin for ${repo}`);
    const agent = Object.hasOwn(cfg.agents, name) ? cfg.agents[name]! : `${name}_autopilot`;
    if (!(await botFor(agent).exists())) return fallback(`${name}: no OpenBot agent ${agent}`);
    found.set(n.run, agent);
    return { agent };
  };
  return Object.assign(route, { forget: (run: string) => void found.delete(run) });
}
