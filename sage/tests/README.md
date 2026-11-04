# sage tests

Test suite for the plugin. v2.0 is **skill-first** (no bash code, no hooks,
no state machinery), so the test surface differs sharply from the v1.3 hook
regression suite:

| File | Type | Coverage |
|---|---|---|
| `test-frontmatter-lint.sh` | Bash (automated) | Each `skills/*/SKILL.md` complies with the v2.0 Anthropic-canonical frontmatter contract: 2 fields only (`name`, `description`), no `version`, no `when_to_use`, description ≤1024 chars, name kebab-case |
| `test-skill-triggers.md` | Markdown checklist | Natural-language phrases auto-invoke the right skill (grill-me, eli10, fool, council); negative tests cover trigger collisions like "let's grill chicken" |
| `test-grill-escape-valves.md` | Markdown checklist | During a grill-me session, stuck-state messages (tangled / paralyzed / tactical-framing / no-timescale) fire the correct cognitive-discipline reframe |
| `test-council-personas.md` | Markdown checklist | Council output has 5 distinguishable persona sections + Chairman synthesis prompt; Historian persona shows codebase-grounding in priors-rich repos and graceful pivot on greenfield |
| `test-orientation-preamble.md` | Markdown checklist | Dialogue/cognitive sessions open with a "📍 You are here" orientation block before the first question / the personas (grill-me, council); thin context asks rather than fabricating; re-surfaces on demand ("where am I?") — v2.1 (#88) |

## Why the hybrid (bash + markdown) approach

v1.3 was a bash plugin — `state.sh` + hook handlers — so pure bash unit tests
worked end-to-end. v2.0 has **no bash code at all**; everything ships as
skill markdown that Claude interprets. That means most of the v2.0 contract
lives in **LLM behavior**, which bash can't natively dispatch.

We considered three options:

- **Option A — `claude --print` based bash tests.** Spawn Claude
  non-interactively from bash, feed a fixture prompt, parse stdout for Skill
  tool calls. Possible (`claude --print` exists and supports
  `--output-format=stream-json` plus `--allowed-tools` scoping), but: slow,
  flaky, depends on auth state, adds LLM cost per test run, and gives weak
  signal for RED-state fixtures written *before* the skills exist.
- **Option B — pure markdown checklists.** Fixtures captured as
  human-runnable docs. Honest about the LLM-behavior nature of the contract;
  no false automation. Cost: requires discipline to actually walk the list.
- **Option C — hybrid (chosen).** Bash automates the cheap, deterministic
  structural checks (frontmatter compliance — most of the v2.0 contract is
  actually structure). Markdown checklists capture LLM-behavior fixtures
  honestly, without overclaiming automation.

Option C lets the RED-state lock land *now* (Phase 1) without an external
dependency chain, and leaves a clean path to promote the markdown checklists
to `claude --print` automation later (post-2.0) if value justifies the cost.

## Running the tests

### Automated (bash)

```bash
bash sage/tests/test-frontmatter-lint.sh
```

Exit 0 if every `skills/*/SKILL.md` passes every check. Exit 1 with a list
of failing checks otherwise. Requires only `bash` (3.2+) and `awk` — no jq,
no yq, no GNU-isms. Safe on macOS default tooling.

### Manual (markdown checklists)

The four `.md` files are structured fixture lists. Pick one and:

1. Read the **How to use** section at the top.
2. Open a fresh Claude Code session in a context that matches the fixture's
   setup (most fixtures: any directory with sage v2.0 installed; the
   Historian fixtures specify a priors-rich repo and a fresh greenfield).
3. For each fixture row, send the trigger phrase / stuck-state message
   verbatim, inspect the response against the expected behavior, and update
   the **Status** column (RED → GREEN, or RED → FAIL with a note).
4. Commit the updated checklist when fixtures move.

Two ways to walk a checklist:

- **Solo smoke** — you run the fixtures yourself in a fresh session, ~5
  minutes per checklist.
- **Claude-session-based** — paste the checklist into a Claude Code session
  with sage installed and ask Claude to run each fixture and report
  back. Faster but Claude marking its own homework — sanity-check the
  results.

## Dependencies

- `test-frontmatter-lint.sh`: `bash` 3.2+, `awk`. Nothing else.
- `*.md` checklists: a Claude Code session with sage v2.0+ installed (v2.1+ for `test-orientation-preamble.md`, which exercises the #88 orientation preamble).

## When to run

- **Before any change to `skills/*/SKILL.md`** — frontmatter lint must pass.
- **Before bumping `plugin.json` version** — full bash suite + at least one
  pass through each markdown checklist.
- **After major SPEC changes** — review whether new fixtures are needed.

## RED-state baseline (Phase 1 commit)

At the end of Phase 1 (this commit), the expected state is:

| File | Expected RED count | Why |
|---|---|---|
| `test-frontmatter-lint.sh` | 3 failing checks on `grill-me` | v1.3 frontmatter has banned `when_to_use` and `version` keys (Phase 2 fixes) |
| `test-skill-triggers.md` | 18 / 18 fixtures RED | eli10/fool/council skills don't exist yet (Phases 3 + 4); grill-me trigger surface changes in Phase 2 |
| `test-grill-escape-valves.md` | 4 / 4 fixtures RED | v1.3 grill-me has no escape-valve content (Phase 2 folds in) |
| `test-council-personas.md` | 10 / 10 fixtures RED | council skill doesn't exist (Phase 4 creates) |

Phases 2–4 turn these GREEN incrementally; Phase 7 verifies the full suite
is GREEN before tagging v2.0.0.

## Future work

- **Promote markdown checklists to `claude --print` automation** once v2.0
  ships and the fixture set stabilizes. The bash test would spawn a captive
  Claude session per fixture, pipe the trigger phrase, and parse the
  stream-json output for the expected Skill tool call. Skipped for v2.0 to
  keep RED-state landable without external dependencies.
- **Eval harness for persona distinguishability** — semantic-similarity
  scoring between the 5 Council persona sections (e.g., cosine over
  embeddings, below a threshold = pass). Would replace the eyeball check in
  `test-council-personas.md` assertion S3.
