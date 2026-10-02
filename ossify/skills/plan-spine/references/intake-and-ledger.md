# What arrived since the plan — the intake queue and the tech-debt ledger

Depth for SKILL.md §3's last step, and read from two other places: `plan-release`
§4 reads §1 at release grooming, and the `patch` skill reads §2 for a patch's
paths. One procedure, three callers. Nothing here writes ossify state: the issue
tracker is the queue, and the ledger is a file in the AI workspace.

---

## 1. The intake queue

A request from another project is an **issue in this project's repo** carrying the
label `from:<requesting-project>` (for example `from:pulse-guard-ai`). The label is
the queue. The requester creates it the first time it files one; nothing else
registers it.

List the open requests — every open issue with a label that starts `from:`:

```bash
gh issue list --repo "<owner/repo>" --state open --limit 1000 \
  --json number,title,url,labels \
  --jq '[.[] | select(any(.labels[]; .name | startswith("from:")))]'
```

**Never pass `--label 'from:*'`.** gh matches a label name exactly and takes the
`*` literally, so that call returns an empty list at rc 0: an empty queue that is
not empty. The prefix filter above is the only reading that finds every
requester.

**The limit is a bound, not a sample.** If
`gh issue list --repo "<owner/repo>" --state open --limit 1000 --json number --jq length`
prints `1000`, raise the limit and list again. A truncated page drops requests
silently. A closed issue is not in the queue.

A request stays open until the spine that pulled it in lands, so the queue can
return one an earlier planning already took. Read its comments
(`gh issue view <n> --repo "<owner/repo>" --json comments`): one carrying a
`pulled in — <spine id>` disposition is already assigned — list it as
such, and never add it to the feature map or a spine again. A spine id has the
`r<n>.s<m>` shape. A `pulled in — <release id>` request (`r<n>`) is on the feature
map and not yet in any spine. At release planning, list it as already pulled in.
At spine planning, when this spine takes the feature it came from, re-disposition it:
`pulled in` to this spine, recorded in `SPINE.md`'s Context and commented on the
issue as below, so spine close (`close/references/spine-close.md`) closes it when
the spine lands. If this spine does not take that feature, leave the request as
it is.

For each other open request, record exactly one disposition:

- **pulled in** — into this spine, as a named work item or an AC, only while the
  spine's first round has not started (SKILL.md §2). At release planning,
  pulled in means onto the feature map:
  `"$oss_bin" feature_add "<name>" "<value>" "<bone|flesh>" intake`.
- **deferred** — with the reason, and what would admit it later.
- **routed to `/ossify:patch`** — a defect in shipped behaviour, or a small
  request the requester cannot fake (`plan-spine/references/fake-ledger-discipline.md` §1).

Record each disposition twice: one line in `SPINE.md`'s Context (at release
planning, in `RELEASE.md`), and one comment on the issue, so the requesting
project sees it without asking —
`gh issue comment <n> --repo "<owner/repo>" --body "<disposition> — <spine or release id>"`.

**At release planning**, a release that serves a consumer states its exit
criterion as "<consumer> can adopt <capability set>", and the capability set stays
open until the release's last spine is planned. A spine's scope freezes when it
is planned; the release's does not.

**No queue to read.** If the repo has no GitHub remote, or `gh` cannot reach its
forge (unauthenticated, or not GitHub), say so in one line and ask the operator
which requests other projects have sent. Give each one they name a disposition
as above. "Could not list" is never "empty".

**An empty queue** is one line: `intake: no open from: requests on <owner/repo>`.

---

## 2. The tech-debt ledger

merge-bar's `working-a-pr` writes accepted known limits and out-of-scope defects,
after a merge, to the AI workspace's `.claude/memory-bank/tech-debt.md`:

```
- [KL] <area/path> — <the limit> — <why accepted> — revisit when <trigger> (PR #N)
- [TD] <area/path> — <defect> → #N
```

Read it from the AI workspace: `"$oss_bin" repo_root ai_workspace` on an ossify
project. Outside one, use the paired workspace next to the repo — a sibling
directory whose `.workspace/pairing.json` names this repo as canonical, commonly
`<repo>-ai`.

```bash
grep -n -E '^- \[(KL|TD)\] ' "<ai-workspace>/.claude/memory-bank/tech-debt.md"
```

The **surface** is what is being planned. At plan-spine pre-flight, it is the
paths and areas the spine's release plan and feature entry name, plus any path
§4's decomposition adds — the pre-flight read cannot see those yet, so read the
ledger again for them before the decomposition is approved. For a patch, it is
the files the fix will touch. A line
**overlaps** when its `<area/path>` is one of those paths, a parent directory of
one, or the same named area. Overlap is judgment; list only what overlaps — a line
that does not overlap is not named at all, not even as skipped.

For each overlapping line, record exactly one disposition:

- **pulled in** — as a named work item or AC of this spine or patch.
- **still accepted** — with the reason. Say whether its `revisit when` trigger
  has fired; a fired trigger is the reason to pull it in, so accepting it anyway
  needs its own reason.
- **retired** — the code it names is gone. Show the evidence
  (`git -C "<repo>" ls-files <path>` prints nothing, and the commit that removed
  it), delete the line from `tech-debt.md`, and note the retirement in `SPINE.md` — for a
  patch, which has no `SPINE.md` and never writes another spine's, in the PR's Evidence.
  This is the only write this section makes, and it is in the AI workspace.

No ledger file, or no overlapping line → one line saying which. Never write the
ledger, or anything about it, into the product repository.
