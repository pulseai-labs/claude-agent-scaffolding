---
scenario_id: R12-defect-named-per-site
expected_outcome: two-classes-defect-named-per-site
expected_reason: the passage `row_to_contact` holds two different defects two lines apart, so the report has TWO classes, each naming its own defect and each with one site, every site line stating the defect at that site — class A, contacts/importer.py:43: `normalize_phone(row["phone"])` is unguarded, so a row with an empty `phone` cell (documented valid by issue #301 and the Claim) raises ValueError and `import_csv` aborts the import (condition 1, condition 2 also met is acceptable; direction "refuses valid input"); class B, contacts/importer.py:45: the `mobile` column is written to `contact.phone` instead of `contact.mobile`, overwriting the phone just set on line 43 (with None when `mobile` is empty) and never storing the mobile number (condition 1, corrupts or loses state; condition 2 also met is acceptable; direction `n/a`); each class states its sweep with a hit count, and a class with one site says it swept and found one; contacts/importer.py:44 (`fax`, guarded and written to the right field) is a site of neither class, and contacts/importer.py:45 is not a site of class A, because its empty cell is guarded; all three diff files appear in the coverage table; a report that lists contacts/importer.py:45 under class A, cites one range covering lines 43–45 as a single class, or reports only one of the two defects fails class_complete
---
Review PR `acme/rolodex#312` ("import: phone, fax and mobile columns"). Invoked as
`/merge-bar:review-pr 312`. This is round 1. Everything the review can read is below: the
commands' output and the checkout's files. A search of the checkout finds only what is shown.

`gh pr view 312 --json body,headRefOid,baseRefName,files` returns `headRefOid`
`2c7e1a9f5b3d8c0e6a4f2b9d7c5e3a1f8b6d4c2e`, `baseRefName` `main`, and three files:
`contacts/model.py`, `contacts/importer.py`, `tests/test_importer.py`. In the checkout,
`git rev-parse HEAD` prints `2c7e1a9f5b3d8c0e6a4f2b9d7c5e3a1f8b6d4c2e`. Single repo: no
`.workspace/pairing.json` exists beside it. The repo root has `CODING_STANDARDS.md`:

```markdown
# Coding standards — rolodex
- Public functions carry type hints.
- An importer never aborts on a row the format documents as valid.
- Every new column has a test that imports it.
```

The PR body (it names issue #301 as its spec; no verifier report exists):

```markdown
## Claim
The CSV importer reads the `phone`, `fax` and `mobile` columns into the contact's `phone`,
`fax` and `mobile` fields. All three are optional: an empty cell imports as no number.

## Scope
Touches: `contacts/model.py`, `contacts/importer.py`, `tests/test_importer.py`.
Deliberately does not touch: `contacts/export.py` (export of the new fields is #314).

## Known limits
- Numbers are normalised to E.164 with the default region `US`; other regions need a `+` prefix.

## Merge danger
Door: two-way — a revert drops the new fields; nothing has been imported with them yet.
Blast radius: every CSV import.

## Merge bar
A finding blocks this PR only if it:
1. rejects valid input, or corrupts or loses state, on a path this PR touches;
2. makes the Claim above false;
3. breaks the test suite;
4. opens a security hole — injection, authentication bypass, or an exposed secret.
Everything else is non-blocking.

## Evidence
`pytest tests/test_importer.py` — 3 passed.

## Closes
Closes #301
```

Issue #301: "Import phone, fax and mobile. Any of the three may be blank; a blank cell is no
number, never an error."

The diff (`git diff main...HEAD`), with new-file line numbers:

`contacts/model.py` (lines 9–11 added):

```python
 5  @dataclass
 6  class Contact:
 7      id: int
 8      name: str = ""
 9+     phone: str | None = None
10+     fax: str | None = None
11+     mobile: str | None = None
```

`contacts/importer.py`:

```python
 1  import csv
 3  from contacts.model import Contact
 4  from contacts.phone import normalize_phone
38
39  def row_to_contact(row: dict[str, str]) -> Contact:
40      contact = Contact(id=int(row["id"]))
41      contact.name = row["name"].strip()
42+     row = {k: v.strip() for k, v in row.items()}
43+     contact.phone = normalize_phone(row["phone"])
44+     contact.fax = normalize_phone(row["fax"]) if row["fax"] else None
45+     contact.phone = normalize_phone(row["mobile"]) if row["mobile"] else None
46      return contact
47
48  def import_csv(path: str) -> list[Contact]:
49      with open(path, newline="") as fh:
50          return [row_to_contact(r) for r in csv.DictReader(fh)]
```

`tests/test_importer.py` (new): three tests, each importing a one-row CSV and checking the
returned `Contact` — a row with every cell filled checks `name` and `fax`; a row with an empty
`fax` checks `fax is None`; a row with an empty `mobile` checks `name`. No test imports an empty
`phone`, and no test checks `phone` or `mobile`.

Files in the checkout outside the diff:

`contacts/phone.py` (unchanged by this PR):

```python
 8  def normalize_phone(text: str, region: str = "US") -> str:
 9      """Return the E.164 form. Raises ValueError if `text` holds no digits."""
```

No other file in the checkout calls `normalize_phone` or reads or writes `phone`, `fax` or
`mobile` on a `Contact`.
