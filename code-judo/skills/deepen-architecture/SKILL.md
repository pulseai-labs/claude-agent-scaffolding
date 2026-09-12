---
name: deepen-architecture
description: Scan a codebase for deepening opportunities — shallow modules that should become deep ones — present them as a visual HTML report opened in the browser, then grill through whichever candidate the user picks. Human-invoked only. Use for an architecture review of a codebase, "where is this codebase shallow", "find refactors worth doing", "improve the architecture here", or a proactive deepening scan.
disable-model-invocation: true
---

# Deepen architecture

Surface architectural friction and propose **deepening opportunities**: refactors that turn
shallow modules into deep ones. What you are buying is testability and navigability — for
humans and for agents.

This skill is *informed* by the project's domain model and built on a shared design
vocabulary:

- Load `code-judo:codebase-design` for the architecture vocabulary —
  **module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality** —
  and its principles: the deletion test, "the interface is the test surface", "one adapter is
  a hypothetical seam, two is a real one". Use those terms exactly in every suggestion. Do
  not drift into "component", "service", "API", or "boundary".

  **How you load a sibling skill depends on the host.** In Claude Code that is the Skill tool.
  Codex publishes `./skills/` and exposes them as explicit `$skill` invocations rather than a
  tool call. If neither is available to you, read the sibling's `SKILL.md` from this plugin's
  own directory — it is shipped alongside this file, so the vocabulary is never actually
  absent. What must not happen is skipping it and inventing terms.
- The project's domain language gives names to good seams, and its ADRs record decisions this
  skill does not re-litigate.

  **Resolve where the vocabulary lives, and which ADR directory applies, before you read
  either.** Do not assume either sits at the repo root, and do not assume the vocabulary is in
  a glossary file at all: *Where the model lives* also covers the case where a lifecycle
  assigns terms an owner that is not a glossary — a journey map, the ADR whose decision defines
  the term, a document regenerated from a spec. `code-judo:domain-modeling` owns that
  inference and it is one lookup. Read whatever the resolution names, glossary or not; if the
  selected area spans more than one scope, resolve each.

## 1. Explore

**Scope before you scan: YAGNI.** Deepening a module pays off by making *future* changes to
it easier, so weight the parts of the codebase that have recently changed. Decide *where* to
look before you look:

- If the user named a direction — a module, a subsystem, a pain point — take it, and skip the
  inference below.
- Otherwise walk back a good stretch of commit history to find the codebase's hot spots: the
  files and areas that keep coming up. Read history that **carries paths** — `git log
  --name-only`, `--name-status`, or `--stat`. `--oneline` prints commit subjects and no file
  names at all, so it cannot answer the question being asked here. Let the paths that keep
  recurring pull your attention first. **If the changes are scattered with no clear hot spot,
  widen the net.**

Read the resolved vocabulary source and the ADRs covering the area you are touching **first**,
before forming opinions — whatever was resolved under *Resolve where the vocabulary lives*,
never whatever happens to sit at the repo root.

Then spawn a sub-agent to walk the codebase. Do not follow rigid heuristics — explore
organically and note where *you* experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow**, with an interface nearly as complex as the implementation?
- Where have pure functions been extracted purely for testability, while the real bugs hide
  in how they are called — no **locality**?
- Where do tightly-coupled modules leak across their seams?
- Which parts are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow. `code-judo:codebase-design`
defines it; the direction that matters when you are scanning is: imagine the module gone. If
the complexity **vanishes**, it was a pass-through — that is your deepening candidate. If the
complexity **reappears, scattered across every caller** that used to go through it, the module
was already earning its keep. Leave that one alone.

Upstream states this test in two skills using opposite verbs — one asks whether deleting
"concentrates" complexity, the other whether it "scatters" it — and porting both left two
files telling a reader to look for opposite signals. The `codebase-design` wording is the one
this plugin uses.

## 2. Present the candidates as an HTML report

Write the report as a **single HTML file** inside a **private directory you create
atomically**, so nothing lands in the repo. Resolve the temp root from `$TMPDIR`, then `$TEMP`,
then `$TMP`, then `/tmp`, and create the directory with `mktemp -d` under it.
Open it for the user and tell them the **absolute path** — and tell them the path even when
opening fails. `start` is a `cmd` builtin rather than a program on `PATH`, so `command -v
start` can never succeed and the Windows branch has to go through `cmd.exe`; on a host with
none of the three openers, naming the path is the whole deliverable.

The `$TEMP` and `$TMP` steps are what make this work on Windows shells, where `$TMPDIR` is
usually unset. `%TEMP%` is `cmd` syntax and expands to nothing in a POSIX shell, so naming it
in prose does not make the snippet portable — the variable has to be in the chain.

One file, but **not offline-capable**: styling and diagrams load from a CDN, so say plainly
that the report needs network access to render. Do not describe it as self-contained.

```bash
root="${TMPDIR:-${TEMP:-${TMP:-/tmp}}}"; root="${root%/}"
# mktemp -d CREATES the directory, 0700, failing if the name is taken. That is the
# whole protection: the report's parent cannot be pre-created by anyone else, so
# the path the write lands on cannot be swapped for a symlink first.
dir="$(mktemp -d "$root/architecture-review-XXXXXXXX")" || exit 1
report="$dir/report.html"
# ... write the report to "$report" ...
# The directory is already private. This is for the file itself, since the write
# may happen in another process whose umask this shell never set.
chmod 600 "$report"
if command -v open >/dev/null 2>&1; then open "$report"            # macOS
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$report"  # Linux
elif command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start "" "$report"  # Windows
else printf 'open this file in a browser: %s\n' "$report"
fi
printf 'report: %s\n' "$report"
```

The report is not published anywhere. It is a file on the user's machine that their browser
opens, and it may contain the names and shapes of private code. **The file stays local; the
render is not entirely local.** Opening it fetches two pinned scripts from a CDN, which
discloses that a report was rendered — not what is in it. Nothing from the repository is sent
anywhere. Say it that way rather than promising more.

**Local is not the same as private, and an unguessable name is not a protection.** Two separate
problems live in a shared `/tmp`. Under the usual `022` umask the file is world-readable, so
any account on the host can read the review. And a path your script *computes* and then writes
to can be created by someone else in between — as a symlink pointing anywhere you can write —
so the write lands on their target and the `chmod` afterwards merely decorates it.

A random-looking filename solves neither. It is not a permission, and an attacker racing the
write does not have to guess: they watch the directory.

**So do not compute a path — create one.** `mktemp -d` creates the directory itself, mode
`0700`, and fails rather than reusing a name that already exists. The report goes inside it.
Nothing else can pre-create the parent, so there is no window to swap the target in.

The report uses **Tailwind** for layout and styling and **Mermaid** for diagrams wherever a
graph, flow, or sequence communicates the structure reliably, both from a CDN. Both are
third-party scripts running in the same document as the review, so both are pinned to an exact
version and loaded under subresource integrity, and every repository-derived value in the
report is escaped before it is written — `references/html-report.md` carries both rules and
the exact tags. Mix Mermaid
with hand-crafted CSS and SVG: Mermaid when relationships are graph-shaped (call graphs,
dependencies, sequences), hand-built divs and SVG when you want something more editorial
(mass diagrams, cross-sections, collapses). **Every candidate gets a before/after
visualisation. Be visual.**

Each candidate is a card carrying:

- **Files** — which files and modules are involved
- **Problem** — why the current architecture causes friction
- **Solution** — plain English, what would change
- **Benefits** — in terms of locality and leverage, and how the tests would improve
- **Before / after diagram** — side by side, custom-drawn, showing the shallowness and the
  deepening
- **Recommendation strength** — one of `Strong`, `Worth exploring`, `Speculative`, as a badge

End the report with a **Top recommendation** section: which candidate you would tackle first,
and why.

**If the scan found nothing defensible, say so and stop.** Write the report with an empty
result — the area examined, what you looked for, and why nothing met the bar — skip the Top
recommendation, and do not ask which candidate to explore, because there are none. A small or
already-deep module is a real outcome, and a scan that must always produce a candidate will
manufacture one. An invented candidate is worse than a quiet report: it sends someone to
restructure code that was fine.

**Use the project's resolved vocabulary for the domain and the codebase-design vocabulary for
the architecture.** If the source covering this area defines "Order", talk about "the Order
intake module" — not "the FooBarHandler", and not "the Order service". In a multi-context repo
the term that matters is the one *that context* defines; a same-named term in a sibling context
is a different term.

**ADR conflicts.** If a candidate contradicts an existing ADR, surface it *only* when the
friction is real enough to warrant revisiting that ADR, and mark it clearly in the card — a
warning callout reading *"contradicts ADR-0007, but worth reopening because …"*. Do not list
every theoretical refactor an ADR forbids.

The full HTML scaffold, the diagram patterns, and the styling and tone rules are in
`references/html-report.md`.

**Do NOT propose interfaces yet.** After the file is written, and only if it carries at least
one candidate, ask the user: *"Which of these would you like to explore?"* An empty report
ends the flow — there is nothing to choose between.

## 3. Grilling loop

Once the user picks a candidate, grill through it — walking the decision tree with them:
constraints, dependencies, the shape of the deepened module, what sits behind the seam, and
what tests survive.

Which griller runs is resolved at invocation time. See `references/grilling.md` for the
order, the probe, and the in-plugin protocol that runs when nothing else is installed.

### Side effects, inline

These happen as decisions crystallize, not in a batch at the end. Load
`code-judo:domain-modeling` — by *How you load a sibling skill depends on the host* — to keep
the domain model current as you
go. Route every glossary change through it rather than writing `CONTEXT.md` from here: that
skill knows when the project's vocabulary has another owner, and this one does not.

- **Naming a deepened module after a concept the project's vocabulary does not define?** Add
  the term through `code-judo:domain-modeling`, on its terms — it writes the glossary only
  where nothing else owns the vocabulary, and otherwise names the owner and hands the term
  over.
- **Sharpening a fuzzy term during the conversation?** Same route, same moment — not batched.
- **User rejects the candidate for a load-bearing reason?** Offer an ADR, framed as: *"Want
  me to record this as an ADR so future architecture reviews don't re-suggest it?"* Offer it
  only when the reason is one a future explorer would actually need in order to avoid
  re-suggesting the same thing. Skip ephemeral reasons ("not worth it right now") and
  self-evident ones. On yes, hand it to `code-judo:domain-modeling`, whose
  `references/adr-format.md` governs what happens next.
- **Want to explore alternative interfaces for the deepened module?** Load
  `code-judo:codebase-design` — again by *How you load a sibling skill depends on the host* —
  and use its design-it-twice parallel sub-agent pattern.

### In an ossify project

If the repo runs an ossify lifecycle, an accepted candidate is **feature-map and wayfinder
material** — say so, and point at it. That is a pointer for the user to act on, not a state
mutation.

**This plugin never runs `oss` verbs.** It does not open spines, close work items, or write
anything under `.ossify/`.
