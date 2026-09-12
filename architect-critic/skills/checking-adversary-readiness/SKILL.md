---
name: checking-adversary-readiness
description: Check whether the external adversary (Codex/Claude) is installed, authenticated, and schema-capable before a deep critique. Triggers on "check adversary readiness", "is codex ready", "critique doctor", "/critique-doctor", "can I run an async critique". Advisory and fail-soft — never blocks, never auto-installs.
---

# checking-adversary-readiness

You have been invoked because the user wants to know whether architect-critic's **external adversary** is ready before running a close-depth critique — especially an **async** one (`/critique --async`), which dispatches Codex as a background job and would otherwise fail mid-run if Codex were missing or unauthenticated.

This skill is **advisory and fail-soft**: it reports readiness and how to fix gaps. It NEVER blocks, and it NEVER installs or logs in on the user's behalf — install/login actions stay explicit and user-approved.

**Devin host policy.** On Devin (`HOST_AGENT=devin`), architect-critic runs **host-only audits** with no external adversary. There is no Codex companion, no fresh-frame backend, and no `--async` support. The readiness probe is a no-op: report immediately — *"Devin host-only audit: no external adversary required. Devin runs self-audit only."* — and skip the Codex/claude binary checks, the companion probe, and the async defaults. Do not prescribe Codex installation on Devin; the host-only policy is by design, not a gap to fix.

---

## Step 1: Run the readiness probe

Resolve the `arc` dispatcher once and hold it in `arc_bin` — it is on `$PATH` on Claude Code and Codex, but **not** on Devin, where `bin/` is never added. Recipe per the plugin's `rules/dispatcher-path.md`: `command -v arc`, else the `source:` path (`--local` installs), else the plugin-cache manifest glob (remote installs). Every `arc` invocation below — and in this skill's references — is `"$arc_bin"`.

Run the doctor through the dispatcher (it sources the libs and always exits 0):

```bash
"$arc_bin" codex_doctor
```

This prints, one line each:
- the `codex` and `claude` binaries (+ versions) on PATH,
- whether the `codex-companion` (codex-plugin-cc) is resolvable,
- Codex auth + schema readiness (via the companion's `setup --json`),
- the sync timeout and async poll/stall/cap defaults,
- the dual-publish note (async = Claude-host → Codex-adversary only; Codex-host keeps the sync path).

## Step 2: Present the report and interpret it

Show the report verbatim, then summarize in one line: **ready**, or **not ready** with the single most important gap. Map each `✗` line to its fix:

- **codex companion not found** → the OpenAI codex plugin isn't installed. Suggest `/plugin install codex` from the `openai-codex` marketplace, or setting `ARCHITECT_CRITIC_CODEX_COMPANION` to an absolute `codex-companion.mjs` path.
- **codex CLI not available** → suggest installing Codex (https://github.com/openai/codex) so `codex --version` works.
- **codex not authenticated** → suggest `codex login`.
- **claude CLI not available** → only matters when Codex is the host (the fresh-frame
  close-depth path runs `claude`); suggest installing the Claude Code CLI so
  `claude --version` works.
- **companion 'setup' did not run** → ensure `node` is installed and the companion is current.

## Step 3: Offer next actions (user-approved only)

If gaps exist, **offer** the relevant command(s) and ask whether to run them — do not run install/login automatically. If ready, tell the user they can run a close-depth critique foreground (`/critique --close`) or, **when hosted in Claude Code**, in the background (`/critique --close --async`) — a Codex host runs close-depth synchronously — and that `/critique-jobs` manages background runs.

This skill is read-only: it makes no state writes and dispatches no jobs.
