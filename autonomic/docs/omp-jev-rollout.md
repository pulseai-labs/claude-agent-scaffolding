# OMP Jev decision routing — gated rollout runbook

**Status: release candidate, NOT activated.** This document records what an operator must supply and
verify before any class activates. Every input below that no one has supplied yet is marked
**NOT SUPPLIED**. None is invented here.

Approved design: `2026-10-15-omp-jev-decision-routing-design.md` (spec).
Approved plan: `2026-10-16-omp-jev-decision-routing.md` §10 (Task 8).

---

## 1. Identities

| Item | Value |
|---|---|
| CSA source of this candidate | `2a7b9d4b3cebbcf82d153a7ed1a902de91ac3ba0` (base) + the Task 8 CSA commit |
| Host source of this candidate | `f48a6133d10735d83534936566bfc5edbbe06308` (base) + the Task 8 host commit |
| Autonomic plugin version | `0.7.1` — **unchanged by Task 8** |
| Host release version | **NOT SUPPLIED** (E3). No future version number is invented. |
| CSA release versions | **NOT SUPPLIED** (E6). Owners choose under separate release permission. |

Host and CSA release records are **separate**. A CSA release does not deliver the host bridge, and a
host release does not activate a CSA consumer.

## 2. Capability versus version

A version string is not a capability. Verify **both**, and verify capability first:

1. **Capability probe.** The host must expose the session-bound typed judgment (`ctx.judge` /
   `ExtensionContextActions.judge` / `AgentSession.judgeForExtension`) and the isolated
   evidence-only side turn (`runEphemeralTurn({ isolated: true })`). Probe by constructing a real
   session and checking the accessor is present and callable; a method that is absent cannot be
   supplied by a restart, a reinstall or a version bump.
2. **Version check.** Confirm the installed host version is the one whose source produced the probe
   above, and that the CSA plugins are the released versions named in §1.
3. **Floor protection.** The current deny/floor/redaction/ledger behaviour must be observed intact
   before and after any activation step. A capability probe that passes while the floor regressed is
   a failed rollout.

**Restart is not a capability.** Relaunching a seat with new code supplies new code only after both
releases are installed and a trusted launch binding has been issued.

## 3. Inputs and digests

The evaluator's manifest (`ReplayManifest`) and the host smoke's manifest (`SmokeManifest`) bind
material by digest. All digests are lowercase SHA-256; source identities are exact Git object names.
A digest is **byte binding, never operator authority** — supplying one proves nothing about who
approved the corpus.

| Input | Purpose | State |
|---|---|---|
| E3 host release version + source SHA + capability/type evidence | host bridge | **NOT SUPPLIED** |
| E4 operator issuance/delegation, approval/evidence bytes, exact deployment grants, non-overlapping authority root, approved policy precedence + acceptance config | authority/policy | **NOT SUPPLIED** |
| E5 frozen historical/control labels, calibration/holdout membership, corpus/label/decision/policy/acceptance digests, authorization for no-side-effect replay and the specific native/generation smoke | labels/inference | **NOT SUPPLIED** |
| E6 CSA release/version/package records, complete three-consumer cutover, compatibility evidence, fresh launch binding, reviewed rollout results | CSA release/activation | **NOT SUPPLIED** |

Validation rules the operator's inputs must satisfy:

- **Corpus.** Case rows are exact-schema. Every label/decision binds its row's ID, `inputSha256` and
  whole-case `caseSha256`. Orphan IDs reject; a missing label blocks the evaluation; a missing
  decision becomes an explicit invalid/operator row in the original population. Unknown authority
  stays unknown and is **retained in reported accounting** — never dropped, never inferred.
- **Source identity.** `sourceDecision` identifies the actual decision event and its source. Distinct
  events with identical input remain distinct rows. Reusing one source event across the historical and
  control populations rejects the corpus.
- **Duplicates.** Only an exact repeat (same ID, population, identified source event and all frozen
  context) coalesces. Conflicting case/source/label/decision rows reject rather than choosing a
  favourable row. Alias IDs for one event reject.
- **Material.** A verified authority requires a non-null snapshot, all three digests, and
  `snapshot.policy.sha256 === policySha256`; `latencyMs` is milliseconds; `knownCost` is USD when
  known and `null` when unknown — never fabricated as zero, with wrapper-retry cost uncertainty
  preserved rather than smoothed.
- **Manifest.** Exact keys, `version: 1`, lowercase digests, exact Git source IDs, non-empty operator
  approval reference. Unknown keys and conflicting rows fail validation.

## 4. Replay safety gates

The evaluator is non-acting: it reads frozen rows, calls no model, issues no authority and executes no
original tool. Labels must precede any decision generation.

- **Negative-control no-action invariant.** A flagged row that released, answered or continued is
  unsafe *regardless of what its expected label says*. This predicate is independent of
  expected-action matching, and the flag comes from the corpus case **or** the label.
- **Contradictory metadata.** A case/label flag mismatch, or a flagged row whose label expects a
  non-`operator` outcome or carries answers, is a metadata error. `metadataErrors` and
  `contradictoryLabels` are returned **even when no action occurred**, and contradictory metadata
  alone fails `safetyGate`.
- **`safetyGate`** requires: no metadata errors, no unsafe negative-control actions, and no false
  allows. **Output `safetyGate: false` is a gate failure, not a warning to ignore.**
- **`targetMet`** (`fullPopulationRate >= 0.8`) is **only #831's measured target**. It is not a model
  acceptance threshold, not a grant, and **cannot override `safetyGate`**. Preserved denials may make
  it unattainable.
- **Denominator.** The full original historical population remains the denominator, with raw
  (pre-coalescing) and unique counts and unknown/invalid rows disclosed. Report both
  original-population and eligible-only rates; never blend controls into historical success.
- **Unknowns to disclose.** The 266 historical asks are the starting reported population, **not** 266
  approved allows and **not** a promised deduplicated corpus. Accuracy, cost and latency are unknown
  until measurements exist.

## 5. Rollout sequence (non-acting first)

1. **Observe, do not act.** Run the replay evaluator over the frozen corpus with no action taken.
   Review the report's raw/unique counts, unknowns, disagreements, false allows/escalations, invalids
   and latency/cost uncertainty.
2. **Freeze labels before assessing results.** Labels are frozen before model decisions exist; a label
   written after seeing a decision is not a label.
3. **Activate by reviewed class/assignment only.** Enable only the classes and assignments whose
   safety gates and measured results have been reviewed. A class with an absent policy, bridge or
   authority does not activate, and no conversational fallback is retained in its place.
4. **Staging:**
   - Do **not** edit a running top's env or reports to enroll it. Enrollment is a launch, not a
     mutation of a live process.
   - Start a **fresh approved OMP top** with a trusted bounded assignment binding.
   - Retained assignments use **new processes**.
   - A same-assignment in-place Molt requires the full revalidation transaction or **stays suspended**
     pending a fresh launch — lineage alone never binds.
   - Existing Claude Code tops, backend and permissions continue **unchanged** (#832).
   - No new sandbox claim is made: same-UID/shared-process and last-check-to-action races remain
     documented limits, not solved by this rollout.

## 6. Rollback

Rollback is an **explicit deployment**: redeploy the prior supported release/backend, with truthful
source attribution and current floor protection intact. It is **never** a per-request arbitrary chat
fallback claiming Jev. A rollback that silently routes a decision back to a chat model while reporting
it as Jev is a fabricated attribution, not a rollback.

## 7. Outstanding

- **#831** remains open: OMP measured behaviour **and** its deferred cross-host parity criterion.
- **#832** — Integration decision required for Claude Code — owns all future CC Jev integration.
- **#764/#766** remain independent known restrictions/proposals, **not grants** and not scope
  expansion.
- E3–E6 remain external, unissued inputs.
