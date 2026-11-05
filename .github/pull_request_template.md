## Claim
<1–3 sentences: what this PR makes true. Each sentence checkable against the diff.>

## Scope
Touches: <areas and paths>. Deliberately does not touch: <areas>.

## Known limits
- <edge case or gap this PR knowingly does not handle> — <why that is acceptable here>

## Merge danger
Door: <one-way or two-way> — <what a revert of the merge would not undo>
Blast radius: <who or what breaks, and how, if this change is wrong>

## Merge bar
A finding blocks this PR only if it:
1. rejects valid input, or corrupts or loses state, on a path this PR touches;
2. makes the Claim above false;
3. breaks the test suite;
4. opens a security hole — injection, authentication bypass, or an exposed secret.
Everything else is non-blocking.

## Evidence
<Each command run this session, and what it showed.>

## Closes
Closes #<n>
