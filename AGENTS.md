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

- Flag new runtime code shipped on a user's path that reads and reports rather than mutating
  durable state, because this repository's skill-first rule makes that work prose — see
  `docs/conventions/skill-first.md`, which is authoritative.
  Safe path: deterministic code only where it mutates durable state; apply that file's
  decidable test before adding library code under a `lib/`.
