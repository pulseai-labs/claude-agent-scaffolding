---
name: patch
description: Ship a defect in shipped behaviour, or a small request from another project that it cannot fake, as a versioned patch off the default branch — reproduce-first for a defect, acceptance-criteria-first for a request, then a PR and a tag. Use when handed issue numbers or a described defect to fix outside any spine, or on /ossify:patch. Not new scope (the intake queue), not a large request (/plan-spine), not a change nothing observes (close's direct-commit patch lane).
---

# patch

A running spine is never reopened. Work that arrives mid-release either waits in
the intake queue for the next spine planning, or — when it is a defect in
behaviour that already shipped, or a small request another project cannot fake —
ships here, as a patch release off the default branch. This skill decides whether
the work belongs here, fixes it by the procedure its kind needs, and lands it as a
versioned PR and a tag.

It writes no ossify state. The `fix/` branch, the PR and the tag are the record;
release close finds them in git (`close/references/release-close.md` §6).

---

## 1. Is this a patch? Refuse the wrong lane, loudly, with the route

Read the input — issue numbers (`gh issue view <n> --json number,title,body,labels,url`)
or the described defect — and place it in exactly one lane:

| The work | Lane |
|---|---|
| A **defect in shipped behaviour** — a released version does something its docs, its tests or its users rely on it not doing | **here** — §3's defect arm |
| A **small request from another project that it cannot fake** — one work item's worth, the yardstick `plan-spine` §4 uses, and no admissible glue on the requester's side (`plan-spine/references/fake-ledger-discipline.md` §1) | **here** — §3's request arm |
| A **large** can't-fake request — more than one work item | **refuse** → plan a spine for it now: `/ossify:plan-spine` (after `/ossify:plan-release` if no release is open) |
| A request the requester **can** fake, or **new scope** with no defect behind it | **refuse** → the intake queue, an issue labelled `from:<requesting project>` (`plan-spine/references/intake-and-ledger.md` §1). The project's own idea, with no requester, goes on the feature map at the next `/ossify:plan-release` |
| A change **nothing observes** — a typo, a comment, a formatter run | **refuse** → close's direct-commit patch lane (`close/references/patch-lane.md`); it needs no version |

A refusal names the lane and stops: no branch, no commit, no version. **Never** add
the work to a running spine — not as a work item, not as an AC — whatever its size
or urgency.

"Small" is judgment, and doubt resolves against this lane: if you cannot say in
one line which single work item the patch would have been, it is a spine.

## 2. Read what the patch will touch

Name the repo the fix goes into and the paths it will touch. Then:

- **The ledger.** Read the tech-debt ledger lines overlapping those paths and give
  each a disposition (`plan-spine/references/intake-and-ledger.md` §2). A line
  this patch resolves is pulled in as one of its ACs.
- **Bones and risk gates**, on an ossify project — a topology resolves; resolve
  `oss_bin` per the plugin's `rules/dispatcher-path.md`. Run
  `"$oss_bin" touch_check` with the paths, one argument per path: rc 0 is a hit
  (stdout names it), rc 1 is clean, rc 2 could not check and is never clean. A
  `risk_gate` hit makes that gate's controls (`"$oss_bin" get '.risk_gates'`)
  required ACs of this patch. A `bone` hit is allowed only when the fix keeps the
  decision the bone's ADR records; a fix that changes that decision is a spine —
  refuse it as §1's large arm. On rc 2, say so and ask the operator before going on.

## 3. Fix it — by kind

**Defect.** Reproduce first. Write the failing test — or, where no test can reach
it, record the failing command and its output — and run it to watch it fail for
the reported reason. Then find the root cause with the loop in
`work-item/references/debugging.md` §2: reliable red, minimize, hypothesize,
instrument. Fix at the root, not at the symptom. Prove it: the reproduction now
passes, it fails again with the fix reverted, and the full suite is green.

**Small request.** Write the acceptance criteria from the requester's issue first —
each one a checkable statement, keeping the requester's words where they are
precise — and post them on the issue so the requester can object before the work
lands. Then build them test-first, one AC at a time: the discipline in
`work-item/references/tdd-loop.md`, without a spine handoff document. Finish on
the full suite green.

Either way, keep a record of every command you ran and what it showed. The PR's
Evidence is built from that record and nothing else.

## 4. Branch and version

Cut `fix/<plugin-or-project>-<version>`, where `<version>` is the patch version
this will ship as, from the **freshly fetched** default branch, in a **clean**
checkout. If the repo's checkout is parked on a spine or work-item branch, or is
dirty, do not switch it or stash it — a running spine owns it. Cut the branch in
a separate worktree:

```bash
git -C "<repo-root>" fetch origin "<default-branch>"
git -C "<repo-root>" worktree add -b "fix/<plugin-or-project>-<version>" "<new-worktree-path>" "origin/<default-branch>"
```

Bump the **patch** version on every surface the project carries it. Find them with
`git grep -n -F "<current version>"`, read each hit, and bump the ones that
declare this project's version: manifests, lockfile entries for the project
itself, changelogs, READMEs. If the project's releases carry no patch version,
ask the operator how this one is numbered; do not invent a scheme.

Commit following the repository's own rules for commit text (its `CLAUDE.md`,
`AGENTS.md` or `CONTRIBUTING.md`).

## 5. Open and work the PR

**Where the `merge-bar` plugin is installed** — this session lists its
`opening-a-pr` and `working-a-pr` skills — open the PR with `/merge-bar:open-pr`
and work it with `/merge-bar:work-pr`.

**Otherwise**, write the six-field body from ossify's copy of that template,
`references/work-pr/pr-body.md` at the plugin root: its headings in order, and
its Merge bar block word for word. Then open it:

```bash
gh pr create --repo "<owner/repo>" --base "<default-branch>" --head "fix/<plugin-or-project>-<version>" --title "<title>" --body-file "<body-file>"
```

Then work it by the plugin root's `references/work-pr/loop.md` (on Claude Code,
`/ossify:work-pr <PR>` routes there).

Either way, the body carries one `Closes #<n>` line per issue this patch
resolves, one per line: GitHub closes only the first issue of `Closes #1, #2`.
**The merge is the operator's.**

## 6. Tag after the merge

After the operator merges, confirm the merge commit's tree carries the new
version, then tag that commit the way the project tags its releases. Read
`git -C "<repo-root>" tag --sort=-creatordate` for the convention (annotated or
not, the prefix, the version form) and follow it:

```bash
git -C "<repo-root>" fetch origin "<default-branch>"
git -C "<repo-root>" tag -a "<tag>" -F "<tag-message-file>" "<merge-commit>"
git -C "<repo-root>" push origin "<tag>"
```

Report the tag, the PR URL and the issues it closed. On each issue another
project filed, comment with the version that carries the fix so the requester can
adopt it.

## 7. Anti-patterns

- **Adding the work to a running spine** because it is small or urgent (§1).
- **Fixing a defect you have not reproduced.** A fix with no failing
  reproduction proves nothing (§3).
- **Writing code before the ACs** on a request (§3).
- **Switching or stashing a checkout a spine is parked on** to cut the branch (§4).
- **Reading `touch_check` rc 2 as clean**, or a `risk_gate` hit as advisory (§2).
- **Bumping one manifest** and leaving the old version on another surface (§4).
- **Merging on the operator's behalf**, or tagging before the merge (§5, §6).
- **Recording the patch in ossify state.** Git is the record (top of this file).

## 8. Slash-command interaction

`/ossify:patch` (`commands/patch.md`) passes the raw argument string as
`$ARGUMENTS`; on shim-less channels (Codex, `Skill()`, natural language) the issue
numbers arrive as literal tokens in the request. **Never reference `$1` / `$2` /
`$N`.** With no argument, ask which issues or which defect; never pick one.
