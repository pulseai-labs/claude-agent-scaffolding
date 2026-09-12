# The nested Run — mechanics of an activated ossify spine

The contract these mechanics serve is `references/ossify-execution.md`.

## 1. Nested depth is a prerequisite, not a fallback

Orca's `Settings → Orchestration → Nested worker depth` must be `2`, because the spine
session dispatches item sessions of its own. No CLI read exposes that setting, so get
the operator's confirmation before starting the spine session; the first real child
dispatch is the runtime proof.

If a child dispatch returns `nested_worker_depth_exceeded`, the spine session stays
the lane owner, reports the blocker, and waits for an operator decision. It does not
substitute a Claude subagent, move item tasks into the parent Run, create a
replacement writer, or restart the lane.

## 2. The nested Run

Your brief injects the spine session's identities explicitly (`ossify-briefs.md`); that
session then creates and binds a **child Run** for item tasks, which does not reset
nested depth.

- child `task-create`, `worker-start`/`dispatch` and `check` always name
  `--run $CHILD_RUN_ID`;
- plan, gap, depth and other spine-level questions come up as `ask --run $PARENT_RUN_ID`;
- replies to item questions go back on each original child message id;
- its final completion uses the **injected parent** task and dispatch ids, settling
  your Dispatch while the child Run is still bound;
- the spine session is the only waiter on the child Run; you, on the parent.

The child Run keeps item plan traffic and item `worker_done` out of your inbox: you see
a batched plan relay, genuine spine-level decisions, and one final completion.

**Teardown is the pairs, not the Run.** The spine session releases every item pair
before its final `worker_done` and names the child Run id in that body. There is no
close-the-Run step: the CLI exposes none.

## 3. The round procedure, as the spine session runs it

1. Validate `SPINE.md`, the sidecar and the round's item set
   (`ossify-execution.md` §3), then prove the sidecar on disk is the ratified one:
   its blob id must equal the **`SIDECAR_OID` your brief injected**, which the top
   recorded when it wrote the file.
   **Every item launch requires that same blob id.** The §3 checks are value
   checks, so an edited-but-still-valid row — a
   changed terminal command — passes them all; only the file's identity catches
   it, and a baseline you sampled yourself would adopt any edit made before your
   first read. A mismatch halts that launch and asks. When the top rewrites the
   sidecar, its reply names the new `SIDECAR_OID`, and that becomes the baseline.
2. Invoke the ossify lane in external-executor mode. ossify prepares every
   same-round worktree and handoff first, then hands over one request per item.
3. For each item, launch a **fresh implementer terminal** from that row's exact command
   — the verifier is not created yet; it has nothing to verify until step 5. Where a
   custom alias is required, create the terminal directly and inject the Dispatch.
4. Each implementer confirms its model, reads, and posts a detailed plan, then waits.
   Gather the round's plans into **one** ordered ask to you; return an independent
   approve-or-amend per item; reply on each original child id, before which no edit
   starts.
5. On each complete return, capture the item's four-part fingerprint, then create and
   dispatch that item's **fresh verifier terminal** from its row's exact command, in the
   same worktree, against the fixed all-claims procedure. `cannot determine` = fail.
6. On the **first** verifier failure, send one `ask --run $PARENT_RUN_ID` with the
   verifier's summary and three options —
   correct with the same pair, replace the pair, halt — and it **blocks: the pair idles**
   and nothing on that item moves until the reply. *Correct* is one consolidated
   correction to the same implementer, then the full recheck to the same verifier.
   *Replace* is the one exception to one pair per item: the old pair is released first,
   the item's worktree is **reset to the request's `base_sha` with a clean porcelain**
   — the rejected staged work is discarded, which is what replacing means — and the
   item is re-requested as a fresh `external_execution_request` carrying the original
   `branch` and `worktree_path`. The fresh pair then runs the ordinary
   `/ossify:work-item` entry from clean, because that entry's pre-flight requires an
   empty porcelain and no fresh session may adopt another's staged tree.
   The correction packet is for *correct* only — it is same-executor by
   construction, and never two pairs live on one item. A replacement at a **different** profile is
   a sidecar rewrite: the top rewrites the row, the operator ratifies it, the digest
   updates, and you revalidate before launching. A second failure asks again, with the
   same three options — except that **every execution of an item counts against
   ossify's three-iteration cap**, the initial run and each correction and each
   replacement alike, so once it is spent the ask offers halt only.
   *Halt* is terminal for that item: release its pair, mark it halted in your own
   state, and when no other item can proceed send a **halt-shaped worker_done** on
   the injected parent ids naming the item and the reason. The top settles that
   dispatch and the spine stays at its current round barrier — no close is
   dispatched off a halt.
7. Initial gaps are handled inside the spine session: it asks you for the operator's
   answers, remains the handoff writer, appends clarifications, and re-requests the item
   within ossify's three-attempt cap.
8. Feed accepted results into the lane in declared decomposition order. Keep each pair
   until its item closes or escalates, then release it. **No terminal is ever
   transferred to another item.**

Same-round pairs may run concurrently. Closes and merges stay serial and the
round barrier is ossify's, unchanged.

## 4. The spine close is dispatched, and it comes next

The spine session stops at the final round barrier — where `/ossify:run-spine` hands
the baton to `/ossify:close <spine-id>` — and never runs the close on its own
initiative.
When its `worker_done` lands, **you dispatch** `/ossify:close <spine-id>` to a close
session that is **always a fresh terminal** you create, never the spine driver's: it
creates nothing, runs the close, and returns what the close opened
(`ossify-pr-briefs.md`). You do not run it here — SKILL.md §6 lists `close` among the
dispatched commands, and the delegation floor keeps suites out of your session.

**The first close opens one PR per hosting repo and halts while any is open**,
recording nothing (`close/references/spine-close.md`); its `worker_done` names **every**
PR it opened, repo and number — or the single word `closed`, when every hosting repo
was remote-less and it recorded the spine outright.

A multi-repo close can also open a PR in one repo and then halt on a later one, so it
returns `halted:` naming what it opened so far. **Dispatch nothing downstream — no
work-PR session, no record pass — until a close returns a complete PR list or `closed`.**
A halt settles that dispatch only: remediate the blocker it names, then dispatch a
**fresh** close session, as many times as that takes.

**Then one work-PR session per returned PR**, each created in that PR's own
hosting-repo worktree and briefed with the two profiles you decided at the PR
transition (`ossify-execution.md` §5). It owns both PR seats in a child Run of its own,
relays one summary per round, and asks you for the merge word; you ask the operator,
and it merges bound to the SHA the reply names. `lifecycle.md` steps 8-12 are that
session's loop, not yours.

**Then, once every returned PR has merged, one record pass** — a second
`/ossify:close <spine-id>`, to another fresh close session. **Hold step 12's teardown —
worker release, branch deletion — until that pass returns:** it resolves the spine
branch again.

That second dispatch is **conditional and single**: it happens
only when the first returned at its open-PR halt naming at least one PR, and only once
every one of those has merged — one SUCCESSFUL record pass per spine, never a
scheduled step; a close that halted consumed nothing and is simply re-dispatched. A
first close that returned `closed` — every hosting repo remote-less, so it landed and
recorded outright — is the whole ceremony, and dispatching a second one against it is
a wrong turn, not a safety net.
