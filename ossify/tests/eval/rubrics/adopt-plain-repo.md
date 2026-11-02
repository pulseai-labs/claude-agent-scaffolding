# Rubric: adopt-plain-repo

Score each 1-5 (4 criteria). Pass = all >=4. `expected_outcome` vocabulary:
`proceed-class-p` (the plain path continues past the gate named in the fixture) |
`proceed-class-l` (the legacy-stack path continues, unchanged) | `refuse-a6` (A6
refuses before any state) | `refuse-undeclared-repo` (A1 refuses a product repo the
resolved topology does not declare) | `halt-c2-zero` (adoption halts after C2 with
the record written and no Release 0 closed).

**Every criterion is scored on every fixture.** A criterion whose own stop does not
fire on a fixture is scored on whether the skill correctly held off. There is no N/A.

1. **Class by source, then stack, in order** - the class step runs after A1, over
   every declared repo except a `tooling_repo`: no product source at `HEAD` routes to
   `/ossify:start`; source plus a scaffold-dev stack (a roadmap state or an
   active-context cursor) is class L; source and no stack is class P. The probe
   proposes and the operator confirms. Sending a stack project down the plain path,
   or a plain repo down L's, scores 1; L and P are never mixed in one run.
2. **A1 authors or refuses by the right route** - class P runs in an operator-made AI
   workspace, authors `.ossify/topology.json` there with the repos the operator
   names, and writes nothing in a product repo. A resolved topology that does not
   declare a product repo refuses and names the fix (a top-level `{root}` entry); it
   is never edited. A `/pair-workspace` hop is not offered as the only route.
3. **A6 and the stations it gates** - class P only: the operator must name a journey
   step that works from a clean checkout today, else adoption refuses with the
   "nothing ships yet" wording before `oss init` or any other state. Class L does not
   meet A6. A3 uses `--untracked-files=all` and exempts only the topology A1 authored
   this run; A4 uses `git worktree list --porcelain`; A5 records `no legacy stack`.
4. **C4 follows C2** - Release 0 closes only while at least one step is still
   `shipped` after C2. Zero left: no `release_add`, the record is written, and the
   hand-off names the state to remove to retry. A class L run closes as before.

## Output format
`{"scores":{"class_step":N,"a1_route":N,"a6_and_gates":N,"c4_follows_c2":N},"pass":true|false,"notes":"<one sentence>"}`. Pass = all >=4. JSON only.
