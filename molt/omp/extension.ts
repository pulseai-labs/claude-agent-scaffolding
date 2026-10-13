// molt on OMP (omp 18.8.9): maps omp's extension events onto createMolt (core.ts), which runs molt's pure
// modules. Loaded only by omp-seat with -e (never ambient). Imports molt's own modules and node: builtins only;
// omp's host types are `any`, so this file imports in plain bun.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { FALLBACK_BRIEF_MS, createMolt } from './core'
import type { MoltIO } from './core'
import { logPath } from '../hooks/records'

export { FALLBACK_BRIEF_MS, claudeShape, claudeShapes, createMolt, messagesOf } from './core'
export type { ClearResult, MoltIO, Shape } from './core'

// omp's real ctx behind MoltIO. Each handler points `cur` at the event's ctx first; the saved command ctx is
// the only route to newSession() (probe, evidence 2026-10-13-omp-c-pr2).
function ioFor(pi: any, cur: () => any, route: () => any): MoltIO {
  const env = process.env
  return {
    usage: () => { const p = cur().getContextUsage?.()?.percent; return typeof p === 'number' && Number.isFinite(p) ? p : undefined },
    sessionId: () => cur().sessionManager.getSessionId(),
    isChild: (env.MOLT_HANDOFF ?? '').trim() === 'parent',
    env,
    get cwd() { return cur().cwd },
    readText: async path => { try { return readFileSync(path, 'utf8') } catch { return undefined } },
    exists: async path => existsSync(path),
    writeText: async (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) },
    remove: async path => { rmSync(path, { force: true }) },
    appendLog: async line => { const path = logPath(env.HOME ?? ''); mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${line}\n`) },
    steer: text => { pi.sendMessage(text, { deliverAs: 'steer' }) },
    warnNext: text => { pi.sendMessage(text, { deliverAs: 'nextTurn' }) },
    status: text => { cur().ui?.setStatus?.('molt', text) },
    notify: (text, tone) => { cur().ui?.notify?.(text, tone === 'warn' ? 'warning' : 'info') },
    // Nothing waits on the bell; it is bounded at 30 s like the Claude glue's.
    bell: (command, message) => new Promise<void>(resolve => {
      const child = spawn('sh', ['-c', `AUTONOMIC_MESSAGE="$1"; export AUTONOMIC_MESSAGE; ${command}`, 'sh', message], { stdio: 'ignore', timeout: 30_000 })
      child.on('error', () => resolve())
      child.on('exit', () => resolve())
    }),
    ephemeral: async prompt => {
      const run = cur().runEphemeralTurn
      if (typeof run !== 'function') return undefined
      const r = await run.call(cur(), { promptText: prompt, tools: false, signal: AbortSignal.timeout(FALLBACK_BRIEF_MS) })
      return typeof r?.replyText === 'string' ? r.replyText : undefined
    },
    route: () => route() !== undefined,
    printMode: () => cur().mode === 'print',
    newSessionAndSeed: async seed => {
      const saved = route()
      if (saved === undefined) return 'no-route'
      const r = await saved.newSession()
      if (r?.cancelled === true) return 'cancelled'
      try { await pi.sendUserMessage(seed) } catch { return 'seed-rejected' }
      return 'cleared'
    },
    branch: () => cur().sessionManager.getBranch(),
  }
}

export default function (pi: any) {
  let ctx: any
  let saved: any
  const molt = createMolt(ioFor(pi, () => ctx, () => saved))
  // Only the main session is gated; a task child or an advisor (whose calls reach this instance) is not.
  const main = (c: any): boolean => {
    if (c?.agent?.kind !== 'main') return false
    ctx = c
    return true
  }

  pi.registerCommand('molt', {
    description: 'molt: now | off | on | status',
    handler: async (args: string, c: any) => {
      if (!main(c)) return
      c.ui?.notify?.(await molt.onCommand(args ?? ''), 'info')
    },
  })
  // The probe's route: the first operator prompt is rewritten to this command, which saves its ctx.
  pi.registerCommand('molt-arm', {
    description: 'molt: arms the clear route (used internally on the first prompt)',
    handler: async (args: string, c: any) => {
      saved = c
      if (typeof args === 'string' && args.trim() !== '') pi.sendUserMessage(args)
    },
  })
  pi.on('session_start', (_e: any, c: any) => main(c) ? molt.onSessionStart() : undefined)
  pi.on('session_switch', (e: any, c: any) => main(c) ? molt.onSessionSwitch(String(e?.reason ?? '')) : undefined)
  pi.on('session_tree', (_e: any, c: any) => main(c) ? molt.onSessionCompact() : undefined)
  pi.on('session_compact', (_e: any, c: any) => main(c) ? molt.onSessionCompact() : undefined)
  pi.on('session_shutdown', (_e: any, c: any) => main(c) ? molt.onSessionShutdown() : undefined)
  pi.on('input', (e: any, c: any) => main(c) ? molt.onInput(e) : undefined)
  pi.on('tool_call', (e: any, c: any) => main(c) ? molt.onToolCall(e) : undefined)
  pi.on('tool_result', (e: any, c: any) => {
    if (!main(c)) return
    // Rewind rebuilds at turn end without an event. Reset now so later retained tools keep their state.
    if (e?.toolName === 'rewind' && e.isError !== true) return molt.onSessionCompact()
    return molt.onToolResult(e)
  })
  pi.on('session_stop', (e: any, c: any) => main(c) ? molt.onSessionStop(e) : undefined)
}
