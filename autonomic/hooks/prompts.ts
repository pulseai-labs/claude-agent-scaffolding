import type { Question } from './verdict'

// The fork's questions. Each carries the policy text, so a fork that does not see the
// system prompt's policy section still judges against it (probe P13).

export const MAX_INPUT = 4000

export function turnEndPrompt(tail: string, policy: string): string {
  return `autonomic turn-end check. You are not continuing the work now. Classify how your last reply ended, judged against the autopilot policy below and the scope this session has read (its spec, plan, grill record or brief). Reply with one JSON object and nothing else.

Cases:
- "covered": the reply ends on a question or a request for confirmation that the policy or the scope already answers. Give "question" (one line) and "answer" (the decision the scope or the policy makes, one line, written as an instruction).
- "stalled": the reply stopped short of the task with no question and no reason to stop. Give "next_step" (one line: the next step of the plan).
- "waiting": the session is waiting on something it armed: a background task, a subagent, a monitor, or another session's report.
- "done": the scope's objective is met; nothing is left for this session to do.
- "pain": the reply needs the operator for a reason on the policy's pain list. Give "question" (one line), and "options": two or three answers the operator can pick with one click, each {"label": "<at most 40 characters>", "text": "<the instruction the session will follow, one line>", "recommended": true | false}. Put the recommended option first, and mark at most one "recommended": true. For a one-way door, offer doing it and not doing it as separate options, and never mark the irreversible one recommended. For credentials or secrets, give no options: the operator answers in plain text.

molt (context handoff): molt's warnings at 40% and 50% of the context window mean work goes on; they are never a reason to stop. Once molt has told the session to write its handoff now (65%), or the session has written it, the case is "waiting".

A reply that asks the operator to approve or review a spec, design, plan or release scope, or to choose between options the scope does not decide, is "pain" even when it recommends one option: a recommendation is not a decision.
When in doubt between "pain" and any other case, answer "pain".
Every case gives "reason": one line naming the policy line or scope document that decides it.
Shape: {"case": "...", "question": "...", "answer": "...", "next_step": "...", "reason": "...", "options": [{"label": "...", "text": "...", "recommended": true}]}

<policy>
${policy}
</policy>

<reply>
${tail}
</reply>`
}

export function askPrompt(questions: readonly Question[], policy: string): string {
  const listed = questions.map(q => ({ question: q.question, options: (q.options ?? []).map(o => o.label), multiSelect: q.multiSelect === true }))
  return `autonomic question check. You are about to ask the operator the questions below. Decide whether the autopilot policy or this session's scope (its spec, plan, grill record or brief) already answers every one of them. Reply with one JSON object and nothing else.

- Covered: {"covered": true, "answers": {"<question text, exactly>": "<one option label, exactly>"}, "reason": "<one line naming the policy line or scope document>"}. For a multi-select question, join the labels with ", ".
- Not covered (any question is still open, or a pain-list reason applies): {"covered": false, "reason": "<one line>"}.

When in doubt, answer not covered.

<policy>
${policy}
</policy>

<questions>
${JSON.stringify(listed, null, 2)}
</questions>`
}

// A tool call's input exactly as the permission fork is shown it; the length gate measures this.
export function shownInput(input: unknown): string {
  try { return JSON.stringify(input, null, 2) ?? '' } catch { return String(input) }
}

export function permissionPrompt(tool: string, input: unknown, policy: string): string {
  let shown = shownInput(input)
  if (shown.length > MAX_INPUT) shown = `${shown.slice(0, MAX_INPUT)}… (cut)`
  return `autonomic permission check. The tool call below needs approval. Decide whether the autopilot policy's permission scope covers it, for the task this session is doing. Reply with one JSON object and nothing else: {"decision": "allow" | "ask", "reason": "<one line>"}.

Answer "ask" for anything on the policy's pain list, for anything outside this session's own task, and whenever in doubt.

<policy>
${policy}
</policy>

<tool>${tool}</tool>
<input>
${shown}
</input>`
}

export function scopeMessage(scope: readonly string[]): string {
  return `autonomic: autopilot is on. Read these documents now as your standing scope, and judge every later choice against them:\n${scope.map(p => `- ${p}`).join('\n')}`
}
