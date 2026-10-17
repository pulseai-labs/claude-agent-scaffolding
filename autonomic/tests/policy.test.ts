import { describe, test, expect } from 'claude-code/testing'
import { DEFAULT_POLICY } from '../hooks/policy'

// 0.9.0 (autopilot slice 1, Task 1): the six standing orders and the two pain-list
// edits, verbatim from the plan's exact-copy block. Their bold names are what
// Tasks 2-5 cite. The approval-gate bullet is the orchestrator-amended line
// (the old "or choosing how a plan is executed" clause contradicted the new
// Superpowers-integration order).
const STANDING_ORDERS = [
  '- **Recommendation authority:** outside the pain list, the option you would recommend is the decision. Take it, state in one line what you chose, the options you weighed and why, and continue. Do not ask the operator to confirm a recommendation.',
  "- **Round stop:** when merge-bar's round stop fires, narrow the Claim — move each edge that does not meet condition 1 into Known limits — fix the blocking findings that remain, and continue; split the PR only when no narrowing keeps the Claim true, and say which parts.",
  "- **Reviewers:** a reviewer that cannot run on this head (quota, outage, not installed) is replaced by the fallback reviewer the project's roles file names; never wait on a reviewer the merge bar does not require.",
  "- **Seats and profiles:** pick seats, reviewer profiles, PR-fix profiles and close-writer profiles from the project's roles file by its conditions, record the pick and why, and continue.",
  '- **Demo walk:** at spine and release close, walk each `user:` line yourself against the merged product, record the evidence for each (the commands, their output, a screenshot where a screen is involved), and mark it walked by orchestrator; the operator gives one nod at the end of release close.',
  "- **Superpowers integration:** at finishing-a-development-branch, push and open a pull request (its option 2); at writing-plans' execution question, use the execution method the brief or the roles file names, else the recommended one; a push to the session's own branch and its pull request are not side effects to ask about first.",
]

describe('the default policy carries the 0.9.0 standing orders (Task 1)', () => {
  test('the six standing orders are present verbatim', () => {
    for (const order of STANDING_ORDERS) expect(DEFAULT_POLICY).toContain(order)
  })
  test('the Round stop order fixes the blocking findings at the stop', () => {
    expect(DEFAULT_POLICY).toContain('fix the blocking findings that remain, and continue')
  })
  test('the one-way-door bullet is the new line', () => {
    expect(DEFAULT_POLICY).toContain("- a one-way door: data loss, a production deploy, spending money beyond the configured seats; a merged branch's delete after the merge check, a tag and a release are not one-way doors;")
  })
  test('the approval-gate bullet is the amended line', () => {
    expect(DEFAULT_POLICY).toContain("- an approval gate: a step your process gives to the operator, such as reviewing or approving a spec, a design, a plan or a release scope, even when you recommend an option; a worker's implementation plan is approved by the orchestrator, not the operator, and the execution method follows the Superpowers integration order;")
  })
  test('the old execution-method clause is gone', () => {
    expect(DEFAULT_POLICY).not.toContain('or choosing how a plan is executed')
  })
})
