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

_Dispatcher invocations below are `"$oss_bin" …` — the calling skill resolves `oss_bin` once (recipe: the plugin's `rules/dispatcher-path.md`); if it is unset in your context, resolve it there first._

The spec is manifest-routed, not conventionally placed:

```bash
"$oss_bin" spec_path
```

**Use that verb; do not compose the path from `"$oss_bin" repo_root ai_workspace`.**
workspace-init writes `.well_known_paths.master_spec` into the manifest — its
default is `${ai_workspace.root}/docs/MASTER-SPEC.md`, but a project may route
it anywhere. Resolving only the workspace root and then guessing (or searching)
misses a customized destination, and the symptom is this surface reporting *"no
MASTER-SPEC.md"* for a properly initialised project. `"$oss_bin" spec_path` reads the
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

The complete input grammar is shared by both halves:

| Input | Interpretation |
|---|---|
| registry value or data-row first cell | trim surrounding whitespace; the complete value must follow bones-registry.md §3 part 1 (the ADR identifier authority) |
| section-4 table delimiter row | every cell has one or more hyphens, optional alignment colons, and surrounding whitespace |
| table row immediately before that delimiter | header; a valid ADR reference in its first cell is reported as a misplaced reference |
| every other section-4 table row | data; an invalid first cell, including an empty one, is reported, never discarded |
| repeated identifier on either half | duplicate finding; compare case-insensitively, preserve source spellings in findings |

Headers are excluded from the identifier sets, but a header whose first cell is a valid ADR reference is a finding. Delimiter rows are omitted. Compare valid identifiers as
complete upper-cased sets; retain the original values and multiplicity to name
mismatches and duplicates. An invalid registry value refuses the comparison;
an invalid index cell is a finding. An empty registry and header-only table
are a clean pair with zero entries and zero rows.

```bash
(
# Locale and variables are private to this read-out; later surfaces consume stdout.
export LC_ALL=C
# Both halves are pinned to THIS directory's manifest: `sv_state` is the routed
# state, never $OSS_STATE_FILE (see the note below), and it is deliberately NOT
# named `$sf` - state-inspection.md §2 owns that name for the override-first
# path, and one surface of a composed read-out must not reassign another's. Both
# resolver calls are guarded: an unresolvable route is the refusal below, never
# an abort under `set -e`. The section-4 heading is read as a '## 4' line — a
# dot, a colon or whitespace after the number — and a spec with no such heading
# REFUSES rather than reading an empty index set, because an unreadable half is
# not an empty one. Only each row's FIRST cell counts, so an ADR reference
# inside a row's prose ("supersedes ADR-0001") is not a row.
sv_state="$("$oss_bin" state_path 2>/dev/null)" || sv_state=""
spec="$("$oss_bin" spec_path 2>/dev/null)" || spec=""
state_rc=0
adr_re='^[Aa][Dd][Rr]-[A-Za-z0-9]+$'
if [ -n "$sv_state" ]; then
  # Keep each .adr structured until its WHOLE value has been trimmed and
  # validated. Raw multiline values must not become several registry records.
  reg_raw="$("$oss_bin" get '.bones | map(.adr)' "$sv_state" 2>/dev/null | jq -r --arg ref "$adr_re" '
    .[] | if type == "string" then gsub("^[[:space:]]+|[[:space:]]+$"; "") else tojson end
    | if test($ref) and (test("[[:space:]]") | not) then "OK " + .
      else "BAD " + (if . == "" then "[empty]" else gsub("[\r\n]"; " ") end) end')" || state_rc=$?
else
  state_rc=1
fi
spec_rc=0; [ -r "$spec" ] || spec_rc=1
hdr=0; [ "$spec_rc" = 0 ] && hdr="$(grep -cE '^##[[:space:]]*4[.:[:space:]]' "$spec" 2>/dev/null)" || :
# Name the half that failed, never both: "registry rc 5, spec rc 0" under a
# both-halves claim is a contradiction the operator has to resolve themselves.
why=""
[ "$state_rc" = 0 ] || why="the registry half (rc $state_rc)"
[ "$spec_rc" = 0 ] || why="${why:+$why and }the spec half"
if [ -n "$why" ]; then
  echo "skip: spec - the bones drift check could not read $why, and an unreadable half is not an empty one"
elif [ "${hdr:-0}" = 0 ]; then
  echo "skip: spec - section 4 carries no '## 4' heading this check reads, so the index half is unreadable rather than empty"
else
  # A value the registry HOLDS but this check cannot NAME refuses the run - it is
  # never filtered out: `bone_add` accepts any ref (`ADR-C2` is legal and in the
  # registry suite's own fixtures), and dropping one would print "0 entries" over
  # a registry that has entries (round 1, C4).
  bad="$(printf '%s\n' "$reg_raw" | sed -n 's/^BAD //p')"
  if [ -n "$bad" ]; then
    echo "skip: spec - the registry holds a value that is not an ADR reference ('$(printf '%s' "$bad" | tr '\n' ' ')'), and a value this check cannot name is not one it may drop"
  else
    # One identifier grammar for both halves; normalization is only for the
    # comparison. Keep the source spelling for findings and retain duplicates.
    reg_values="$(printf '%s\n' "$reg_raw" | sed -n 's/^OK //p')"
    sv_fold() { awk 'NF {print toupper($0)}'; }
    reg_all="$(printf '%s\n' "$reg_values" | sv_fold | sort)"
    reg="$(printf '%s\n' "$reg_all" | sort -u)"
    reg_dupes="$(printf '%s\n' "$reg_all" | uniq -d)" || reg_dupes=""
    # Buffer one row: ONLY the row immediately before a full delimiter row is
    # the header. Report an ADR-shaped header; validate every other table row.
    idx_all="$(awk '/^##[[:space:]]*4[.:[:space:]]/ {f=1; next} /^##[[:space:]]/ {f=0} f' "$spec" \
      | awk -v ref="$adr_re" '
        function cell(row, a) {
          split(row,a,"|"); row=a[2];
          sub(/^[[:space:]]+/,"",row); sub(/[[:space:]]+$/,"",row); return row
        }
        function delimiter(row, a,n,i) {
          sub(/^[[:space:]]*\|/,"",row); sub(/\|[[:space:]]*$/,"",row)
          n=split(row,a,"|"); if(!n) return 0
          for(i=1;i<=n;i++) if(a[i] !~ /^[[:space:]]*:?-+:?[[:space:]]*$/) return 0
          return 1
        }
        function emit(row, c) {
          c=cell(row); if(c ~ ref) print "OK " c;
          else print "BAD " (c=="" ? "[empty]" : c)
        }
        /^[[:space:]]*\|/ {
          if(delimiter($0)) {
            if(pending!="" && cell(pending) ~ ref) print "HEADER " cell(pending)
            pending=""; next
          }
          if(pending!="") emit(pending)
          pending=$0; next
        }
        {if(pending!="") emit(pending); pending=""}
        END {if(pending!="") emit(pending)}')" || idx_all=""
    idx_rows="$(printf '%s\n' "$idx_all" | sed -n 's/^OK //p')" || idx_rows=""
    bad_rows="$(printf '%s\n' "$idx_all" | sed -n 's/^BAD //p')" || bad_rows=""
    adr_headers="$(printf '%s\n' "$idx_all" | sed -n 's/^HEADER //p')" || adr_headers=""
    idx="$(printf '%s\n' "$idx_rows" | sv_fold | sort -u)" || idx=""
    dupes="$(printf '%s\n' "$idx_rows" | sv_fold | sort | uniq -d)" || dupes=""
    # comm over the two variables - no temp files to create, leak or clean. An
    # empty side is handled explicitly, because comm would count a lone blank
    # line as a difference and manufacture a phantom id.
    if [ -z "$reg" ] || [ -z "$idx" ]; then
      only_reg="$reg"; only_idx="$idx"
    else
      only_reg="$(comm -23 <(printf '%s\n' "$reg") <(printf '%s\n' "$idx"))" || only_reg=""
      only_idx="$(comm -13 <(printf '%s\n' "$reg") <(printf '%s\n' "$idx"))" || only_idx=""
    fi
    # Render matching keys through the source values, never through the
    # normalized set. Distinct source spellings remain visible in a duplicate.
    sv_names() {
      printf '%s\n' "$2" | awk -v keys="$1" '
        BEGIN {n=split(keys,a,"\n"); for(i=1;i<=n;i++) wanted[a[i]]=1}
        wanted[toupper($0)] && !seen[$0]++ {print}' | tr '\n' ' ' | sed 's/ $//'
    }
    if [ -n "$only_reg" ] || [ -n "$only_idx" ] || [ -n "$dupes" ] || [ -n "$reg_dupes" ] || [ -n "$bad_rows" ] || [ -n "$adr_headers" ]; then
      [ -z "$only_reg" ] || echo "fail: spec - registry entry with no index row: $(sv_names "$only_reg" "$reg_values")"
      [ -z "$only_idx" ] || echo "fail: spec - index row with no registry entry: $(sv_names "$only_idx" "$idx_rows")"
      [ -z "$dupes" ] || echo "fail: spec - section 4 carries more than one row for: $(sv_names "$dupes" "$idx_rows")"
      [ -z "$reg_dupes" ] || echo "fail: spec - the registry carries more than one bone record for: $(sv_names "$reg_dupes" "$reg_values")"
      [ -z "$bad_rows" ] || echo "fail: spec - section 4 carries a row whose first cell is not an ADR reference: $(printf '%s' "$bad_rows" | tr '\n' ' ')"
      [ -z "$adr_headers" ] || echo "fail: spec - section 4 carries a header whose first cell is an ADR reference: $(printf '%s' "$adr_headers" | tr '\n' ' ')"
    else
      echo "ok: spec - bones index matches the registry: $(printf '%s' "$reg" | grep -c '[^[:space:]]') entries, $(printf '%s' "$idx_rows" | grep -c '[^[:space:]]') rows"
    fi
  fi
fi
)
```

**Pass the state path explicitly.** A bare `"$oss_bin" get` honours an exported
`$OSS_STATE_FILE`, so with an override in play this would read *another
project's* bones while `"$oss_bin" spec_path` read this one's spec — reporting drift
between two unrelated projects. `"$oss_bin" state_path` is the manifest-routed answer
regardless of the override, which binds both halves of the comparison to the
same project — which is why this block names it **`sv_state`** and not `sf`:
state-inspection.md §2 owns `sf` for the override-first path the rest of a
composed `doctor` read-out uses, and a shared name would let one surface
silently reassign the other's state mid-run. (The interop surface, §7 of the
skill body, reports the override separately; this comparison must not depend on
the user having run it first.)

**Compare identifier *sets*, never their counts.** Cardinality cannot tell the
two directions apart: replace `ADR-0002`'s row with `ADR-9999` and *both*
directions are present while `.bones | length` and section 4's row count still
agree — a count comparison reports clean on exactly the drift this check exists
to find. Ids are compared **case-insensitively** (both halves upper-cased) and as
**complete values** per bones-registry.md §3 part 1, never a numeric substring, so a legal
non-numeric ref such as `ADR-C2` is compared too: an adopted series may spell an
id in either case, and neither spelling is drift. A registry value that is not
an ADR reference at all **refuses the comparison** (`skip:`) rather than being
filtered out — a value this check cannot name is not one it may drop. The block
above reports each direction with the identifiers that do not pair:

| Mismatch | What it means | Report as |
|---|---|---|
| registry entry with no index row | a bone was recorded but never written into the spec | `fail: spec` — the spec understates the architecture |
| index row with no registry entry | a row was hand-written, or an entry was lost | `fail: spec` — name the direction and the rows that do not pair |
| more than one index row for one entry | the invariant is *one row per entry*; a copy left behind reads as agreement to a set comparison | `fail: spec` — name the duplicated ids |
| more than one registry record for one entry | a legacy or hand-edited state carries a duplicate registration; the index cannot show which record is the extra one | `fail: spec` — name the duplicated ids, and repair the registry |
| a section-4 row whose first cell is not an ADR reference | the row is unnameable: neither a bone nor a header label, so no comparison can pair it | `fail: spec` — name the row and say what a bone row must start with |
| an ADR reference in a section-4 header | the row immediately before a delimiter is a header and cannot represent a bone | `fail: spec` — name the reference; move the bone into a data row below the delimiter, or remove a stray delimiter that reclassified it |
| a blank or invalid registry ADR value | the registry holds a record whose complete trimmed value cannot be compared as an ADR reference | `skip: spec` — name the value (`[empty]` for whitespace only); repair that registry record against its source ADR, then rerun doctor; never delete it merely to clear the refusal |

None is auto-repairable: which artifact is right is a judgment about what
actually happened. Name the identifiers, name the direction each belongs to, and
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
