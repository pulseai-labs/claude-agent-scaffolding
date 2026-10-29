# Baseline standards

The Standards axis applies these in every project. A project's `CODING_STANDARDS.md` adds to
them and overrides them where the two conflict.

## Checks that lie

A green check is a claim. Each of these passes while checking nothing:

- **Tautology** — the expected value comes from the code under test: a value compared with
  itself, a round trip that re-derives what was just written, a snapshot taken from the
  output it guards.
- **A mock that cannot fail** — the test asserts on its own stub's return or call list, or
  mocks the very module it claims to test.
- **Structure-sensitive** — it pins wording, order or line layout rather than behaviour, so a
  correct rewrite breaks it and a wrong one with the same shape passes.
- **Never reaches the path** — the input never enters the branch the claim is about; an early
  return, a skipped fixture or a default swallows it.
- **Self-certifying** — a grep or string check that its own comment, fixture or error message
  satisfies.
- **Coupled fixtures** — one test's setup or leftover state makes another pass.

Ask of each new or changed test: if the code it covers were wrong, would this fail? If not, it
is a defect in the test, and the Claim it backs ("a test pins X") may be false.

## A loosening needs an adjacent control

A change that makes a check accept more — a wider pattern, a new exemption, a relaxed
assertion — fails by accepting everything. It needs a case that must still fail, next to the
case that must now pass.

## Every finding is a class

A defect is a pattern, not a line. Name the pattern, sweep the whole repository for it, and
report every site — in scope and outside it.
