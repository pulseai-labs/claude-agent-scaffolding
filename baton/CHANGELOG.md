# Changelog

All notable changes to the `baton` plugin.

## 0.1.0 - 2026-10-22

First release.

- Engine: a recipe (validated, frozen at `arm`) drives units through stages; `baton tick` launches
  sessions when a unit is due, reads closed signals, and merges a pull request only by the
  recipe's rule, with parking, `unpark`, `status` and `report`.
- T3 Code host over the tailnet `/mcp` endpoint, and `baton t3 login` (OAuth with PKCE, token
  file mode 600).
- `omp-t3-claim`, the launcher that applies a claim file before starting `omp-t3`.
- systemd user timer: `baton timer install|remove`, installed by `baton arm` unless `--no-timer`.
