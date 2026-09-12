# Real-use findings (the mandatory pilot-evidence input)

Depth for SKILL.md §4. Spec §5.2 lists four inputs to release planning; this is
the one that is **asked** rather than read, and the one most easily skipped.

> **Real-use findings since the last release** — what broke, what annoyed, what
> you reached for and did not find *while actually using the product*.

It is **mandatory** from Release 1 onward. A release planned without it is planned
from a memory of the plan.

---

## 1. Why it is an input at all — the motivation loop

The methodology's premise is that usable software early keeps the builder using
the product, and using the product is what tells you what to build next. That loop
only closes if the evidence from using it re-enters planning as a **first-class
input** rather than as an occasional good idea.

Making it mandatory does something the feature map cannot: it forces the question
*"did you actually use it?"* to be asked out loud, every release. A run of
releases with no findings is not a clean bill of health — it is the signal that
the loop is broken, and it should be named as such (see §5).

This is also the pilot evidence contract in miniature: "the user reports the
motivation loop working (using the product between spines)" is one of the pilot's
success criteria, and this input is where that report lands.

---

## 2. Collecting them

Ask directly, and ask in the *user's* terms — not "any defects?" but:

1. **What broke?** Anything that failed, errored, or produced a wrong result while
   you were using it for real.
2. **What annoyed you?** Friction, extra steps, waiting, re-typing, having to
   remember something the product should remember.
3. **What did you reach for and not find?** The missing capability you expected to
   be there. This is the highest-signal question and the one nobody volunteers.
4. **What did you route around?** Manual steps, a script on the side, editing
   state by hand. A workaround is a finding with a workaround attached.
5. **What did you stop using, and why?** Abandonment is the loudest finding
   available, and the easiest to not mention.

Keep them concrete and short. *"The backtest takes four minutes so I stopped
iterating"* is a finding; *"performance could be better"* is a mood.

Findings are **evidence, not requests**. Do not let them arrive pre-converted into
solutions — "add a cache" hides the observation that produced it, and the
observation is what has planning value.

---

## 3. Recording them

_Dispatcher invocations below are `"$oss_bin" …` — the calling skill resolves `oss_bin` once (recipe: the plugin's `rules/dispatcher-path.md`); if it is unset in your context, resolve it there first._

Attach them to the release being planned:

```bash
"$oss_bin" release_set_meta "$rel" '{"real_use_findings":["backtest takes ~4 min so iteration stopped","had to hand-edit the saved strategy JSON to change a rule","no way to compare two runs side by side"]}'
```

The release record must exist first — collect the findings in §4 of the flow, then
write them once `"$oss_bin" release_add` has minted the id. `release_set_meta` accepts
only the five known patch keys (`exit_criteria`, `spine_dag`, `ledger_budget`,
`next_sketch`, `real_use_findings`) and silently drops anything else, so a typo in
the key looks exactly like success — check it back with
`"$oss_bin" get '.releases[-1].real_use_findings'` if you are unsure.

Findings that describe missing or broken **value** also become feature-map entries
immediately, so they compete for selection on equal terms:

```bash
"$oss_bin" feature_add "compare two backtest runs" "iterate on a strategy without losing the previous result" flesh real-use
```

The `real-use` source tag matters at the next groom: it marks entries that came
from evidence rather than from imagination, and those are the ones that earn a
deepening pass (`references/feature-map-grooming.md` §4).

---

## 4. What they change in this planning pass

- **Selection.** A finding with real cost outranks a feature nobody has missed.
- **Deepening passes.** They are the *only* legitimate trigger for one. "Slow" is
  not evidence; "I stopped iterating because it takes four minutes" is — and it
  carries the before-measurement the deepening pass will need.
- **Fake-ledger pressure.** A finding that lands on a known fake is its
  replacement trigger firing. Check the fake ledger (`"$oss_bin" get '.fakes'`) against
  the findings and move any fired trigger onto the map.
- **Risk-gate and bone review.** A finding that reveals a surface nobody
  registered is a bones-registry gap — the fix belongs in the registry (via the
  spine that lands it), not only in this release's plan.

---

## 5. Release 0, and empty findings

**Release 0: n/a.** There is no product to use yet, exactly as the previous-retro
input is n/a. Say "n/a — Release 0" and move on; do not invent findings from the
spec, and do not skip the *question* silently in later releases because it was n/a
once.

**Later releases with genuinely zero findings** are a yellow flag, not a green
one. Say it out loud: *"No real-use findings since Release 1 — did you use the
product between releases?"* Either the answer is "no, I did not" (the motivation
loop is not closing, and that is the most important thing on the table today), or
the answer is "yes, and it was fine" — which is itself a finding worth recording.

Record the empty case rather than omitting the key, so the next groom can see the
run:

```bash
"$oss_bin" release_set_meta "$rel" '{"real_use_findings":["none reported - product used, no friction surfaced"]}'
```

---

## 6. Anti-patterns

- **Skipping the input** because the last release closed recently. Mandatory.
- **Accepting solutions instead of observations.** Ask what happened, then decide
  what to build.
- **Treating zero findings as a pass.** §5.
- **Filing every finding as a defect.** Most are missing value, and missing value
  belongs on the feature map, not in a bug list.
- **Recording them only in prose in RELEASE.md.** State is authoritative; the
  document is a record.
- **Letting a finding that fires a fake's replacement trigger sit unrecorded.**
  Deferred truth becoming permanent silently is the exact failure the fake
  lifecycle rules exist to prevent.
