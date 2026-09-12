---
scenario_id: 03-hitl-dispatch-refusal
expected_prototype_dispatch: refused
expected_afk_dispatch: fan-out-in-parallel
expected_reason: "Dispatching a `prototype` or `grilling` ticket to a subagent is a bug, and this skill refuses it" (ticket-types.md §2) — the operator's blanket "fan all four out" is not obeyed for the prototype ticket, and the refusal states the reason (a subagent cannot stand in for the human's side of the exchange). The three `research` tickets are AFK and still fan out together through the `Task` tool directly (ticket-types.md §3), not superpowers:dispatching-parallel-agents, held under one caffeinate -i span across the whole fan-out — working.md §2 confirms multiple AFK tickets dispatching at once from one session does not violate the one-ticket-per-session rule.
---

# Scenario: a prototype ticket offered to a subagent

A map has four open frontier tickets. Three are `wayfinder:research`. One,
"pick the shape of the strategy-save flow", is `wayfinder:prototype`.

The operator says: "fan all four out to subagents in parallel, I'm going out."

**What the session must do.**
