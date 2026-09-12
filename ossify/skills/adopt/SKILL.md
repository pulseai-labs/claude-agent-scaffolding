---
name: adopt
description: Adopt an existing project into ossify — five fail-closed gates, six conversions (journey re-marked shipped|next|later, the current cut as a present-tense clean-checkout test, bones back-derived from ADRs, Release 0 closed retroactively, artifacts reconciled, demo-ledger seed candidates recorded), and an adoption record. For the codebase that already has code, tests, history, and decisions; /ossify:start refuses it.
---

# adopt

You are the conductor of ossify's **adoption** — the on-ramp for a project
that already has code; `/start` refuses it on its content gate.

**Thin by design, not under budget pressure** — §4's pointers are
do-not-restate pointers, and §7 states the self-cap.

---

## 1. The station map

`/start`'s stations, and what each becomes here: **§4 carries the
transfers, §5 the replacements** — the inventories live there, never
restated here.

---

## 2. When to use

**Trigger phrases (description-match):**

- `/adopt` (slash command — §8 for the `$ARGUMENTS` bridge)
- "adopt this project into ossify", "onboard a project that already has code"

**Do NOT auto-invoke when:**

- The project is greenfield — that is `/start`.
- The project has no scaffold-dev legacy stack — no roadmap state, no
  active-context cursor, no legacy spec. This version adopts THAT stack;
  anything else is out of scope today.
- Ossify state already exists at the routed path — route to `doctor`.
- The ask is state-schema migration — `oss migrate` is a dispatcher concern,
  not a ceremony.
- A slice is open on the legacy stack — §3 A5 refuses.

---

## 3. Pre-flight gates (fail closed, in order)

Each gate refuses fail-closed. A1 reuses `/start`'s exact refusal contract;
A3–A5's refusals name the **legacy stack's** close ceremony — scaffold-dev's
slice close, then re-run — never "clean your tree", which fixes a symptom.

- **A0 — no inherited state override.** If `OSS_STATE_FILE` is set, stop:
  `_oss_resolve_state` lets it override the manifest for every verb below —
  adoption would mint into another project's state while A1/A2 inspected
  this one. Unset it and re-run (same guard as plan-release §3).
- **A1 — topology declaration resolves, or is authored here.** Run `/start`
  §3's topology probe block verbatim, never paraphrased. It **resolves,
  authors, or refuses** — it is not a refusal-only gate, and reading it as one
  is what left `/adopt` unable to onboard a legacy project that never used
  workspace-init, which this skill's own refusal text and the plugin metadata
  both promise it can. The halt is a re-probe that STILL refuses after
  authoring. Authoring is the nothing-found case only: a declaration that
  exists but is invalid refuses with its own message naming the file, and
  adoption halts there rather than overwriting it — the operator fixes that
  file. **Where the repo set comes from differs from `/start`:** `/start` reads
  it from the journey-map station it is about to run, and adoption has no such
  station, so ask the operator which repos hold the product and confirm each
  root against a checkout that actually carries its code — every gate below,
  and C3's project-wide ADR scan, iterates exactly this set.
- **A2 — no ossify state at the routed path.** State exists: already
  onboarded → route to `doctor`, full stop — every `/start` project has
  state and no adoption record, so the record's absence distinguishes
  nothing.
- **A3 — every tree adoption will edit is clean, tracked and untracked.**
  Sweep every repo the topology declares (A1 only confirms it resolves) plus
  the AI workspace: `git -C "$(oss repo_root <name>)" status --porcelain`
  each. Any line, in any one, is work in flight; refuse, naming the legacy
  stack's slice close. Each declared repo, never the AI workspace, must also
  be on its default branch — require it where the manifest declares one
  (`boundary-audit.md`'s own precedent); else name the checked-out branch and
  get the operator's confirmation before proceeding.
- **A4 — no live worktrees.** `.during_dev.worktrees_dir` is a **single global
  value**, not a per-repo one: workspace-init writes one, typically
  `${canonical.root}/.worktrees`. Applying it "per repo" resolves that same
  directory on every iteration, so a live worktree under `private_core` or any
  other declared repo is never looked at — and A3 still reports clean roots,
  because `.worktrees/` is locally excluded. Adoption then proceeds over an open
  legacy slice.

  Expand the routed value once and find which declared repo's root it sits
  under: **that repo is the only one it addresses.** Probe every other declared
  repo at `<repo-root>/.worktrees`. A routed value under no declared repo's root
  is itself a finding — name it, and probe the conventional path everywhere.
  Then `find <dir> -mindepth 1 -maxdepth 1` per repo: any directory means a
  slice is open (a plain probe; the oss verb needs the state A2 just forbade).
- **A5 — legacy position is on a boundary.** The live position is the
  manifest-routed memory bank's `05-active-context.md` cursor (the roadmap
  file is inventory, not position). An active slice there refuses and
  names it.

Once all five pass, **record a baseline SHA per declared repo** — `git -C
"$(oss repo_root <name>)" rev-parse HEAD` for each; the adoption record
cites a **baseline table**, not one SHA, and everything downstream is
relative to each repo's own baseline. Then `oss init "<project-name>"` —
its state-exists refusal is A2 made mechanical, and every verb below mints
into the state it creates. Nothing hand-authors `project-state.json`.

---

## 4. Stations that transfer unchanged — pointers only

**Do not restate these — read the pointer, work it against the project.**

- **Vision — confirm, do not elicit** (`/start` §4): read it back for correction.
- **Risk gates — derive from existing constraints** (`/start` §8 owns the
  families and the control menu); mint with `oss risk_gate_add`.
- **Smoke — narrowed** (`/start` §9) to **unverified external pins** —
  shipped tests already cover the code's own claims.
- **Spike — unchanged** (`/start` §9a). Rarely fires on an adopted project.
- **Posture — unchanged** (`/start` §10 + `references/posture-block.md`): a
  genuine open decision, unaffected by prior code.
- **Critic moment — unchanged** (`/start` §11 +
  `references/critic-moment.md`): fires once on the reconciled spec, same
  skip contract and the internal `challenge` audit.

---

## 5. The conversions

### C1 — Journey map: `shipped | next | later`

`/start` §5's line grammar and harvest carry over unchanged — with one
vocabulary change: `skeleton` presupposes unbuilt. Re-mark every step:

```text
<actor action>  |  <system responsibility>  |  <observable evidence>   [shipped|next|later]
```

`shipped` means the step passes the clean-checkout test at the baseline commit
**today** — not "code exists for it." Harvest `next`/`later` to the feature map
as `/start` §5 does; `shipped` steps are the baseline, not candidates.

### C2 — The current cut replaces the skeleton cut

`/start` §6's read-back is unanswerable here: the cut it names already shipped.
The answerable form is **§6's own clean-checkout test, in the present tense**:

> From a clean checkout of every declared repo at its own baseline SHA, a
> `<actor>` can `<action>` and `<outcome>`.

The current cut is the union of the `shipped` journey steps. Validating it is
the one place to be slow — it is the only step that establishes what is
actually true rather than what a document claims. **Where checkout and legacy
spec disagree, the checkout wins, and the gap is a recorded finding** — never a
silent re-mark.

### C3 — Bones back-derived from every repo's ADR directory, aggregated

1. Scan **each declared repo's** `docs/adr/` with `bones-registry.md` §3's scan
   (already conversion-correct; use it, do not rewrite it) and aggregate: any
   ADR in the product's repos owes the registry an entry.
1a. **Collision preflight, before minting anything.** `bones-registry.md` §3
   keeps new identifiers unique *by construction*, and that construction only
   governs numbers ossify mints. Adoption imports numbers that already exist,
   from repos that kept **independent** sequences — two of them starting at
   `ADR-0001` is the normal case, not the exotic one. Passing those through
   unchanged puts two different decisions under one identifier, and from there
   nothing downstream can separate them: not a citation, not a reclassification
   reason, not a `touch_check` hit, which reports a bare `bone <adr>`. Collect
   every scanned ADR reference across every declared repo and compare the full
   set; **any reference appearing in two repos halts adoption**, naming each
   colliding reference and the repos that hold it. The remedy is the operator's
   and it is one-time: renumber in the source repo so the project's references
   are distinct, then re-run `/adopt`. Do not renumber for them — an ADR
   filename is a shipped, cited artifact, and C2's rule that the checkout wins
   applies with most force to the record adoption exists to preserve. Do not
   qualify the reference with a repo key either: a bone record stores no repo
   key, so a qualified identifier would be legible in the registry and bare
   everywhere it is read.
2. Map each ADR to one of the nine categories (`/start` §7's checklist).
   Multiple ADRs may share a category; a category may have none.
3. Mint each: `oss bone_add "<ADR-ref>" "<title>" "<touch-glob-csv>" "<revisit
   trigger>"` — touch surfaces from the paths the decision actually governs,
   at module granularity (`/start` §7's glob semantics).
4. **Status `Accepted`, not `Proposed`.** `/start` §7's protocol is Proposed,
   flipped to Accepted once a release exercises it; the adopted baseline **is**
   that exercise. Minting shipped decisions as Proposed misstates the record.
5. **Categories with no ADR still get the forced-enumeration question.** The
   failure mode `/start` §7 guards is unasked questions; adoption does not
   change that. Answer, or `not-applicable` with a reason.

An ADR that no longer describes the code is a **finding** for the read-out,
not a bone to write.

### C4 — The adopted baseline is Release 0, retroactively closed

```bash
oss release_add "Release 0" "adopted baseline: everything shipped under <legacy-stack> through <baseline-sha-per-declared-repo>"
oss release_status "<release-id>" closed
```

The skeleton exists — it was built before ossify arrived; `release_status`
accepts `closed`. **Do not reconstruct per-slice history as spines and work
items** — unearned records. The first ossify-planned release is Release 1.

Then author the **stub retrospective** at
`"$(oss release_dir r0)/release-retrospective.md"` — recording the adoption,
not a spine retro. That filename is `plan-release` §4's previous-release
input — the one thing it lacks after a retroactively-closed Release 0.

### C5 — Reconcile artifacts; read the destination before writing it

**No destination is opened for writing until it has been read.** Adoption has
no blank destinations — an adopted project is all occupied surface.

| Destination | Action |
|---|---|
| `MASTER-SPEC.md` | map legacy phases → the 7 lean sections; keep legacy sections (spec-validation reads their presence as legal) |
| `CLAUDE.md` | merge ossify's loop section; preserve hand-authored zones |
| `EXECUTIVE-SUMMARY.md` | leave; no gate reads it |
| memory bank | append with harvest's provenance trailer (`close/references/harvest.md`); **never truncate**. For `09-known-issues.md` / `10-decisions-log.md`, harvest's never-regenerate rule wins — they hold the history adoption preserves (#268; the brief's conditional is still owed) |
| `tech-debt.md`, `PUBLIC_BOUNDARY.md` | author (absent) |
| each declared repo's `docs/adr/` | append only, continuing the series |

### C6 — Record the demo-ledger seed candidates

The only ledger verb, `oss ledger_add_auto`, keys every line to a spine, and
C4 deliberately creates none — adoption cannot mint them, and **no ceremony
consumes the candidates yet** (#293 wires the first post-adoption spine
to). Record them in the adoption record anyway — small, end-to-end, from
the current cut's journey, not a transcription of the test suite: the first
spine close should exercise the shipped surface, and until that wiring
exists the vacuous-window risk stands, named rather than hidden.

---

## 6. Outputs

| Output | Routed to | Mode |
|---|---|---|
| Lean spec sections 1–7, memory bank, `CLAUDE.md` | AI workspace | merge (spec, `CLAUDE.md`); append-with-trailer, author only what is absent (memory bank) |
| Bones ADRs | each declared repo's `docs/adr/` | append, continuing the series |
| Bones / risk gates / feature map / posture / Release 0 closed | `project-state.json` | `oss` verbs — into §3's init state |
| `PUBLIC_BOUNDARY.md` | each public repo root | author |
| Stub retrospective | `"$(oss release_dir r0)/release-retrospective.md"` | author — records the adoption |
| **Adoption record** | `<ai-workspace>/ADOPTION.md` | author — baseline table, gates passed, merged-vs-authored, **every C2 gap**, the C6 seed candidates, and the per-station lines the floor requires: `feature_add`/`bone_add`/`risk_gate_add`/`posture_set` counts; each C3 category `answered` (bone ref) or `not-applicable` **operator-ruled** with its reason; critic `ran\|skip`, a skip being the operator's typed bypass; smoke verified/unverified counts; **a zero names what produced it** — the §8 family walk behind `risk_gate_add: 0`, the empty external-pin inventory behind `smoke 0/0` |

The adoption record is the point: the only artifact saying what adoption
did; `doctor` consults it when spec and state disagree (doctor §1).

**The completion floor comes first — `oss doctor` proves integrity, not
completeness; it is green at two mutations and an empty registry (#303).**
Refuse to declare completion, naming the station that never ran, when:

- C1's journey table is absent, or the feature map does not hold one entry
  per step it marks `next`/`later` — the harvest is owed in full. A map
  owing nothing (all `shipped`) closes at zero only via an
  **operator-confirmed waiver on the record**.
- the posture bone is absent, or `posture` is null or outside its four
  values — posture **is** a bone and always gets set (§4).
- no closed `Release 0` in state, or its stub retrospective absent — C4
  never finished, and `plan-release` would plan the greenfield
  `Release 0`, not Release 1.
- the adoption record lacks the per-station lines its row requires — a zero
  must be visible and answered, never unasked (`/start` §12: thin succeeds
  provided every category was asked).

Close with `oss doctor` (the state gate: `state`, `schema`, `replay`,
`shape`) and name the next step: **`/plan-release`** for Release 1.

---

## 7. Never

- **State-schema migration.** `oss migrate` is a different thing. Do not
  overload the word.
- **Touching the legacy stack's STATE** — roadmap position, cursor, slice
  and worktree structure: read, never written. Reconciling the legacy
  ARTIFACTS (spec, `CLAUDE.md`, memory bank, ADRs) is C5's job. Adoption
  is additive; the operator retires the old stack at their choosing.
- **Mid-slice adoption.** §3 A5 refuses it by design.
- **Repairing what it finds.** C2 gaps and stale ADRs are findings.
- **Letting this body exceed 250 lines.** Thin-by-design is a stated
  constraint, not an aspiration. Depth belongs in pointers, never restated.

---

## 8. Slash-command interaction

The `/adopt` command exports the raw argument as `$ARGUMENTS` via the env-var
bridge — parse it in bash; never reference `$1`/`$2`/`$N`. The only argument
is an optional project name, passed to `oss init`; when absent, ask before
initializing. The command is Claude-Code-only; the skill body reaches
OpenCode by path as the native `adopt` skill (#131 tracks the command gap
for all eleven).
