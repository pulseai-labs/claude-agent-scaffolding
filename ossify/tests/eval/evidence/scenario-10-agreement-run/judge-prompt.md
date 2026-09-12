# Comparison-judge prompt

**Everything below the `---` is the prompt.** This header is not part of it.

Substitutions the original run made: `<repo-root>` was the absolute path of the
checkout, and the two verdict files were referenced by absolute path (the judge
read them itself rather than receiving them pasted). The scenario was pasted
verbatim from `scenario.md` below its `---`.

The judge was asked one question beyond the comparison — **ambiguity or
misread** — because that distinction is what decides whether a divergence is a
finding against the prose. A judge that only reports disagreement manufactures
work from planner error.

**Why it judges five axes and not four.** The planners were asked for four
judgments, but scenario 10 names five things to agree on, and two of them
(increment type, D-class) are answered at *different rungs of the same ossify
ladder*. A judge told to compare "spine class" returns one verdict for both, so
increment type is never scored and any claim about it is the reader's inference
from the planners' rung-1 text. Separating them makes it a verdict.

What surfaces rung-level disagreements is not this separation — the rung-3 split
sits inside the D-class axis, which the fold never merged — but the standing
instruction below to report `secondary` divergences.

---

You are an LLM-as-judge for an inter-planner agreement run. Two independent planners were given the SAME scenario and the SAME instruction, and each read the ossify skills at <repo-root>/ossify/skills/ (plan-release, plan-spine, start) before answering.

Your job is NOT to grade correctness. It is to compare the two verdicts across the five things the acceptance scenario names, and report where they agree and where they diverge.

The scenario under test is `docs/conventions/evolutionary-architecture-playbook.md` §13.10: *two independent planners derive the same stage, increment type, D-class, Risk tier, and mandatory controls from the same evidence.* The first four are the playbook's four independent axes (§2). ossify does not carry the playbook's vocabulary, so compare each axis at the ossify judgment that answers it:

1. **stage** -> the release ladder label
2. **increment type** -> the class ladder's rung 1, the journey gate: user-facing spine vs `internal-enabler`
3. **D-class (architecture delta)** -> the class ladder's rungs 2-3: bone-ness
4. **Risk tier** -> the risk gate (warranted or not; defect family; touch surface)
5. **mandatory controls** -> the control checklist

Axes 2 and 3 are answered at different rungs of the SAME ossify ladder. Judge them separately anyway: a planner can agree on the final class while disagreeing about a rung. Read each planner's rung-1 and rung-2/3 reasoning on its own terms.

For each of the five return: `agree` (the operative judgment is the same) or `diverge` (the operative judgments differ), plus a one-sentence statement of what each said. If a planner did not derive an axis at all, say so explicitly rather than inferring their answer.

Then, for every divergence, answer one further question by reading the owning prose yourself: **is the divergence a judgment ambiguity in the shipped prose, or did one planner simply misread a rule that is unambiguous?** Quote the governing sentence and say which. This distinction is the whole point of the run — an ambiguity is a finding against the prose; a misread is not.

Also report any divergence in *secondary* reasoning that does not change one of the five judgments but rests on a different reading of a rule — flag these separately as `secondary`.

Return one JSON object and nothing else:

{"axes":{"stage":{"verdict":"agree|diverge","a":"...","b":"..."},"increment_type":{...},"d_class":{...},"risk_tier":{...},"mandatory_controls":{...}},"divergences":[{"axis":"...","kind":"prose-ambiguity|misread","governing_quote":"...","source":"<file> §<n>","explanation":"..."}],"secondary":[{"topic":"...","a":"...","b":"...","kind":"prose-ambiguity|misread","governing_quote":"...","source":"...","explanation":"..."}],"agreement_count":N,"notes":"<two sentences max>"}

SCENARIO GIVEN TO BOTH:
<scenario.md, verbatim>

PLANNER A's VERDICT is in the file <path to planner-a.md>
PLANNER B's VERDICT is in the file <path to planner-b.md>

Read both files, then read whatever owning prose you need under <repo-root>/ossify/skills/ to classify each divergence. JSON only.
