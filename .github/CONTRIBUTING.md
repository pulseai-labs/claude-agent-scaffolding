# Contributing to pulsestack

pulsestack is a plugin marketplace for coding agents. Each top-level plugin directory (`ossify/`,
`merge-bar/`, `crew/` and the rest) is one plugin, published from this one repository. The
root [README's plugin table](../README.md#all-plugins) says which harnesses each one ships on:
Claude Code, Codex, OMP, or a subset. There is no application: the plugins are the product.

Bug reports, feature requests and pull requests are welcome. The issue forms ask for what a maintainer
needs first: for a bug, the plugin, its version and the harness it ran on.

## Before you change a plugin

- Read [`CLAUDE.md`](../CLAUDE.md). It holds the repository's engineering policy: testing
  discipline, the shell gotchas that have cost time here, the git policy and review discipline.
- Read [`docs/conventions/skill-first.md`](../docs/conventions/skill-first.md). For code that ships
  and runs on a user's path, it decides whether the change is a prose skill or code. Build, release
  and test tooling is outside its scope.
- To try a plugin from your checkout, add the checkout as a marketplace; the root
  [README's Install section](../README.md#install) has the Claude Code and Codex commands under
  **Local development**.

## Tests

[`.github/workflows/tests.yml`](workflows/tests.yml) is the authoritative list of what must pass.
Run the suite of every plugin you changed, and the repo-root `tests/` gates, which catch breaks
between plugins and between the marketplace surfaces. A passing test is not evidence on its own:
`CLAUDE.md` says how to mutation-test one with `tests/lib/mutate.sh`. Some gates run in neither CI
nor a plugin's own runner (sage's hand-walked checklists, ossify's `tests/eval/`); `CLAUDE.md`
says how to find them before a version bump.

A change to a plugin's manifest or packaging must reach every surface that plugin ships on.
`tests/test-codex-dual-publish.sh` and `tests/test-omp-surface.sh` check that parity.

## Pull requests

- Work on a branch and open a PR; nothing is pushed to `main` directly.
- Fill in the PR template. Its seven fields (Claim, Scope, Known limits, Merge danger, Merge bar,
  Evidence, Closes) are the body that [merge-bar](../merge-bar/) reviews against, and the Merge bar
  decides which review findings block. How to fill each field is in
  [merge-bar's template notes](../merge-bar/skills/opening-a-pr/references/pr-body.md).
- A PR merges by merge commit or rebase, never by squash. It needs the "repository test suites"
  check green, a branch that is up to date with `main`, and every review thread resolved.
- Commit messages carry no AI-attribution trailers (`Co-Authored-By:` an assistant, "Generated
  with" lines).

## Reporting a security issue

Do not open a public issue. Follow [`SECURITY.md`](SECURITY.md).

## Conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
