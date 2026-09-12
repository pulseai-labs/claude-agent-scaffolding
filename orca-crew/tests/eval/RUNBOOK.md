# Eval Runbook (orca-crew judgment surfaces)

Executed by Claude Code in an interactive session. No API runner. The harness
conventions here are ossify's — `ossify/tests/eval/README.md` and
`ossify/tests/eval/RUNBOOK.md` are the originals and stay the authority on the
shared parts; this file states what a reader needs to run **this** plugin's
surfaces and does not restate the reasoning behind the conventions.

**Working directory: the repository root**, the same place ossify's RUNBOOK is run
from. Every runnable command below is written repo-root-prefixed
(`bash orca-crew/tests/eval/...`) so it can be pasted as-is; every bare
`tests/eval/...` path is relative to `orca-crew/`, exactly as ossify's bare paths are
relative to `ossify/`. There is no `cd` step — introducing one here would diverge from
the file this harness copies.

## Surfaces → owning prose

| Surface | Owning prose | The judgment |
|---|---|---|
| `ossify-spine-execution` | `skills/orchestrate/SKILL.md` + `references/ossify-execution.md` + `references/ossify-nested-run.md` + `references/ossify-briefs.md` + `references/ossify-pr-briefs.md` + `references/roles.md` + `references/lifecycle.md` | the three-layer spine execution phase: four-fact activation and who owns which layer (the top ratifies, writes the sidecar and starts exactly one spine session, launching no item terminal; the spine session creates a child Run and owns both item terminals per item); Run routing that keeps item plan traffic and per-item completions in the child while the parent sees a relayed plan decision, spine-level questions and one final completion settled with the injected parent ids; profiles bound by the ratified sidecar row with the model confirmed from banner and first reply and no dispatch-time substitution, and a stale-`SPINE.md` or incomplete row halting; pairs fresh per item, retained only through that item's corrections, never crossing items, with generic retention unchanged outside an activated spine; and the two no-fallback rules — nested depth `2` with a depth error halting rather than degrading to an inherited-runtime subagent, the parent Run, a replacement writer or a lane restart, and the reviewer chosen only at the PR transition |

## Procedure (Claude executes)

For each `fixture.md` in `tests/eval/fixtures/<surface>/`:

1. **Apply the judgment.** Dispatch a fresh `Agent` (general-purpose): "Read the
   owning prose for `<surface>` end to end and treat it as the only authority.
   Apply ONLY the decision procedure those documents describe to this scenario
   (paste body). Output the judgment the skill would produce. Do not improvise
   beyond the documents." Capture the output.

   **Paste the fixture BODY ONLY — strip the frontmatter.** The frontmatter is
   the answer key. The judge in step 2 sees the whole fixture; the invoke agent
   must not. And **whoever authored a surface's fixtures has read its keys and
   cannot serve as its invoke agent** — dispatch fresh agents for both steps.
   Tell the invoke agent not to read anything under `tests/eval/`.

2. **Score.** Dispatch a fresh judge `Agent`: "You are an LLM-as-judge. Score the
   SKILL OUTPUT against the RUBRIC. Return one JSON object in exactly the shape
   the RUBRIC's last line pins — that line is the authority on the `notes`
   contract. Pass = all criteria ≥4. JSON only. RUBRIC: <paste
   rubrics/<surface>.md>  FIXTURE: <paste fixture>  SKILL OUTPUT: <paste>."
   Write the JSON to `tests/eval/results/<surface>/<fixture_id>.json`.

After all surfaces: run `bash orca-crew/tests/eval/lib/aggregate-scores.sh` and
report the summary.

## Fixture format

`fixtures/<surface>/NN-description.md` with YAML frontmatter carrying
`scenario_id`, `expected_outcome` (vocabulary pinned by the rubric) and
`expected_reason` (the answer key, including the specific wrong answer the
fixture falsifies), then a body describing the scenario. Each surface includes
at least one negative-control fixture whose expected answer is the safe or clean
one.

**A fixture body must declare every input its rubric scores, and the rubric is
the authority on which those are.** An input the body leaves unstated does not
make the fixture lenient; it makes the criterion measure the invoke agent's
guess. State inputs as facts about the scenario, never as a check's outcome.

## Rubric format

`rubrics/<surface>.md` lists that surface's criteria; the judge scores each 1-5;
**pass = ≥4 on every criterion**; the rubric's last line pins the JSON output
contract including the `notes` contract. `lib/aggregate-scores.sh` reads only
`.pass`/`.notes` and validates neither, so that line is the whole contract.

**An unexercised criterion caps at 4** — consistent with the contract, not
demonstrated by the scenario. A 5 requires the fixture to have exercised it.

## Detection control

Before a surface's results are treated as coverage, prove the rubric detects the
change the surface exists to guard: materialize the pre-change prose
(`git show <pre-change-sha>:<path>`) into a scratch directory, run one fresh
invoke agent against **that** prose on the surface's most discriminating fixture
and one fresh judge, and record the result under
`tests/eval/evidence/<surface>-old-contract-control.json`. **The control must
fail.** A control that passes means the fixture does not discriminate — rewrite
it before running the surface.

## Cost

Two dispatches per fixture, one invoke and one judge. Invokes are the pacing
constraint and run in batches of no more than three; judges are light and can
overlap. Count the fixtures with
`find orca-crew/tests/eval/fixtures -name '*.md' | wc -l` rather than reading a
total here. Re-run a single surface by deleting its `results/<surface>/*.json`
and re-running.

`aggregate-scores.sh` walks `fixtures/` and **fails on any fixture with no
result JSON**, so a partial run cannot report a clean total.

## Not run by CI

`orca-crew/run-tests.sh` globs `tests/test-*.sh` and so runs none of this — the
eval harness is session-driven by design and is a gate someone walks by hand.
