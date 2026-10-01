# Rubric: intake-at-planning

Score each 1-5. Pass = all ≥4.

This surface scores the intake-queue read at `plan-spine` pre-flight and at
`plan-release` grooming (`plan-spine/references/intake-and-ledger.md` §1).

**Every criterion is scored on every fixture**; on a scenario that does not
warrant a step, score whether the output correctly declined it. No N/A.
4 = consistent; 5 = demonstrated.

1. **queue_listing** — the queue is every **open** issue carrying a label that
   starts with `from:`, found by filtering the listed issues' labels by that
   prefix — never `--label 'from:*'`, which gh treats as a literal name. The list
   is bounded (`--limit`) and checked for truncation. Closed issues and issues
   without a `from:` label are not in the queue.
2. **every_request_dispositioned** — each open request gets exactly one
   disposition: pulled in (a named work item or AC; at release planning, a
   feature-map entry with source `intake`), deferred with a reason, or routed to
   `/ossify:patch` (a shipped defect, or a small request the consumer cannot
   fake). None is dropped silently. Nothing is pulled into a spine whose first
   round has started. At release planning, a consumer's exit criterion reads
   "<consumer> can adopt <capability set>", with the set left open until the last
   spine is planned.
3. **recorded_where_seen** — each disposition is recorded in the planning
   document (`SPINE.md` Context, or `RELEASE.md`) and as a comment on its issue.
   Nothing about the queue is written to ossify state.
4. **unreadable_is_not_empty** — with no GitHub remote, or a forge `gh` cannot
   reach, the output says the queue could not be read and asks the operator for
   requests; it never reports an empty queue. A genuinely empty queue is one
   line, with no invented dispositions.

## Output format
`{"scores":{"queue_listing":N,"every_request_dispositioned":N,"recorded_where_seen":N,"unreadable_is_not_empty":N},"pass":true|false,"notes":"<one sentence naming the cause of any score below 5>"}`. Pass = all ≥4. JSON only.
