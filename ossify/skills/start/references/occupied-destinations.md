# Occupied destinations — `/start` never writes over a file

Depth for SKILL.md §3 and §13. `/start` can run in a workspace that already
holds files at its destinations: a project scaffold-onboard set up before any
code carries a legacy MASTER-SPEC, a hand-authored `CLAUDE.md` and a memory
bank whose LIVE files (`05`, `06`, `09`, `10`) hold history nothing else
records. §3's canonical-content gate never sees them, because it reads declared
repos and the AI workspace is never one. This file is the rule that keeps them.

Regenerating an existing file is opt-in, per file, and always confirmed.

---

## 1. Check every destination before `oss init`

The ceremony writes before §13: bones ADRs at §7, `PUBLIC_BOUNDARY.md` at §10,
the lean MASTER-SPEC at §11. So the check runs in §3, past both gates and
before `"$oss_bin" init` — an operator who stops here is left with nothing
written, not with state that the next `/start` refuses.

Resolve the path of every output in §13's table (`memory-bank-brief.md` §4 —
`oss repo_root ai_workspace` for the workspace; a loop over declared repos
never reaches it) and check whether a file already exists there: the
MASTER-SPEC at `"$oss_bin" spec_path`, the EXECUTIVE-SUMMARY, each memory-bank
file where the bank lives (`close/references/harvest.md`, "Where the bank is"),
`CLAUDE.md`, each `PUBLIC_BOUNDARY.md`, and the private boundary inventory at
`posture-block.md` §7's convention,
`<ai-workspace>/docs/private-boundary-inventory.md`.
A MASTER-SPEC anywhere else in the workspace is not overwritten, but name it to
the operator too: two specs side by side is a question, not a default. Bones ADRs take a
fresh number from the `bones-registry.md` §3 scan, so they do not collide here;
if one ever would, the same rule applies. An output whose path no route names
yet — an EXECUTIVE-SUMMARY with no routing key — cannot be checked here; §2's
last paragraph checks it when its path is chosen.

A destination that holds nothing is written as usual, with no question.

## 2. Stop and ask, per file

When a destination is occupied, write nothing over it. Name every occupied
file to the operator, with its path and size, and ask for each one:

- **Keep** — the file stays exactly as it is. Do not write ossify's version over
  it, merge into it, or append to it. Say in the §13 hand-off which output was
  not authored because of it. **Not offered for the MASTER-SPEC:** §11 audits
  and §13 derives from the lean spec, so a kept legacy spec would feed both. For
  that file the choices are move aside, or stop the ceremony.
- **Move aside** — when that file's station comes, and not before, rename the
  existing file to a path that holds nothing, then write ossify's version at the
  destination, and say in the §13 hand-off where it went. A ceremony stopped
  earlier has moved nothing.

The operator may answer for several named files at once, or stop the ceremony
here. Nothing has been overwritten either way. Never pick an answer the
operator did not give: no default, no automatic move, merge or migration.

Every later write honours the answer for its file, and checks its destination
again just before writing: one that became occupied after §3, or one §3 could
not resolve, is asked about the same way. Never write a file whose path was
not checked.

## 3. Why the route is a question

No flow that converts a legacy spec or memory bank ships, so routing there
would strand the operator. Asking per file is a route that always runs.
