# ossify (v1.12.0)

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
line. Since 1.6.0 (#139) `close`'s impl-check gate gains Layer 4: a semantic
review over three lenses (fidelity, pattern, absence) at work-item close,
applied inline on every harness. Since 1.10.0 (#507) Layer 4 always runs
inline — the delegated multi-agent engine behind it is removed.

Since 1.8.0, `/ossify:run-spine <spine-id> --external-executor` is an optional,
provider-neutral execution seam: instead of dispatching its own nested
implementer, the lane prepares every same-round worktree and handoff, hands the
round out as one `external_execution_request` per item, and takes back one
`external_execution_result` each. It names no tool, product or model; the caller
supplies the procedure. Everything on either side of that one step is unchanged
— worktrees, handoffs, the return contract, declared-order closes, serial
merges, the round barrier, the 3-dispatch cap. The mode adds no return mode: a
rejected item is repaired through a correction continuation that returns the
same `complete` shape, and Layer 4 runs inline there as it does everywhere.
**`/ossify:run-spine <spine-id>` with no flag is
completely unchanged** and still dispatches `ossify:implementer-agent`.

Since 1.9.0, the deterministic gates close the vacuous-green family: the
zero-tests guard no longer inverts a true match past the pipe buffer, flags
only when a zero-marker has no positive-execution marker beside it (an
aggregate suite with one empty target is no longer misflagged), and
recognizes `cargo nextest` plus vitest's `No test files found` and
`Tests  0 passed` phrasings. `oss demo_run` fails a ledger that executed
zero lines - empty, user-only, or all-quarantined - instead of printing
`PASS 0 lines`, and the close ceremony's quarantine check writes its
head/parent evidence into a per-invocation tempdir rather than fixed `/tmp`
paths that collided across concurrent closes.

Since 1.11.0, two states the lifecycle could not express have a verb. A work
item minted and then withdrawn before any dispatch is marked `abandoned`
(`oss work_item_status <id> abandoned`): the round walk, spine close, harvest
and release close all skip it, where before it either blocked spine close as
`planned` or recorded a merge that never happened as `complete`. The verb
refuses it on an item that was already dispatched — a recorded branch or
worktree is the dispatch, and withdrawing one would strand its work. And a
bone's or risk gate's touch surface can be **re-pointed** after the code it
covers moves (`oss bone_set_touch`, `oss risk_gate_set_touch`). That is a
correction the caller applies, **not a detector**: nothing here notices that a
surface has gone stale, and a re-point to a glob that matches nothing is
accepted. What the verbs refuse is a list carrying no glob at all. Both are
journaled corrective appends. The op names `set_bone_touch` and
`set_risk_gate_touch`, their payloads `{adr,touch}` and `{name,touch}`, and the
status value `abandoned` are a compatibility contract: live journals written by
an earlier local build already carry them, and renaming an op is what replay
catches (`unknown op`, rc 4). A payload reshape does **not** fail replay, and it
fails in two different ways, so neither mode is a safe default to describe: a
renamed **identifier** key (`adr` → `adr_ref`) applies as a silent no-op — the
surface is left as it was — for a registry whose rows carry their key, where a
row whose key is null or absent is instead matched by the null comparison and
gets its surface overwritten; and a renamed **value** key (`touch` → `surface`)
is destructive — it writes `touch: null` at rc 0, and **one** such row makes
**every** `touch_check` answer `INCONCLUSIVE, not clean` (rc 2), not only the
damaged surface's, because the read is a single pass that the first null aborts.
The payload keys are held by this contract and by the verbs' own tests, not by
replay alone.

Since 1.11.1, the registries' corrective-append verbs refuse input they would
otherwise silently misinterpret. A re-point or a controls rewrite whose list
carries an entry with leading or trailing whitespace — a CR kept from a CRLF file
is the usual source — is refused at rc 2 and the entry is named with its
whitespace escaped, instead of being journaled as a glob that can never match the
path it was meant to cover; a list with no entry in it at all is refused for the
same reason, on all three verbs rather than the two that had the guard. The two
mint verbs refuse such an entry too, so a bone or gate cannot be *created* with a
surface that silently covers nothing, and a caller who space-splits a list gets a
usage refusal naming the CSV grammar instead of a silently shrunk surface — on
every list-taking verb except `bone_add`: its 4th argument is optional, so no
arity guard can tell a glob from a revisit trigger, and `bones-registry.md`
states where the second word lands instead. And
`bone_add` / `risk_gate_add` refuse a ref that already exists rather than minting
a second row for one key, which had left the operator holding a surface the
re-point verb then refused to repair — that rail runs inside the state lock, so
two ceremonies racing to mint the same key cannot produce the duplicate either.

Since 1.11.2, the `abandoned` carve-out is complete on the close path, and the
detector the re-point verbs never had ships as a doctor sweep. A work item
withdrawn before dispatch is diagnosed as just that when `/ossify:close` is
pointed at it, instead of being told the execution lane skipped
`work_item_exec` — the two want opposite actions, which is why the status is read
before the diagnosis. Spine close's all-withdrawn halt now names the whole route
out, including the two obligations a retirement carries: the demo-ledger
amendment the withdrawal owes (and for an ordinary active line whose only
implementation was withdrawn, retire-or-replace rather than `ledger_unplan`,
which answers rc 7 there), and any repo armed for that spine. The same gate
refuses a spine with **no** work items — it was never decomposed, and passing
used to move the discovery to a later step — step 5's changed-path guard, or
step 4's demo on a zero-line ledger. Release close halts
when its tag set is empty, instead of recording a release that published nothing.
And `doctor` reports a bone's or gate's touch surface that matches **no** tracked
file in any declared repo — per SURFACE, so a list that is only partly dead still
reads clean: a surface re-pointed at a tree that does not exist reads `clean` on
every path and the spine is never reclassified. The repair has existed since
1.11.0, and now the detection does too.

Since 1.12.0, the never-strand invariant has **one predicate and one place**. A
work item counts as dispatched when it records any of the three fields the
dispatch writer journals — `branch`, `worktree_path`, `base_sha` — and that one
definition now answers in both directions and at the spine level: an item that
records a dispatch, or that has landed, is never `abandoned`; an `abandoned` item
is never dispatched; and a spine any of whose items records a dispatch, is
`active`, or has landed is never retired. Each refusal is evaluated **inside the
state lock**, so a concurrent writer's commit is visible to it — the previous
reads happened before the lock, which is a check-to-append race with data loss as
its outcome. A duplicate work-item id is named as a duplicate (rc 7, pointing at
#305) instead of being misreported as a state-read failure, and it is refused for
every status rather than for `abandoned` alone. No journal op, payload key or
status value changes: the rails are verb-side, so a journal that already holds an
inconsistent pair still replays clean and `doctor` reports it as drift.

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
