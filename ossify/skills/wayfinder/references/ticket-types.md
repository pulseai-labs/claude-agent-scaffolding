# Ticket types

Depth for `SKILL.md` §1's ticket-type pointer, and the file every wayfinder
ticket resolves through: which of ossify's uncertainty instruments a
ticket's type names, whether that instrument can run unattended, and how it
earns its label on the tracker.

Ossify already owns five ways to resolve uncertainty — four instrument docs
(`research.md`, `smoke-test-pass.md`, `spike-contract.md`, `prototype.md`)
plus a grill (`challenge`) — and wayfinder adds none of its own. A
ticket's type says which of those five its uncertainty is, or that it
carries no uncertainty at all and just wants doing.

---

## 1. The six types

| Type | Mode | Resolver | Uncertainty |
|---|---|---|---|
| `research` | AFK | `start/references/research.md` | factual, read-shaped |
| `smoke-test` | AFK | `start/references/smoke-test-pass.md` | factual, script-shaped |
| `spike` | AFK | `start/references/spike-contract.md` | technical — build a falsifier |
| `prototype` | HITL | `start/references/prototype.md` | experiential — a person chooses |
| `grilling` | HITL | `challenge` interview + `start/references/domain-modeling.md` | none; it is the grill |
| `task` | either | no instrument | none; manual work unblocking a decision |

Resolver paths are read cross-skill via
`${CLAUDE_PLUGIN_ROOT}/skills/start/references/<file>`. This is the
established pattern — `challenge/SKILL.md` already reads references that
way, and the absorption spec sanctions it. **The grill is reached the same
way** — read `${CLAUDE_PLUGIN_ROOT}/skills/challenge/references/interview.md`,
as every other ossify caller of the grill does. Never name the slash command:
`/ossify:challenge` is the Claude Code spelling, and wayfinder now ships on
the OpenCode bundle too, where the same skill is registered as a native
`/challenge` and no `ossify:` alias exists. The reference path is the one
address that is correct on every surface.

**Take each instrument's method; do not take its storage.** All four were
written for an ossify project and name ossify artifacts as their
destination — `research.md` writes `docs/research/<slug>.md` in the AI
workspace and folds verified claims into a bone's ADR, `smoke-test-pass.md`
and `spike-contract.md` both land in the affected bone's ADR, and
`prototype.md` records against a journey-map step or a bone ADR. A wayfinder
map does not require any of that: `references/tracker.md` §1 branches 2 and 3
put a map on any repository's tracker, and such a repo may have no bones, no
ADRs, no journey map, and no AI workspace at all. The instrument's *procedure*
— the question form, the falsifier, the timebox, the variant comparison — is
what the type points at and it transfers whole. Its *write target* does not.

Where the named artifact does not exist, the resolution's home is the one
every ticket already has: the resolution comment on the ticket and its one
line in the map's Decisions so far (`references/working.md` §1 step 4). That
is the durable record on this branch. **Never invent a parallel artifact tree
to satisfy a resolver path** — a `docs/adr/` written into a repo that has no
bones is scaffolding nobody asked for and nothing else reads. In an ossify
project the instrument's own destination stands, and the ticket's comment is
the pointer to it.

Each ticket carries exactly one `wayfinder:<type>` label, set when it is
filed: `wayfinder:research`, `wayfinder:smoke-test`, `wayfinder:spike`,
`wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`. The map
that owns them carries `wayfinder:map` and none of the six — a map is not
its own ticket.

---

## 2. AFK and HITL

**AFK** — the ticket can be worked unattended: dispatched to a subagent, or
picked up solo while the operator is elsewhere. `research`, `smoke-test`,
and `spike` are AFK because each one's instrument resolves against
something that does not need a person watching — sources that say what
they say, a script that exits 0 or doesn't, a falsifier that fires or
doesn't.

**HITL** — human-in-the-loop, and not negotiable. `prototype` and
`grilling` are HITL because the thing under resolution *is* a person's
judgment: which built variant feels right, how the operator actually
answers a question the interview predicted differently. `task` carries no
uncertainty at all — it is manual work unblocking the decision — so its
mode is whatever the work itself needs, not a property of the type.

**The falsifier is the boundary.** If a check could fail, the ticket is a
`spike`. If the answer requires a person comparing built variants, it is a
`prototype`.

**Dispatching a `prototype` or `grilling` ticket to a subagent is a bug, and
this skill refuses it.** The agent never stands in for the human's side of the
exchange. A grilling agent that answers its own questions has broken the
ticket, not resolved it.

---

## 3. Dispatching the AFK tickets

Fan `research`, `smoke-test`, and `spike` tickets out through the `Task` tool
directly, not `superpowers:dispatching-parallel-agents` — Batch S ossified
`challenge` in-tree to drop plugin dependencies, and taking one back
reverses that.

**`Task` is a Claude Code tool, and wayfinder ships on surfaces that do not
have it.** The Codex manifest registers no agent and no tool, and
`ossify/README.md` states outright that Codex has no worker path; the OpenCode
bundle exposes the skill without one either. **On any surface with no subagent
mechanism, the fan-out does not happen and is not simulated.** Chart mode
finishes at step 5, says which AFK tickets it left unworked and why, and those
tickets stay open on the frontier for a later work-mode session to pick up one
at a time — which is the ordinary path, not a degraded one, since work mode
resolves exactly these types single-file anyway.

Resolving them inline in the charting session instead is the failure to avoid:
it breaks charting's own rule that it resolves nothing, and on a batch of
three research tickets it silently converts an unattended fan-out into a long
foreground run the operator did not ask for. A named refusal costs one
sentence; the alternative costs the mode's contract.

**The map body is the dispatcher's to write, never a worker's — and that
means every heading, not just one.** A map body is edited by whole-body
replacement (`references/working.md` §4), so two workers that finish together
read the same body and the second write silently erases the first's edit.
`working.md` step 4 appends to `Decisions so far`, and **step 5 mutates the
same body twice more**: it clears a graduated patch out of `Not yet specified`
and appends a scoping ruling to `Out of scope`. All three race identically.

So the split is by **surface**, not by step:

- **The dispatching session claims every ticket BEFORE launching its worker**
  — `references/working.md` §1's claim, run serially here, one ticket at a
  time. A dispatched ticket is otherwise open and unassigned for the whole
  length of a research pass or a spike, so a concurrent work-mode session
  reads it as frontier, claims it, and resolves it alongside the worker; both
  then comment, both close, and two conflicting decisions come back for the
  same question. Claiming in the dispatcher rather than inside each worker is
  deliberate: it is already serial, so N workers cannot race each other's
  claims the way N concurrent sessions would.
- **Each worker** resolves its own ticket, posts its own resolution comment,
  and closes it. Those touch only that ticket and are conflict-free.
- **Each worker returns** everything that would touch the map — its
  Decisions-so-far line, any patch its answer graduated out of fog, any
  scoping ruling, and any ticket that should be created as a result.
- **The dispatching session** applies all of it to the map after the batch is
  in, one write at a time, and creates the graduated tickets.

Splitting by step instead is the trap this paragraph exists to close: a worker
told only "comment and close" that follows step 5 anyway overwrites its
siblings' map edits, and a worker that obeys the restriction literally
**silently drops** the graduation and re-scoping its own answer produced. Both
failures are invisible at the end of a fan-out that otherwise looks clean —
neither leaves an error, and the map simply comes out missing work.

The dispatching session is the one place any of this can be serialised, which
is why the rule lives here at the fan-out rather than in `working.md`.

**Dispatch only what the frontier predicate admits** — open, unassigned, and
blocked by nothing still open (`references/tracker.md` §2). AFK is a property
of the type; it is not permission to run. A blocked `spike` handed to a
subagent resolves against evidence that does not exist yet and records that
answer on the ticket as if it were real, which is worse than not running it.
This binds on every caller — `charting.md` step 6's post-chart fan-out and any
batch a work-mode session launches alike — and it is stated here, at the
fan-out, rather than in each of them.

A host that sleeps mid-run kills background agents as a generic API error.
Hold a sleep inhibitor across the **whole** fan-out, not per agent. The
spelling is the platform's: `caffeinate -i` on macOS — a foreground process
that holds the assertion until killed. On Linux, `systemd-inhibit
--what=sleep sleep infinity` held in the background for the batch and killed
after it — `systemd-inhibit` inhibits only while the command it wraps is
running, so a background `sleep infinity` is the held assertion, the same
shape `caffeinate -i` gives for free. Whichever spelling, the host's
permission config must allow it BEFORE the batch: an inhibitor first invoked
mid-fan-out pauses for approval exactly when the operator is away — after
the dispatcher has claimed the tickets — and protects nothing while it
waits. If invoking it would prompt, say the batch is unprotected and let the
operator pre-approve it or accept that. A host with neither inhibitor has
nothing to hold: say so, rather than claiming a protected fan-out.

---

## 4. Pointer direction

This file points at the four instrument docs — `research.md`,
`smoke-test-pass.md`, `spike-contract.md`, `prototype.md` — and they do not
point back. A back-pointer would mean four file edits for symmetry, and
four places to drift. The actor here is work mode, AFK or HITL, and that
contract belongs to the file that schedules the work, not to the
instruments being scheduled.
