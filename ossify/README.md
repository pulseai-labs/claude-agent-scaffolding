# ossify (v1.8.0)

Skeleton-first lifecycle plugin: Release 0 → MVP → v1, driven by bone and flesh
spines against a cumulative demo ledger. Nine entry skills (`start`, `adopt`,
`plan-release`, `plan-spine`, `work-item`, `close`, `doctor`, `challenge`,
`wayfinder`) plus `/ossify:run-spine`, which drives a planned spine's rounds
end to end, and the standalone utilities — session handoff
(`/ossify:handoff`, `/ossify:handoff-resume`) and the PR review-fix-merge
loop (`/ossify:work-pr`) — which work in any repository, ossify-initialised
or not. Since 1.5.0 (#339) `work-pr` is also the spine-close merge lane: a
spine's hosting repos land on their base branches by PR where a remote exists
(merged locally only where none does), and a release is a tag on the merged
line. Since 1.6.0 (#139) `close`'s impl-check gate gains Layer 4: a delegated
semantic review over three lenses (fidelity, pattern, absence) at work-item
close, applied inline on every harness or by a dedicated Workflow-tool pass
on Claude Code on Anthropic.

Since 1.8.0, `/ossify:run-spine <spine-id> --external-executor` is an optional,
provider-neutral execution seam: instead of dispatching its own nested
implementer, the lane prepares every same-round worktree and handoff, hands the
round out as one `external_execution_request` per item, and takes back one
`external_execution_result` each. It names no tool, product or model; the caller
supplies the procedure. Everything on either side of that one step is unchanged
— worktrees, handoffs, the return contract, declared-order closes, serial
merges, the round barrier, the 3-dispatch cap. The mode adds no return mode: a
rejected item is repaired through a correction continuation that returns the
same `complete` shape, and Layer 4 runs inline there because the caller has
already reviewed the item. **`/ossify:run-spine <spine-id>` with no flag is
completely unchanged** and still dispatches `ossify:implementer-agent`.

Since 1.7.0 (#368), every bare `doctor` sweep includes plugin provenance and
`doctor provenance` runs it alone. It reports the answering `oss` binary, the
loaded doctor body, and the expected checkout or Claude installed version
separately. A version mismatch exposes prior `oss` verbs and compares only
product prose actually loaded earlier in the session; it does not scan unused
skills or decide reruns. The guarantee starts after one update and fresh
session. Codex and OpenCode installed-reference resolution remains partial
(#396, #399).

`wayfinder` is both at once, which is why it is listed above rather than
below: an entry skill with its own skill directory, and an any-repo one. It
charts a question into decision tickets on the issue tracker, or works an
existing map's frontier one ticket per session. The three utilities have no
skill directory — their depth lives in `references/` — so they are a Claude
Code command surface only and the OpenCode bundle does not carry them (#131
tracks the command-registration gap there). Every entry skill, `wayfinder`
included, is in the bundle.

`challenge` is the grill and the adversarial critic, absorbed in-tree at 1.1.0:
the bone grill gate, the spec-core close audit, the release class veto, and the
spine plan/close audits all run on ossify alone — no ai-mentor or
architect-critic install required. Both plugins remain useful standalone;
ossify no longer depends on either. A close-depth audit recruits an external
fresh-frame adversary when one is configured via `OSSIFY_ADVERSARY`
(`skills/challenge/references/adversaries.md`); unconfigured means host-only,
by declaration.

Ossify is in the Claude and Codex marketplaces as of v1.0.0. In the OpenCode
bundle it stays an explicit opt-in: bundle installability begins only after an
immutable bundle tag is published, and it requires the root bundle's explicit
four-plugin allowlist documented in
[`../.opencode/INSTALL.md`](../.opencode/INSTALL.md). Plan D's consolidated eval
covers all 10 acceptance scenarios; scenario 10 is a run rather than a standing
fixture, and its second run agreed **5 of 5 with no divergence** after the prose
fixes its first run prompted (#250, #251). That is two runs on one scenario, not
a measured property of the prose — #254 stands over both. The two real-project
pilots are operator-owned and post-v1.

Ossify requires a topology declaration and nothing else: `/ossify:start` and
`/ossify:adopt` author `.ossify/topology.json` themselves, and a workspace-init
`.workspace/pairing.json` is read as a translated fallback when one exists.
`workspace-init` is optional. Round execution dispatches the
`ossify:implementer-agent` subagent. Claude Code registers it natively, and the
OpenCode adapter registers `ossify-implementer-agent` as well, so rounds run on
both. **Codex** has no worker path: its planning, diagnosis and close skills
work, and rounds are driven from Claude Code or OpenCode. The critic is
internal, so the release-planning veto and the spine-close audit run on every
install, Codex-only included.

Design of record and the release roadmap are tracked in this repository's
issues and git history rather than as shipped files.

Dispatcher: `bin/oss`. Tests: `bash tests/run-all.sh`.
