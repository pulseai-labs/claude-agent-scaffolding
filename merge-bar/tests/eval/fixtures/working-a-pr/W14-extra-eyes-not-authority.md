---
scenario_id: W14-extra-eyes-not-authority
expected_outcome: extra-eyes-judged-by-bar-not-waited-for
expected_reason: CodeRabbit is an extra-eyes reviewer — its P1 label decides nothing; the finding that the log message wording is unclear meets no merge-bar condition, so it is `answered — <condition it fails>` in its thread, not fixed; the finding that a failed rename leaves a truncated file reported as written meets condition 1 and is fixed in the round's one push; the still-queued CodeRabbit is NOT waited for and does not gate the round or the terminus, and nothing about CodeRabbit's state decides what blocks; Reviewer completeness is checked against the `reviewing-a-pr` report for the current head (which ran and found nothing further), not against CodeRabbit having reported
---
Working PR #233 ("backup: write snapshots atomically"). Preflight passed; the branch is checked
out at head `b83f10c`. The body's Merge bar is the four conditions with no raising line; its
Scope is `backup/`. Known limits reads "None." CI is green.

Crew is present. The project's reviewer seat ran `reviewing-a-pr` on `b83f10c` and returned a
round-1 report with `Classes: None found.` and a Coverage table that marks every file of the
diff `read` by both axes.

CodeRabbit is installed on the repo and is still queued on `b83f10c` — it has posted nothing
on this head. Earlier, on the previous head, it left two inline comments, both still open:

1. `backup/log.py:19`: "**P1** — the message 'snapshot done' is ambiguous; say which snapshot
   finished." Nothing is lost or wrong; only the wording is vague.
2. `backup/snapshot.py:62`: "The result of `os.replace` is not checked; if the rename fails
   the code still logs success and the caller is told the snapshot exists, but the temp file
   was never moved into place and the snapshot path holds the previous, truncated file."
   This line is in the PR's diff.

The body's Merge danger reads: "Door: two-way — reverting the merge restores the old snapshot write; nothing outlives it."
