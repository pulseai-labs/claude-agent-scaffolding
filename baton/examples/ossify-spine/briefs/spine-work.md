# Spine PR round

If the operator file exists, it is a reversal the operator asked for: do it first. Then run merge-bar's `skill://working-a-pr` for one round only: disposition every finding in the review file, every red check, and the CodeRabbit comments present now; push once. Never merge. Any body edit keeps the first two lines (`spine close …`, `pushed-tip: …`) verbatim and adds after them; unclaim by a follow-up commit, never a rewrite. Then write the round done file and end. If working-a-pr's round-3 stop fires, that is a stop.
