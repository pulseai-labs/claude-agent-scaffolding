---
name: challenge
description: Stress-test a plan or design by interview, or run an adversarial audit of a written spec or plan with an optional external fresh-frame adversary. Activate on "grill me", "stress-test this", "pressure-test this", "challenge my design", "poke holes", "what am I missing", "audit this spec", "adversarial review", "deep audit", "fresh-frame review", or /ossify:challenge. Ossify's lifecycle moments call both modes internally — the bone grill gate, the spec-core close audit, the release class veto, the spine plan and close audits.
---

# challenge

Ossify's own grill and adversarial critic. Two modes, one skill, no plugin
dependencies. This body is a router: it picks the mode and nothing else.

---

## 1. Route

- **An artifact path is present** (a command argument, or the invoking prose
  names a file to audit) → **audit mode.** Read
  `${CLAUDE_PLUGIN_ROOT}/skills/challenge/references/audit.md` end to end and
  follow it, with the artifact and the depth the caller named.
- **Audit intent with no path** — the invocation says *audit / critique /
  adversarial review / deep audit* of material that sits in the conversation
  → **still audit mode.** Write the pasted material to a scratch file (a
  `SPEC*`/`PLAN*` name under `${TMPDIR}`), audit it, and say where it was
  written; if the material is only described, not pasted, ask for the file.
  Explicit audit intent never falls through to an interview.
- **A plan or design sits in conversation, to be stress-tested interactively**
  → **interview mode.** Read
  `${CLAUDE_PLUGIN_ROOT}/skills/challenge/references/interview.md` end to end
  and follow it.
- **Ambiguous** → ask one question: audit this artifact, or grill this plan?

## 2. Who calls which mode

| Caller | Mode | Depth | Gating |
|---|---|---|---|
| `start` §11 spec-core close | audit | close | advisory — never gates |
| `plan-release` §7c class veto | audit | close | **fail-closed** — the veto is the caller's interpretation |
| `plan-spine` §6 plan audit | audit | close | optional, user-asked |
| `plan-spine` §7 bone grill gate | interview | — | offered, bone-only, never auto-invoked |
| `close` §7 spine close | audit | close on bone, shallow on flesh | class-scoped record |
| `wayfinder` chart step 1 | interview | — | advisory — it fixes the map's destination, never gates |
| `wayfinder` `grilling` ticket | interview | — | the ticket **is** the grill; resolving it closes the ticket |
| the user, directly | either | — | — |

**Wayfinder's two rows take the direct-invocation shape, not the ceremony
one.** An operator is in the loop both times — `ticket-types.md` §2 makes
`grilling` HITL and refuses to dispatch it to a subagent — so the challenge
set is walked with the operator and a rebuttal record is kept. Where that
record lands is wayfinder's call: the map's `Notes` for chart step 1, the
ticket's resolution comment for a `grilling` ticket.

The callers own their moments, their gating, and their dispositions. This
skill yields the challenge set — **unwalked for ceremony callers** (their
ladders are the rebuttal), with a rebuttal record when the user invoked it
directly; what a finding *does* is decided by the reference that invoked you
(`critic-veto.md`, `critic-moment.md`, `spine-close.md`).

## 3. The adversary is configuration

Close-depth audits recruit one external fresh-frame adversary per the ladder in
`references/adversaries.md`: per-invocation override → `OSSIFY_ADVERSARY` →
host-only. Unconfigured means host-only by declaration. The summary names what
ran.

## 4. Nevers

- **Never gate.** Advisory or veto is the caller's semantics, never yours.
- **Never invoke a peer plugin.** No `Skill(...)` call leaves ossify; both
  modes are internal.
- **Never restate a mode's procedure here.** The references are the only copy.
- **Never ask the user a fact the environment can answer** (interview mode).
- **Never alter the closing-line tokens** (audit mode §8) without changing
  every consuming reference in the same commit.
- **Never let this body exceed 250 lines.** Thin-by-design is a stated
  constraint, not an aspiration.
