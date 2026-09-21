# Rubric: listing-principles

For each fixture, judge the SKILL OUTPUT against this rubric. Score each criterion 1-5. Pass = all criteria >=4.

This skill merges principles from up to four sources (shipped-default, user-promoted, project-scoped patterns, memory-bank) and renders them grouped by source. A --source filter narrows which sources appear. When a project-scoped principle overrides a user-global one, the project version wins and the override is annotated.

## Criteria

1. **Shipped defaults always shown (unless --source excludes them)** — When no --source filter is active, shipped-default principles appear in every output. When --source shipped is passed, ONLY shipped defaults appear; all other sources are omitted.
   - 5: Shipped defaults present and complete when expected; correctly omitted when --source excludes them.
   - 4: Shipped defaults present but one principle text slightly truncated or reworded.
   - 3: Shipped defaults present but mixed into another section without a "shipped-default" label.
   - 2: Shipped defaults partially missing (some lines omitted).
   - 1: Shipped defaults absent when they should be present, or present when --source filter should exclude them.

2. **Source-tag annotation present per principle** — Each active principle in the output carries a visible source annotation: "shipped-default", "user-promoted", or "project". The annotation may appear inline (e.g., parenthetical), as a column in a table, or as a section header that unambiguously groups principles by source.
   - 5: Every principle has a clear source annotation; no principle is unlabeled.
   - 4: All principles labeled but annotation format inconsistent (e.g., some inline, some via section header).
   - 3: Section headers used as annotation but at least one section is mislabeled.
   - 2: Source annotations absent for user-promoted or project principles.
   - 1: No source annotations anywhere in the output.

3. **--source filter honored** — On fixture 04 (invoked with --source shipped), the output contains only shipped-default principles. User-promoted and project-scoped principles must not appear.
   - 5: Only shipped defaults in output; user-promoted and project sections absent.
   - 4: Only shipped defaults shown but a now-empty section header for another source leaks into output.
   - 3: --source filter partially applied (e.g., user section hidden but project section still present).
   - 2: --source filter ignored; all sources rendered.
   - 1: --source flag caused a crash or no output.
   - Note: For fixtures without --source filter, auto-score 5 on this criterion.

4. **Project-overrides-user merge correctly annotated** — On fixture 05, when a project-scoped principle overlaps with a user-global one (same normalized prefix), the project version is shown as the active principle and annotated as overriding the user-global entry. The user-global version must NOT appear as a separate active principle.
   - 5: Project version shown as active; override annotation present; user-global version absent as standalone entry.
   - 4: Project version shown as active; user-global version absent; but override annotation missing.
   - 3: Both versions shown without merge (user-global not suppressed).
   - 2: User-global version shown as active instead of project version.
   - 1: Both versions shown with no annotation, or output omits the principle entirely.
   - Note: For fixtures without an override scenario, auto-score 5 on this criterion.

## Output format

Return one JSON object: `{"scores": {"shipped_defaults": N, "source_tags": N, "source_filter": N, "override_annotated": N}, "pass": true|false, "notes": "<one sentence>"}`. Pass = all criteria >=4. JSON only, no prose around it.
