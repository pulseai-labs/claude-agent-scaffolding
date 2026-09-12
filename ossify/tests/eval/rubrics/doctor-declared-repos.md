# Rubric: doctor-declared-repos

Score each 1-5 (4 criteria). Pass = all ≥4. `expected_outcome` vocabulary:
`all-ok` | `some-fail`. `all-ok` = every check the interop surface runs prints
`ok:` and the read-out states plainly that nothing failed. `some-fail` = at
least one line is `fail:` and the read-out states plainly, at the end, that
the workspace failed interop — a `fail:` line present in the transcript but
never surfaced in the closing statement is a different, wrong outcome from
one that names it.

**Every criterion is scored on every fixture.** A fixture that turns on one
mechanic is still scored on the other three — a criterion whose own condition
never arises in that fixture scores whether the skill correctly stayed silent
about it (or correctly reported a clean line), the same convention
`close-per-repo` and `run-spine-declared-repo` use. There is no N/A.

1. **Every declared repo gets its own root-resolution line, keyed by its own
   name — never only `canonical` and `ai_workspace`.**
   `doctor/references/interop-check.md`'s `ai_workspace`-and-every-declared-repo
   section resolves `oss repo_root <key>` once per key the manifest declares,
   `ai_workspace` included. A third (or further) declared repo whose root does
   not resolve, is not a directory, or resolves cleanly must be named on its
   OWN `ok:`/`fail:` line. Reporting only two repo-shaped lines regardless of
   how many repos are declared — even when the overall all-ok/some-fail
   verdict happens to be right — reproduces the pre-#272/#310-Task-10 checklist
   this criterion exists to catch.
2. **Every declared repo also gets the git-work-tree probe on its own line;
   `ai_workspace` alone is exempt from it.** `git -C "<root>"
   rev-parse --is-inside-work-tree` must print exactly `true` for a pass — a
   nonzero rc, or an rc-0 `false` (a bare repository or a `.git`-directory
   root, which resolves and answers the probe without erroring), both fail
   that repo's line, and both must be checked on EVERY declared repo other
   than `ai_workspace`, not on whichever repo happens to be named `canonical`.
   Running this probe against fewer than every declared repo, or against
   `ai_workspace`, is wrong regardless of the verdict.
3. **The declared-repo set is never silently truncated, and the sole-repo case
   is unaffected.** A healthy third or fourth declared repo still gets named
   on its own line even when nothing about it would otherwise draw attention —
   an all-ok verdict is not license to collapse multiple repos into one
   summary sentence or omit the ones that passed. Symmetrically, a manifest
   declaring exactly one product repo produces exactly one DECLARED-REPO line,
   under whatever name that repo actually carries, **plus the `ai_workspace`
   line criterion 1 requires** — "exactly one" counts product repos, not total
   lines, and reading it as total lines scores correct output as wrong. No
   extra lines invented, and no behavior different from before this
   generalization.
4. **The closing statement says plainly, for the WHOLE workspace, whether
   anything failed — never per-repo silence.** Since there is no exit code,
   a `fail:` line on any one declared repo must change the stated bottom
   line for the whole check, regardless of which repo (canonical or
   otherwise) it belongs to. A summary that reads as clean while a
   `fail:` line sits earlier in the same transcript is the wrong answer even
   if every individual line was itself correct.

## Output format
`{"scores":{"per_repo_root_line":N,"per_repo_worktree_probe":N,"set_not_truncated":N,"summary_states_failure":N},"pass":true|false,"notes":"<one sentence>"}`. Pass = all ≥4. JSON only.
