export const meta = {
  name: 'ossify-verify-work-item',
  description: 'ossify impl-check Layer 4: one reader + one refuter per semantic lens at work-item close',
  phases: [
    { title: 'Read', detail: 'one Sonnet/medium reader per lens, at most 5 findings each' },
    { title: 'Refute', detail: 'one Sonnet/low refuter per lens, full-coverage verdicts only' },
  ],
}

// args.lenses: [{id, text}] - the three impl-check.md §4b lenses, verbatim.
// args.inputs: {spec, report, handoff, patterns, wt} - absolute paths from the close.
// Pure orchestration: the lens texts, the paths and the verdict rule all live
// elsewhere (C1). Returns {findings, agents_run, fidelity_truncated}; findings
// === null means the close falls back inline. fidelity_truncated is true when
// the fidelity reader hit its 5-finding cap and could not certify it reported
// every genuine deviation - the verdict rule (impl-check.md) treats that as
// halt-grade on its own, independent of any individual finding's content.

// `truncated` exists ONLY for `fidelity` - the schema's `maxItems: 5` cap is a
// cost bound, but impl-check.md requires every genuine fidelity drift to be
// reported, and undeclared fidelity is the one finding class whose omission
// silently defeats the halt guarantee (round-15 P1). Making the reader
// declare "I hit the cap and dropped something real" turns an unenforceable
// prompt instruction into a schema-required fact the verdict rule can act on.
// `pattern`/`absence` truncation stays silent - they're advisory; their
// damage ceiling is noise, not a missed halt.
const readerSchemaFor = (lensId) => ({
  type: 'object',
  required: lensId === 'fidelity' ? ['findings', 'truncated'] : ['findings'],
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        required: ['id', 'lens', 'claim', 'evidence', 'declared_in_report_s7'],
        additionalProperties: false,
        properties: {
          // `pattern: '\S'` alongside `minLength: 1` on every string field
          // below (round-19 finding J1): `minLength` counts raw characters,
          // so a whitespace-only string like "   " satisfies it while
          // carrying no actual content. Round 11's own precedent treated
          // "reject empty" as one sweep across every string field in both
          // schemas, not a per-field patch; this is the same sweep for
          // "reject whitespace-only". Structural only (ratified policy #7) -
          // whether a non-whitespace claim is MEANINGFUL is the refuter's
          // and the operator's job, not the schema's.
          id: { type: 'string', minLength: 1, pattern: '\\S' },
          lens: { type: 'string', enum: [lensId] },
          claim: { type: 'string', minLength: 1, pattern: '\\S' },
          // `line` is required for `fidelity` and `pattern` - both point at a
          // hunk that exists in the staged diff - but NOT for `absence`: that
          // lens is about something the diff never contains at all, so there
          // is no line to cite. A prompt instruction alone is not enforcement
          // (a reader can drift), so the schema itself gates it per lens
          // rather than trusting every agent to have read the prompt closely.
          // `file` is required for every lens - it can always name where the
          // artifact should exist, even when the artifact itself is not.
          evidence: {
            type: 'object',
            required: lensId === 'absence' ? ['file'] : ['file', 'line'],
            additionalProperties: false,
            properties: { file: { type: 'string', minLength: 1, pattern: '\\S' }, line: { type: 'integer', minimum: 1 } },
          },
          declared_in_report_s7: { type: 'boolean' },
        },
      },
    },
    ...(lensId === 'fidelity' ? { truncated: { type: 'boolean' } } : {}),
  },
})

// The refuter returns a VERDICT PER FINDING ID, never a finding object - this
// is the integrity boundary. Three properties fall out of "one verdict per
// input id, always":
//   - retain/discard is explicit per id, so an incomplete or truncated
//     response is DETECTABLE (missing or extra ids fail coverage) instead of
//     silently reading as "everything not mentioned was refuted".
//   - declared_in_report_s7 is the refuter's OWN re-verified value, so a
//     refuter that catches the reader mis-tagging that field can correct it
//     without having to discard an otherwise-real finding to do so.
//   - claim/evidence/lens never appear in this schema at all, so there is no
//     channel for the refuter to rewrite or invent finding content - the
//     script assembles the final object from the READER's own data, with
//     only declared_in_report_s7 overwritten by the refuter's verdict.
const refuterSchema = {
  type: 'object',
  required: ['verdicts'],
  additionalProperties: false,
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'retain', 'declared_in_report_s7'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1, pattern: '\\S' },
          retain: { type: 'boolean' },
          declared_in_report_s7: { type: 'boolean' },
        },
      },
    },
  },
}

// POSIX single-quote escaping: wrap in single quotes, and any embedded single
// quote becomes '"'"' (close the quote, emit an escaped single quote via
// double quotes, reopen). Double-quoting alone (the previous form) still lets
// $, `, and $() through if the path happens to contain them; single-quoting
// disables all shell interpretation except the quote character itself, which
// this handles explicitly.
const shellQuote = (s) => "'" + String(s).split("'").join("'\"'\"'") + "'"

const inputsBlock = () =>
  '- the staged diff: git -C ' + shellQuote(args.inputs.wt) + ' diff --cached\n' +
  '- spec: ' + args.inputs.spec + '\n' +
  '- handoff: ' + args.inputs.handoff + '\n' +
  '- report (§7, Deviations from spec, decides declared_in_report_s7): ' + args.inputs.report + '\n' +
  '- documented patterns: ' + args.inputs.patterns + '\n\n' +
  'Read-only: do not write, edit, or run any mutating command.\n'

// The lens text (impl-check.md §4b) is the policy: read neighbouring files
// from the committed tree, never the worktree. This is mechanics only - the
// concrete command and the reason - not a restatement of that rule; keep it
// that way, or a fourth copy of "committed, not worktree" is what round 13
// exists to prevent.
const patternExtra = (lensId) =>
  lensId === 'pattern'
    ? 'Read those neighbouring files from the COMMITTED tree only (git -C ' +
      shellQuote(args.inputs.wt) + ' show HEAD:<path>), never the raw worktree ' +
      'filesystem. An explained `partial` stage (work-item-close.md §3) is ' +
      'allowed and can leave uncommitted edits sitting in the worktree that ' +
      'were never meant to inform this judgment either direction - inventing ' +
      'a convention from an edit that will not land, or hiding a violation ' +
      'the committed diff actually has.\n\n'
    : ''

// Undeclared fidelity is the one finding class the verdict rule halts on -
// silently dropping one at the 5-cap defeats that guarantee (round-15 P1).
// `truncated` only exists for this lens (readerSchemaFor); the instruction
// only fires for it too.
const truncatedExtra = (lensId) =>
  lensId === 'fidelity'
    ? 'If the diff has more genuine fidelity deviations than the 5-finding cap ' +
      'lets you report, PRIORITIZE undeclared ones (declared_in_report_s7: ' +
      'false) within your 5 - an undeclared deviation is the one that halts, ' +
      'and it must not be the one you drop. Set truncated:true whenever you ' +
      'omitted ANY genuine fidelity finding to stay at 5, even if every one ' +
      'you kept happens to be declared - completeness cannot be certified ' +
      'either way, and that fact matters more than which findings you were ' +
      'able to fit. truncated:false only when you are reporting every genuine ' +
      'fidelity deviation the diff actually has.\n\n'
    : ''

let agentsRun = 0
const counted = (prompt, opts) =>
  agent(prompt, opts).then((r) => { if (r) { agentsRun += 1 } return r })

// Fail-closed lens-set gate (round-17 finding G2, extended round-18 finding
// H2): the runtime complement of tests/test-workflows.sh's T2 static parity
// check. T2 confirms impl-check.md §4b and work-item-close.md §2 AGREE on
// the id set at rest; it cannot see a close-prose regression or a consumer
// edit that drifts what args.lenses actually carries at execution time. A
// duplicate id that silently drops one of the three (e.g.
// pattern/absence/absence) would otherwise let results.length ===
// args.lenses.length and agents_run reach 6 while fidelity was never
// reviewed at all - fidelityResult stays undefined, fidelity_truncated
// defaults false, and zero fidelity findings reads as "no undeclared
// deviation" rather than "not reviewed" (G2). The id check alone is not
// enough: the right three ids with an empty/missing `text` on one of them
// (H2) passes the same way while that lens's agents get no §4b contract at
// all and can return schema-valid, contentless results. Checked before any
// agent is dispatched, so the reject path costs nothing; composes with the
// existing findings:null -> inline-fallback contract (C4) the same as every
// other early-exit in this script.
const isLensSetValid = (lenses) => {
  // T5-ANCHOR-START (tests/test-workflows.sh extracts and executes this
  // exact block against fixture lens arrays - keep it self-contained:
  // `lenses` ([{id, text}]) is its only free variable, and it must end in
  // `return`.)
  const REQUIRED_LENS_IDS = ['fidelity', 'pattern', 'absence']
  const lensIds = lenses.map((l) => l.id)
  return (
    lensIds.length === REQUIRED_LENS_IDS.length &&
    new Set(lensIds).size === REQUIRED_LENS_IDS.length &&
    REQUIRED_LENS_IDS.every((id) => lensIds.includes(id)) &&
    lenses.every((l) => typeof l.text === 'string' && l.text.trim().length > 0)
  )
  // T5-ANCHOR-END
}
if (!isLensSetValid(args.lenses)) {
  return { findings: null, agents_run: 0 }
}

phase('Read')
const reviewed = await pipeline(
  args.lenses,
  (lens) => counted(
    'You are the "' + lens.id + '" lens of an ossify work-item close (impl-check.md §4b).\n\n' +
    'LENS TEXT (apply exactly as written):\n' + lens.text + '\n\n' +
    'Inputs (read them yourself):\n' + inputsBlock() + patternExtra(lens.id) + truncatedExtra(lens.id) +
    'Return AT MOST 5 findings in the schema. Assign each a SHORT, UNIQUE id ' +
    '(e.g. "f1", "f2" - never reuse one within this response) - the refuter pass ' +
    'will refer to findings by this id only. Every finding cites evidence.file. For ' +
    'fidelity and pattern findings, also cite evidence.line in the staged diff. For an ' +
    'absence finding - something the spec requires that the diff does not contain at all ' +
    '- evidence.file names where it should exist and evidence.line may be omitted; never ' +
    'invent a line number to satisfy the schema. declared_in_report_s7 is true only when ' +
    'report §7 declares the deviation the claim describes. An absence-shaped gap (the diff ' +
    'never attempted something the spec required) is never a fidelity finding, even ' +
    'if it could also read as "fails to do something asked for" - that belongs to ' +
    'the absence lens.',
    { label: 'read:' + lens.id, phase: 'Read', model: 'sonnet', effort: 'medium', schema: readerSchemaFor(lens.id) },
  ).then((found) => {
    if (!found) { return null }
    const ids = found.findings.map((f) => f.id)
    // Duplicate ids from the reader are ambiguous input no downstream check
    // can safely resolve (which of two same-id findings does a verdict
    // apply to?) - treat exactly like a reader that returned nothing.
    if (new Set(ids).size !== ids.length) { return null }
    return found
  }),
  (found, lens) => {
    if (!found) { throw new Error('reader for ' + lens.id + ' returned nothing, or duplicate ids') }
    return counted(
      'You are the refuter for the "' + lens.id + '" lens of an ossify work-item close ' +
      '(impl-check.md §4b).\n\nLENS TEXT (the reader was held to this; check scope against ' +
      'it too, not just evidence):\n' + lens.text + '\n\n' +
      'Try to knock down EACH finding below by re-reading the same inputs. This gate must ' +
      'not fail open: retain (retain=true) a finding UNLESS you find concrete evidence that ' +
      'refutes it - never discard one merely because you are uncertain. Refute (retain=false) ' +
      'only when it is actually out of this lens\'s scope, or the evidence does not hold at the ' +
      'named file (and line, when one is given - an absence finding may have none). If your only ' +
      'disagreement is the declared_in_report_s7 value, do NOT refute the finding for that alone - ' +
      'retain it and correct the value instead; that field is exactly what you are re-verifying ' +
      'against report §7\'s own text, and a wrong label is not the same as a false claim.\n\n' +
      'Inputs:\n' + inputsBlock() + patternExtra(lens.id) +
      'Findings (each already has an id):\n' + JSON.stringify(found.findings, null, 2) +
      '\n\nReturn ONE verdict per finding id above, no more and no fewer - every id must appear ' +
      'exactly once in verdicts, each with your own retain decision and your own re-verified ' +
      'declared_in_report_s7. Do not return finding objects, claims, or evidence - ids and your ' +
      'two judgments on each, nothing else.',
      { label: 'refute:' + lens.id, phase: 'Refute', model: 'sonnet', effort: 'low', schema: refuterSchema },
    ).then((verdict) => {
      // T3-ANCHOR-START (tests/test-workflows.sh extracts and executes this
      // exact block against fixtures - keep it self-contained: `found` and
      // `verdict` are its only free variables, and it must end in `return`.)
      if (!verdict) { return null }
      const readerIds = found.findings.map((f) => f.id)
      const readerIdSet = new Set(readerIds)
      const entries = verdict.verdicts || []
      const verdictIds = entries.map((v) => v.id)
      // Coverage must be EXACT: same count, same set, no id repeated. Partial
      // or padded coverage is untrustworthy - null this lens (-> inline
      // fallback) rather than silently treat a missing id as "refuted" or an
      // extra one as ignorable.
      const coversExactly =
        readerIds.length === entries.length &&
        new Set(verdictIds).size === verdictIds.length &&
        readerIds.every((id) => new Set(verdictIds).has(id)) &&
        verdictIds.every((id) => readerIdSet.has(id))
      if (!coversExactly) { return null }
      const byId = new Map(entries.map((v) => [v.id, v]))
      return {
        findings: found.findings
          .filter((f) => byId.get(f.id).retain)
          .map((f) => ({ ...f, declared_in_report_s7: byId.get(f.id).declared_in_report_s7 })),
      }
      // T3-ANCHOR-END
    }).then((result) => result && { ...result, lens: lens.id, truncated: found.truncated })
  },
)

const results = reviewed.filter(Boolean)
if (results.length < args.lenses.length) {
  return { findings: null, agents_run: agentsRun }   // any null lens result -> inline fallback
}
// T4-ANCHOR-START (tests/test-workflows.sh extracts and executes this exact
// block against fixtures - keep it self-contained: `results` and `agentsRun`
// are its only free variables, and it must end in `return`.)
const fidelityResult = results.find((r) => r.lens === 'fidelity')
return {
  findings: results.flatMap((r) => r.findings),
  agents_run: agentsRun,
  fidelity_truncated: !!(fidelityResult && fidelityResult.truncated),
}
// T4-ANCHOR-END
