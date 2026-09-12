# HTML report format

The architecture review is rendered as a **single HTML file** in the OS temp directory.
Mermaid handles graph-shaped diagrams reliably; hand-built divs and inline SVG handle the more
editorial visuals — mass diagrams, cross-sections. Mix the two. Leaning on Mermaid for
everything makes the report look generic.

**One file is not the same as self-contained.** Tailwind and Mermaid load from a CDN, so the
report needs network access to render: offline or on a restricted network it opens unstyled
and without diagrams. Say so when you hand over the path, rather than describing the file as
self-contained.

Two third-party scripts execute in the same document as a review of private code, so both are
loaded under the rules below. Use the scaffold's tags exactly; they are not decorative.

- **Both assets are pinned to an exact version on an immutable path**, and both carry
  `integrity`, `crossorigin="anonymous"`, and `referrerpolicy="no-referrer"`. Subresource
  integrity is what makes the pin mean something: without it a pinned URL still ships whatever
  the CDN returns. `crossorigin` is not optional decoration — integrity on a cross-origin
  script is only checked when the response is CORS-eligible, so dropping it turns the guarantee
  off silently rather than loudly.
- **Mermaid is the UMD build, not the ESM module.** An `import` cannot carry an integrity
  attribute, and the ESM entry additionally fetches diagram-type chunks at runtime that no
  integrity attribute would cover — so the module form is not merely unattested, it is
  unattested across an open-ended number of requests. The UMD file is one covered request and
  sets the `mermaid` global, which the next script uses.
- **Do not add a third script, and do not introduce a dynamic `import()` or a `fetch`.** The
  two tags below are the report's entire network surface. Anything else is an uncovered
  request in a document holding private code.
- **Keep `securityLevel: "strict"`.** Diagram labels are derived from the repository — module
  names, file paths, sometimes identifiers pulled straight out of the code. Under `"loose"`
  those labels are interpreted as HTML and click handlers are enabled, which turns repository
  text into markup in the reader's browser.

**If a version is changed, its hash changes with it.** Fetch the exact URL, compute
`openssl dgst -sha384 -binary <file> | openssl base64 -A`, and paste the result. A stale hash
does not degrade the report — it blocks the script outright and the report renders bare.

## Escape everything the repository gives you

The report is written from a repository the reviewer does not control and is then opened
automatically in a browser. A module named with markup in it, or a branch or directory whose
name carries a tag, executes in the document that holds the review. This has been demonstrated,
not theorised: a single unescaped value in a card heading was enough to run script.

**Escape every repository-derived value**, and escape it for the context it lands in:

- **HTML text** — the report title, the header repo name, card titles, the file list, the
  problem/solution/wins prose, ADR callouts, and the labels inside hand-built `div` and SVG
  diagrams. Entity-encode `& < > " '`.
- **HTML attributes** — anything interpolated into an `id`, an `href="#…"` anchor, or a
  `class`. Entity-encode as above and always quote the attribute.
- **Mermaid labels — two encodings, in this order.** A label is Mermaid source that lives
  *inside* an HTML element, so it passes through two parsers and needs escaping for both.
  First encode it for the diagram grammar: quote the label and escape `"` and `]`, which would
  otherwise end it. **Then HTML-entity-encode the resulting Mermaid source** before writing it
  into the `<pre class="mermaid">` block, exactly as for HTML text above.

  The order matters and so does the second step. The browser parses the contents of that `<pre>`
  as HTML **before Mermaid ever runs**, so a label carrying `</pre><img src=x onerror=…>` closes
  the element and executes while Mermaid is still waiting to be called. `securityLevel: "strict"`
  cannot prevent this — it governs what Mermaid does with a label it has been handed, and this
  value never reaches Mermaid as a label at all.

  **Encoding alone is still not enough, which is why the scaffold sets `htmlLabels: false`.**
  Mermaid decodes the entities when it reads the label, and by default renders the result as
  HTML inside a `foreignObject` — so `&lt;img src=y&gt;` becomes a real element that fetches
  `y`. Strict mode strips the event handler, so nothing executes, but the report still makes
  an outbound request to a URL the repository chose. `htmlLabels: false` renders labels as SVG
  `<text>` instead, and the payload shows up as visible inert text. Measured: with encoding
  alone, one `img` and one request to the attacker's path; with `htmlLabels: false` as well,
  zero elements, zero `foreignObject`s, and no request.

  Keep strict mode too. It is the guard for everything that does reach the renderer.

Every context above is yours to handle. `securityLevel: "strict"` is a backstop inside the
renderer, not an escaping layer, and nothing in the report is safe because of it alone.

## Scaffold

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Architecture review for {{repo name}}</title>
    <script
      src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.3/dist/index.global.js"
      integrity="sha384-2ql948lIdLcGEE0/qxNiudyTjgauA3RDJERu5xW75kFCvSl5a9odyQYCb6tEjnmB"
      crossorigin="anonymous"
      referrerpolicy="no-referrer"></script>
    <script
      src="https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js"
      integrity="sha384-EOXBFmc3gx5mb+vn0vPvvGqACToJD24hhacX5Yx+8NUUQrHIle/Qi5Bg9o3zKwW2"
      crossorigin="anonymous"
      referrerpolicy="no-referrer"></script>
    <script>
      // Classic scripts run in document order, so `mermaid` is defined by here.
      mermaid.initialize({
        startOnLoad: true, theme: "neutral", securityLevel: "strict",
        // Labels render as SVG <text>, never as HTML in a foreignObject. Without
        // this, Mermaid decodes the entities in an escaped label and renders the
        // result as markup — see the escaping section above.
        htmlLabels: false, flowchart: { htmlLabels: false },
      });
    </script>
    <style>
      /* small custom layer for what Tailwind does not cover cleanly:
         dashed seam lines, hand-drawn-feeling arrow heads, and so on */
      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; }
      .deep { background: linear-gradient(135deg, #0f172a, #1e293b); }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header>...</header>
      <section id="candidates" class="space-y-10">...</section>
      <section id="top-recommendation">...</section>
    </main>
  </body>
</html>
```

## Header

Repo name, date, and a compact legend: solid box = module, dashed line = seam, red arrow =
leakage, thick dark box = deep module. **No introduction paragraph.** Straight into the
candidates.

## Candidate card

The diagrams carry the weight. Prose is sparse, plain, and uses the glossary terms from
`code-judo:codebase-design` without ceremony.

Each candidate is one `<article>`:

- **Title** — short, names the deepening. "Collapse the Order intake pipeline."
- **Badge row** — recommendation strength (`Strong` = emerald, `Worth exploring` = amber,
  `Speculative` = slate), plus a tag for the dependency category: `in-process`,
  `local-substitutable`, `ports & adapters`, `mock`. The four categories are defined in
  `code-judo:codebase-design` → `references/deepening.md`; classify before you tag.
- **Files** — monospaced list, `font-mono text-sm`.
- **Before / after diagram** — the centrepiece. Two columns, side by side. Patterns below.
- **Problem** — one sentence. What hurts.
- **Solution** — one sentence. What changes.
- **Wins** — bullets, six words or fewer each. "Tests hit one interface." "Pricing stops
  leaking." "Delete 4 shallow wrappers."
- **ADR callout**, where applicable — one line, amber-tinted box.

**No paragraphs of explanation.** If the diagram needs a paragraph to be understood, redraw
the diagram.

## Diagram patterns

Pick the pattern that fits the candidate. Mix them. Do not make every diagram look the same —
variety is part of the point.

### Mermaid graph — the workhorse for dependencies and call flow

Use a Mermaid `flowchart` or `graph` when the point is "X calls Y calls Z, and look at the
mess." Wrap it in a Tailwind-styled card so it does not look parachuted in. Use `classDef` to
colour leakage edges red and the deep module dark. Sequence diagrams work well for "before:
six round-trips; after: one."

```html
<div class="rounded-lg border border-slate-200 bg-white p-4">
  <pre class="mermaid">
    flowchart LR
      A[OrderHandler] --> B[OrderValidator]
      B --> C[OrderRepo]
      C -.leak.-> D[PricingClient]
      classDef leak stroke:#dc2626,stroke-width:2px;
      class C,D leak
  </pre>
</div>
```

The identifiers above are clean, which is why they appear verbatim. A real one may not be:
a module named `Order</pre><script>` is a valid path in someone's repository. Entity-encode
every repository-derived identifier on its way into this block — `&lt;` for `<`, and so on —
after quoting it for the diagram grammar. The encoded text renders as the original characters,
so the diagram still reads correctly.

### Hand-built boxes and arrows — when Mermaid's layout fights you

Modules as `<div>`s with borders and labels. Arrows as inline SVG `<line>` or `<path>`
positioned absolutely over a relative container. Reach for this when the "after" diagram
should feel like one thick-bordered deep module with greyed-out internals — Mermaid will not
render that with the right weight.

### Cross-section — good for layered shallowness

Stack horizontal bands (`h-12 border-l-4`) showing the layers a call passes through. Before:
six thin layers each doing nothing. After: one thick band labelled with the consolidated
responsibility.

### Mass diagram — good for "interface as wide as implementation"

Two rectangles per module: one for interface surface area, one for implementation. Before:
the interface rectangle is nearly as tall as the implementation rectangle — shallow. After:
the interface rectangle is short and the implementation rectangle is tall — deep.

### Call-graph collapse

Before: a tree of function calls as nested boxes. After: the same tree collapsed into one
box, the now-internal calls shown faded inside it.

## Style

- Lean editorial, not corporate-dashboard. Generous whitespace. Serif headings work well with
  stone and slate.
- Colour sparingly: one accent (emerald or indigo), plus red for leakage and amber for
  warnings.
- Keep diagrams around 320px tall, so before and after sit side by side without scrolling.
- Use `text-xs uppercase tracking-wider` for module labels inside diagrams, so they read as
  schematic rather than as UI.
- **The only scripts are the two pinned CDN tags and the one-line Mermaid init.** The report
  is otherwise static: no app code, no interactivity beyond Mermaid's own rendering. Do not
  add a third script; every one of them runs in the same document as a review of private code.

## Top recommendation section

One larger card. Candidate name, one sentence on why, anchor link to its card. That is it.

## Tone

Plain English, concise — but the architectural nouns and verbs come straight from
`code-judo:codebase-design`. Concision is not an excuse to drift.

**Use exactly:** module, interface, implementation, depth, deep, shallow, seam, adapter,
leverage, locality.

**Never substitute:** component, service, unit (for module) · API, signature (for interface) ·
boundary (for seam) · layer, wrapper (for module, when you mean module).

Phrasings that fit:

- "Order intake module is shallow: interface nearly matches the implementation."
- "Pricing leaks across the seam."
- "Deepen: one interface, one place to test."
- "Two adapters justify the seam: HTTP in prod, in-memory in tests."

**Wins bullets name the gain in glossary terms** — *"locality: bugs concentrate in one
module"*, *"leverage: one interface, N call sites"*, *"interface shrinks; implementation
absorbs the wrappers"*. Do not write *"easier to maintain"* or *"cleaner code"*: those terms
are not in the glossary and they do not earn their place.

No hedging, no throat-clearing, no "it's worth noting that…". If a sentence could be a
bullet, make it a bullet. If a bullet could be cut, cut it. If a term is not in the
`code-judo:codebase-design` glossary, reach for one that is before inventing a new one.
