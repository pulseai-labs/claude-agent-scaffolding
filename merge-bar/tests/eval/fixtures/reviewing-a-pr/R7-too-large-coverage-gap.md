---
scenario_id: R7-too-large-coverage-gap
expected_outcome: gap-stated-never-clean
expected_reason: the coverage table lists all fourteen diff files; under the Standards axis, Form.tsx, validators.ts, api.ts, form.test.tsx and api.test.ts are `not read — <context exhausted>` and package-lock.json is `not read — <generated lockfile>` (also `not read` under Claim/Spec); the report never calls the Standards axis, those files or the PR clean or free of findings — "no Standards findings in the eight files it read" is the most it may say; the Claim/Spec class is still reported — the email check refuses plus-addressed addresses at src/settings/validators.ts:18 and src/settings/sections/Profile.tsx:44 (two sites, sweep stated), condition 1, direction "refuses valid input"; a report that omits the unread files from the table, marks them `read`, or says "Standards: no findings" without naming the gap fails coverage_stated
---
Review PR `acme/webapp#612` ("settings: rewrite the settings page"), +3,910/−1,240 across
fourteen files. Invoked as `/merge-bar:review-pr 612`. Round 1.

`gh pr view 612 --json body,headRefOid,baseRefName,files`: `headRefOid`
`a1c3e5f7092b4d6f8a0c2e4f6a8b0d2f4e6a8c0e`, `baseRefName` `main`. `git rev-parse HEAD` prints
the same SHA. Single repo; root `CODING_STANDARDS.md`:

```markdown
- Components never call `fetch` directly; they go through `src/api/`.
- A test that mocks the module it tests is not a test of that module.
```

The fourteen files: `src/settings/SettingsPage.tsx`, `src/settings/Form.tsx`,
`src/settings/validators.ts`, `src/settings/api.ts`, `src/settings/useSettings.ts`,
`src/settings/sections/Profile.tsx`, `src/settings/sections/Notifications.tsx`,
`src/settings/sections/Billing.tsx`, `src/settings/__tests__/form.test.tsx`,
`src/settings/__tests__/api.test.ts`, `src/settings/__tests__/validators.test.ts`,
`src/routes.tsx`, `package.json`, `package-lock.json` (+2,140, generated).

The PR body:

```markdown
## Claim
The settings page is rebuilt on the shared `Form` component. Every field accepts and rejects
the same input as before.

## Scope
Touches: `src/settings/`, `src/routes.tsx`, `package.json`, `package-lock.json`.
Deliberately does not touch: the settings API server, `src/api/`.

## Known limits
- The Billing section is read-only for now — editing it lands in #615.

## Merge danger
Door: two-way — client code only; a revert restores the old page.
Blast radius: every user who opens Settings.

## Merge bar
A finding blocks this PR only if it:
1. rejects valid input, or corrupts or loses state, on a path this PR touches;
2. makes the Claim above false;
3. breaks the test suite;
4. opens a security hole — injection, authentication bypass, or an exposed secret.
Everything else is non-blocking.

## Evidence
`npm test` — 212 passed.

## Closes
Closes #598
```

No verifier report exists; the spec is issue #598 ("move Settings onto the shared Form").

The review dispatched its two axes, each with the whole diff. They returned:

- **Standards axis:** "Read SettingsPage.tsx, useSettings.ts, sections/Profile.tsx,
  sections/Notifications.tsx, sections/Billing.tsx, validators.test.ts, routes.tsx and
  package.json: no defects against the standards or the baseline. Context exhausted before
  Form.tsx, validators.ts, api.ts, form.test.tsx and api.test.ts — not read. package-lock.json
  skipped: generated."
- **Claim/Spec axis:** "Read all thirteen source, test and manifest files; skipped
  package-lock.json (generated). One defect. The old validator (`git show
  main:src/settings/legacy.js:31`) accepted `^[^@\s]+@[^@\s]+$`; the new one,
  `src/settings/validators.ts:18`, is `export const isEmail = (s: string) =>
  /^[\w.]+@[\w.]+$/.test(s);`, which refuses `ana+news@example.com`. Sweep: `rg -n -F
  '[\w.]+@' src/` — 2 hits: validators.ts:18 and sections/Profile.tsx:44, where
  Profile inlines the same regex for its secondary-email field. No other email check exists
  in the checkout."

The seat's session limit was reached as the axes returned: no further dispatch or file read
is possible this round. The report is written from what the two axes returned.
