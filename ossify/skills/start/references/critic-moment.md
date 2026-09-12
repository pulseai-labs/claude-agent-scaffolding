# The spec-core critic moment

Depth for SKILL.md §11. One audit, run by ossify's own `challenge` skill in
audit mode, at spec-core close — after the lean MASTER-SPEC is authored and
before the bones harden into Release-0 planning.

**One invocation, no more, no less.** It restores the old stack's
Phase-5/7/close critic cadence. Since 1.1.0 the critic is internal: there is no
plugin to detect, no bridge to export, no absence to skip around.

---

## 1. The moment

| Trigger | Artifact audited | Depth | How it is passed |
|---|---|---|---|
| Spec-core close (lean MASTER-SPEC authored; before `plan-release`) | the lean MASTER-SPEC | close | named in prose when the audit reference is read |

`plan-release` owns a *different* audit (the class-declaration veto,
spec §5.2 step 3). That one is fail-closed; this one is advisory. Neither
imports the other's semantics.

---

## 2. The sequence

1. **Announce**, then end the turn:

   > Spec-core close — running a close-depth audit on the lean MASTER-SPEC +
   > bones registry + skeleton-cut before the bones harden. Type `skip` to
   > bypass.

2. **Wait.** If the user types exactly `skip` (case-insensitive), log it and
   continue to the next block. Do not argue, do not re-offer. In a
   non-interactive run the default is to **proceed** — `skip` is the only
   bypass, and a scripted run is not a reason to skip the one adversarial look
   the spec-core gets.

3. **Run the audit.** Read
   `${CLAUDE_PLUGIN_ROOT}/skills/challenge/references/audit.md` end to end and
   follow it: the lean MASTER-SPEC is the artifact, the depth is `close`, the
   target label is the spec's name. You are a ceremony caller: the audit
   consolidates and returns **every finding unwalked** — it runs no internal
   rebuttal for you (audit.md §7) — and control returns via its structured
   summary, a message opening *"Audit complete for …"* listing them all.
   Your §4 triage below is the rebuttal. React to what it actually returned,
   not to what you expected.

   Whether an external fresh-frame adversary joined is decided by the
   adversary ladder (`challenge/references/adversaries.md`): per-invocation
   override, then `OSSIFY_ADVERSARY`, then host-only. An unconfigured install
   audits host-only and says so in one plain status line — the declared
   default, not a failure.

4. **Disposition-triage** the standing challenges (§3), then continue to the
   Release-0-minimums recap and the outputs block.

---

## 3. Disposition triage — advisory, never a gate

This is the part that distinguishes the critic moment from a quality gate.
Control has returned to you; you decide what happens to each standing
challenge.

| Challenge kind | Disposition |
|---|---|
| **Spec-aligned** — the challenge asks for something the methodology already mandates (a missing bone category, an un-named touch surface, an unverified claim not marked, a moat item leaking into the public artifact) | **Auto-accept.** Fold it into the spec + the relevant bone ADR yourself, and say what you folded. |
| **Load-bearing / vision-touching** — it questions the skeleton cut, the product's core hypothesis, the posture, or a bone the user chose deliberately | **Escalate to the user.** Present it as a decision, with the critic's reasoning and your read. |
| **Out of scope** — it asks for the artifacts spec-core deliberately retired (exhaustive FR/NFR, a roadmap, a PROJECT_PLAN) | **Reject with a reason**, and say so out loud: those grow at release closes. |
| **Ambiguous, contradictory, or stale** | **Escalate.** Never silently pass. |

Then surface a short digest: what was auto-accepted, what was escalated, what
was rejected and why. A silent triage is indistinguishable from ignoring the
critic.

**Never block on the critic.** A standing challenge the user declines to act on
is recorded and the flow continues. The critic's findings do not gate
`plan-release`.

> Note the asymmetry with the *release-planning* veto (spec §5.2): there, an
> ambiguous or stale finding defaults to ESCALATE and a veto **auto-applies** as
> reclassification, because misclassification is a safety property. Here the
> stakes are lower and the pass is advisory. Do not import the veto's
> fail-closed semantics into this moment, and do not export this moment's
> advisory semantics into the veto.

---

## 4. Anti-patterns

- **Do not gate on the critic.** Advisory. Always.
- **Do not fire more than once.** One close audit per spec-core close.
  Per-block fires were considered and rejected as disruptive.
- **Do not fire before the lean MASTER-SPEC exists.** The audit reads a real
  artifact on disk; there is no phase-recap file in ossify's flow.
- **Do not skip the audit because no adversary is configured.** Host-only is
  the declared default, not an absence.
- **Do not auto-apply a vision-touching challenge.** Auto-accept covers
  spec-aligned mechanics only.
- **Do not retry on a failed audit.** If it errors or returns a malformed
  summary, log it and continue; the user can re-run `/ossify:challenge`
  against the spec directly.
