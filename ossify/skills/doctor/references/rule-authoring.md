# Machine-checkable rule authoring

The depth behind `doctor/SKILL.md` §6. The one surface in this skill that
writes, and it writes to exactly one file.

**Two modes, and the sweep only ever gets the first.**

| Mode | When | Writes? |
|---|---|---|
| **Inspect** | a full sweep (`SKILL.md` §3), or any request that names no rule | never |
| **Author** | an explicit ask for a rule — "add a project rule", "forbid X" | appends one block, after confirmation |

**Inspect** is the sweep's verdict: read `03-code-patterns.md`, count the
`mcrule` blocks, validate each one's shape (§5), and note any carrying a type
this build does not recognise (§8). Report the count and any malformed block.
Do **not** prompt for a rule — a health check that stops to solicit an unrelated
write has stopped being a health check.

---

## 1. The file, and how to find it

The file is `<bank>/03-code-patterns.md`, where `<bank>` is the memory-bank
directory.

**Never hardcode `.claude/memory-bank/03-code-patterns.md` against `$PWD`.**
The bank lives in the **AI workspace**, not beside the code, and it is
manifest-routed: resolve it exactly as `close/references/harvest.md` §7 does —
the topology declaration's `.well_known_paths.memory_bank`, token-expanded, with a
relative or unresolved route a STOP, never a fallback to the cwd. A cwd-rooted
path writes rules into whichever repo the session happened to start in.
When the lane cannot run at all, emit its line anyway — never drop it silently:
`skip: rules - no topology declaration resolves (neither .ossify/topology.json nor a .workspace/pairing.json fallback), so the memory bank cannot be located`
(remedy `/ossify:start`, `/ossify:adopt`, `/init-workspace` or
`/pair-workspace`); `skip: rules - memory-bank
route '<value>' is not absolute` (the STOP case, surfaced not written around);
`skip: rules - no 03-code-patterns.md at <path>; /start seeds it with an empty
section`.

`03-code-patterns.md` ships from `/start` with the
`## Machine-checkable rules` heading present and **no rules under it**
(`start/references/memory-bank-brief.md` §1). An empty section is not an absent
one, and neither is a defect.

**Lane discipline: this surface writes to `03-code-patterns.md` and nothing
else.** Never `00-project-brief.md` through `08-governance.md`, never
`CLAUDE.md`, never `MASTER-SPEC.md`.

---

## 2. Who reads an authored rule — state this accurately

Two different things, and conflating them oversells what authoring buys:

- **`close`'s work-item gate, Layer 3, reads this file and judges.** An
  authored rule *is* consulted on every work-item close — as a documented
  pattern an agent reads and applies, quoting it back verbatim in any finding
  (`close/references/impl-check.md` §4). That read **is** the evaluation
  mechanism.
- **Mechanical evaluation is WONTFIX in ossify — settled 2026-08-15.** Ossify
  ships nothing that parses `mcrule` blocks and runs them against a codebase,
  and never will: the planned evaluator was retired by decision, its residue
  folding into the planned Layer 4 agent pass (#139). (This file speaks for
  ossify only. Whether another stack consuming the shared artifact evaluates
  it mechanically is that stack's own contract — a mid-migration project
  should read the legacy stack's docs rather than be promised anything here,
  which is one more reason §3's field parity is load-bearing.)

So the honest line to the user is: *"this rule is now documented, validated,
and read by the work-item gate at every close; ossify ships no mechanical
evaluator, by decision."* "Read", not "applied": the Layer 3 read judges the
staged diff against pattern-shaped rules and quotes them in findings, but a
rule needing a measurement the diff does not carry — `coverage_floor`'s
threshold is the live case — is *consulted*, not measured, there. Do not shorten that to "enforced by
tooling", and do not shorten it to "not enforced" — the first oversells the
mechanism, the second would tell someone to skip authoring rules that Layer 3
genuinely applies.

---

## 3. The four types

The table below is the authoritative list — there is no verb behind it. The
field sets are carried **verbatim** from scaffold-onboard's R2 mcrule grammar,
and that is load-bearing: `03-code-patterns.md` is the same artifact in both
stacks, a project mid-migration can hold rules authored by either, and a field
set drifted by one name would make each stack misread the other's blocks.

Field sets are **per type**, not shared. `coverage_floor` is the one type with
no optional fields at all, which is the most common authoring mistake:

| Type | Required | Optional |
|---|---|---|
| `banned_imports` | `forbid` | `in`, `where` |
| `coverage_floor` | `paths`, `threshold` | *(none)* |
| `style_invariants` | `forbid_pattern` | `in`, `exclude`, `where` |
| `required_pattern` | `require_pattern` | `in`, `exclude`, `where` |

---

## 4. Grammar

**HTML-sentinel comments, never fenced code blocks.** Each rule sits between
`<!-- mcrule:start type=<T> -->` and `<!-- mcrule:end -->`. The body is
`key: value`, one pair per line. Prose may surround blocks and is what makes the
file readable by a human.

The fenced-block alternative was drafted and **explicitly rejected**: fence
boundaries are invisible in rendered markdown, which breaks the human/machine
dual-readability the file exists for. Never emit a fenced rule block, not even
as an example inside a message.

Worked examples, one per type:

    We forbid synchronous HTTP libraries in async paths — they block the loop.

    <!-- mcrule:start type=banned_imports -->
    in: src/**/*.py
    where: any_function_marked_async
    forbid: [requests, urllib3, httpx.Client]
    <!-- mcrule:end -->

    The API layer holds an 80% coverage floor.

    <!-- mcrule:start type=coverage_floor -->
    paths: [src/api/]
    threshold: 80
    <!-- mcrule:end -->

    Never `print()` outside tests.

    <!-- mcrule:start type=style_invariants -->
    in: src/**/*.py
    exclude: tests/**/*.py
    forbid_pattern: '\bprint\('
    <!-- mcrule:end -->

    Every API handler documents Args and Returns.

    <!-- mcrule:start type=required_pattern -->
    in: src/api/handlers/*.py
    require_pattern: 'Args:\s+.*\s+Returns:'
    where: function_def
    <!-- mcrule:end -->

**Quote regex values in single quotes.** It protects `\b`, `\s`, `(` and friends
from being eaten by an intermediate parser. Validation treats values as
opaque (§5) — only the *key* is charset-checked — so a quoted regex passes
through whole.

---

## 5. Validation, before every write — by reading, against §3 and §4

There is no validator verb. **You are the validator**: check the composed block
against §4's grammar and §3's field table before it lands in the file, and
refuse the write until every check passes. **Shape only** — do not compile the
regexes and do not evaluate anything. The checks, and the order is part of the
contract:

1. **Every non-blank line of the body — between the sentinels, which §4
   validates separately and this check never sees — leading whitespace
   stripped, is `key: value`, split on the FIRST colon.** A value may itself
   contain colons: §4's own
   `require_pattern: 'Args:\s+.*\s+Returns:'` is the canonical example, and
   it is well-formed. Blank lines and indentation inside a block are
   tolerated, not defects (§7.3 whitespace-normalises for idempotency, so
   indented variants exist in the wild). A line of prose inside the block is
   a MALFORMED line — report it as that, never as a missing field, or the
   author is sent to the wrong problem.
2. **The key charset is letters, digits and `_` only.** Values are OPAQUE:
   real rules hold `$`, quotes, brackets, backslashes and glob metacharacters,
   and none of that is the key's business.
3. **Every field has a non-empty value — and whitespace-only counts as
   empty.** Trim the value after the colon before judging it: `forbid:` and
   `forbid:   ` are the same absent constraint. A field that forbids nothing
   is worse than useless — an empty pattern's meaning is a decision nobody
   made deliberately — so neither validates.
4. **The type is one of §3's four, every required field for that type is
   present, and no field is unknown for that type.** An unknown field is an
   error, not a shrug: a typo'd `forbid_patern` written today misleads every
   future read of the block.
5. **Check required fields before unknown fields.** A typo'd required field
   then reports as *"requires `forbid_pattern`"* — handing the author the
   correct spelling — rather than *"unknown field `forbid_patern`"*, which
   only confirms what they typed.

On a failing check, name the one wrong line and the fix. A required field
reported missing still has a line to quote when a typo'd key triggered it
(check 5's case — quote that line); only a field genuinely absent from the
block has none, and then the diagnostic names the field, its type, and the
block it is missing from. Then re-prompt; §6's loop rule applies.

**A rule body never enters a shell command.** The old verb path was deleted
along with the injection hazard it existed to defend against (values holding
`$(…)` and backticks reaching shell source — Codex P1, PR #149 round 5), but
the residual rule outlives the verb: validation is a read, the append is the
Write or Edit tool, and block bytes never appear inside any command you run —
in a sweep they come out of `03-code-patterns.md`, a repository file nobody in
this session wrote.

---

## 6. The authoring conversation

One rule per invocation:

1. **Restate the intent and name the type.** *"You want `requests` and
   `urllib3` forbidden inside async functions under `src/` — that's a
   `banned_imports` rule with a `where:` predicate. Right?"* If two types could
   fit, name both and ask which direction: forbid-a-pattern or require-one.
2. **Prompt only for missing required fields.** Do not walk the whole field list
   when the ask already answered half of it.
3. **Propose optional fields with defaults** drawn from the project's tech
   context (`04-tech-context.md` if it exists — do not block on it). Skip the
   ones the user does not care about; optional means optional.
4. **Preview the composed block** in your message and wait for confirmation.
   The user should see the exact bytes before they land.
5. **Validate** (§5).
6. **Append** (§7).
7. **Confirm** with the absolute path written and one line on what the rule now
   does — using §2's accurate phrasing.

**On a failing validation, loop once.** Surface the failing check by name with
the offending line, plus a concrete suggestion, then re-prompt. If a second pass still fails, offer
the choice — hand-author the block per §4's grammar, or drop it for now — and
never silently abort.

---

## 7. Append semantics

Append; never rewrite.

1. **Locate `^## Machine-checkable rules`.** If the heading is absent, append it
   at EOF and treat the new block as the first under it.
2. **Insert after the last `<!-- mcrule:end -->`** within the section, preceded
   by a blank line. The section's lower boundary is the next `##` heading, or
   EOF. With no blocks yet, insert directly under the heading.
3. **Idempotent on an identical block.** Scan the section first; if a block with
   a byte-identical body (after whitespace normalisation) exists, skip the write
   and say so. Do not duplicate.
4. **Never overwrite an existing rule**, and **never touch prose between
   blocks** — the human context is half the file's value.

---

## 8. Unknown types are preserved, never deleted

A block carrying a type this build does not know (`type=dependency_age`, say,
authored against a later version) must **survive** an authoring run untouched.

- The section scan must not crash on one. Treat it as an opaque block and skip
  over it.
- Say so in one line: *"preserved a `type=dependency_age` block this build does
  not recognise."*
- **Skip means skip during processing, not delete from disk.**

If the *user* asks for an unsupported type, do not silently re-classify their
ask into one of the four. Name the four, say the block can be hand-authored
ahead of support per §4's grammar, and note that this build's ceremonies will
preserve it as an opaque block — not apply it — unless a later revision of
§3's table (here, or in the paired scaffold-onboard stack) picks the type up.
