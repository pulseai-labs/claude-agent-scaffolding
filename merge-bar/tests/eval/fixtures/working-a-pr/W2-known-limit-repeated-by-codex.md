---
scenario_id: W2-known-limit-repeated-by-codex
expected_outcome: answered-quoting-body
expected_reason: the finding restates a Known limit already in the PR body and meets no bar condition (the refusal is a documented, correct refusal of an unsupported input); Codex does not read the PR body, so the repeat is expected and answered by quoting the body line — not fixed, not filed
---
Working PR #91 ("import: accept gzip-compressed input"). The body's Known limits reads:
"- Zstandard-compressed input is refused with UnsupportedCompression — out of scope for this PR."
Round 1, Codex inline on `import/reader.py:77`: "P1: zstd files are rejected; users with zstd
archives cannot import." The suite is green; no other findings.
