---
name: working-a-pr
description: Drive an open pull request to a mergeable state against the merge bar its own body declares — fetch every reviewer finding, sort each as blocking or non-blocking by that bar, fix only the blocking ones in one push per round, answer the rest in the thread or record them as known limits, stop at round 3 when the fixes are generating the findings, and merge only on the operator's explicit ack. Use when working, driving, babysitting or landing a PR, addressing review comments, or when handed a PR number to get merged.
---

# Working a pull request — against its merge bar

Drive one PR to mergeable. The finish line is the **`## Merge bar`** in the PR's own body,
written when it was opened (`opening-a-pr`). Every finding is judged against that bar, not
against an ideal: the loop fixes what the bar says blocks, answers or records the rest, and
merges only on the operator's explicit ack. The loop is judgment; the shell is only for
mechanical `git`/`gh` facts. Nothing here needs a manifest, a worktree, or any plugin state.

**No Merge bar in the body?** Before round 1, add the six fields from
`../opening-a-pr/references/pr-body.md` to the body (`gh pr edit <PR> --body-file <file>`),
keeping everything already there, and tell the operator you did. A bar written before the
first disposition is a bar; one written after is a rationalisation.

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
line ending in exactly one of the five dispositions in §3. The ledger is the
loop's working memory and its terminus
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
  must be non-blocking: a member of a blocking class — one that meets the PR's
  merge bar — is fixed or the change is cut (§3), never left. A fix that closes only the cited site guarantees the class returns.
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

## 3. The disposition contract — the PR's merge bar

This section is authoritative for this lane. The bar is the `## Merge bar` section of the PR
body. A finding is **blocking** if and only if it meets one of the bar's conditions, or the
PR's one raising line. Decide by the condition, never by the reviewer's label: a bot's "P1"
that meets no condition is non-blocking, and a "nit" that meets condition 1 is blocking.

Every ledger line ends in exactly one of these five dispositions:

- **`fixed in <sha>`** — every blocking finding that is real. For a non-blocking finding,
  allowed only when the fix sits inside Scope and is a line or two; never required.
- **`invalid — <why>`** — the finding is wrong. The refutation is evidence-shaped — walked
  against the tree, quoted — never "disagree". Applies to blocking and non-blocking alike.
- **`answered — <condition it fails>`** — the default for a non-blocking finding. Reply in the
  review thread in one line naming which bar condition it does not meet. If it repeats a
  Known limit, quote the body line. Reviewers such as Codex are not documented to read the PR
  body, so repeats are expected: answer them, never fix them.
- **`limit — [KL]`** — a non-blocking finding that names a real edge case of this PR worth
  recording. Add a line to the body's `## Known limits` (`gh pr edit <PR> --body-file <file>`)
  and say so in the thread; §5 writes it to the ledger after the merge. A finding that meets condition 1 cannot be a limit, whatever it is labelled — by the reviewer, by the PR body, or by the operator.
- **`outside scope → #N`** — a real defect on a path this PR does not touch. At most one issue per PR, created with `gh issue create` and listing every such finding with its file, line
  and a link to the review comment; a later one is added to that issue as a comment. §5
  records it as a `[TD]` line.

**The blocking rail.** A blocking finding is fixed, refuted with evidence, or the change is
cut. It is never ack-to-merged, never deferred and never relabelled, no matter which round
surfaced it or who asks — "just merge it" included.

- **You drive the fix yourself:** edit, commit, push. Record `fixed in <sha>` only when the fix
  is on the PR head the reviewer can see.
- **Staleness:** a fix commit landing after a review makes that verdict stale. Re-fetch (§2)
  and re-review on the **new** head; the old verdict does not carry forward.
- **Reviewer completeness:** green CI is not proof a reviewer ran; a skipped reviewer is not
  approval; a queued reviewer is waited for or surfaced — never assumed. Confirm each expected
  reviewer actually left something on the current head. Do not busy-wait a queued reviewer:
  say it is pending and let the operator decide.

Sort by failure direction before acting: a finding that the boundary **refuses a valid input**
is blocking — condition 1; a finding that it **correctly refuses an unsupported input** is
`invalid` or `answered`; a finding that it **admits what it cannot handle** and corrupts or
loses state is blocking. Incoherence this diff introduced is this diff's to fix.

## 3.5 Rounds

A round is one pass of §2 → §2.5 → §3 ending in one push. Round 1 is the first review of the
opened PR.

- **One push per round.** Commit fixes class by class, then push once, after the sweep below.
  Reviewers such as Codex review every push, so each extra push buys an extra review.
- **A fix touches only what its blocking finding needs** — the class §2.5 named, and nothing
  else. No cleanup, no rewording nearby, no fixing a non-blocking finding "while you are there".
  Every extra line is a new review target.
- **Sweep the fix diff before you push it.** Read `git diff <last pushed head>..HEAD` against the
  bar: does any line of it newly reject valid input, corrupt or lose state, or falsify the
  Claim? Most of round N's findings are on round N-1's fixes; the cheapest round to remove is
  the one you are about to cause.
- **The round-3 stop.** At round 3, if blocking findings remain and they sit on lines your own
  fix commits wrote (check with `git blame` against the fix SHAs), stop. Do not start a fourth round. Surface
  the findings, the fix commits they sit on, and two options for the operator: **narrow the
  Claim** — moving an edge into Known limits, only where it does not meet condition 1 — or
  **split the PR**, naming the parts. The operator chooses.
- **Not the stop:** blocking findings at round 3 on lines the PR's original commits wrote. The
  reviewers are excavating the design, not reacting to your fixes. Disposition each on its
  merits and continue; a count alone never ends the loop.

**Unclaiming.** Narrowing the Claim is two edits, not one: the findings behind the claim keep
their ledger lines — the unclaiming commit is the fix — and the claim itself comes out of every
artifact that promises it: the PR body, the changelog, and any README, doc or release-metadata
line the diff wrote it into. A claim baked into a commit message comes out only by rewriting
history; a rewrite re-mints every descendant sha, so remap each `fixed in <sha>` line onto the
rewritten head before the terminus. A rewrite pushes non-fast-forward, so lease it —
`git push --force-with-lease=<branch>:<current-remote-oid>`, captured immediately before the
rewrite — and a refused lease re-enters §1: someone advanced the branch.

Neither the stop nor unclaiming touches the blocking rail or bypasses staleness: they land
commits like any other fix, prior verdicts go stale, and the reviewer signal must be complete
on the head that carries the final shape before the terminus ask.

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
blocking finding, a stale or incomplete reviewer signal, or a red gate. If the operator
leaves it open,
report the PR URL and stop — the loop does not poll.

## 5. After the merge — write the ledger

Only after the merge has succeeded. Collect every line of the final body's `## Known limits`
(except `None.`), every `limit — [KL]` finding, and the one `outside scope → #N` issue if
there is one. Write them as:

```
- [KL] <area/path> — <the limit> — <why accepted> — revisit when <trigger> (PR #N)
- [TD] <area/path> — <defect> → #N
```

**Where they go:** the paired AI workspace's `.claude/memory-bank/tech-debt.md`. Find the
workspace by looking next to this repository for a directory holding
`.workspace/pairing.json` whose `canonical.name` is this repository's name (commonly
`<repo>-ai`), or through ossify's `.ossify/topology.json`. The manifest's absolute `root`
paths may belong to another machine — match by name and location, never by trusting them.
If the file is absent, create it with the heading `# Tech debt — <repo>`. Commit and land it
the way that repository's own `CLAUDE.md` says; if it says nothing, leave it uncommitted and
tell the operator.

Never write the ledger into the reviewed repository — it may be public, and the ledger is
process record. If no paired workspace can be found, print the lines and ask the operator
where they go.

## Anti-patterns

- **Growing the loop into tooling.** No wrapper scripts, no state files — the ledger of
  dispositions lives in the conversation and the terminus report.
- **Judging a finding by its label.** "P1" and "nit" are the reviewer's words; the bar is yours.
- **Editing straight down the ledger.** N findings are not N fixes. Classify first (§2.5).
- **Fixing non-blocking findings to make them go away.** Answer them. A fix is a new review
  target.
- **Filing an issue per finding.** Out-of-scope defects share one issue; in-scope
  non-blocking findings get none.
- **Counting rounds without reading them.** Round 3 stops the loop only when the reading says
  your fixes are generating the findings.
- **Ack-to-merging a blocking finding**, or letting "just merge it" relabel one as a limit.
- **Trusting a pre-fix verdict on a post-fix head.**
- **Auto-merging.** The merge is always the operator's explicit call.
