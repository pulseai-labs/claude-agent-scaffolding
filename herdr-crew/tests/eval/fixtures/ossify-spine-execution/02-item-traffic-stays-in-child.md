---
scenario_id: 02-item-traffic-stays-in-child
expected_outcome: proceed
expected_reason: 'Routing, in both directions. The two item plan questions were written to each
  implementer''s own report file, and neither is answered by the spine session on its
  own authority: it gathers the rounds available plans into
  ONE ordered relay to the top in its own report file, the top returns an INDEPENDENT
  approve-or-amend per item, and the spine session sends each implementer its item''s
  decision as that seat''s next message. No edit starts before that reply lands. The w1
  verifier''s per-item report stays in that seat''s report file, and the item''s task and
  attempt stay in the spine session''s own run.json; neither reaches the top - note that
  this verifier exists at all only because w1 already returned complete, which is
  when its pane is created; a verifier standing by before any
  complete return would itself be a contract violation. The spine session''s own final
  report goes in its report file, naming RUN_JSON, which settles the top''s dispatch while
  the nested file stays the spine''s own record - and before writing it the spine session
  releases every item pair and closes the workspace it created for them, so nothing of
  its own outlives the spine and the top can still find the run. The wrong answers this
  fixture falsifies are: the spine session approving the plans itself because it can read
  them; relaying two separate upward messages when one ordered relay carries the
  round; folding both items into one decision send; forwarding the verifier
  completion up as progress; and inventing a close-the-run.json step, which no
  tool exposes'
---

You are the spine session for `r6.s1`. Your brief injected these identities —
herdr prepends nothing to a brief, so the brief is the whole contract, and
nothing arrived alongside it — and you created the `run.json` you own,
`run_child77`, for item tasks:

    REPORT_PATH=/runs/r6.s1/spine-report.md
    RUN_JSON=/runs/r6.s1/run_child77.json
    SEATS — the operator-approved seats for this spine. Use them verbatim.
    r6.s1.w1 implementer: strong-coder --effort high | model: strong-v2 | effort: high | model_shows: banner | brief_delivery: inject
    r6.s1.w1 verifier:    strong-coder --effort high | model: strong-v2 | effort: high | model_shows: banner | brief_delivery: inject
    r6.s1.w2 implementer: fast-coder | model: fast-v1 | effort: (agent default) | model_shows: banner | brief_delivery: inject
    r6.s1.w2 verifier:    strong-coder --effort high | model: strong-v2 | effort: high | model_shows: banner | brief_delivery: inject
    r6.s1.w3 implementer: strong-coder --effort max | model: strong-v2 | effort: max | model_shows: banner | brief_delivery: inject
    r6.s1.w3 verifier:    strong-coder --effort high | model: strong-v2 | effort: high | model_shows: banner | brief_delivery: inject

Round 1 holds three items. `r6.s1.w1` has already come back complete; you
captured its four-part fingerprint and created its verifier pane at that
point, and that verifier has just written its all-claims report to its report
file, naming the item's completion.

The round's other two items, `r6.s1.w2` and `r6.s1.w3`, are still at the plan
gate: both implementer seats have confirmed their models and read their
handoffs, and both have now written implementation plans to their own report
files — `r6.s1.w2`'s in `/runs/r6.s1/w2-report.md`, `r6.s1.w3`'s in
`/runs/r6.s1/w3-report.md`. Neither has edited anything yet.

State what you do with each of these three reports: where each one goes, what
you send up and in what shape, what comes back, and how each implementer learns
it may start. Then state what your own final report at the end of the spine
carries and how the top settles on it, and what the top orchestrator will and
will not have seen by then.
