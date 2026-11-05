# Contributing to pulsestack

pulsestack is a plugin marketplace for coding agents. Each top-level plugin directory (`ossify/`,
`merge-bar/`, `crew/` and the rest) is one plugin. All of them are published from this one repository
to Claude Code, and most of them to Codex and OMP as well. There is no application: the plugins are the product.

Bug reports, feature requests and pull requests are welcome. Use the issue forms, so a report names
the plugin, its version and the harness it ran on.

## Before you change a plugin

- Read [`CLAUDE.md`](../CLAUDE.md). It holds the repository's engineering policy: testing
  discipline, the shell gotchas that have cost time here, the git policy and review discipline.
- Read [`docs/conventions/skill-first.md`](../docs/conventions/skill-first.md). It decides whether
  a change is written as prose in a skill or as code, and most changes here are prose.
- To try a plugin from your checkout, add the checkout as a marketplace; the root
  [README's Install section](../README.md#install) has the commands under **Local development**.

## Tests

[`.github/workflows/tests.yml`](workflows/tests.yml) is the authoritative list of what must pass.
Run the suite of every plugin you changed, and the repo-root `tests/` gates, which catch breaks
between plugins and between the marketplace surfaces. A passing test is not evidence on its own:
`CLAUDE.md` says how to mutation-test one with `tests/lib/mutate.sh`.

A change to a plugin's manifest or packaging must reach every surface that plugin ships on.
`tests/test-codex-dual-publish.sh` and `tests/test-omp-surface.sh` check that parity.

## Pull requests

- Work on a branch and open a PR; nothing is pushed to `main` directly.
- Fill in the PR template. Its seven fields (Claim, Scope, Known limits, Merge danger, Merge bar,
  Evidence, Closes) are the body that [merge-bar](../merge-bar/) reviews against, and the Merge bar
  decides which review findings block.
- A PR merges by merge commit or rebase, never by squash. It needs the "repository test suites"
  check green, a branch that is up to date with `main`, and every review thread resolved.
- Commit messages carry no AI-attribution trailers (`Co-Authored-By:` an assistant, "Generated
  with" lines).

## Reporting a security issue

Do not open a public issue. Follow [`SECURITY.md`](SECURITY.md).

## Conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
