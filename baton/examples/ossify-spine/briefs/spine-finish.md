# Spine close, second pass

The spine PR is merged. First `git fetch origin` in the AI workspace, then check, in this order. Never treat the branch's own state file as the result: only `origin/main` counts.

1. If the project state file at `origin/main` (`git show origin/main:<path>`) already reads the spine closed, end the turn without rerunning close and without a commit.
2. If `close-pr.txt` exists in OUT, an earlier attempt already opened the close PR: end the turn without rerunning close. Never merge the close PR.

Whichever way the turn ends, leave the AI workspace on `main`: `git switch main`.

Otherwise run `/ossify:close <spine>` on Claude Code, `skill://close <spine>` on OMP, through its second pass: record the landing, then the demo, bone registration, audit, retro and harvest. Commit the ledger with the close record. Then land that commit before ending the turn:

- In a workspace that lands records only through PRs, do not push to `main`: commit on a branch, push it, open the PR, and write its URL as one line to `close-pr.txt` in OUT at once (write `close-pr.txt.tmp`, then `mv` it over), then `git switch main`. Never merge the close PR.
- Otherwise push the AI workspace commit the close made (`git push` in the AI workspace).
