**Does CodeRabbit read the PR description?** Not documented — checked 2026-09-26 against
https://docs.coderabbit.ai/guides/review-instructions, https://docs.coderabbit.ai/faq,
https://docs.coderabbit.ai/overview/pull-request-review.md and
https://docs.coderabbit.ai/knowledge-base/index.md: none of them lists the pull request title
or description among a review's inputs, so the six-field body must be assumed invisible to
CodeRabbit too. What it *is* documented to read: `**/AGENTS.md` and other code-guideline files,
automatically, as review criteria (https://docs.coderabbit.ai/knowledge-base/code-guidelines.md)
— so the Code Review Rules section reaches CodeRabbit as well as Codex.

# CodeRabbit configuration

Only for **public** repositories — CodeRabbit's free tier reviews public repositories only, so
a private repository's automatic reviewer is Codex alone.

Write `.coderabbit.yaml` at the repository root:

```yaml
# yaml-language-server: $schema=https://coderabbit.ai/integrations/schema.v2.json
reviews:
  profile: chill
  path_instructions:
    - path: "**"
      instructions: |
        Mark a finding as blocking only if the change rejects valid input, or corrupts or
        loses state, on a path it touches, or it breaks the test suite, or it opens a
        security hole (injection, an authentication bypass, an exposed secret); say which.
        Everything else is a non-blocking suggestion. An input or state the change does not
        handle is not a finding by itself unless it meets that rule; a documented refusal of
        an unsupported input is correct behaviour.
```
