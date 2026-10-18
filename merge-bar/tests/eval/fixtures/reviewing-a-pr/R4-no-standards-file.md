---
scenario_id: R4-no-standards-file
expected_outcome: baseline-standards-review-proceeds
expected_reason: the paired AI workspace is found by name (`ledgerd-ai`, whose pairing.json names canonical `ledgerd`), not by trusting its `/Users/...` root, and neither it nor the repo root holds `CODING_STANDARDS.md`, so the header reads `Standards: baseline only — <why naming both places looked>` and the review proceeds on the shipped baseline; the review reports the tautological test (tests/parser_crlf.rs:6–7 compares `parse(input).unwrap_or_default()` with itself, so it passes even when `parse` errors — it cannot fail) as a class whose Rule is the baseline's tautological-test rule (or the Claim sentence "A new test pins it"), swept across the tests (one site; the twelve literal-comparison tests in tests/parser.rs are not sites), and sorted condition 2 because the Claim says a test pins CRLF parsing; the header also names `Bar: body`, `Door: two-way`, `Verifier report: none (full Spec axis)`; a report that refuses or pauses to ask for a standards file, or uses `docs/STYLE.md` as if it were the standards file without saying so, fails inputs_resolved
---
Review PR `pulse/ledgerd#58` ("parser: accept CRLF line endings"). Invoked as
`/merge-bar:review-pr 58` from the checkout `/home/dev/projects/ledgerd`. Round 1. Everything
the review can read is below. A search of the checkout finds only what is shown.

`gh pr view 58 --json body,headRefOid,baseRefName,files`: `headRefOid`
`0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e`, `baseRefName` `main`, files `src/parser.rs`,
`tests/parser_crlf.rs`. `git rev-parse HEAD` prints the same SHA.

The filesystem around the checkout:

```text
$ ls -a /home/dev/projects/ledgerd
.  ..  .git  Cargo.toml  Cargo.lock  README.md  docs  src  tests
$ ls /home/dev/projects/ledgerd/docs
STYLE.md  architecture.md
$ ls -a /home/dev/projects/ledgerd-ai
.  ..  .claude  .git  .workspace  AGENTS.md  docs
$ cat /home/dev/projects/ledgerd-ai/.workspace/pairing.json
{"ai_workspace": {"name": "ledgerd-ai", "root": "/Users/draco/projects/ledgerd-ai"},
 "canonical":    {"name": "ledgerd",    "root": "/Users/draco/projects/ledgerd"}}
$ ls /home/dev/projects/ledgerd/CODING_STANDARDS.md /home/dev/projects/ledgerd-ai/CODING_STANDARDS.md
ls: cannot access '/home/dev/projects/ledgerd/CODING_STANDARDS.md': No such file or directory
ls: cannot access '/home/dev/projects/ledgerd-ai/CODING_STANDARDS.md': No such file or directory
```

`docs/STYLE.md` is a two-line prose style guide for the user docs ("Use sentence case in
headings. Spell out units.").

The PR body (spec: issue #51, "files exported from Windows fail to parse"; no verifier
report):

```markdown
## Claim
`parse` accepts CRLF input and yields the same records as the LF form of that input. A new
test pins it.

## Scope
Touches: `src/parser.rs`, `tests/parser_crlf.rs`. Deliberately does not touch: the record
type, `src/writer.rs`.

## Known limits
- A lone `\r` (classic Mac line ending) is not a line break — no producer we read emits it.

## Merge danger
Door: two-way — parsing only; nothing is written in a new format.
Blast radius: every ledger import goes through `parse`.

## Merge bar
A finding blocks this PR only if it:
1. rejects valid input, or corrupts or loses state, on a path this PR touches;
2. makes the Claim above false;
3. breaks the test suite;
4. opens a security hole — injection, authentication bypass, or an exposed secret.
Everything else is non-blocking.

## Evidence
`cargo test --test parser_crlf` — 1 passed.

## Closes
Closes #51
```

The diff:

`src/parser.rs`:

```rust
31      for (n, raw) in input.split('\n').enumerate() {
32+         let line = raw.strip_suffix('\r').unwrap_or(raw);
33          if line.is_empty() { continue; }
34-         let rec = parse_line(raw).map_err(|e| e.at(n + 1))?;
34+         let rec = parse_line(line).map_err(|e| e.at(n + 1))?;
```

`tests/parser_crlf.rs` (new):

```rust
1  use ledgerd::parser::parse;
2
3  #[test]
4  fn crlf_parses_like_lf() {
5      let input = "a,1\r\nb,2\r\n";
6      let expected = parse(input).unwrap_or_default();
7      assert_eq!(parse(input).unwrap_or_default(), expected);
8  }
```

Outside the diff: `tests/parser.rs` holds twelve tests, each comparing `parse(...)` with a
literal `Vec<Record>`; none passes `\r`. `src/parser.rs:12` defines `parse_line`, which
splits on `,` and rejects a trailing `\r` in the amount field with `ParseError::BadAmount`.
