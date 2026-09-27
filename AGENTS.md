## Code Review Rules

### What can block a merge

- Mark a finding as blocking only if the change rejects valid input, or corrupts or loses
  state, on a path it touches — or it breaks the test suite, or it opens a security hole
  (injection, an authentication bypass, an exposed secret). Say which of those it is.
  Safe path: everything else is a suggestion; mark it non-blocking.

### Edge cases the change does not handle

- An input or state the change does not handle is not a finding by itself. Raise it only
  when it meets the blocking rule above; otherwise mention it once, marked non-blocking.
  Safe path: a documented refusal of an unsupported input is correct behaviour.

### The skill-first rule

- Flag new runtime code on a user's path that breaks this rule: **Code that MUTATES DURABLE STATE may be deterministic. Code that READS AND REPORTS must be prose.** `docs/conventions/skill-first.md` is authoritative for its scope and its decidable test.
  Safe path: apply that file's decidable test before adding code under a `lib/`.
