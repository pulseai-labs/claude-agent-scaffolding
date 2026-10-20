// seat-mods on OMP, second entry: the orchestrator's status-block check and idle stop, the same
// rules as hooks/register.ts's prompt.submit / classic.Stop / turn.complete, over OMP's input,
// before_agent_start and session_stop. A separate entry because OMP runs session_stop and
// tool_call handlers in extension order and stops at the first block: the guard (omp/extension.ts)
// must load first, and this check must load last, after molt and autonomic, so their stop blocks
// win as they do beneath seat-mods on Claude Code (AI workspace spec
// 2026-10-19-omp-status-block-port-design.md §6.3). omp-seat loads it for the orchestrator only.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { parseRole } from '../hooks/rules'
import { STATUS_CONTEXT, rewriteReason, STATUS_WARNING, IDLE_REASON, IDLE_WARNING, isCrewTagged, checkBlock, isIdleStop, hasMoltHandoff, waitingOnOperator, WAITING_NOTICE } from '../hooks/status'
import { autonomicPath, parseAutonomic } from '../hooks/records'

export type StatusTurn = { status: boolean; blocked: boolean; warning: string | undefined }
type Stop = { block: { decision: 'block'; reason: string } | undefined; warning: string | undefined; notice?: string }
const NOTHING: Stop = { block: undefined, warning: undefined }
const MOLT_ARM = '/molt-arm '

// The reply as text: a string as-is, a message's text blocks joined (autonomic's textOf reading).
export function replyText(m: unknown): string {
  if (typeof m === 'string') return m
  const content = m !== null && typeof m === 'object' ? (m as { content?: unknown }).content : undefined
  if (!Array.isArray(content)) return ''
  return content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('\n')
}

// One session per process, as register.ts's `turn`. OMP's input cannot tell typing from a herdr
// send (both are `interactive`), so a turn is status only by its crew tag, or when no input
// started it at all (a job completion, an idle wake). The record is born at an idle input or at a
// stop with none, survives the hidden turn after any extension's block, and ends when this entry
// lets a stop through. An aborted turn fires no session_stop, so the next idle input replaces it.
export function createStatusCheck(roleEnv: () => string | undefined) {
  let turn: StatusTurn | undefined
  // The next before_agent_start is a status prompt's: its prompt arrives expanded for a slash
  // command, so the input's classification is carried here, not re-read from the prompt.
  let context = false
  // Prompts typed while a turn runs, by kind, in order: OMP may run a queued one as its own turn with no new input.
  let queued: boolean[] = []
  const on = (): boolean => { const s = parseRole(roleEnv()); return s.kind === 'free' && s.role === 'orchestrator' }

  return {
    onInput(text: string, idle: boolean): void {
      if (!on()) return
      // molt loads first and rewrites a new process's first prompt to `/molt-arm <text>` (its fixed prefix).
      const status = isCrewTagged(text.startsWith(MOLT_ARM) ? text.slice(MOLT_ARM.length) : text)
      if (idle || turn === undefined) { turn = { status, blocked: false, warning: undefined }; queued = [] }
      else { queued.push(status); if (!status) turn.status = false }
      context = status && turn.status
    },
    onBeforeAgentStart(_prompt: string): { message: { customType: 'seat-mods-status'; content: string; display: false } } | undefined {
      if (!on()) return undefined
      // A queued prompt starting its own run takes its kind from its input, not the no-input default.
      if (turn === undefined && queued.length > 0) turn = { status: queued.shift() as boolean, blocked: false, warning: undefined }
      if (!context) return undefined
      context = false
      return { message: { customType: 'seat-mods-status', content: STATUS_CONTEXT, display: false } }
    },
    onSessionStop(e: { last_assistant_message?: unknown; stop_hook_active?: unknown }): Stop {
      if (!on()) return NOTHING
      if (turn === undefined) {
        if (e.stop_hook_active === true) return NOTHING
        turn = { status: true, blocked: false, warning: undefined }
      }
      const live = turn
      if (!live.status) { turn = undefined; return NOTHING }
      const reply = replyText(e.last_assistant_message)
      const check = checkBlock(reply)
      const handoff = hasMoltHandoff(reply)
      // The shape failure first, else the idle failure (#876): one block per turn for both.
      const failure = handoff ? undefined
        : !check.ok ? { reason: rewriteReason(check.failed), warning: STATUS_WARNING }
        : isIdleStop(reply) ? { reason: IDLE_REASON, warning: IDLE_WARNING } : undefined
      if (failure === undefined) {
        turn = undefined
        const waiting = handoff ? undefined : waitingOnOperator(reply)
        return { block: undefined, warning: undefined, notice: waiting === undefined ? undefined : `${WAITING_NOTICE}${waiting}` }
      }
      if (live.blocked) {
        turn = undefined
        // A reply let through after its one rewrite may still wait on the operator (#873).
        const waiting = waitingOnOperator(reply)
        return { block: undefined, warning: failure.warning, notice: waiting === undefined ? undefined : `${WAITING_NOTICE}${waiting}` }
      }
      live.blocked = true
      return { block: { decision: 'block', reason: failure.reason }, warning: undefined }
    },
    turn: (): StatusTurn | undefined => turn,
  }
}

// The waiting-on-operator signal (#873): show the notice and ring autonomic's bell from its
// session record, in autopilot only. The session id is the one autonomic's OMP adapter
// records under (extension.ts's io.sessionId(): ctx.sessionManager.getSessionId()). The
// bell runs detached with a 30 s kill; a non-zero exit, a rejection or a timeout is logged
// and nothing waits on it.
type BellHost = { exec(file: string, argv: string[], init: { timeout: number }): Promise<unknown> }
type StatusContext = {
  sessionManager?: { getSessionId?: () => string }
  ui?: { notify?: (text: string, tone: string) => void }
}

function operatorWaiting(pi: BellHost, ctx: StatusContext, notice: string, home: () => string): void {
  const id = ctx.sessionManager?.getSessionId?.() ?? ''
  if (id === '') return
  let saved: string | undefined
  try { saved = readFileSync(autonomicPath(home(), id), 'utf8') } catch { return }
  const record = parseAutonomic(saved)
  if (record.mode !== 'autopilot') return
  ctx.ui?.notify?.(notice, 'info')
  if (record.bell === undefined) return
  try {
    void pi.exec('sh', ['-c', `AUTONOMIC_MESSAGE="$1"; export AUTONOMIC_MESSAGE; ${record.bell}`, 'sh', notice], { timeout: 30_000 }).then(
      result => {
        const exit = result !== null && typeof result === 'object' && 'exitCode' in result ? result.exitCode : undefined
        if (typeof exit === 'number' && exit !== 0) console.error(`seat-mods: bell failed exit=${exit}`)
      },
      error => { console.error(`seat-mods: bell failed ${String(error)}`) },
    )
  } catch (error) {
    console.error(`seat-mods: bell failed ${String(error)}`)
  }
}

const main = (ctx: any): boolean => ctx?.agent?.kind === 'main'

export default function (pi: any, deps: { home?: () => string } = {}) {
  const check = createStatusCheck(() => process.env.SEAT_MODS_ROLE)
  // The record lives under the operator's home in production; tests point it elsewhere.
  const home = deps.home ?? homedir
  // The check can only add a stop: a throw lets the event through unchanged.
  pi.on('input', (e: any, ctx: any) => {
    try { if (main(ctx)) check.onInput(String(e?.text ?? ''), typeof ctx.isIdle === 'function' ? ctx.isIdle() === true : false) } catch {}
    return undefined
  })
  pi.on('before_agent_start', (e: any, ctx: any) => {
    try { return main(ctx) ? check.onBeforeAgentStart(String(e?.prompt ?? '')) : undefined } catch { return undefined }
  })
  pi.on('session_stop', (e: any, ctx: any) => {
    try {
      if (!main(ctx)) return undefined
      const r = check.onSessionStop(e ?? {})
      if (r.warning !== undefined) ctx.ui?.notify?.(r.warning, 'warning')
      if (r.notice !== undefined) operatorWaiting(pi, ctx, r.notice, home)
      return r.block
    } catch { return undefined }
  })
}
