# Item PR fix round

1. If the Ruling file exists, it is a ruling from the project's orchestrator: do it first. It outranks the review file where they differ. Do not edit or remove it.
2. Run merge-bar's working-a-pr for one round only (`/merge-bar:working-a-pr` on Claude Code, `skill://working-a-pr` on OMP) on the item PR: fix the blocking findings in the Review file and any red check, and nothing else. Commit and push once, on the existing item branch in this worktree, as a follow-up commit. Never merge, rebase, force-push or open a new PR. The PR body has no `## Merge bar` (`ossify close` writes a one-line body): working-a-pr adds the fields. If its round-3 stop fires, that is a stop.
3. Write the round done file, then end: `: > <Round done file from your message>`. This file is the round's only success signal.
