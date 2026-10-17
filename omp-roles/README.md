# omp-roles

The OMP role pack for default mode. 0.5.0 ships `omp-seat`, the launcher that pins the `seat-mods`, `molt` and `autonomic` OMP extensions onto a seat, and the `implementer` and `seat-reviewer` agents. The launcher accepts `worker` (`omp-seat worker`) and ships the `spine-driver`, `close`, `work-pr` and `orchestrator` coordinator roles, launched with `omp-seat <role>`. Since 0.6.0 it also ships `crew-spine` and `crew-work-pr` for herdr-crew 0.2.23's activated spine session and work-PR session: their brief is the procedure, and every seat they create is a herdr pane, never a task subagent (#839). `spine-driver` and `work-pr` stay the default-lane roles. Since 0.7.0, `omp-seat` passes `seat-config.yml` to every seat as a `--config` overlay that turns off omp's todo reminders: a reminder restarts a stopped turn while todos are open, so the seat could not go idle for molt's handoff (#843). The `todo` tool stays on. OMP only: it has no `.claude-plugin/` and Claude Code never loads it.

`orchestrator`: the OMP top; needs seat-mods 0.4.4, autonomic 0.7.0 and herdr-crew 0.2.19 (its procedure, the `orchestrate` skill), and `omp-seat` refuses the role without them. Launch with `SEAT_MODS_ROLE=orchestrator`; `omp-seat` refuses the role without it, since the #798 rail keys on it. Since 0.5.0, `omp-seat orc` is the operator's short form: it sets `SEAT_MODS_ROLE=orchestrator` when the variable is unset or empty (another value is kept and refused) and runs `omp-glm` unless `--via` names another wrapper.

The `implementer` autoloads ossify's `work-item` skill and returns its JSON after staging, without committing. Install ossify 1.18.0 for `run-spine`'s OMP dispatch by agent name. Under `omp-seat`, implementer children use seat-mods' verifier profile, which denies commit, push and PR creation. Its writes are allowed in the coordinator's checkout and under `SEAT_MODS_ALLOW`; the guard does not keep it out of the checkout. The `seat-reviewer` reads a diff and writes only the report path its brief names; its first line records the reviewed HEAD, followed by findings or `Findings: none`.

Under `omp-seat`, a `spine-driver`, `close`, `work-pr`, `crew-spine` or `crew-work-pr` launch must export `SEAT_MODS_ROLE=coordinator` (unset, seat-mods guards the session as an implementer, which denies the commits, pushes and merges the procedures need) and list each hosting repo's worktree root in `SEAT_MODS_ALLOW` (e.g. `SEAT_MODS_ROLE=coordinator SEAT_MODS_ALLOW=/path/to/repo/.worktrees omp-seat spine-driver`).

### Opt-in trusted OMP assignment launch (unreleased)

A dispatcher with separately recorded operator approval issues through the installed Autonomic `bin/authority.ts`, then sets all five startup fields: `AUTONOMIC_AUTHORITY_PATH`, `AUTONOMIC_AUTHORITY_SHA256`, `AUTONOMIC_ASSIGNMENT_ID`, `AUTONOMIC_ASSIGNMENT_GENERATION`, `AUTONOMIC_LAUNCH_ID`. A role, `AUTONOMIC_MODE`, seat selection, plan approval or digest supplied by the worker is not enrollment. No binding keeps legacy/manual launch; a partial/invalid binding refuses before even the via's version probe.

`omp-seat` resolves the already selected Autonomic install root and synchronously invokes `bun <root>/bin/authority.ts validate-launch --worker-root <root>` for the captured allowance; no inter-plugin import. Validation includes actual assignment worktree, all `SEAT_MODS_ALLOW` entries (coordinator `.worktrees` included), report/scratch and declared output roots. Authority/input/evidence/policy and parent directories must not overlap that allowance in either direction. Existing role guards, alias/minimum-version checks, original argv, marking and extension order **seat-mods → Molt → Autonomic** remain unchanged.

Every materially new enrolled assignment needs a fresh process/launch binding, even if its pane is retained. A changed env/report cannot hot-enroll a running seat. Same-assignment corrections may reuse only unchanged approvals/grants/lifetime; completion or revocation invalidates old authority. Public Molt ownership evidence is insufficient for automatic reactivation: an in-place clear stays suspended and requires a fresh trusted launch. Finish/handoff already-running tops/workers before rollout. A wrapper bypassing `omp-seat` is not a validated launch.

The real authority CLI/reader is usable independently of model/backend; native decision activation and its host release/policy/calibration gates are separate. Task-3 fixture issuance is not a live grant. See Autonomic's trusted-assignment section for exact schema/CLI and same-UID/shared-process/last-check race limits. Operator-owned merge/design/plan gates and all seat-mods denials remain absolute; no new role/profile/exception is supplied. Claude Code launch/backend semantics are unchanged; Jev parity remains deferred to #832.

### Gated rollout of the integrated routing release candidate (unreleased)

The reviewed integrated OMP routing release candidate adds no launcher flag and no new role. Cutover is staged by the operator, not by a worker: start a **fresh approved OMP top** with a trusted bounded assignment binding; retained assignments use new processes; a same-assignment in-place Molt needs the full revalidation transaction or stays suspended. Do **not** edit a running top's env or reports to enroll it — enrollment is a launch, not a mutation of a live process. Existing Claude Code tops/backend/permissions are unchanged under #832, and no new sandbox claim is made. Rollback is explicit deployment to the prior supported release/backend with truthful source attribution and current floor protection, never a per-request chat fallback claiming Jev. The full input/validation/gate list lives in Autonomic's `docs/omp-jev-rollout.md`. **No version is selected here and `ompTested` is unchanged.**

## Install

Coordinator roles need ossify 1.18.0 for `spine-driver`, `close`, `crew-spine` and `crew-work-pr`, and merge-bar for `work-pr` (and for `crew-work-pr` where its brief's stopping rule is merge-bar).

OMP does not put a plugin's `bin/` on `PATH`, so a coordinator role also needs the `plugin-bin-path.ts` loader from the root README's OMP section, installed once per machine; without it `oss` is not found. `omp-seat` does not pass `--no-extensions`, so the loader in your user extension folder still loads.

```bash
omp plugin marketplace add pulseai-labs/claude-agent-scaffolding
omp plugin install omp-roles@claude-agent-scaffolding
omp plugin install seat-mods@claude-agent-scaffolding
omp plugin install molt@claude-agent-scaffolding
omp plugin install autonomic@claude-agent-scaffolding
omp plugin install ossify@claude-agent-scaffolding
omp plugin install merge-bar@claude-agent-scaffolding
omp plugin install herdr-crew@claude-agent-scaffolding   # the orchestrator role only
```

Put the launcher on `PATH`. `omp plugin list` shows the installed version; the path is in the install record:

```bash
ln -sf "$(jq -r '.plugins["omp-roles@claude-agent-scaffolding"] | (map(select(.scope == "user")) + .)[0].installPath' ~/.omp/plugins/installed_plugins.json)/bin/omp-seat" ~/.local/bin/omp-seat
```

Run it again after an upgrade: the link points at one version's folder. `omp-seat` needs `bun`; a `--via` wrapper that runs omp under `timeout` needs `--foreground`.

`omp-seat` needs seat-mods 0.4.1 (the first release that maps `seat-reviewer` to the reviewer profile), molt 0.3.0 and autonomic 0.6.0. It refuses an older version or a missing OMP extension, naming the required minimum.

Pinned and tested on omp 18.11.2; an upgrade is a PR.
