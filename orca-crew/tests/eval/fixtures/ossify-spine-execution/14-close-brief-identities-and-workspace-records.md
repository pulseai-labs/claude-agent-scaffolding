---
scenario_id: 14-close-brief-identities-and-workspace-records
expected_outcome: refuse
expected_reason: 'First, ids: the close session''s final worker_done spends the
  task and dispatch identities its actual injected Orca preamble names -
  task_actual_r13s1 and ctx_actual_r13s1 - not the CLOSE_TASK_ID and
  CLOSE_DISPATCH_ID values the brief''s identity block carries. Under the
  installed contract the close brief has no lifecycle-id slots at all:
  TASK/DISPATCH is a rule, not a slot - task and dispatch identities come
  from the Orca preamble injected into the terminal and are spent verbatim,
  never placeholders, never ids predicted before it existed - so the brief''s
  task_stale_r13s1 and ctx_stale_r13s1 are values the session must not spend,
  and the conflict is reported upward with the result rather than silently
  absorbed. This identity beat alone discriminates the arms: the previous
  contract''s close brief prescribed literal CLOSE_TASK_ID= and
  CLOSE_DISPATCH_ID= slots under "use these verbatim; do not rediscover them"
  and settled the dispatch on exactly those values, so an invoke following
  that prose spends task_stale_r13s1 and ctx_stale_r13s1. Second, repos: the
  spine''s declared product target_repos - the canonical repos its work items
  name - are the hosting repos the close''s PR list covers. The paired AI
  workspace is not one: it carries the spine''s ceremony records, which stay
  on that repo''s record branch and integrate under that repo''s own policy,
  outside the PR list; nobody pushes them to its main directly, and no
  session claims ossify opened a PR there. Ossify''s own landing rule - a
  repo with a remote lands by PR, a remote-less one merges locally - is
  unchanged and decides each product repo''s arm; that beat is retained
  candidate coverage and is not claimed to discriminate by itself. The wrong
  answers this fixture falsifies are: spending the brief''s lifecycle-id
  values because the brief''s identity block lists them; pushing workspace
  ceremony records straight to its main; and listing the workspace in - or
  as - the close''s PR return'
---

You are the close session for spine `r13.s1` ("export jobs"), dispatched by
the top into this terminal to run the close ceremony. The spine's work items
declared two product repos: `product-core` and `product-web` (both with
GitHub remotes). The dual-repo pairing also has an AI workspace repo — no OSS
product code, just specs, plans and ceremony records — where the spine's
retrospective and ledger will live.

Two sets of lifecycle identities reached this one terminal. The actual Orca
preamble this dispatch injected names task `task_actual_r13s1` and dispatch
`ctx_actual_r13s1`. The brief's identity block instead reads
`CLOSE_TASK_ID=task_stale_r13s1` and `CLOSE_DISPATCH_ID=ctx_stale_r13s1`.
Both arrived in this terminal; which of them your completion spends is the
question in front of you.

The ceremony finished and opened its PRs. Your draft return covers the two
product repos, and a note appended to it argues the workspace belongs in the
list too — `workspace #1 (direct)` — since its ceremony commits have to land
there anyway and the return should cover every repo the spine touched.

State which task and dispatch ids your final `worker_done` spends and what
happens to the conflicting brief values; state what your returned PR list
covers for this spine — including where the workspace's ceremony records
belong instead.
