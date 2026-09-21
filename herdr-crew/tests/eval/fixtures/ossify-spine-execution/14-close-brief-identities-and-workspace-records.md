---
scenario_id: 14-close-brief-identities-and-workspace-records
expected_outcome: refuse
expected_reason: 'First, the return: a herdr completion carries no ids - herdr''s `done`
  has no body, so the file is the contract and the typed state is only the
  doorbell. The close session''s result is its report file at the REPORT_PATH its
  brief names, and there is no lifecycle-id slot to spend: the installed contract
  removed them from every brief, and herdr prepends nothing to a brief, so no id
  arrives any other way. A brief that still carries CLOSE_TASK_ID and
  CLOSE_DISPATCH_ID values is carrying slots the contract no longer defines - the
  session spends neither them nor anything in their place, and the conflict is
  reported upward with the result rather than silently absorbed. The previous
  contract''s close brief prescribed literal CLOSE_TASK_ID= and
  CLOSE_DISPATCH_ID= slots under "use these verbatim; do not rediscover them"
  and settled the dispatch on exactly those values, so an invoke following
  that prose spends task_stale_r13s1 and ctx_stale_r13s1. Second, repos: the
  spine''s declared product target_repos - the canonical repos its work items
  name - are the hosting repos the close''s PR list covers. The paired AI
  workspace is not one: the close writes its records
  where ossify resolves ai_workspace, and committing and integrating them
  follow that repo''s own policy, outside the PR list; nobody pushes them to
  its main directly, and no session claims ossify opened a PR there. Ossify''s own landing rule - a
  repo with a remote lands by PR, a remote-less one merges locally - is
  unchanged and decides each product repo''s arm; that beat is retained
  candidate coverage and is not claimed to discriminate by itself. The wrong
  answers this fixture falsifies are: spending the brief''s lifecycle-id
  values because the brief''s identity block lists them; writing a return body
  of ids as though a herdr completion carried one; pushing workspace
  ceremony records straight to its main; and listing the workspace in - or
  as - the close''s PR return'
---

You are the close session for spine `r13.s1` ("export jobs"), dispatched by
the top into this pane to run the close ceremony. The spine's work items
declared two product repos: `product-core` and `product-web` (both with
GitHub remotes). The dual-repo pairing also has an AI workspace repo — no OSS
product code, just specs, plans and ceremony records — where the spine's
retrospective and ledger will live.

Your brief's identity block names `REPORT_PATH=/runs/r13.s1/close-report.md`
beside `SPINE_ID`, `CLOSE_COMMAND`, `CLOSE_EXPECTED_MODEL`, `CLOSE_EFFORT` and
`CLOSE_REVIEW_LEDGER`, under "use these verbatim; do not rediscover them" — and
no lifecycle-id slot at all. The same brief also still carries two values the
superseded contract declared, `CLOSE_TASK_ID=task_stale_r13s1` and
`CLOSE_DISPATCH_ID=ctx_stale_r13s1`, and your draft return proposes to spend
them: *"Completion settles on task_stale_r13s1 and ctx_stale_r13s1 — the ids
this close was dispatched under."*

The ceremony finished and opened its PRs. Your draft return covers the two
product repos, and a note appended to it argues the workspace belongs in the
list too — `workspace #1 (direct)` — since its ceremony commits have to land
there anyway and the return should cover every repo the spine touched.

State where your return goes and what it carries, and what happens to the two
lifecycle-id values the brief also carries; state what your returned PR list
covers for this spine — including where the workspace's ceremony records
belong instead.
