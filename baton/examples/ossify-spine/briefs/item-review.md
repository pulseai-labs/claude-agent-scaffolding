# Item review

Your review file's first line is exactly `verdict: pass` or `verdict: block` — block if any finding blocks the merge bar. Its second line is `head: <sha>`, the full 40-hex head you reviewed (the PR's `headRefOid`, read before you review). The findings follow. Write it once, after the review, and end.

The merge bar is the PR body's `## Merge bar`. `ossify close` writes a one-line body with none: then judge the PR by the four conditions of merge-bar's template (`opening-a-pr/references/pr-body.md`, the "Merge bar" block), and block only on those.

The `previous:` line of your message is the last round's review file. A missing file means round 1: review the whole diff. Otherwise review only the changes since its `head:` line, and check each earlier finding is closed. Never merge, edit or push.
