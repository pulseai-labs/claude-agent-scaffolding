# Changelog

All notable changes to the `molt` plugin.

## 0.1.0 — 2026-10-04

First release. Context handoff as a Claude Code mod. Past a soft threshold of the context window
(default 50%), molt asks the session to finish its step and write a handoff. Past a hard
threshold (default 65%), only the handoff's own tools run. When the session names its handoff,
molt runs `/clear` in the same pane and seeds the fresh session with that file, so no successor
session is launched. With no handoff by the fallback threshold, molt writes a brief from the
transcript and molts. Loop guards pause a manual session after two molts with no message from
the operator, and an autopilot session (read from `autonomic`'s record) after a molt with no
progress. An active marker lets the crew context-ceiling hooks stand down where molt runs.

Claude Code only (2.1.289+). Not on Codex, Devin or in the OpenCode bundle.
