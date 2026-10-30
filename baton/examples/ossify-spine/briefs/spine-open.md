# Spine close, first pass

Run `/ossify:close <spine>` on Claude Code, `skill://close <spine>` on OMP, through its first pass. In the PR body, sort the ledger's entries into "Decided — check these" and "Needs you"; keep the body's first two lines (`spine close …`, `pushed-tip: …`) verbatim and add everything after them. After the PR opens, do not run work-pr. Write the spine PR record (temp name, then `mv`) as exactly
`{"id":"spine-pr","group":0,"order":0,"pr_url":"<url>"}`
and end.
