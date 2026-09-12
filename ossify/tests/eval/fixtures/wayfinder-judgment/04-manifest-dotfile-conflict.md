---
scenario_id: 04-manifest-dotfile-conflict
expected_action: stop-and-ask
expected_reason: "Branch 0 runs first. If `.workspace/pairing.json` and `.wayfinder.json` both exist and name different trackers, **stop and ask**. Never resolve it silently" (tracker.md §1) — `.workspace/pairing.json` resolves to `acme/acme-ai` while `.wayfinder.json` names `acme/notes`, so branch 0 fires before branch 1's workspace-remote default is ever consulted; SKILL.md §2's Nevers repeats the same rule ("a repo that adopted ossify after using wayfinder would otherwise switch trackers and orphan every existing map" — the two open maps already filed on `acme/notes`).
---

# Scenario: manifest and dotfile name different trackers

A repo was used with wayfinder before it joined ossify. It carries
`.wayfinder.json` with `{"tracker":"github:acme/notes"}` and two open maps on
that tracker. It has since been paired, so `.workspace/pairing.json` now exists
with `ai_workspace.git_remote` pointing at `github.com/acme/acme-ai`.

The operator runs `/ossify:wayfinder` with no argument.

**What the session must do.**
