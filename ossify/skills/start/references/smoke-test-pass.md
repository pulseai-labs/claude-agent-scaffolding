# Smoke-test pass over unverified claims

Depth for SKILL.md §9. Implements the promoted principle
`pp-smoke-test-pre-spec`: **every technology claim a bone rests on is either
verified by a minimal isolated smoke test, or explicitly marked unverified in
that bone's ADR.**

Routine, lightweight, and cheap. Distinct from the feasibility spike — see §5.

---

## 1. What counts as a claim

Anything the bones registry assumes about the outside world:

- **Crate / package existence and name** — "there is a crate called `X`". The
  single most common hallucination class.
- **Version / API surface** — "`X` v2 exposes `fn foo(&self) -> Bar`",
  "this endpoint accepts a `since` parameter".
- **Integration assumption** — "`A` and `B` compose", "this runs under WASM",
  "the driver is async-safe", "this library is `Send + Sync`".
- **Platform / toolchain fact** — "this builds on the target we ship to",
  "the CLI is on the runner image".
- **Performance-shaped assumption load-bearing for a bone** — only when a bone
  *depends* on it (e.g. "in-process is fast enough that we need no queue").

Not a claim: anything about your own not-yet-written code. That is design, not
fact, and it is what the feasibility spike is for.

---

## 2. Protocol

For each claim, in a **throwaway worktree** (never the project tree):

1. **State the claim in one sentence**, as a falsifiable proposition.
2. **Write 20-50 lines** that would fail if the claim were false. Minimum viable
   evidence: an import + one real call, a `cargo add` + `cargo check`, one HTTP
   request against the real endpoint with the real parameter.
3. **Run it.** Record the actual output — the version resolved, the signature
   the compiler accepted, the response shape.
4. **Discard the code.** Keep only the recorded outcome. Smoke-test code never
   enters the project tree; if it did, it would be the first fake nobody
   registered.
5. **Record the outcome in the bone's ADR** — one line under a `Verified claims`
   heading: the claim, the date, and the concrete evidence (`serde_json 1.0.x,
   from_str::<Value> compiles`).

Time-box the whole pass. If a single claim eats more than ~15 minutes, it is
not a smoke test — reclassify it: a claim that needs *reading* rather than
running (a comparison, a constraint, a rate limit) is research
(`references/research.md`); genuine architectural uncertainty is a spike (§5);
a claim neither can settle now is an explicit `unverified` mark (§3).

---

## 3. When to mark a claim `unverified`

Marking is a legitimate outcome, not a failure — the sin is the *silent*
assumption, not the acknowledged one. Mark `unverified` when:

- The claim cannot be tested without credentials, hardware, or a paid account
  you do not have yet.
- The claim is about a system that does not exist yet (a partner API in
  development).
- The cost of verification exceeds the cost of being wrong at Release 0 — e.g.
  the bone is easily reversible.

Then, in the bone's ADR:

```markdown
### Unverified claims
- `<claim>` — unverified (<why>). Revisit trigger: <the event that forces it>.
```

_Dispatcher invocations below are `"$oss_bin" …` — the calling skill resolves `oss_bin` once (recipe: the plugin's `rules/dispatcher-path.md`); if it is unset in your context, resolve it there first._

An `unverified` claim **must** get a revisit trigger, and it is a strong
candidate for the bone's own `revisit_trigger` field. It is also good
feature-map material (`"$oss_bin" feature_add "verify <claim>" ... spec`) when the
verification will itself be work.

---

## 4. Where the evidence lives

- **Verified / unverified lines → the bone's ADR.** That is the durable record;
  it is what a later reader checks when the bone is questioned.
- **The registry entry** (`"$oss_bin" bone_add`) carries the index, not the evidence.
- **Nothing goes into the project tree** from the smoke test itself.

---

## 5. Smoke test vs. feasibility spike

| | Smoke test (this) | Feasibility spike (`references/spike-contract.md`) |
|---|---|---|
| Question | "Is this external fact true?" | "Can this architecture work at all?" |
| Scope | One claim | One hypothesis about the design |
| Size | 20-50 lines, minutes | Timeboxed, hours-to-days |
| Ceremony | None — routine, run as many as needed | Explicit offer + a written contract |
| Code fate | Discarded | Discarded (`code_fate: discard`, contractually) |
| Output | A line in a bone's ADR | A recorded decision |

The overlap is real and the boundary is judgment. The tell: if you already know
*what* to build and only need to confirm a fact about a dependency, it is a
smoke test. If you do not yet know whether the shape works, it is a spike.

---

## 6. Anti-patterns

- **Assuming a crate/version because it sounds right.** This is the exact defect
  the principle was promoted to prevent.
- **Smoke-testing in the project tree.** The throwaway code becomes a fixture,
  the fixture becomes a dependency, and nobody registered a fake.
- **Letting the smoke pass grow into implementation.** 20-50 lines. If it wants
  to be 300, it is a spike.
- **Silent assumption.** Verified or explicitly `unverified` — never neither.
- **Verifying claims nobody's bone rests on.** The pass is scoped by the
  registry, not by curiosity.
