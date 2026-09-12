# impl-check — the four-layer work-item gate

Depth for SKILL.md §4, step 2. This is the orchestrator-side gate over one work
item's output (spec §6, last bullet). It runs on the resolved `$spec`, `$report`
and `$wt` from `work-item-close.md` §1 — **never on a placeholder**.

Four layers, in order. **Halt on the first failure in any layer**, and a halt is
terminal: no later layer runs, no commit, no merge, no status write.

---

## 1. Why this one halts when the implementer's did not

The implementer runs every verification command **without** halting on the first
failure, deliberately (`work-item/SKILL.md` §6). This gate does the opposite, and
for the opposite reason:

| | Implementer | This gate |
|---|---|---|
| On first failure | keep going | **halt** |
| Why | nobody is listening; a partial picture forces a second dispatch that costs more than the failed commands did | there *is* a human to route to, and the recovery choice does not improve with more failures attached |

So the two are not inconsistent, and neither is a bug to be "aligned" with the
other. If you are tempted to make this one gather everything first: the first
failure is what the recovery menu acts on, and running the rest changes files,
burns time, and buries it.

---

## 2. Layer 1 — `auto:` ACs, halt-on-first-fail

```bash
oss verify_acs "$spec"    # TSV: label <tab> command <tab> expectation, in declared order
```

Then, per row, in the order it printed. The fields are tab-separated (commands
contain spaces), and the rows are consumed by **redirection, never by a pipe**:

```bash
rows="$(oss verify_acs "$spec")" \
  || { echo "[AC] cannot read the spec '$spec' - the gate would otherwise pass by reading nothing"; exit 2; }
[ -n "$rows" ] \
  || { echo "[AC] the spec '$spec' yields zero auto: ACs - verify the spec path and the AC grammar"; exit 2; }

rc=0
while IFS="$(printf '\t')" read -r label cmd exp; do
  [ -n "$label" ] || continue
  oss verify_step "$wt" "$cmd" "$exp" || rc=$?
  [ "$rc" -eq 0 ] || { echo "[AC] $label \`$cmd\` did not satisfy '$exp' (rc $rc)"; break; }
done <<EOF
$rows
EOF
[ "$rc" -eq 0 ] || exit "$rc"        # halt: no later layer runs
```

Three idioms here, all load-bearing and all silent when wrong.

**Parse the spec ONCE, up front, where the rc is checkable.** The rows used to be
fed straight in from a process substitution, whose rc the loop cannot see. A spec
that could not be read — a mis-derived path landing on the handoff or last
round's spec, or AC lines that drifted from the grammar — produced **zero rows**:
the loop body never ran, `rc` kept the `0` it was initialised with, and the gate
reported **green having read nothing**. A gate that passes when it is blind is
worse than no gate. Capture the rows first, fail closed on an unreadable spec,
and treat "zero auto ACs" as a defect to surface rather than a vacuous pass.

**`|| rc=$?`, never `if ! oss verify_step …; then rc=$?`.** After a negated test
`$?` is the *negation's* status — zero — so `rc` records a pass, the halt check
below never fires, and the loop runs every remaining AC before falling into layer
2. The `||` form captures the command's own rc, and as an OR-list it is
errexit-exempt.

**`oss verify_acs … | while …` is the other trap.** The last element of a pipeline runs
in a **subshell**: `rc` is set in a child and lost, `break` leaves only the
subshell, and the ceremony sails past the halt into layer 2 with a failing AC
behind it — at rc 0. Feeding the loop from the captured `$rows` by heredoc (as
above) keeps it in the current shell, which is what makes the halt reach the
caller. A `< <(…)` process substitution does that too and is fine where the
producer's rc does not matter — but here it does, which is why the parse moved
out of the redirection entirely.

Both nonzero codes halt, and they mean different things, so say which:

| rc | Meaning | Tag |
|---|---|---|
| 0 | the AC's command behaved as declared | — |
| 1 | the AC failed | `[AC]` |
| 2 | the expectation is malformed or unrecognized | `[AC]`, and name the criterion, not the code |

An rc 2 is a **criterion** defect: the expectation grammar is `exit <n>` or
`output contains <str>`, and anything else fails closed rather than passing
silently. That routes to the third recovery option (re-author the AC), never to
"re-dispatch the implementer" — the code is not what is wrong.

**`verify_step` already applies the zero-tests guard for you.** A command naming
a recognized test runner whose output shows a zero-tests result fails as *vacuous
green*. Do not re-implement it in the ceremony. Two scoping facts, because both
directions bite:

- It fires **only on an `exit 0` expectation.** A row legitimately expecting
  `exit 1` from a recognized runner is not vacuous, and is not flagged.
- It requires **both** halves — the command must name a recognized runner **and**
  the output must show zero tests. A non-runner that merely prints a zero-tests
  phrase is not vacuous.

`user:` rows are not parsed here at all — and no ossify gate parses them
anywhere. The human-walked half of acceptance lives in the demo ledger
(`oss ledger_add_user`, keyed by spine), walked at the cumulative demo; a
spec's `user:` line is documentation for the implementer only.

---

## 3. Layer 2 — report cross-check

```bash
oss report_cross_check "$report" "$spec"    # 0 accounted-for | 1 missing | 2 report not found
```

Every `auto:` AC in the spec must appear in the report's AC table
(`work-item/references/report-contract.md` §2). **A missing `auto:` AC halts** —
an unreported AC is indistinguishable from an unimplemented one, and the whole
point of the report is that it is the evidence the gate reads.

The lib emits `oss: report does not account for: <AC>` and returns rc 1. The
`[report cross-check]` tag below is **the skill's surfacing convention layered on
top** — it appears in no lib and you should not grep for it.

An AC that was deferred, skipped under a recorded override, or only partially
satisfied still has to be **named** in the report with its severity. "Quietly
dropped" and "incomplete report" are the same observation from here.

---

## 4. Layer 3 — code patterns

Read the project's `03-code-patterns.md` and **judge** whether the staged diff
violates a documented pattern.

**This layer is agent judgment in this release, and that is a decision rather
than an omission.** The predecessor stack's mechanical evaluator is a phantom
entry point over three unimplemented rule families: it resolves to nothing, it
passes everything, and it reads as coverage. **A mechanical gate that silently
passes is worse than an honest judgment call** — the first is trusted, the second
is read.

**Settled, 2026-08-15: the evaluator is wontfix.** This paragraph used to end
*"a real evaluator arrives with rule authoring"*, then *"that remains a
separate v0.3 item"*. Neither is true any longer: no ossify evaluator will
ship, by decision rather than delay. An authored rule is documented, validated
at authoring (`doctor` §6), and read **here, by you**, on every work-item
close — this layer IS ossify's evaluation mechanism, and the planned Layer 4
agent pass (#139) is its deepening, not its replacement. Nothing in this stack
parses those blocks and runs them against a codebase, and nothing is waiting
to. (The predecessor stack's own claims are covered two paragraphs up: its
documented evaluator is a phantom entry point, which is exactly why this
layer is honest judgment instead.)

So: read the file, read the diff, and say what you find. If the project has no
`03-code-patterns.md`, say that too — an absent rule file is a fact worth one
line, not a silent pass.

### Where the file is

The memory bank, in the **AI workspace** — not any declared repo, and not
beside the code being reviewed. The bank is manifest-routed: resolve it exactly
as `references/harvest.md` §7 does (the pairing manifest's
`.well_known_paths.memory_bank`, token-expanded; a relative or unresolved route
is a STOP), never against `$PWD`. The file is `<bank>/03-code-patterns.md`.

`03-code-patterns.md` is one of the bank's live files, authored at onboarding
from bones category 8 (`start/references/memory-bank-brief.md` §1) and grown by
the harvest. Its `## Machine-checkable rules` section ships **seeded empty** —
an empty section is not the same as an absent file, and neither is a violation.

### What a finding looks like

Two parts, always, because a finding the author cannot act on is an opinion:

1. **The pattern, quoted** from `03-code-patterns.md` — its own words, not your
   paraphrase of them.
2. **The offending hunk**, by file and line, from the staged diff.

> `[rule] src/orders/api.rs:142` — `03-code-patterns.md`: *"adapters never
> import from `domain::internal`"*. This hunk adds
> `use crate::domain::internal::OrderState;` in an adapter.

**Calibrate against the pattern as written, not its spirit.** If the diff
violates what the rule *says*, it is a finding. If it violates something you
believe the rule *meant*, that is a gap in the rule — say so as an observation
and do not halt the gate on it. The rules are the project's, and rewriting them
by interpretation at a close gate is how a rule set stops meaning anything.

### What is not a finding

- **Style the file does not mention.** Naming, formatting, import order — if
  `03-code-patterns.md` is silent, so are you. This is not a code review; see
  `code-review.md` for the judgment layer that *is*.
- **Code the diff did not touch.** Pre-existing violations are a backlog item,
  not this work item's failure. Note them once, in passing.
- **A pattern you would have written differently.** Not yours to relitigate here.
- **An empty or absent `## Machine-checkable rules` section.** Expected on a
  young project. Say so in a line and move on.

---

## 4b. Layer 4 — the three semantic lenses

Layer 3 asked whether the diff violates a pattern the project *wrote down*. Layer 4
is the semantic pass nothing else in the gate can do: **does the diff implement the
spec, follow the repo's patterns, and omit nothing the spec requires.** It runs
after Layer 3, on the same staged diff, and its findings are judged by the same
verdict rule no matter which execution path produced them (`work-item-close.md` §2
chooses the path; this section owns the lenses).

### The lenses

Each lens is a reading of the staged diff. Apply them as written — they are the
contract, not a summary of one:

- `fidelity` — the diff does something `spec.md` does not ask for, or does
  something it asks for **in a way that contradicts the description** — existing
  behaviour that diverges, not behaviour that was never attempted. **An outright
  absence is never a fidelity finding**, however naturally "fails to do something
  it asks for" reads as covering it too — that case belongs to `absence`, below,
  full stop; a fidelity finding needs a hunk that does the wrong thing, not the
  lack of one. Report **every** genuine drift as a finding, whether or not report
  §7 discloses it — declaration is not a gate on whether this is a finding, it is
  a field *on* the finding. Set `declared_in_report_s7` from the report's own §7
  text, not your reconstruction of what the implementer meant; the verdict rule
  below, not this lens, decides what a `true` or `false` value means for the
  close.
- `pattern` — the diff contradicts a convention the repo follows **in fact**, not
  one written down — which means the diff and the four documents alone cannot
  answer this lens; **read the relevant neighbouring files from the committed
  tree** (`git show HEAD:<path>`, never the raw worktree filesystem — an
  explained `partial` stage, `work-item-close.md` §3, can leave uncommitted
  edits sitting there that were never meant to inform this judgment) to
  establish what the repo actually does before judging against it. (This is the
  one lens the inline path and the delegated path both need read access
  beyond the diff for — the input list below is a floor, not a ceiling, here.)
  The written half is `03-code-patterns.md`, and that half is Layer 3's — do not
  re-run it. What is left is the defect classes a documented rule never captures:
  guards that cannot fire (or fire always), ordering that inverts the contract,
  two files contradicted by the same change, usage strings that disagree with
  what the code does, prose claiming behaviour nothing implements, a gate whose
  status is discarded. Same calibration rule as Layer 3: judge against what is
  there, not what you would have written.
- `absence` — the spec requires an artifact, command, or wiring the diff does not
  contain at all. Not "could be better" — **absent**. Every case where the diff
  never attempted something the spec required lands here, even one that could
  also be read as "fails to do something spec.md asks for" — `fidelity` excludes
  it by definition, above; there is no finding that legitimately belongs to both.

### The finding schema

Every finding, from either execution path, is exactly:

```text
{id, lens, claim, evidence: {file, line?}, declared_in_report_s7}
```

`id` is a stable identifier the reader assigns (delegated path only — see the
refuter note below; the inline path has no separate refuter pass to key
against, so `id` is not load-bearing there). `lens` is one of the three ids
above; `claim` is one sentence naming the deviation and what it costs;
`evidence.file` points into the staged diff, always, for `fidelity` and
`pattern` findings. For `absence`, it names the path where the missing
artifact should exist instead — which may not appear in the staged diff at
all, since the whole point of an absence finding is something the diff never
contains. `line` is required for `fidelity` and `pattern` findings but
optional for `absence`, same reason: there may be no line to cite, only the
file (real or prospective) where it should exist. Never invent a line number,
or a diff-anchored file, to satisfy the shape. `declared_in_report_s7` is answered from report
§7's own text.

### The verdict rule — identical on both paths

A `fidelity` finding with `declared_in_report_s7: false` **halts** with the
`[fidelity]` tag and §6's recovery menu — the report is wrong about the one thing
this gate exists to check. Everything else — `pattern`, `absence`, and a
`fidelity` finding §7 *does* declare — is **advisory**: the surviving findings are
written to `<work-item-dir>/verify.md` and echoed in the close summary, and
spine-close code review (`references/code-review.md`) reads that file as an input.
Advisory means advisory: no pattern or absence finding halts, delays, or re-runs
this close (D5).

**If a `fidelity` and an `absence` finding land on the same underlying gap**
(independent readers can both notice it despite the lenses' partition above) —
normalize before applying the halt: an absence-shaped gap is `absence`, never
`fidelity`, regardless of which lens's reader produced it. Re-tag rather than
drop; the claim and evidence carry over.

**Truncation itself halts, independent of any individual finding's content.**
The delegated fidelity reader is capped at 5 findings (a cost bound, not a
completeness claim); on a diff with more genuine deviations than that, an
omitted one being undeclared would defeat this gate's one hard guarantee
silently. `fidelity_truncated: true` on the delegated return means the reader
could not certify it reported every genuine fidelity deviation — treat that
as a `[fidelity]` halt on its own, naming truncation as the reason, even when
every finding actually returned is declared. The inline path has no schema
cap to hit — a free-form judgment reports what it finds, so this halt class
does not arise there.

### The relationship to its neighbours, so no axis ships twice

| | Reads | Asks | Stops the close? |
|---|---|---|---|
| Layer 3 | diff vs `03-code-patterns.md` | a **documented** pattern violated | yes (`[rule]`) |
| Layer 4 `fidelity` | diff vs `spec.md` + report §7 | is it the code the item was supposed to write, and does the report say so honestly | yes, undeclared only (`[fidelity]`) |
| Layer 4 `pattern` / `absence` | diff vs conventions-in-fact / spec artifacts | what a documented rule never captures | no — advisory to `verify.md` |
| code-review (spine close) | the spine's whole diff | is it **good** code; did the *intent* drift | no — advisory, dispositioned |

Layer 4 catches a defect while the item is still open that code review would only
see once the spine's diff is one thing; code review still owns craft and
spine-level intent. Neither re-runs the other.

### Inline path — every harness

After Layer 3, read the staged diff, `spec.md`, `handoff.md`, report §7 and the
patterns file, apply the three lenses yourself, and emit findings in the schema.
`pattern`'s neighbouring-files read (§4b above) comes from the COMMITTED tree
only (`git show HEAD:<path>`), never the raw worktree filesystem — an
explained `partial` stage (`work-item-close.md` §3) can leave uncommitted
edits sitting there that were never meant to inform this judgment, in either
direction. This is not a degraded mode — it is the same judgment with the
host's own context, and it is the universal fallback (`work-item-close.md`
§2).

### Delegated path — Claude Code on Anthropic only

`ossify/workflows/verify-work-item.js`: one reader and one refuter per lens, six
Sonnet agents, models pinned in the script (readers medium, refuters low). The
script carries no lens text — the close passes the three lenses and the input
paths in `args`. Every reader and refuter has ordinary tool access to the
worktree beyond the fixed input list — the `pattern` reader specifically is
told to use it, reading relevant neighbouring files before judging, the same
requirement as the inline path above. It returns
`{findings, agents_run, fidelity_truncated}`; it writes nothing, calls no
`oss` verb, touches no git. Apply the verdict rule
above to what returns exactly as if you had read the diff yourself: a
delegated run changes who read the diff, never what the close asserts.

**Refuter output is never trusted as free text.** The reader assigns each
finding a stable `id`; the refuter is given the same findings back and returns
exactly one verdict per `id` — `{id, retain, declared_in_report_s7}` — never a
re-serialized finding, and never fewer or more verdicts than there are
findings. The script accepts a survivor only if coverage is exact (every
reader `id` gets one verdict, no extra ids, no duplicates) and its `id` is
actually a member of what that lens's reader produced; a fabricated id, a
truncated response, or a duplicate nulls the whole lens rather than being
silently absorbed. `claim` and `evidence` always come from the reader's own
object — the refuter's only write access is `declared_in_report_s7`, so it can
correct a reader's mistagging of that one field without having to discard an
otherwise-real finding to do it, and it can never touch anything else. This is
deterministic verdict-checking, not judgment, and it is enforced in the script
— see `tests/test-workflows.sh` T3.

---

## 5. Source-tagged errors

Every surfaced error starts with a **literal** tag naming which layer produced
it. The tag is how a reader knows whether to look at the code, the report, or the
criterion:

```text
[AC]                 AC-3 `<command>` expected `exit 0`, observed rc 1
[report cross-check] report does not account for: AC-2
[rule]               <file>:<line> - <the documented pattern it violates>
[fidelity]           <file>:<line> - the diff deviates from spec.md: <claim>; report §7 does not declare it
[fidelity]           the delegated reader hit its 5-finding cap and could not certify every genuine deviation is reported (truncated:true)
```

Do not invent a fifth tag, do not translate one into prose, and do not merge two
layers' findings under one tag. Four tags, spelled exactly as above — the two
`[fidelity]` lines are the same tag on two distinct triggers (an undeclared
finding, or unresolvable truncation), not a fifth.

---

## 6. The recovery menu

Surfaced on any halt, **never auto-selected**. Present all three with their real
consequences and stop:

1. **Re-dispatch the implementer with the failure.** The default when the code is
   wrong. The failure detail goes into the handoff as a clarification, because a
   fresh worker has no memory of the previous attempt. The execution lane's
   3-dispatch cap still applies.
2. **Accept with a recorded deferral.** The choice when the gap is real, bounded,
   and not worth another round now. It is *recorded*, not waved through — an
   accepted failure that leaves no trace is an unaccepted failure that nobody
   will find.
3. **Fix the criterion.** Only when the **criterion** is wrong — never when the
   code is wrong. Rewriting a criterion to match what was built is how a gate
   becomes decorative, and it is silent: every later run passes.

   **Which criterion depends on the layer that halted**, because the four layers
   are judged against four different documents:

   | Halting layer | The criterion is | Fixing it means |
   |---|---|---|
   | `[AC]` — Layer 1 | the AC in `spec.md` | re-author the AC: a malformed expectation, or a command that never tested what the AC describes |
   | `[report cross-check]` — Layer 2 | the report's AC table | the report under-accounts; the fix is in `report.md`, not the spec |
   | `[rule]` — Layer 3 | the pattern in `03-code-patterns.md` | amend the pattern in the memory bank — with the user, since it binds every future spine |
   | `[fidelity]` — Layer 4 | the deviation is real and §7 does not declare it | re-dispatch: the code aligns to the spec, or §7 declares the deviation honestly; only where the *spec itself* is wrong, back through `/plan-spine` — never amended at this gate |

   A Layer 3 halt offered "re-author the AC" is being offered the wrong document:
   no AC is involved, and the honest options are amend the pattern, or fix the
   code. **A pattern amendment is never a quiet by-product of one work item's
   gate** — it changes the rule for everything after it.

The user picks. This is not a disposition row and the auto-apply policy does not
reach it (`work-item-close.md` §5).

---

## 7. Anti-patterns

- **Running a layer on a placeholder path.** `$spec`, `$report` and `$wt` were
  resolved for you; `<spec path>` is a filename.
- **Gathering all failures before halting.** §1.
- **Re-implementing the zero-tests guard**, or expecting it on a non-`exit 0`
  expectation (§2).
- **Grepping lib output for `[report cross-check]`** (§3).
- **Reading rc 2 as a code failure.** It is a criterion failure (§2).
- **Treating a missing `auto:` AC in the report as a reporting nit** (§3).
- **Auto-selecting a recovery option**, or presenting only one (§6).
- **Re-authoring an AC because the code failed it** (§6).
- **Running `user:` rows here** (§2).
- **Halting on a pattern or absence finding.** Advisory by decision (§4b); the
  only Layer 4 halts are an undeclared fidelity deviation and the delegated
  fidelity reader's own truncation (`fidelity_truncated: true`) — both under
  the same `[fidelity]` tag.
- **Letting `verify.md` advisories evaporate.** They are spine-close code
  review's input; advisory does not mean disposable.
