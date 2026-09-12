# Lean-spec validation

The depth behind `doctor/SKILL.md` §5. Validates `MASTER-SPEC.md` against the
**lean** schema (spec §13.2). Read-only: this surface never edits the spec, and
never authors a missing section.

The schema itself is owned by `start` and lives in
`start/references/lean-spec-schema.md`, in the `ossify` plugin — its §5 is the
validation contract this file executes. That file is the authority on *what the
schema is*; this one is the authority on *how a validation run reports*.

---

## 1. Routing to the file

The spec is manifest-routed, not conventionally placed:

```bash
oss spec_path
```

**Use that verb; do not compose the path from `oss repo_root ai_workspace`.**
workspace-init writes `.well_known_paths.master_spec` into the manifest — its
default is `${ai_workspace.root}/docs/MASTER-SPEC.md`, but a project may route
it anywhere. Resolving only the workspace root and then guessing (or searching)
misses a customized destination, and the symptom is this surface reporting *"no
MASTER-SPEC.md"* for a properly initialised project. `oss spec_path` reads the
routed key, expands its `${...}` tokens, falls back to the same convention when
the key is absent, and refuses a value that is not absolute.

If no topology declaration resolves, that is a **finding, not a refusal** — emit
`skip: spec - no topology declaration, so MASTER-SPEC.md cannot be located` and
carry on with the rest of the sweep (`SKILL.md` §3). The verb exits nonzero and
says why; echo its message rather than substituting a guess.

If the manifest resolves but no `MASTER-SPEC.md` exists, that is also a
`skip:`, not a `fail:` — a project that has not run `/start` yet has no spec to
be wrong. Name `/start` as the next step.

---

## 2. The seven required sections

In this order, per `start/references/lean-spec-schema.md` §1:

| # | Section | Present-and-non-empty is required |
|---|---|---|
| 1 | Vision narrative | yes |
| 2 | Journey map | yes |
| 3 | Skeleton cut | yes |
| 4 | Bones-registry index | yes |
| 5 | Risk gates | yes |
| 6 | Posture & boundary | yes — see §4 |
| 7 | Release-0 minimums | yes |

**Legacy phase-named sections are neither required nor an error.** A spec
migrated from the 10-phase schema may carry both; report neither as a finding.

**No FR/NFR ID table is required, and its absence is not an error.** This is the
single most likely false positive, because every reviewer trained on the
predecessor stack expects one. `start/references/lean-spec-schema.md` §3 records that exhaustive
enumeration is *deliberately* dropped and grown at release closes instead. Do
not report it, and do not "helpfully" suggest adding one.

**A thin section is not an invalid section.** `start/references/lean-spec-schema.md` §4 sets
genuinely low Release-0 floors — a three-line feature map, one core journey, most
bone categories answered `not-applicable` with a revisit trigger. A spec-core
close that produced a five-line feature map and four `not-applicable` bones is a
**successful** close. Validate presence and non-emptiness, never richness.

---

## 3. The bones drift check

**The bones index must have one row per bones-registry entry in
`project-state.json`.** This is the check that justifies spec validation living
in `doctor` rather than in `/start`: it is a comparison between two artifacts,
and only one of them is the spec.

```bash
oss get '.bones | length' "$(oss state_path)"
```

**Pass the state path explicitly.** A bare `oss get` honours an exported
`$OSS_STATE_FILE`, so with an override in play this would read *another
project's* bones while `oss spec_path` read this one's spec — reporting drift
between two unrelated projects. `oss state_path` is the manifest-routed answer
regardless of the override, which binds both halves of the comparison to the
same project. (The interop surface, §7 of the skill body, reports the override
separately; this comparison must not depend on the user having run it first.)

Compare against the row count of section 4. The direction of the mismatch
changes the finding:

| Mismatch | What it means | Report as |
|---|---|---|
| registry entry with no index row | a bone was recorded but never written into the spec | `fail: spec` — the spec understates the architecture |
| index row with no registry entry | a row was hand-written, or an entry was lost | `fail: spec` — name both counts and the suspect row |

Neither is auto-repairable: which artifact is right is a judgment about what
actually happened. Name the two counts, name the rows that do not pair, and
stop.

---

## 4. Posture is an error when absent, not a default

**An absent posture section is a `fail:`.** Not a warning, and never quietly
defaulted to private.

The reason is in the companion spec: absence is exactly the ambiguity that must
*resolve* private, and a validator that silently applies the default destroys
the evidence that nobody ever decided. A project whose posture was never
discussed and a project deliberately set private are different situations with
the same file contents unless this check refuses to paper over it.

A posture section that is present but says *"default-private, revisit at MVP"*
is **valid** — that is a decision with a revisit trigger, which is what the
schema asks for.

---

## 5. Error format

One line per finding, and every line carries three things:

1. **Where** — the section number and, when the file gives you one, the line.
2. **What** — the rule that failed, in the schema's own words.
3. **The remediation** — the concrete next move, naming a command literally
   where one exists (`/start` when there is no spec at all; for a content change,
   ossify ships no `/amend-spec` command — name the section and the edit, and say
   the amend flow is ceremony-routed prose).

A finding without a remediation is a complaint. If you cannot name the next
move, you have not finished diagnosing.

---

## 6. What this surface deliberately does not check

Named so a reader hitting the gap finds a note rather than silence:

- **Prose quality.** The vision is narrative and *nothing sequences by it*
  (`start/references/lean-spec-schema.md` §2). There is no rule to validate it against.
- **Whether the journey map is the *right* journey.** That is a `/start`
  conversation and, later, a release-close re-groom.
- **Citation resolution.** Whether a spec's file paths and REQ-IDs still resolve
  is its own concern, not this one.
- **EXECUTIVE-SUMMARY.md.** Derived from sections 1–3, no gate reads it, and its
  absence is silent by design. Mention it if it is missing; do not fail on it.
