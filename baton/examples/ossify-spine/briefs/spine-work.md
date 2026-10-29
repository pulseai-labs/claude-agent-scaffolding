# Spine PR round

1. If the operator file exists, it is a reversal the operator asked for: do it first.
2. Run merge-bar's working-a-pr for one round only (`/merge-bar:working-a-pr` on Claude Code, `skill://working-a-pr` on OMP): disposition every finding in the review file, every red check, and the CodeRabbit comments present now; push once. Never merge. Any body edit keeps the first two lines (`spine close …`, `pushed-tip: …`) verbatim and adds after them; unclaim by a follow-up commit, never a rewrite. If working-a-pr's round-3 stop fires, that is a stop.
3. Write the round done file, then end: `: > <Round done file from your message>`. This file is the round's only success signal.
