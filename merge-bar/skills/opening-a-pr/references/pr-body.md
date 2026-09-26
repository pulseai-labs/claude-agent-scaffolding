# The PR body

Copy this template exactly. Six `##` headings, in this order. The Merge bar block is copied
word for word; the only permitted change is one optional line after it that **raises** the
bar (for example "Any change to the on-disk format blocks."). It never lowers conditions 1–4.

```markdown
## Claim
<1–3 sentences: what this PR makes true. Each sentence checkable against the diff.>

## Scope
Touches: <areas and paths>. Deliberately does not touch: <areas>.

## Known limits
- <edge case or gap this PR knowingly does not handle> — <why that is acceptable here>

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
```

## Filling each field

- **Claim** — what becomes true for a user of the change, not a list of what you did.
- **Scope** — both halves. "Does not touch" is what makes an out-of-scope finding
  recognisable as one.
- **Known limits** — one line per limit, each with its reason. Write `None.` only when that is
  the honest answer; usually it is not, because every change leaves some input or state it
  does not handle.
- **Merge bar** — the block above, unchanged, plus at most one raising line.
- **Evidence** — only what ran in this session, with its result. If nothing ran, write
  `Not run — <why>`.
- **Closes** — one `Closes #N` line per issue. If the PR closes nothing, write `None.`
