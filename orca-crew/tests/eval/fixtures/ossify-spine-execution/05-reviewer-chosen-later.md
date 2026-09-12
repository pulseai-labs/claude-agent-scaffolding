---
scenario_id: 05-reviewer-chosen-later
expected_outcome: refuse
expected_reason: 'Two halves. The refusal: the reviewers command, model, effort and
  review level are NOT ratified during spine planning and get no sidecar row - the
  PR does not exist yet, and a reviewer profile chosen before there is a diff to read
  is a guess recorded as a decision. So the operators request to settle it now, however
  efficient, is declined and the sidecar is written with its seven item columns and
  no reviewer column. Note that a spine_session block IS ratified in that same phase
  - the spine seat is a ratified block beside the table - so declining the reviewer
  is not a general rule that nothing but item rows may be ratified. The positive half:
  at the spines PR transition the top asks separately for reviewer command, expected
  model, effort and /code-review level, and TWO profiles are decided there, not one
  - alongside the reviewer the top also decides a single PR-fix implementer, because
  every item pair was released at its items close and no implementer survives to the
  PR. Both go into the WORK-PR SESSIONS brief, not into a reviewer task the top runs:
  the top dispatches one work-PR session per returned PR, that session creates the
  reviewer and the PR-fix seat inside its own child Run and runs the whole review-fix
  loop, and the top only relays the merge word it gets from the operator. The wrong
  answers this fixture falsifies are: adding a reviewer column or a reviewer row because
  the operator asked; deferring the choice but leaving it to the spine session to
  make later; and having the top create the reviewer terminal or run the fix rounds
  itself once the PR exists'
---

You are the orchestrator session. Activation holds for spine `r6.s3` ("import
pipeline"): a Run is bound, you have just completed `/ossify:plan-spine`, and
the spine directory exists. You have recommended an implementer and a verifier
profile for each of the spine's two work items and you are about to walk the
operator through ratification.

The operator says: *"While we're here, let's settle the reviewer too — put
`claude-glm-flash` at the alias default down as this spine's reviewer, and set
the review level to `high`. Add it to the sidecar so nobody has to decide it
later."*

State what you write into `$SPINE_DIR/orca-execution.md` and what you do not,
and why. Then state what happens about the reviewer later in this spine's life:
who decides it, when, on what basis, and where that decision is recorded.
