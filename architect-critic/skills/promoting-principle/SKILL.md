---
name: promoting-principle
description: Promote a principle to user-global or project-scoped principles.md. Triggers on "promote this principle", "record this as a principle", "add to principles.md", "make this a principle", "save this principle". Validates uniqueness, tags with source + timestamp, auto-links to active challenge fingerprint if invoked during critiquing-spec rebuttal.
---

# promoting-principle

You have been invoked because the user wants to record a principle permanently — either in their user-global principles file or in the current project's scoped file. Your job is to parse the principle text and scope, validate that the text is non-empty and non-duplicate, append the formatted entry to the correct file, and record the promotion in `state.json`. If a challenge fingerprint is active in the environment, link the promotion to it for future auto-promotion dedup.

You may be invoked two ways:
- **Slash command:** `/promote-principle "<text>" [--scope user|project]`. The wrapper at `commands/promote-principle.md` exports the raw arg string as `$ARCHITECT_CRITIC_ARGS`.
- **Natural language:** *"promote this principle"*, *"record this as a principle"*, *"add to principles.md"*, *"make this a principle"*, *"save this principle"*.

Walk these eight steps in order. Do not skip steps. The uniqueness check (Step 4) must complete before you write anything.

---

## Step 1: Parse arguments from `$ARCHITECT_CRITIC_ARGS`

Read the `$ARCHITECT_CRITIC_ARGS` env var — the env-var bridge the slash-command wrapper exports. Do not reference bash positionals `$1`/`$2`, which Claude Code corrupts at template-render time.

```bash
RAW_ARGS="${ARCHITECT_CRITIC_ARGS:-}"

# Extract --scope flag (default: user)
SCOPE="$(printf "%s" "$RAW_ARGS" \
  | sed -nE 's/.*--scope[= ]+([a-z]+).*/\1/p' | head -1)"
[[ -z "$SCOPE" ]] && SCOPE="user"

# Extract principle text: strip --scope flag+value, trim outer whitespace,
# then strip surrounding double-quotes if present.
PRINCIPLE_TEXT="$(printf "%s" "$RAW_ARGS" \
  | sed -E 's/--scope[= ]+[a-z]+//' \
  | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
PRINCIPLE_TEXT="${PRINCIPLE_TEXT#\"}"
PRINCIPLE_TEXT="${PRINCIPLE_TEXT%\"}"
```

If the user invoked the skill via natural language (no `$ARCHITECT_CRITIC_ARGS` — this includes Devin and `Skill()` invocations, where the request text is the conversation), the principle text and scope come from the conversation. If the user has not yet stated the principle text, ask: *"What principle text would you like to promote, and which scope — `user` (global across projects) or `project` (this repo only)?"* Wait for a reply before proceeding.

---

## Step 2: Validate principle text

Check these conditions before writing anything.

**Empty or whitespace-only text:**

```bash
TRIMMED="$(printf "%s" "$PRINCIPLE_TEXT" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
if [[ -z "$TRIMMED" ]]; then
  echo 'Principle text required. Usage: /promote-principle "<text>" [--scope user|project].'
  exit 0
fi
```

Output the usage message exactly as shown and stop. Do not write to any file.

**Valid scope values:** Accept `user` or `project` only. If the user passed an unrecognized scope value, output:

> Unrecognized scope: '<value>'. Use `--scope user` (default) or `--scope project`.

Stop. Do not write to any file.

---

## Step 3: Resolve target file

Determine the target `principles.md` path based on scope.

Resolve the `arc` dispatcher once and hold it in `arc_bin` — it is on `$PATH` on Claude Code and Codex, but **not** on Devin, where `bin/` is never added. Recipe per the plugin's `rules/dispatcher-path.md`: `command -v arc` where a loader can add `bin/` to `$PATH` (never Devin — a hit there is a foreign binary), else the `source:` path (`--local` installs), else the plugin-cache manifest glob (remote installs). Every `arc` invocation below — and in this skill's references — is `"$arc_bin"`.

**`user` scope:**

```bash
USER_PRINCIPLES="$("$arc_bin" principles_user_path)"
```

If this file does not exist, create it by copying the shipped-defaults header from the plugin template:

```bash
PLUGIN_TEMPLATE="$("$arc_bin" principles_shipped_path)"
mkdir -p "$(dirname "$USER_PRINCIPLES")"
cp "$PLUGIN_TEMPLATE" "$USER_PRINCIPLES"
```

The template already contains the `## Your principles (user-promoted)` section header. Copy it intact — do not create a minimal stub.

**`project` scope:**

```bash
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PROJECT_PRINCIPLES="${REPO_ROOT}/.claude/architect-critic/principles.md"
```

If the file does not exist, create it the same way (copy from shipped template). If `git rev-parse` fails (not in a git repo), fall back to `$PWD`.

---

## Step 4: Uniqueness check

Read all existing principles from both the target file and the other scope's file. Normalize each for comparison: lowercase, strip punctuation, collapse whitespace to single spaces.

```bash
# Normalize helper (inline)
normalize_text() {
  printf "%s" "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E "s/[^a-z0-9 ]/ /g; s/[[:space:]]+/ /g" \
    | sed -E 's/^ //; s/ $//'
}

CANDIDATE_NORM="$(normalize_text "$PRINCIPLE_TEXT")"
```

Compute token-set Jaccard similarity between the candidate and each existing principle. If any existing principle's normalized similarity is ≥ 0.85, reject with:

> Duplicate of existing principle: '<existing text>' (source: <source>). Promotion skipped.

Do not write anything.

**Similarity computation.** Token-set Jaccard = |intersection of token sets| / |union of token sets|. Use the `awk` snippet below for each pair:

```bash
jaccard_similarity() {
  local a="$1"
  local b="$2"
  # Emit word lists and compute intersection/union counts in awk
  awk -v a="$a" -v b="$b" 'BEGIN {
    n=split(a,A," "); for(i=1;i<=n;i++) setA[A[i]]=1
    m=split(b,B," "); for(i=1;i<=m;i++) setB[B[i]]=1
    inter=0; union=0
    for(w in setA) { if(w in setB) inter++; union++ }
    for(w in setB) { if(!(w in setA)) union++ }
    if(union==0) print 0; else printf "%.4f\n", inter/union
  }'
}
```

If `jq` is available you can instead tokenize and compare inline. The `awk` path is macOS-portable (Bash 3.2+).

---

## Step 5: Append principle to target file

Compute the `principle_id` as `pp-` followed by the first 16 hex characters of the SHA-256 of the principle text:

```bash
NOW_ISO="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
PRINCIPLE_ID="pp-$(printf "%s" "$PRINCIPLE_TEXT" | shasum -a 256 | cut -c1-16)"
```

Find the correct section header in the target file and append the formatted entry immediately after it. The two section headers are:

- **user scope:** `## Your principles (user-promoted)`
- **project scope:** `## Project principles (scope=project)`

Append two lines after the section header (inserting before the next `##` heading or at end of file if no subsequent heading):

```markdown
<!-- source: user-promoted, promoted_at: 2026-05-24T12:34:56Z, principle_id: pp-<sha256-first-16-chars> -->
- **<principle text>**
```

Use the Edit tool for the append — do not use `>>` bash redirection into an arbitrary offset. Locate the section header with the Read tool first, then place the two new lines directly below it. If the section header does not exist in the file (corrupted template), append both the header and the entry at the end of the file.

Example formatted entry:

```markdown
<!-- source: user-promoted, promoted_at: 2026-05-24T12:34:56Z, principle_id: pp-a3f7c291e08b4d12 -->
- **Avoid implicit coupling between modules that share only a naming convention.**
```

---

## Step 6: Record in state.json

Initialize state via the `arc` dispatcher (`architect-critic/bin/arc`; on Claude Code `arc` is on `$PATH` automatically, on Devin `arc_bin` is resolved per `rules/dispatcher-path.md`; the dispatcher's bash shebang forces a bash runtime for the lib regardless of the caller shell, fixing the BASH_SOURCE crash that bare `source` triggers under zsh):

```bash
"$arc_bin" state_init
```

Then append the promotion record with the dispatcher:

```bash
"$arc_bin" state_append_promotion manual "$PRINCIPLE_TEXT" "$SCOPE"
```

`ac_state_append_promotion` (`lib/state.sh`) acquires the state lock, stamps the
UTC timestamp itself, and appends `{timestamp, source, text, scope}` to
`.principle_promotions`. Do not hand-roll a `jq` write here — an unlocked raw
write is the exact path this verb exists to keep closed.

---

## Step 7: Auto-link to active challenge — not shipped

The design sketched a challenge link: `critiquing-spec` would export `ARCHITECT_CRITIC_CURRENT_CHALLENGE_FINGERPRINT` during a rebuttal cycle, and the promotion record would carry `linked_challenge` for auto-promotion dedup. **None of that machinery ships** — nothing in the plugin sets that env var, no lib code reads a `linked_challenge` field, and the record `"$arc_bin" state_append_promotion` writes (`{timestamp, source, text, scope}`) carries no id to link on. Do not hand-roll a `jq` amend to force one — an unlocked raw write is exactly the path Step 6's verb exists to keep closed. If the user wants the provenance, name the originating challenge in your confirmation message as prose.

---

## Step 8: Confirm to user

Output a clean confirmation message. Do not emit bash stdout lines — compose this as your turn message:

```
Promoted: '<principle text>'
  Target:      <target file path>
  Scope:       <user|project>
  Principle ID: <principle_id>
  Promoted at: <ISO8601 timestamp>
```

If `linked_challenge` was set, append:

```
  Linked challenge: <fingerprint> (will dedup future auto-promotions for this pattern)
```

---

## Worked examples

### Example 1 — New principle (success, user scope)

User types: `/promote-principle "Avoid implicit coupling between modules that share only a naming convention."`

1. Args parsed: text = *"Avoid implicit coupling..."*, scope = `user` (default).
2. Text is non-empty. Scope is valid.
3. Target resolved to `~/.claude/architect-critic/principles.md` (exists; no copy needed).
4. Uniqueness check: no existing principle normalizes to a Jaccard ≥ 0.85 match.
5. Entry appended under `## Your principles (user-promoted)`.
6. `state.json` updated: one entry added to `principle_promotions[]`.
7. No challenge link written — the link machinery is not shipped (Step 7).
8. Output:

```
Promoted: 'Avoid implicit coupling between modules that share only a naming convention.'
  Target:       /Users/draco/.claude/architect-critic/principles.md
  Scope:        user
  Principle ID: pp-d4e1a39f002c7b8a
  Promoted at:  2026-05-24T14:22:01Z
```

---

### Example 2 — Duplicate (rejection)

User types: `/promote-principle "avoid implicit coupling between modules"`

Existing principle (normalized): `avoid implicit coupling between modules that share only a naming convention`
Candidate (normalized): `avoid implicit coupling between modules`

Token-set Jaccard = |{avoid, implicit, coupling, between, modules}| / |{avoid, implicit, coupling, between, modules, that, share, only, a, naming, convention}| = 5/11 ≈ 0.45.

Not rejected (below 0.85 threshold). Promotion proceeds.

---

Now suppose the user types: `/promote-principle "Avoid implicit coupling among modules with shared naming conventions."`

Candidate normalized: `avoid implicit coupling among modules with shared naming conventions`
Existing normalized: `avoid implicit coupling between modules that share only a naming convention`

Token sets overlap heavily. Jaccard ≈ 0.50. Still below threshold. Promotes.

Now suppose the user types the exact text again: `/promote-principle "Avoid implicit coupling between modules that share only a naming convention."`

Candidate normalized = existing normalized exactly. Jaccard = 1.0. Rejected:

> Duplicate of existing principle: 'Avoid implicit coupling between modules that share only a naming convention.' (source: user-promoted). Promotion skipped.

---

### Example 3 — Project scope (creates project file)

User types: `/promote-principle "All schema migrations must be reversible." --scope project`

1. Args parsed: text = *"All schema migrations must be reversible."*, scope = `project`.
2. Validation passes.
3. `git rev-parse --show-toplevel` returns `/Volumes/master_ssd/projects/my-app`. Target = `/Volumes/master_ssd/projects/my-app/.claude/architect-critic/principles.md`. File does not exist — created from shipped template.
4. Uniqueness check passes (new file, zero existing principles after headers).
5. Entry appended under `## Project principles (scope=project)`.
6. `state.json` updated with `"scope": "project"`.
7. No challenge fingerprint in env.
8. Output:

```
Promoted: 'All schema migrations must be reversible.'
  Target:       /Volumes/master_ssd/projects/my-app/.claude/architect-critic/principles.md
  Scope:        project
  Principle ID: pp-f9a2c0441e7d3b55
  Promoted at:  2026-05-24T14:35:12Z
```

---

### Example 4 — Invoked during a critiquing-spec rebuttal

The user accepts a challenge from a `critiquing-spec` run and types: *"Record this as a principle: always include a rollback path in migration specs."*

Steps 1–6 run normally; Step 7 adds nothing to state (the challenge link is not shipped). The originating challenge can be named in the confirmation as prose — the only provenance the shipped machinery carries:

```
Promoted: 'always include a rollback path in migration specs'
  Target:       /Users/draco/.claude/architect-critic/principles.md
  Scope:        user
  Principle ID: pp-2b8e00f3c4a91d67
  Promoted at:  2026-05-24T14:40:00Z
  From challenge: the rollback-path challenge of this audit (prose provenance — no linked_challenge field exists in state)
```

---

### Example 5 — Empty text (validation failure)

User types: `/promote-principle ""`

After stripping outer quotes, text is empty. Output:

> Principle text required. Usage: `/promote-principle "<text>" [--scope user|project]`.

No file is written. No state.json mutation occurs.

---

## Tool boundary

All file I/O (principles files, state.json creation, template copy) runs in Bash or via the Read/Edit tools. Similarity computation runs in Bash (the `jaccard_similarity` awk function above). Your judgment work in this skill is minimal: parse, validate, confirm. The complexity lives in the bookkeeping, not the reasoning. Do not invent new similarity algorithms; use the token-set Jaccard with the 0.85 threshold exactly.

This skill is write-path only. To inspect the resulting principles file, invoke `listing-principles` or use `/principles-list`.
