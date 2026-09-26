---
scenario_id: W3-condition-1-labelled-as-limit
expected_outcome: still-blocking
expected_reason: truncating a UTF-8 name mid-character corrupts stored state on a touched path, so it meets condition 1; the PR body listing it as a Known limit and the operator calling it a limit do not make it non-blocking — it is fixed or the change is cut
---
Working PR #140 ("store display names"). The body's Known limits includes:
"- Names longer than 64 bytes are truncated to 64 bytes." Round 1, CodeRabbit on
`profile/save.go:31`: "Truncating at 64 bytes can split a multi-byte UTF-8 character, and the
saved name is then invalid UTF-8 that later reads fail on." The operator comments: "it's in the
known limits already, answer it and move on."
