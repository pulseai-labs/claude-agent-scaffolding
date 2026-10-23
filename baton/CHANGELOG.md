# Changelog

All notable changes to the `baton` plugin.

## 0.2.1 - 2026-10-23

- Example recipe `ossify-spine`: `spine_review`'s message now puts a space, not a newline,
  after the PR URL. OMP splits a slash command's arguments on spaces and tabs only, so the
  newline joined the URL to the next word, `/review` failed to parse it, and the seat opened its
  interactive Review Mode picker under T3 and stalled (#894). A recipe test pins the URL as
  `/review`'s own argument. The MCP `clientInfo.version` string now reads 0.2.1.

## 0.2.0 - 2026-10-23

- Example recipe `examples/ossify-spine/`: runs an ossify feature spine end to end on T3 — the
  detached run-spine lane, one implementer per work item, gap re-entry, close and correction,
  ordered merges onto the spine branch, the spine PR's review rounds, and the spine close — with
  its briefs (prose; one `common.md` every seat reads first). No engine behaviour change; the MCP `clientInfo.version` string now reads 0.2.0.
- README: the "Example: an ossify spine" section — the arm command and the operator runbook.

## 0.1.0 - 2026-10-22

First release.

- Engine: a recipe (validated, frozen at `arm`) drives units through stages; `baton tick` launches
  sessions when a unit is due, reads closed signals, and merges a pull request only by the
  recipe's rule, with parking, `unpark`, `status` and `report`.
- T3 Code host over the tailnet `/mcp` endpoint, and `baton t3 login` (OAuth with PKCE, token
  file mode 600).
- `omp-t3-claim`, the launcher that applies a claim file before starting `omp-t3`.
- systemd user timer: `baton timer install|remove`, installed by `baton arm` unless `--no-timer`.
