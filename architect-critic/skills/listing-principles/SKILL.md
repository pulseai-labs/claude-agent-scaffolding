---
name: listing-principles
description: Show all principles in effect (shipped defaults + user-promoted + project-scoped + memory-bank patterns) grouped by source with annotations. Triggers on "show principles", "list principles", "what principles apply here", "principles in effect", "audit principles". Optional --source all|shipped|user|project filter.
---

# listing-principles

You have been invoked because the user wants to see all principles currently in effect for the architect-critic. Your job is to read up to four principle sources, merge them, apply any `--source` filter, and render the result grouped by source — each principle annotated with its origin and any suppression status. This skill is intentionally read-only: no mutation, no promotion, no state writes.

---

## Step 1: Parse `--source` filter

Read `$ARCHITECT_CRITIC_ARGS` (the env-var bridge the slash-command wrapper exports — do not reference bash positionals `$1`/`$2`, which Claude Code corrupts at template-render time). On shim-less channels — Devin, `Skill()`, natural language — nothing exports it; read `--source VALUE` as a literal token in the invocation/request text. Extract `--source VALUE` if present; default to `all`.

```bash
SOURCE_FILTER="$(printf "%s" "${ARCHITECT_CRITIC_ARGS:-}" \
  | sed -nE 's/.*--source[= ]+([a-z]+).*/\1/p' | head -1)"
[[ -z "$SOURCE_FILTER" ]] && SOURCE_FILTER="all"
```

Valid values: `all`, `shipped`, `user`, `project`. If the user passes an unrecognized value, treat as `all` and note the fallback inline.

---

## Step 2: Resolve principles sources

You read up to four sources in this exact order. Each is optional except shipped defaults (always present). Document the resolved path for each source in your working context.

**Source 1 — Shipped defaults** (`shipped`)

Resolve the `arc` dispatcher once and hold it in `arc_bin` — it is on `$PATH` on Claude Code and Codex, but **not** on Devin, where `bin/` is never added. Recipe per the plugin's `rules/dispatcher-path.md`: `command -v arc`, else the `source:` path (`--local` installs), else the plugin-cache manifest glob (remote installs). Every `arc` invocation below — and in this skill's references — is `"$arc_bin"`.

The plugin ships `templates/principles.md`. It always exists. Resolve it through the `arc` dispatcher — `arc_bin` above — which self-locates the installed plugin root on every surface:

```bash
SHIPPED_PATH="$("$arc_bin" principles_shipped_path)"
```

Contains two load-bearing defaults: the **Ghost Notes principle** (what is absent is often more important than what is present) and the **CORE protocol** (Curiosity → Objectivity → Reassurance → Empathy). Both render under `## Shipped defaults`.

**Source 2 — User-global** (`user`)

```bash
USER_PATH="$("$arc_bin" principles_user_path)"
```

If this file does not exist, skip this source silently (no "file not found" error in output). If it exists but is empty after stripping headers and blank lines, omit the section header.

**Source 3 — Project-scoped** (`project`)

```bash
PROJECT_PATH="$(git rev-parse --show-toplevel 2>/dev/null)/.claude/architect-critic/principles.md"
```

If `git rev-parse` fails (not in a git repo), try `$PWD/.claude/architect-critic/principles.md`. If the file does not exist, skip this source silently. A project-scoped principle that duplicates a user-global principle is annotated `(overrides user-global)`.

**Source 4 — Memory-bank patterns** (`project` filter includes these; `all` includes these)

Opt-in via environment variable, not install-probed: this source is included only when `$ARCHITECT_CRITIC_MEMORY_BANK_PATH` is set and names a readable file — every `- ` bullet in it becomes a synthetic principle (`source=memory-bank`, no `principle_id`). Point it at whatever bank file holds patterns worth auditing through (for a scaffold-onboard-derived bank, e.g. `02-system-patterns.md` or `03-code-patterns.md`). These entries render under `## Memory-bank patterns` and count as project-source for filter purposes. `ac_principles_merge` (`lib/principles.sh`) implements this same source-4 rule — the env var's target file is the only memory-bank input it reads.

---

## Step 3: Merge via the `arc` dispatcher

Call the bash helper to load user-global principles via the resolved `"$arc_bin"` (Step 2 resolves it; on Claude Code `arc` is on `$PATH` because Claude Code adds each plugin's `bin/` automatically — on Devin it is not, hence the resolution). The dispatcher's bash shebang forces a bash runtime under it regardless of the calling Bash tool's shell (zsh by default on macOS), so the lib's `${BASH_SOURCE[0]}` and `${BASH_REMATCH[…]}` work as written. Never `source` the lib directly from skill body — under zsh it crashes:

```bash
"$arc_bin" principles_load_user_global
```

This strips header lines (lines starting with `# `), strips trailing `[promoted ...]` annotations, and emits one active principle per line. Hold the output in your working context.

For the shipped defaults and project-scoped file, read them directly with the Read tool (they use `<!-- source: ... -->` HTML comments that you parse — see Step 6 below). For memory-bank patterns, read the file at `$ARCHITECT_CRITIC_MEMORY_BANK_PATH` if the variable is set and the file exists.

**Duplicate handling.** Normalize for comparison: trim, lowercase, collapse spaces. Project-scoped wins over user-global on conflict; annotate the winner `(overrides user-global)`. Drop the duplicate silently. Display order: shipped → user → project → memory-bank.

---

## Step 4: Apply `--source` filter

| Filter value | Sources shown |
|---|---|
| `all` | shipped + user + project + memory-bank |
| `shipped` | shipped only |
| `user` | user-global only |
| `project` | project-scoped + memory-bank |

Apply the filter after the merge. Do not re-read files; just drop sections not matched by the filter before rendering.

---

## Step 5: Read suppressions

Read `auto_promote_suppressions[]` from `state.json`:

```bash
STATE_FILE="$("$arc_bin" state_path)"
SUPPRESSIONS="$(jq -c '.auto_promote_suppressions // []' "$STATE_FILE" 2>/dev/null || echo '[]')"
NOW_ISO="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
```

A suppression is **active** if its `expires_at` field is greater than `NOW_ISO` (lexicographic ISO8601 comparison is correct). Collect all active suppressions into a working list.

These are declined auto-promotion candidates; surfacing them lets the user know why a recurring theme isn't appearing as a candidate. Display in a `## Suppressed candidates` footer. If the field is absent or empty, skip the footer silently.

---

## Step 6: Render output

Render as markdown in your turn message. Group by source heading. Omit any section whose source produced zero entries after filtering — do not render empty headers.

### `<!-- source: ... -->` HTML comment contract

The shipped `templates/principles.md` and any project/user principles files annotate entries with a block comment on the line **before** the bullet — the format `promoting-principle` Step 5 writes and `ac_principles_parse_meta` (`lib/principles.sh`, the parsing authority) reads. It matches the comment line, then reads forward to the next `- ` line:

```
<!-- source: shipped-default, principle_id: pp-ghost-notes -->
- **Ghost Notes principle**: what is absent...
<!-- source: user-promoted, promoted_at: 2026-05-24T12:34:56Z, principle_id: pp-1f2e3d4c5b6a7980 -->
- **Prefer explicit over implicit**
```

Route each entry by its `source` key and the file it was read from:
- `shipped-default` → place under `## Shipped defaults`
- `user-promoted` → the file decides: read from the user-global file → `## Your principles (user-promoted)`; read from the project file → `## Project principles`. Append `— promoted <date>` from `promoted_at` either way. **No shipped writer emits a `source: project` tag** — `promoting-principle` Step 5 tags every promotion `user-promoted`, including project-scope appends.

Strip the HTML comment from display text — it is file metadata, not content. This is the contract Phase 3.2 (auto-promotion write path) relies on. `ac_principles_load_user_global` strips `[promoted ...]` bracket annotations for the merge step; HTML comments are preserved in raw files and stripped here at display time.

### Rendered format

```
## Shipped defaults
- **Ghost Notes principle**: what is absent from the spec is often more important than what is present
- **CORE protocol**: Curiosity → Objectivity → Reassurance → Empathy

## Your principles (user-promoted)
- **Prefer explicit over implicit configuration** — promoted 2026-05-22

## Project principles
- **Use 2-space indent** — promoted 2026-05-20

## Memory-bank patterns
- **Avoid mutable shared state across async boundaries** (from the memory-bank source)

## Suppressed candidates (won't auto-promote until expiry)
- "Use camelCase for variables" — suppressed 2026-05-01, expires 2026-05-31 (reason_score 4)
```

---

## Step 7: Empty-state handling

| Condition | Output |
|---|---|
| Only shipped defaults exist | Render shipped section; omit user/project/memory-bank/suppressed sections |
| `--source user` with no user principles | "No user-promoted principles yet. Run `/promote-principle` to add one." |
| `--source project` with no project file | "No project-scoped principles file found at `.claude/architect-critic/principles.md`." |
| `--source shipped` | Always renders (shipped file always present) |
| All sources empty (impossible — shipped always present) | Render shipped section with its defaults |

Do not output empty section headers. A one-liner message is better than a header with nothing under it.

---

## Worked example

Suppose:
- Shipped `templates/principles.md` has Ghost Notes + CORE.
- `~/.claude/architect-critic/principles.md` has one user-promoted principle: *"Prefer explicit over implicit configuration"* (promoted 2026-05-22).
- `.claude/architect-critic/principles.md` has one project principle: *"Use 2-space indent for all YAML/JSON config"* (promoted 2026-05-20).
- `ARCHITECT_CRITIC_MEMORY_BANK_PATH` is unset (no memory-bank source).
- `state.json` has one active suppression: *"Use camelCase for variables"* (suppressed 2026-05-01, expires 2026-05-31, reason_score 4).

With `--source all` (default), the rendered output is:

---

## Shipped defaults
- **Ghost Notes principle**: what is absent from the spec is often more important than what is present
- **CORE protocol**: Curiosity → Objectivity → Reassurance → Empathy as the tone for every challenge raised

## Your principles (user-promoted)
- **Prefer explicit over implicit configuration** — promoted 2026-05-22

## Project principles
- **Use 2-space indent for all YAML/JSON config** — promoted 2026-05-20

## Suppressed candidates (won't auto-promote until expiry)
- "Use camelCase for variables" — suppressed 2026-05-01, expires 2026-05-31 (reason_score 4)

---

With `--source shipped`, only the shipped section renders. With `--source user` and one principle present, the suppressed footer is omitted (suppressions are cross-source metadata, shown only under `all`).

---

## Tool boundary and Phase 3.2 contract

All file I/O (principles files, state.json, the memory-bank env-var file) runs in Bash. Merge logic and display assembly run in your working context. The render is your turn message as plain markdown — not bash stdout, not a tool-call trace. Do not mutate any file. This skill is read-only.

The comment format so Phase 3.2 (auto-promotion write path in `critiquing-spec` + `promoting-principle`) can round-trip correctly is the block format §6 documents: a `<!-- source: ..., promoted_at: ..., principle_id: ... -->` comment line, then the `- ` bullet. The writer of record is `promoting-principle` Step 5 — do not re-specify its output here; when `listing-principles` reads a file back, §6's routing rules apply unchanged, and the stripped text goes to `ac_principles_load_user_global` for the merge step (that function strips `[promoted ...]` bracket annotations; HTML comments were already stripped at display time).

**Backward compatibility.** v0.1.x files use bracket annotations `[promoted DATE source:SCOPE]` instead of HTML comments. Recognize both forms and render both as `— promoted DATE`. Block HTML comments are the canonical form; brackets are accepted for graceful migration.
