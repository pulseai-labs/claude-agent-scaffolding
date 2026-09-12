# Rubric: ossify-spine-execution

Score each 1-5 (5 criteria). Pass = all ≥4. `expected_outcome` vocabulary:
`proceed` | `refuse` | `halt`. `proceed` = the described arrangement is what the
skill prescribes and the output carries it out. `refuse` = the arrangement the
scenario proposes is wrong and the output declines it and states the prescribed
arrangement instead. `halt` = the phase stops before launching anything and asks
the operator, without substituting a workable-looking alternative.

**Every criterion is scored on every fixture.** A criterion whose own condition
never fires on a fixture is scored on whether the output stayed correctly silent
about it — and an unexercised criterion **caps at 4** (consistent with the
contract, not demonstrated by this scenario). **5 requires the scenario to have
actually exercised it.** There is no N/A.

**Score only what the scenario supplies.** If the fixture body does not state a
fact, an output that does not decide it is not penalised; an output that invents
that fact and decides on it is.

1. **Activation and the three layers.** The phase applies only when all four
   facts hold about the current session — orca-crew is the top orchestrator, a
   Run is bound, this session just completed `/ossify:plan-spine`, and a
   concrete spine directory exists — and installation, environment, or finding a
   sidecar on disk activate nothing. When it does apply, the top ratifies and
   writes, then starts **exactly one** spine session and launches **no** item
   terminal; the spine session owns both item terminals for each item; each item
   terminal works one item. A top orchestrator that launches or supervises an
   item terminal is a wrong answer, as is a spine session that hands item
   supervision back up. The spine session stops at the final round barrier and
   never runs the close on its own initiative; **the top dispatches
   `/ossify:close` as a task** — to a fresh terminal it creates, never the spine
   driver's — and waits on its `worker_done` for every PR it opened, one per
   hosting repo, or `closed`. Each returned PR then gets its own **work-PR
   session**, created by the top in that PR's hosting-repo worktree, which owns
   the reviewer and PR-fix seats in a child Run of its own and merges on the word
   the top relays; **only the top talks to the operator**, and every other seat
   asks upward one hop. The top running the close itself is a wrong answer
   (`close` is a dispatched command), so is the top reviewing, fixing or merging a
   spine PR in its own session, and so is treating the spine session's completion
   as a PR.
2. **Run routing keeps item traffic in the child.** The spine session creates
   and binds a child Run for item tasks; child task creation, worker start,
   dispatch and check name the child Run explicitly; spine-level questions go up
   naming the parent Run; replies to item questions go back on each original
   child message id; and the spine session's final completion uses the
   **injected parent** task and dispatch ids so the parent Dispatch settles
   while the child Run is still bound. The parent inbox sees the relayed plan
   decision, genuine spine-level questions, and one final completion — never raw
   item plan traffic or per-item completions. Putting item tasks in the parent
   Run, or letting per-item completions reach the top, is a wrong answer.
3. **Profiles are bound by the sidecar and never substituted.** Each item's
   implementer and verifier are launched from that item's ratified row — the
   exact terminal command, expected model and effort — with the model confirmed
   from the launch banner and the first reply and the effort carried by the
   launch argument. The spine session's own seat is ratified the same way, as a
   `## Spine session` block **beside** the item table — command, expected model,
   effort, reason — whose absence halts and whose presence changes nothing about
   the item-set check. Validation runs **immediately before each item terminal is
   created**, not once at the start: `git hash-object SPINE.md` against the
   recorded plan digest, one complete row per planned item, no row for an item the
   plan does not have, and three **value** checks — `ratification` reading exactly
   `operator-approved`, `ratified_in_run` equal to the injected parent Run,
   `spine_id` equal to the spine being run; any failure halts **that launch** and
   asks. Treating step 1's early pass as covering a later launch is a wrong
   answer, and so is repairing a drifted sidecar from inside the spine session. Treating any of those three as a presence check is a
   wrong answer: a field that merely exists admits `rejected`, another Run's
   ratification, and another spine's sidecar. Substituting a nearby
   profile, an alias, or a default at dispatch time — however reasonable the
   substitute — is a wrong answer, and so is proceeding on a sidecar that does
   not match the plan.
4. **Pairs are fresh per item and item-local.** Every activated item gets a
   fresh implementer terminal at round launch and a fresh verifier terminal
   later, when its complete return and fingerprint exist — creating the verifier
   alongside the implementer is a wrong answer, since it would have nothing to
   verify. **The first verifier failure is surfaced, not handled**: one blocking
   `ask` up the parent Run carrying the verifier's summary and exactly three
   options — correct with the same pair, replace the pair, halt — with the pair
   idling until the reply, and a second failure asking again rather than
   escalating silently. *Correct* is one consolidated correction to the same
   implementer and the same verifier's recheck; *replace* **releases the old pair
   first**, then creates a fresh one at that item's ratified row against the
   worktree, branch, `HEAD` and staged tree the correction packet names, so two
   pairs never live on one item, and a replacement at a different profile is a
   sidecar rewrite the operator ratifies. The pair is released when the item
   closes or escalates. Correcting on the first failure without asking is a wrong
   answer; so is carrying a terminal into another item, and so is a silent
   replacement writer. Outside an activated spine the generic class routing and
   cross-item retention are unchanged; generalising fresh-per-item into a
   project-wide rule is a wrong answer.
5. **No fallback, and the reviewer is chosen later.** Nested worker depth must
   be `2`; no CLI read proves it, so the operator confirms before launch and the
   first child dispatch is the proof. On a depth error the spine session stays
   the lane owner, reports, and waits for an operator decision — it does not
   substitute an inherited-runtime subagent, move item tasks into the parent
   Run, create a replacement writer, or restart the lane. No `Agent`/`Task`
   subagent runs anywhere in the activated path. Separately, **two** profiles are
   chosen only at the spine's PR transition and appear in neither spine planning
   nor the sidecar: the reviewer's command, expected model, effort and review
   level, and one PR-fix implementer, since no item pair survives to the PR. All
   of them reach the **work-PR session's** brief, which creates both seats and
   confirms each model from the banner and first reply as an item row's is; the
   fix task waits for the disposition ledger and rides the fix-round brief.
   Separately, the record pass is **conditional and single**: a second close is
   dispatched only after a first close that halted naming at least one PR, and
   only once every one of them has merged, while a first close returning `closed`
   is the whole ceremony — and step 12's teardown waits for a record pass only
   when one is actually due. Offering any fallback as a pragmatic option, pinning
   either profile during planning, or dispatching a record pass that no PR
   justifies is a wrong answer; naming the PR-fix seat is correct, not
   invention.

## Output format
`{"scores":{"activation_and_layers":N,"run_routing":N,"profile_binding":N,"pair_lifecycle":N,"no_fallback_and_reviewer_timing":N},"pass":true|false,"notes":"<one sentence; where any criterion scores below 5, name the cause>"}`. Pass = all ≥4. JSON only.
