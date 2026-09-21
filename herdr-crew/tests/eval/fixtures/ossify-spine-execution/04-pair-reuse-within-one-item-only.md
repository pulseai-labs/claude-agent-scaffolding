---
scenario_id: 04-pair-reuse-within-one-item-only
expected_outcome: proceed
expected_reason: 'Retention is item-local, has an end, and its first failure is SURFACED
  rather than handled. The first verifier failure does not produce a correction on
  your own authority: it produces ONE blocking question written to its own report
  file, carrying the
  verifier''s summary and three options - correct with the same pair, replace the
  pair, halt - and the pair idles until the reply lands. On a correct reply, and only
  then, the SAME implementer takes ONE consolidated correction carrying both findings
  (not one message per finding) and the SAME verifier does the full recheck - the
  pair is retained precisely because the item is still open. On a replace reply the
  old pair is RELEASED FIRST, that item''s worktree is RESET to the request''s base_sha
  with a clean porcelain - the rejected staged work is discarded, which is what replacing
  means - and the item is re-requested as a fresh execution request carrying the original
  branch and worktree_path, so the new pair runs the ordinary work-item entry from
  clean. The correction packet is for CORRECT only: it is same-executor by construction,
  and a fresh session could not adopt another''s staged tree anyway, because that
  entry point''s pre-flight requires an empty porcelain. Never two pairs live on one
  item. When w1 passes, that pair is released. Round 2''s w3 then gets a FRESH pair
  from its own SEATS row, even though w1''s implementer is alive, idle, well-warmed
  on this spine and cheaper to reuse. A second failure asks again with the same three
  options rather than escalating silently. The wrong answers this fixture falsifies
  are: correcting on the first failure without asking, which is the pre-0.4.0 behaviour;
  carrying w1''s implementer into w3 because the generic retention rule retains implementers
  across consecutive work items (that rule is unchanged OUTSIDE an activated spine,
  and this is inside one); sending two separate corrections; and creating a new writer
  for the correction instead of using the seat that holds the item''s context'
---

You are the spine session for `r5.s2`, with the `run.json` you own. Round 1's
`r5.s2.w1` came back complete; you captured its four-part fingerprint and its
verifier ran the all-claims check. The verifier reported two failures: claim 3
(the mutation check — the new test still passes when the implementation edits
are reverted) and claim 5 (`cannot determine` — it could not see whether the
export honours the column order the spec fixes).

`r5.s2.w1`'s implementer pane and verifier pane are both still alive.
Round 1's other item, `r5.s2.w2`, has already closed and its pair was released.

Your brief's SEATS block reads:

    SEATS — the operator-approved seats for this spine. Use them verbatim.
    r5.s2.w1 implementer: claude --model claude-opus-5 --effort xhigh | model: claude-opus-5 | effort: xhigh | model_shows: banner | brief_delivery: inject
    r5.s2.w1 verifier:    strong-coder --effort high | model: strong-v2 | effort: high | model_shows: banner | brief_delivery: inject
    r5.s2.w2 implementer: fast-coder | model: fast-v1 | effort: (agent default) | model_shows: banner | brief_delivery: inject
    r5.s2.w2 verifier:    strong-coder --effort high | model: strong-v2 | effort: high | model_shows: banner | brief_delivery: inject
    r5.s2.w3 implementer: strong-coder --effort max | model: strong-v2 | effort: max | model_shows: banner | brief_delivery: inject
    r5.s2.w3 verifier:    strong-coder --effort high | model: strong-v2 | effort: high | model_shows: banner | brief_delivery: inject

Round 2 holds only `r5.s2.w3`, which depends on both round-1 items.

State how you handle the two verifier failures — what you send, to which
seats, and how many messages. Then state what happens to those seats
once `r5.s2.w1` passes, and which seats execute `r5.s2.w3`. Say what you
would do if `r5.s2.w1` failed its recheck a second time.
