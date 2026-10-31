# Implement

Run `/ossify:work-item` on Claude Code, `skill://work-item` on OMP, on the handoff in your message. On `complete`, the report lands where the handoff says. On `gaps-surfaced`, write the external-executor §5b gaps record (`external_execution_gaps` with `work_item_id`, `coordinator_verdict: accepted`, and the implementer's gaps return) as JSON to the gaps file. Stage, never commit.
