---
scenario_id: O3-repo-has-template
expected_outcome: template-kept-six-fields-added
expected_reason: the repo's PR template sections (Summary, Test plan, Screenshots) are all kept and filled, and the six fields are added after them; none of the template's sections is deleted
---
Branch `fix/login-redirect` in a web app repo, base `main`. The repo has
`.github/pull_request_template.md` containing three sections: `## Summary`, `## Test plan`,
`## Screenshots`. The change makes `/login` redirect to the page the user came from instead of
`/home`; one file, `app/auth/redirect.ts`, plus a test. `npm test` ran green this session.
Nothing is in screenshots. The operator says: "open the PR."
