# Working a pull request — the review-fix-merge loop

Drive one PR to mergeable: fetch every reviewer finding, give each a recorded
disposition, drive the fixes yourself, re-review on the new head, defer the
non-blocking leftovers as tracked issues, and merge only on the operator's
explicit ack. The loop is judgment; the shell is only for mechanical `git`/`gh`
facts. Nothing here needs a manifest, a worktree, or any ossify state — the
lane works on any repository `gh` can reach.

## 1. Preflight — resolve the target, stop early, stop loudly

- **The repo:** the one you are in, unless `--repo-root DIR` says otherwise —
  and with `--repo-root`, **every** `git`/`gh` command below runs against that
  directory (run them from it, or `git -C <dir>` / `gh --repo <owner>/<repo>`):
  a bare `gh` in the invoking repo resolves the PR number against the wrong
  repository, and if both repos have that number, even the head verification
  checks the wrong one against itself. Not inside a git repo and no flag → say
  so and stop; this is the one gap judgment cannot bridge.
- **The PR exists and is OPEN:** `gh pr view <PR> --json state,isDraft`
  before anything else; a typo'd number fails here, not three steps in — and
  a closed or merged PR stops here too, because `gh pr view` succeeds on
  those and the loop would otherwise edit and push a branch nothing can
  merge. A draft is surfaced (workable, not mergeable) rather than stopped.
- **Clean tree:** a dirty target repo means someone's work is in the blast
  radius of your fixes — say what is dirty and stop until the operator
  commits, stashes, or cleans. Never stash on their behalf.
- **The head you will edit:** check out the PR branch (`gh pr checkout`) and
  confirm the branch and commit you landed on are the PR's own head (`gh pr
  view --json headRefName,headRefOid` against `git rev-parse`). Editing the
  wrong branch writes fixes nowhere the PR can see; a mismatch is a stop, said
  plainly.

Each stop names what failed and what would unblock it. None of them is a
refusal to work the PR — they are the order that keeps fixes attributable.

## 2. Fetch the findings — both signals, always

Reviewers leave findings in two places, and each alone misses what the other
carries:

- the **review + conversation stream** — review summaries, CI rollup, top-level
  comments (`gh pr view --comments`, `gh pr checks`, review listings — the
  `--comments` flag matters: the bare view omits top-level comments, and a
  finding that lives only there would silently miss the ledger);
- the **inline line-level comments** — where review bots put nearly everything
  (`gh api --paginate repos/{owner}/{repo}/pulls/{n}/comments`, or the
  equivalent — paginated, because a second page of findings that never loads
  is a ledger hole wearing a clean look).

Read both, then build the **disposition ledger**: one line per finding, every
line ending in exactly one of `fixed in <sha>` / `deferred → #N` /
`invalid — <why>`. The ledger is the loop's working memory and its terminus
report; a finding missing from it was never dispositioned.

## 2.5 Read the findings as a set before each edit pass

§2 hands you a list; editing straight down it is this loop's main failure mode.
Independent fixes to overlapping prose re-anchor the sentences the next finding
cites, and round N+1 arrives built out of round N's own fixes.

So before each edit pass — the first one, and again after every re-review —
collapse the ledger into **classes**. A class is one
defect however many findings name it: the same mistake at several sites, two
reviewers on one site, or several symptoms of one wrong condition. Fix a class
in one commit, or record why it splits.

Three obligations follow. Each is a requirement, not a procedure — how you
satisfy it is yours:

- **You close the class, not the finding.** A finding names one site; the class
  is every site reachable at that boundary. The reviewers saw a sample, so
  enumerate the rest yourself and close them together. What you name and leave
  must be non-blocking: a member of a blocking class — correctness, security,
  data loss, a broken contract — is fixed or the change is cut (§3), never
  left. A fix that closes only the cited site guarantees the class returns.
- **Grep the condition's old form first.** When a fix changes a rule, the
  defects that remain are phrased in what you replaced, not in what you wrote.
  The old form is the search term, and the fix is often deleting a stale clause
  rather than adding a new one.
- **Order by collision, not by severity.** Two fixes that rewrite the same
  prose are one edit. Where they genuinely are not, apply the one that moves
  the anchor first, then re-read the other finding against the new text before
  touching it — its quoted line may no longer exist.

A fourth obligation applies to what you just wrote. **Sweep the fix diff before
you push it**, against the same class you set out to close. Most of round N's
findings are on round N-1's fixes, so the cheapest round to remove is the one
you are about to cause.

Then ask one question of the whole set, which no single finding can answer:
**is the PR's headline claim still true?** A round of fixes can leave the
description, a changelog entry, a commit message, any doc line, or any
release-metadata field the diff touched promising work the diff no longer
does.

The ledger stays one line per finding. Classes are how you **fix**; the ledger
is how you **report**.

## 3. The disposition contract

This section is authoritative for this lane.

- **P1 / blocking** — correctness, security, data loss, a broken public
  contract: **must be fixed before merge, or refuted with evidence like any
  other false finding.** Never ack-to-merge, never deferrable, no matter
  which review round surfaced it or who asks.
- **Non-blocking** — fix it or defer it. A deferral is a **tracked issue in
  the target repo** recorded as `deferred → #N`; a silent pass is not a
  disposition. File it with `gh issue create` and enough body that a stranger
  can act on it without this conversation.
- **Invalid** — a finding can be wrong. Refuting it is a disposition, but the
  refutation is evidence-shaped (walked against the tree, quoted), never
  "disagree".
- **You drive the fix yourself:** edit, commit, push. Record `fixed in <sha>`
  only when the fix is on the PR head the reviewer can see.
- **Staleness:** a fix commit landing after a review makes that verdict stale.
  Re-fetch (§2) and re-review on the **new** head; the old verdict does not
  carry forward.
- **Reviewer completeness:** green CI is not proof a reviewer ran; a skipped
  reviewer is not approval; a queued reviewer is waited for or surfaced —
  never assumed. Confirm each expected reviewer actually left something on the
  current head. Do not busy-wait a queued reviewer: say it is pending and let
  the operator decide.

Loop §2→§2.5→§3 until every finding is dispositioned, every P1 is fixed or
evidence-refuted, never deferred, and the reviewer signal is complete on the
current head.

**The second exit — stop looping and change the change.** The line above is the
normal terminus. This one is categorical, not a round count:

- **Rounds stop shrinking *and* the fixes are generating the findings.** When a
  round is mostly fallout from the previous round's own fixes, more rounds will
  not converge; the shape of the change is wrong. Cut it or narrow it, and say
  so — do not restructure twice.
- **A claim the change cannot honour ends the loop by being unclaimed.**
  Designing under review pressure at round N produces round N+1; a documented
  refusal is complete, an unhonoured promise is not. Unclaiming is two edits,
  not one: the findings behind the claim keep their ledger lines — the
  unclaiming commit is the fix — and the claim itself comes out of every
  artifact that promises it: the PR description, the changelog, and any
  README, doc, or release-metadata line the diff wrote it into. A claim
  baked into a commit message comes out only by rewriting history; a rewrite
  re-mints every descendant sha, so remap each `fixed in <sha>` line onto the
  rewritten head before the terminus, or the ledger cites commits no head
  contains. A rewrite pushes non-fast-forward, so lease it —
  `git push --force-with-lease=<branch>:<current-remote-oid>`, captured
  immediately before the rewrite rather than at the original preflight,
  which rounds of fix pushes have already moved — and a refused lease
  re-enters §1: someone advanced the branch, and a bare force would discard
  their commits. A refusal still promised is the same unhonoured promise.
- **A plateau of *original-design* findings is not a cut signal.** When rounds
  stop shrinking but the findings have shifted off your fixes and onto the
  design the PR always had, the reviewers are excavating, not reacting. That
  loop ends by dispositioning — fix or refute the P1s, and give the rest their
  per-finding disposition, fixing, refuting, or deferring each on its own
  merits, never a bulk deferral because the count plateaued — not by waiting
  for a clean round that will not come.
  Measured on PR #349: findings ran 17 → 4 → 6 → 5 → 7 across five rounds, and
  the categorical exit closed it, not convergence.

Sort by failure direction before acting on either: a finding that the boundary
**refuses a valid input** is a fix — the boundary is breaking its own contract;
a finding that it **correctly refuses an unsupported input** is invalid or
deferred; a finding that it **admits what it cannot handle** is a fix.
Incoherence this diff introduced is always this diff's to fix.

Neither exit touches the P1 rail. A P1 is fixed, evidence-refuted, or the
change is cut. It is never merged. And neither exit bypasses staleness: cutting, narrowing, or
unclaiming lands commits like any other fix — prior verdicts go stale, the
loop re-runs on the new head, and the reviewer signal must be complete on the
head that carries the final shape before the terminus ask.

## 4. Terminus — surface everything, then ask

In one place, give the operator:

- the full disposition ledger,
- CI state and per-reviewer status (ran / skipped / pending / stale),
- a mergeability verdict: clean to merge, or exactly what still blocks —
  **grounded in GitHub's own answer, fetched here** (`gh pr view --json
  mergeable,mergeStateStatus,isDraft`): a draft, a conflict with the base, a
  branch the ruleset calls BEHIND, or a blocked review state each falsifies
  "clean to merge" however green CI and the reviewers look, and discovering
  that only after the operator acks is the loop soliciting an impossible
  merge.

Then **ask**: merge, wait, or leave open. Merge only on explicit ack, and the
ack covers **the head the ledger describes**: pass the reviewed OID
(`gh pr merge --match-head-commit <oid>`, with the repo's merge convention —
ask if the convention is not evident from the repo's history or settings), so
a head that moved between the report and the answer refuses and re-enters §2
instead of merging unreviewed commits. The pin guards **commits, not
verdicts** — a blocking review or a red CI rerun can land on the *same* head
while the operator considers the ask — so after the ack and immediately
before merging, re-fetch both finding signals and the checks once more;
anything newly blocking re-enters §2 instead of merging. On a branch governed
by a merge queue, required checks must be **finished** before accepting the
ack — with checks still pending, `gh pr merge` does not merge, it *enables
auto-merge*, and this lane never auto-merges. Never merge over an unresolved
P1, a stale or incomplete reviewer signal, or a red gate. If the operator leaves it open,
report the PR URL and stop — the loop does not poll.

## Anti-patterns

- **Growing the loop into tooling.** No wrapper scripts, no state files — the
  ledger lives in the conversation and the terminus report.
- **Editing straight down the ledger.** N findings are not N fixes. Classify
  before each edit pass (§2.5).
- **Closing only the site the reviewer cited**, when the same defect sits at
  three more the reviewer never reached.
- **Counting rounds instead of reading them.** Round six is not a signal;
  round six built out of round five's fixes is.
- **Ack-to-merging a P1**, or letting a "just merge it" instruction reclassify
  a correctness finding as style.
- **Silent-passing a non-blocking finding** — untracked is undispositioned.
- **Trusting a pre-fix verdict on a post-fix head.**
- **Auto-merging.** The merge is always the operator's explicit call.
