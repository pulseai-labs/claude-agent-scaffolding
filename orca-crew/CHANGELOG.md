# Changelog

All notable changes to the `orca-crew` plugin.

## 0.4.0

The seats an activated spine spends are now **ratified, surfaced and separated**. 0.3.0
made the item pairs bindable; this makes the spine session's own seat ratifiable too,
stops the first verifier failure from being handled silently, and moves the close and
every PR loop out of the top's session into seats of their own. **Everywhere else
nothing moves:** `/ossify:run-spine <id>` with no flag is unchanged, and the generic
role table, class routing and retention still govern every session outside such a spine.

- **D24** — the sidecar gains a `## Spine session` block — command, expected model,
  effort, and the reason — **beside** the item table, never a row in it, so the item-set
  equality check is untouched. The reader value-checks it with the item rows and halts on
  its absence; the top launches the spine terminal from that exact command and confirms
  the model from the banner and the first reply, exactly as for an item row.
- **D25** — the **first** verifier failure sends one `ask` up the parent Run carrying the
  verifier's summary and three options — correct with the same pair, replace the pair,
  halt — and **blocks**: the pair idles until the reply. *Replace* is the one exception to
  one pair per item: it releases the old pair, resets the item's worktree to the request's
  `base_sha` with a clean porcelain — the rejected staged work is discarded — and
  re-requests the item, so the fresh pair runs the ordinary entry point from clean rather
  than adopting a staged tree no pre-flight would accept; the correction packet is for
  *correct* only. A replacement at a different profile is a sidecar rewrite the operator
  ratifies. Replaces 0.3.0's silent first correction and second-failure escalation.
- **D26** — four seats, one voice. Only the top talks to the operator; every other seat
  asks upward one hop. The close runs in a **fresh** terminal the top creates (the
  retention reuse is gone) and returns every PR it opened; each returned PR gets its own
  **work-PR session** in that PR's hosting-repo worktree, owning the reviewer and PR-fix
  seats in a child Run and merging bound to the SHA the top relays. Every dispatched
  session returns a checkable artifact — PR list, ledger comment id, merge SHA.
- **D27** — the record pass is **conditional and single**: dispatched only when the first
  close returned at its open-PR halt naming at least one PR, and only once every one of
  them has merged. A close that returned `closed` is the whole ceremony.
- **D28** — the sidecar is revalidated **immediately before every item launch**, the
  spine-session block included; any drift halts that launch and asks the top.

**Clause fixes.** #435 the sidecar's implementer entry point is an angle-bracket slot
rather than a `$NAME` nothing injects; #438 the ordinary reviewer path has a defined
default `/code-review` level; #441 the item verifier leaves `HEAD`, the staged tree and
the porcelain status exactly as found; #442 `orchestrate/SKILL.md`'s write set names the
sidecar.

**Files.** `references/ossify-execution.md` keeps the contract — activation, the sidecar,
the seats, the PR transition — while `references/ossify-nested-run.md` takes the
mechanics (depth, routing, the round procedure, the close) and `references/ossify-pr-briefs.md`
takes the close and work-PR briefs. Every reference stays at or under 200 lines.

## 0.3.0

Three session layers, **on a spine this session just planned** — the four-fact
activation in D14 is the whole switch. They replace the single dispatched lane driver
whose subagents inherited its runtime and so could not honour a per-item model or
effort. **Everywhere else nothing moves:** `/ossify:run-spine <id>` with no flag is
unchanged and still dispatches `ossify:implementer-agent`, and the generic role
table, class routing and retention still govern every session outside such a spine.

- **D14** — activation is four facts about the current session: orca-crew is the top
  orchestrator, a Run is bound, this session just completed `/ossify:plan-spine`, and a
  concrete spine directory exists. Installation, environment, and finding a sidecar on
  disk activate nothing.
- **D15** — `$SPINE_DIR/orca-execution.md` (`orca-execution/v1`), written by the top
  orchestrator alone after the operator ratifies every row in one phase. Rows carry
  only terminal command, expected model, and effort; the implementation-plan gate, the
  implementer entry point, and the verifier procedure are fixed for every item.
- **D16** — every activated item gets a fresh implementer and a fresh verifier at its
  exact ratified profile, retained only through that item's corrections and never
  crossing work items. Generic class routing and retention are unchanged outside such
  a spine.
- **D17** — three session layers: the top starts **one** spine session, that session
  creates a child Run and owns both item terminals per item, and item plan traffic and
  item completions never reach the parent inbox. No Agent/Task subagent runs anywhere
  in the activated path.
- **D18** — each implementer reads, posts a detailed plan, and waits; the spine session
  relays a round's plans up in one ordered ask and the top decides each independently.
  No edit starts before the relayed decision.
- **D19** — fixed procedures, selectable runtimes: the implementation-plan gate, the
  `/ossify:work-item` entry point and the all-claims verifier procedure are the same on
  every item; only the terminal command, the expected model and the effort vary. The
  model is checked from the launch banner and the first reply; the effort is the exact
  approved launch argument, with no attestation mechanism behind it.
- **D21** — nested worker depth must be `2`. No CLI read proves it, so the operator
  confirms before launch. `nested_worker_depth_exceeded` halts and asks; it never falls
  back to a subagent, to the parent Run, or to a lane restart.
- **D22** — corrections are item-local: one consolidated correction to the same
  implementer, the same verifier rechecks it, and a second failure on that item
  escalates to the top. No replacement writer is created silently. The
  continuation packet carries all four identities the executor must confirm
  before it touches anything — work item id, branch, `HEAD` and staged tree.
- **D23** — Layer 4 runs inline under external mode, and the reviewer is chosen only at
  the spine's PR transition — not in spine planning and not in the sidecar.

D20 is ossify's own half of the seam (the provider-neutral `--external-executor`
contract) and ships in that plugin, not this one.

## 0.2.0

Session budget and plan-time routing, triggered by measured session spray: tens of
GLM sessions a day, dozens of tasks per run, many one-question verifiers
and "correction" sessions that spent their budget orienting.

- **D7** — the default worker is `claude-glm` at high, retained; flash is for
  read-only probes, mechanical verification, and bounded fast items.
- **D8** — plan-time routing: each work item carries a complexity class
  (`contract` → `claude-glm`, `bounded` → `claude-glm-flash`); unclassified
  defaults to `claude-glm`.
- **D9** — session budget, hard cap: one implementer and at most one verifier per
  work item; one reviewer per PR and at most one verifier per fix round; further
  read-only questions go to the existing session by `send`.
- **D10** — retention to half the window: past ~50% (500k on `glm-5.3`) or an
  auto-compact, checked by `/context` at each task boundary, the implementer
  writes a handoff and the next item starts fresh.
- **D11** — corrections travel by message: one bounded `send`/`reply` to the live
  session; a correction session is never created.
- **D12** — new findings route through the orchestrator (#410): an implementer
  resolves a thread only after the disposition.
- **D13** — verification is one all-claims brief and one report per work item;
  `claude-glm` at high unless every claim is mechanical.

## 0.1.0

Initial release. One prose skill, no runtime library.

- `orchestrate` — the orchestrator/worker session model over Orca orchestration: the
  delegation floor, the role table with alias and effort per role, the twelve-step run,
  four self-contained brief templates, the ossify seam, and the refusals.
- `/orca-crew:orchestrate [objective]` loads the skill and binds the Run.

Design boundaries, stated once here:

1. The skill states one Orca mechanic itself (launch by alias with `terminal create`
   then `dispatch --inject`, because `worker-start --agent` cannot take a custom alias)
   and defers every other command to `orca skills get orchestration`.
2. A review runs once per PR and returns findings only through `worker_done`. GitHub
   review threads are a second stream the retained implementer works to zero.
3. ossify keeps every contract; this plugin sorts its commands between the orchestrator
   session and dispatched sessions and edits no ossify prose.
4. No per-project role map. The aliases are the roles.

Not in the OpenCode bundle in this release.
