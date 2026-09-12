# The return contract

Depth for SKILL.md §9. Your run ends with exactly one of two JSON shapes. They are
**exact-string structural contracts, not paraphrase targets** — the orchestrator
parses them, and every deviation below is a contract violation on its own:

- a wrong key name (`status` for `mode`, `questions` for `gaps`, `report` for
  `report_path`),
- a missing required key,
- a value outside a declared enum, however sensible the substitute reads,
- prose without the JSON envelope.

---

## 1. The two shapes, verbatim

**Complete** — the execution loop ran to the end:

```
{"mode": "complete", "report_path": "<abs path to report.md>", "summary": "<one-line>", "stage_status": "all_staged | partial | none"}
```

**Gaps surfaced** — pre-flight stopped the run and no work was done:

```
{"mode": "gaps-surfaced", "gaps": [{"section": "<ref>", "question": "<concrete question>", "severity": "blocking | nice-to-have"}, ...]}
```

`mode` is literally `"complete"` or `"gaps-surfaced"` — never `failed`, `blocked`,
`complete-with-fail`, or `clarification-needed` (preamble). There is no third
mode; the nuance you would invent one for belongs in `summary` and in the report.

**A correction continuation returns this same complete shape.** The one flow
that might look like it needs a third mode — a rejected item handed back for
targeted repair (`references/correction-continuation.md`) — does not get one:
the loop ran, the report was updated, the work was staged, so `mode` is
`complete` and what changed is described in `summary` and in the report.

---

## 2. Complete-mode fields

| Key | Rule |
|---|---|
| `mode` | The literal `"complete"`. |
| `report_path` | **Absolute** (starts with `/`) and **ends in `report.md`**. |
| `summary` | One line. On all-pass, what the item delivered. On any fail, **name the failing ACs** and point at the report. |
| `stage_status` | Exactly one of `"all_staged"`, `"partial"`, `"none"` (SKILL.md §8). |

All four keys are required, every time.

```
{"mode": "complete", "report_path": "/abs/path/to/work-r1.s2.w1/report.md", "summary": "AC-1,2,4 pass; AC-3 fail (anchor text mismatch) — see report", "stage_status": "all_staged"}
```

**Complete-mode fires even when verification failed.** `mode` reports the
execution loop, not the AC outcomes: the loop ran, the report was authored, the
work was staged. AC outcomes live in `## 3. ACs — verification status` and are
named in `summary`. Downgrading `mode` on a failed AC hides a real report behind an
unparseable status, and the orchestrator's recovery paths all assume they can read
the report you just wrote.

---

## 3. Gaps-mode fields

`gaps` **must be non-empty.** An empty array means "no gaps", and no gaps is the
complete path — an empty-array gaps return is a run that did nothing and said
nothing.

Every element carries all three of `section`, `question`, `severity`.

| Key | Rule |
|---|---|
| `section` | Where it lives — `"spec §3 — decisions"`, `"AC-2"`, `"pre-flight — worktree state"`. |
| `question` | A concrete sentence someone can answer. Not a restatement of your confusion. |
| `severity` | Exactly `"blocking"` or `"nice-to-have"` — never `high`, `low`, or `critical` (preamble). |

```
{"mode": "gaps-surfaced", "gaps": [{"section": "AC-2", "question": "Should a duplicate heading get a numeric suffix, or should the run exit nonzero?", "severity": "blocking"}, {"section": "spec §4 — files to modify", "question": "Does the renderer live in tocgen/render.py or stay inline in __main__.py?", "severity": "nice-to-have"}]}
```

A `nice-to-have`-only pre-flight does **not** return gaps-mode — proceed, take the
defensible default, and record it in the report. Mixed severities do return
gaps-mode, carrying the nice-to-haves along so one round-trip answers both.

---

## 4. What gaps-mode is not for

Three things that feel like gaps and are not. All three go in the report.

1. **Implementation difficulty.** "This is harder than the estimate suggests" is
   not a gap. A gap is missing *information*; difficulty is missing *time*, and
   the orchestrator learns about it from your report and your `summary`.
2. **Architectural disagreement.** The spec is locked — it went through planning
   and, on a bone spine, an adversarial audit before it reached you. Thinking the
   design is wrong is worth saying, in `## 6. Decisions during execution` or
   `## 7. Deviations from spec`, where it reaches the reviewer with the evidence
   of having built the thing attached. Re-litigating it as a blocking gap stalls
   the round and arrives without that evidence.
3. **Tooling failures.** A missing runner, a broken import in an unrelated module,
   a flaky network fixture. Note it in `## 8. Blockers and advisories` and work
   around it if you can. The one exception is a *pre-flight* environment gap —
   gate 3's dirty or missing worktree — which is a gap because it makes the run
   itself invalid.

And the timing rule that subsumes all three: **gaps-mode is a GATE-PHASE exit,
and the gate phase is SKILL.md §3 + §4** — pre-flight and the RED gate, which
runs only on the success path out of pre-flight and can still stop the run.
**Once §4 passes, the only terminal mode is `complete`.**

The line sits after §4 rather than after §3 because of what it protects: nothing
is staged until §5, so a gate-phase exit strands nothing, while a late gaps-mode
return strands implemented work with no report explaining it.

---

## 5. Where the return surfaces

- **Mode A** — the final assistant message. Put the JSON there as its own block,
  last. Anything after it is noise the parser has to survive.
- **Mode B** — the Task tool's return payload, which is the same final message.

The shape is identical in both. The harness handles the difference; you do
not.
