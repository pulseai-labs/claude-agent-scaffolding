import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Notice } from '../types'
import { DEFAULTS, parseConfig } from './config'
import type { MoltConfig } from './config'
import { stageOf, thresholdsFor } from './measure'
import type { Stage, Thresholds } from './measure'
import { activePath, autonomicPath, logPath, parseAutonomic, safeSessionId } from './records'
import { DEFAULT_INSTRUCTIONS, DEFAULT_SEED, expandHome } from './templates'

// molt: in-place context handoff (spec §2). Module variables survive /clear, which is
// what a molt needs to carry across; $.state does not, and holds only the band.

type Engine = EngineInterface

const notice = atom({ plugin: 'molt', key: 'notice' } as const, null as Notice)

let cfg: MoltConfig = DEFAULTS
let stage: Stage = 'below'
let lastPercent: number | undefined
const off = new Set<string>()
let paused: string | undefined
let seeded: { session: string; startPercent?: number } | undefined

const USAGE = 'usage: /molt now | off | on | status'

async function home($: Engine): Promise<string> {
  return (await $.env.get('HOME')) ?? ''
}

async function readText($: Engine, path: string): Promise<string | undefined> {
  try {
    const text = await $.fs.read(path)
    return typeof text === 'string' ? text : undefined
  } catch {
    return undefined
  }
}

async function log($: Engine, line: string): Promise<void> {
  try {
    await $.process.run(['sh', '-c', 'mkdir -p "$(dirname "$2")" && printf "%s\\n" "$1" >> "$2"',
      'sh', `${new Date().toISOString()} ${line}`, logPath(await home($))])
  } catch {}
}

async function touchActive($: Engine, sessionId: string): Promise<void> {
  if (!safeSessionId(sessionId) || off.has(sessionId)) return
  try { await $.fs.write(activePath(await home($), sessionId), `${new Date().toISOString()}\n`) } catch {}
}

async function dropActive($: Engine, sessionId: string): Promise<void> {
  if (!safeSessionId(sessionId)) return
  try { await $.process.run(['rm', '-f', activePath(await home($), sessionId)]) } catch {}
}

async function setNotice($: Engine, value: Notice): Promise<void> {
  await update($, notice, () => value)
}

function currentThresholds(sessionId: string): Thresholds {
  return thresholdsFor(cfg, seeded?.session === sessionId ? seeded.startPercent : undefined)
}

function showStatus($: Engine, sessionId: string): void {
  if (off.has(sessionId)) return $.ui.status('molt: off')
  if (paused === sessionId) return $.ui.status('molt: paused')
  const t = currentThresholds(sessionId)
  $.ui.status(lastPercent === undefined ? 'molt' : `molt ${Math.round(lastPercent)}%/${Math.round(t.soft)}%`)
}

async function template($: Engine, path: string, fallback: string): Promise<string> {
  return (await readText($, expandHome(path, await home($))))?.trim() || fallback
}

async function writeMissingTemplates($: Engine): Promise<void> {
  const h = await home($)
  const pairs: Array<[string, string]> = [[cfg.instructionsTemplate, DEFAULT_INSTRUCTIONS], [cfg.seedTemplate, DEFAULT_SEED]]
  for (const [path, text] of pairs) {
    const full = expandHome(path, h)
    try {
      if (await $.fs.exists(full)) continue
      await $.fs.write(full, `${text}\n`)
    } catch (err) {
      await log($, `template write failed ${full} ${String(err)}`)
    }
  }
}

async function status($: Engine, sessionId: string): Promise<string> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const t = currentThresholds(sessionId)
  const record = parseAutonomic(await readText($, autonomicPath(await home($), sessionId)))
  const lines = [
    `molt is ${off.has(sessionId) ? 'off' : paused === sessionId ? 'paused' : 'on'} for this session.`,
    `fill: ${lastPercent === undefined ? 'not measured yet' : `${Math.round(lastPercent)}%`} — soft ${Math.round(t.soft)}%, hard ${Math.round(t.hard)}%, fallback ${Math.round(t.fallback)}%`,
    `mode (autonomic's record): ${record.mode}`,
  ]
  const b = usage.context.breakdown
  if (b === undefined || b.rawMaxTokens <= 0) lines.push('auto-compact threshold not readable on this build.')
  else if (!b.isAutoCompactEnabled || b.autoCompactThreshold === undefined) lines.push('auto-compact is off.')
  else {
    const at = (b.autoCompactThreshold / b.rawMaxTokens) * 100
    lines.push(at <= t.hard
      ? `WARNING: auto-compact runs at ${Math.round(at)}%, at or below molt's hard threshold (${Math.round(t.hard)}%). Raise auto-compact or lower molt's thresholds, or auto-compact acts first.`
      : `auto-compact at ${Math.round(at)}%: above molt's hard threshold.`)
  }
  if (cfg.problems.length) lines.push(`settings: ${cfg.problems.join('; ')}`)
  return lines.join('\n')
}

export const register: Register = (on, options) => {
  cfg = parseConfig(options as Readonly<Record<string, unknown>> | undefined)

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'molt', description: 'molt: now | off | on | status' })
      const sessionId = await $.session.id()
      await touchActive($, sessionId)
      showStatus($, sessionId)
      if (cfg.problems.length) $.ui.toast(`molt: ${cfg.problems.join('; ')}`)
    } catch (err) {
      await log($, `session.start error ${String(err)}`)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await dropActive($, e.sessionId)
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    try {
      if (e.source === 'startup') await writeMissingTemplates($)
      await touchActive($, e.session_id)
    } catch (err) {
      await log($, `SessionStart error ${String(err)}`)
    }
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      const sessionId = await $.session.id()
      await touchActive($, sessionId)
      if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
        if (paused === sessionId) paused = undefined
        const value = await read($, notice)
        if (value !== null && (value.tone === 'info' || paused === undefined)) await setNotice($, null)
      }
    } catch (err) {
      await log($, `prompt.submit error ${String(err)}`)
    }
    return next(e)
  })

  on('command.run', { command: 'molt' }, async ($, e) => {
    const sessionId = await $.session.id()
    const arg = (e.args ?? '').trim()
    if (arg === 'off') {
      off.add(sessionId)
      await dropActive($, sessionId)
      showStatus($, sessionId)
      return { text: 'molt is off for this session. The crew context-ceiling hooks speak again here.' }
    }
    if (arg === 'on') {
      off.delete(sessionId)
      await touchActive($, sessionId)
      showStatus($, sessionId)
      return { text: 'molt is on for this session.' }
    }
    if (arg === 'status') return { text: await status($, sessionId) }
    return { text: USAGE }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const value = await read($, notice)
    if (value === null || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor={value.tone === 'info'}>{value.text} </Text>
        <Button key="dismiss" label="Dismiss" onPress={() => update($, notice, () => null)} />
      </Box>
    )
  })
}

// Used by Tasks 8 and 9; exported so the type checker sees them used meanwhile.
export const internals = { stageOf, setStage: (s: Stage) => { stage = s }, getStage: () => stage }
