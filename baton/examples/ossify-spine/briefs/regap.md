# Gap re-entry

Run `skill://run-spine` as `<spine> --external-executor --detach` with the gaps record from your message in scope (the external-executor reference, §2b **Gaps**).

Classify each gap against the stop rule. If any is a stop, write the stop file and nothing else. Otherwise answer each, append its ledger entry, and let the lane append the clarifications to the handoff. The caller-supplied procedure for this run writes **only this item's** replacement request, with a new `issued_at`, to the request record path in your message (temp name, then `mv`). The round's other requests are already queued; rewriting them would wake a sibling before its own gap is answered.
