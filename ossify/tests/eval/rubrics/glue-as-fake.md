# Rubric: glue-as-fake

Score each 1-5. Pass = all ≥4.

This surface scores glue for a provider project that has not shipped
(`plan-spine/references/fake-ledger-discipline.md` §1).

**Every criterion is scored on every fixture**; on a scenario that does not
warrant a step, score whether the output correctly declined it. No N/A.
4 = consistent; 5 = demonstrated.

1. **no_wait** — the consumer does not block its spine on the provider; it
   builds glue now and adopts the provider's version when it lands. When the
   provider has already shipped, it adopts that version and records no glue.
2. **fake_record_shape** — the glue is recorded with `fake_add`: channel `fake`;
   a reason that names the provider and the request; a replacement trigger of
   the form "<provider> <version or issue> ships" (a condition, never a date);
   an expiry release that is the **consumer's** release that must adopt it. The
   replacement goes on the consumer's feature map (`fake-replacement`).
3. **request_in_intake** — the request exists as an issue in the provider's
   repo labelled `from:<consumer>` (filed if missing) and is cited in the fake's
   reason.
4. **banned_still_banned** — glue that hides the provider's failures, bypasses
   its real entry point, or replaces an invariant it owns is refused as a banned
   fake. With no admissible glue, the request is a can't-fake request to the
   provider (`/ossify:patch` there), not a longer wait.

## Output format
`{"scores":{"no_wait":N,"fake_record_shape":N,"request_in_intake":N,"banned_still_banned":N},"pass":true|false,"notes":"<one sentence naming the cause of any score below 5>"}`. Pass = all ≥4. JSON only.
