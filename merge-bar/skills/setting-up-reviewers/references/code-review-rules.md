# The review rules section

Append the block below to the reviewed repository's root `AGENTS.md`, or create the file
holding only this block. Codex's GitHub reviewer reads this heading; any other agent reviewer
reads it too. Rule 3 is optional — include it only when the operator names the one domain
invariant reviewers most often have to explain.

```markdown
## Code Review Rules

### What can block a merge

- Mark a finding as blocking only if the change rejects valid input, or corrupts or loses
  state, on a path it touches — or it breaks the test suite. Say which of those it is.
  Safe path: everything else is a suggestion; mark it non-blocking.

### Edge cases the change does not handle

- An input or state the change does not handle is not a finding by itself. Raise it only
  when it meets the blocking rule above; otherwise mention it once, marked non-blocking.
  Safe path: a documented refusal of an unsupported input is correct behaviour.

### <The domain invariant, in a few words>

- Flag <what breaks the invariant>, because <why it matters>.
  Safe path: <the accepted way to do it>.
```

These rules deliberately never refer to the PR description: Codex is not documented to read
it, so a rule that depends on it would silently do nothing there.
