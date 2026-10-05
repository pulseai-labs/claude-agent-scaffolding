import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Pain } from '../types'
import { DEFAULTS, parseConfig } from './config'
import type { AutonomicConfig } from './config'
import { APPEND, TOUCH } from './io'
import { ledgerLine, ledgerPathFor, oneLine } from './ledger'
import type { LedgerCase, Usage } from './ledger'
import { parseCommand, parseEnvMode, resolveDoc, statusText } from './mode'
import { DEFAULT_POLICY, POLICY_ID, expandHome } from './policy'
import { scopeMessage } from './prompts'
import { lineagePath, logPath, parseLineageFrom, parseRecord, safeSessionId, serializeRecord, sessionPath } from './records'
import type { SessionRecord } from './records'
import { neverRules } from './never'
import type { Where } from './never'
import { permissionPrompt } from './prompts'
import { parsePermission } from './verdict'
import { askPrompt } from './prompts'
import { parseAsk } from './verdict'
import type { Question } from './verdict'
import { hasMoltMarker, statusYields } from './floor'
import { turnEndPrompt } from './prompts'
import { parseTurn } from './verdict'

// autonomic: autopilot reflexes (spec §3). Module variables survive /clear; the session
// record file carries the mode across a molt by way of molt's lineage file.

type Engine = EngineInterface
type Live = SessionRecord & { problem?: string; invalid?: string }

const notice = atom({ plugin: 'autonomic', key: 'notice' } as const, null as Pain)

let cfg: AutonomicConfig = DEFAULTS
const live = new Map<string, Live>()       // each session's resolved record
const pushes = new Map<string, number>()   // covered or stalled turn ends in a row with no change
const changed = new Set<string>()          // sessions that changed something since their last turn end
const announced = new Set<string>()        // sessions whose carried scope has been announced
const USAGE_TEXT = 'usage: /autopilot on [scope doc …] | off | status'

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

// Each returns whether it landed; nothing here throws.
async function appendLine($: Engine, path: string, line: string): Promise<boolean> {
  try {
    return (await $.process.run(['sh', '-c', APPEND, 'sh', line, path])).exitCode === 0
  } catch {
    return false
  }
}

async function touch($: Engine, path: string): Promise<boolean> {
  try {
    return (await $.process.run(['sh', '-c', TOUCH, 'sh', path])).exitCode === 0
  } catch {
    return false
  }
}

async function log($: Engine, line: string): Promise<void> {
  await appendLine($, logPath(await home($)), `${new Date().toISOString()} ${line}`)
}

async function policyText($: Engine): Promise<string | undefined> {
  return (await readText($, expandHome(cfg.policyPath, await home($))))?.trim() || undefined
}

async function repoRoot($: Engine): Promise<string> {
  const cwd = await $.session.cwd()
  try {
    const r = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'])
    if (r.exitCode === 0 && r.stdout.trim() !== '') return r.stdout.trim()
  } catch {}
  return cwd
}

async function ledgerPath($: Engine): Promise<string> {
  return ledgerPathFor(await $.env.get('AUTONOMIC_LEDGER'), await repoRoot($))
}

async function bellOf($: Engine): Promise<string | undefined> {
  const env = ((await $.env.get('AUTONOMIC_BELL')) ?? '').trim()
  return env !== '' ? env : cfg.bell
}

// Autopilot needs its policy and a writable ledger; without either the session is manual (spec §4).
async function guard($: Engine, rec: Live): Promise<Live> {
  const clean: Live = { ...rec, problem: undefined }
  if (rec.mode !== 'autopilot') return clean
  if ((await policyText($)) === undefined) return { ...clean, mode: 'manual', problem: 'no policy' }
  if (!(await touch($, await ledgerPath($)))) return { ...clean, mode: 'manual', problem: 'ledger not writable' }
  return clean
}

async function save($: Engine, id: string, rec: Live): Promise<void> {
  live.set(id, rec)
  if (safeSessionId(id)) {
    try { await $.fs.write(sessionPath(await home($), id), serializeRecord(rec)) } catch (err) { await log($, `record write failed session=${id} ${String(err)}`) }
  }
  $.ui.status(statusText(rec))
}

// The record for the current session: its own file, else its molt parent's (amendment
// A1: only a root has one), else the spawn's env.
async function modeOf($: Engine): Promise<Live> {
  const id = await $.session.id()
  const known = live.get(id)
  if (known !== undefined) return known
  const h = await home($)
  const safe = safeSessionId(id)
  let rec: Live | undefined = safe ? parseRecord(await readText($, sessionPath(h, id))) : undefined
  if (rec === undefined) {
    const from = safe ? parseLineageFrom(await readText($, lineagePath(h, id))) : undefined
    const parent = from !== undefined && safeSessionId(from) ? parseRecord(await readText($, sessionPath(h, from))) : undefined
    if (parent !== undefined) rec = { ...parent, source: 'lineage' }
  }
  if (rec === undefined) {
    const env = parseEnvMode(await $.env.get('AUTONOMIC_MODE'))
    const bell = await bellOf($)
    rec = { mode: env.mode, scope: [], source: 'env', ...(bell === undefined ? {} : { bell }), ...(env.invalid === undefined ? {} : { invalid: env.invalid }) }
  }
  const checked = await guard($, rec)
  await save($, id, checked)
  if (checked.problem !== undefined) $.ui.toast(`autonomic: autopilot refused — ${checked.problem}`)
  return checked
}

// One ledger line. A ledger that cannot be written ends autopilot (spec §4: no ledger,
// no autopilot); the caller must not act on a decision that was not recorded.
async function record($: Engine, id: string, kase: LedgerCase, q: string, a: string, why: string, usage?: Usage): Promise<boolean> {
  const line = ledgerLine({ time: new Date().toISOString(), session: id, kase, q, a, why, usage })
  if (await appendLine($, await ledgerPath($), line)) return true
  const rec = live.get(id)
  if (rec !== undefined) await save($, id, { ...rec, mode: 'manual', problem: 'ledger not writable' })
  $.ui.toast('autonomic: the ledger is not writable; this session is manual now.')
  await log($, `ledger append failed session=${id}`)
  return false
}

async function ring($: Engine, bell: string, message: string): Promise<void> {
  try {
    await $.process.run(['sh', '-c', `AUTONOMIC_MESSAGE="$1"; export AUTONOMIC_MESSAGE; ${bell}`, 'sh', message])
  } catch (err) {
    await log($, `bell failed ${String(err)}`)
  }
}

// A pain signal (spec §3.4): band, toast, bell, and the pain file a launcher may name.
// It never resumes the run by itself.
async function pain($: Engine, id: string, reason: string, detail: string): Promise<void> {
  const text = `autopilot: ${reason} — ${oneLine(detail, 200)}`
  try { await update($, notice, () => ({ text })) } catch {}
  $.ui.toast(text)
  const bell = live.get(id)?.bell
  if (bell !== undefined) await ring($, bell, text)
  const path = ((await $.env.get('AUTONOMIC_PAIN_PATH')) ?? '').trim()
  if (path !== '' && !(await appendLine($, path, `${new Date().toISOString()} pain ${text}`))) await log($, `pain file append failed ${path}`)
  await log($, `pain session=${id} ${text}`)
}

type Judged<T> = { v: T; usage?: Usage } | { skip: true } | { fail: string }

// One fork, one retry (spec §4). Nothing to fork, or an aborted turn, lets the event pass.
async function judge<T>($: Engine, prompt: string, parse: (text: string) => T | undefined): Promise<Judged<T>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await $.model.fork({ prompt })
    if (r.isAnswered) {
      const v = parse(r.text)
      if (v !== undefined) return { v, usage: r.usage }
      await log($, `fork reply did not parse attempt=${attempt + 1}`)
      continue
    }
    if (r.reason === 'nothing-to-fork' || r.reason === 'aborted') return { skip: true }
    await log($, `fork failed attempt=${attempt + 1} reason=${r.reason}`)
  }
  return { fail: 'the fork failed twice, or its reply did not parse' }
}

async function writeDefaultPolicy($: Engine): Promise<void> {
  const path = expandHome(cfg.policyPath, await home($))
  try {
    if (!(await $.fs.exists(path))) await $.fs.write(path, DEFAULT_POLICY)
  } catch (err) {
    await log($, `policy write failed ${path} ${String(err)}`)
  }
}

async function statusReport($: Engine, id: string): Promise<string> {
  const rec = await modeOf($)
  const policyPath = expandHome(cfg.policyPath, await home($))
  const painPath = ((await $.env.get('AUTONOMIC_PAIN_PATH')) ?? '').trim()
  const lines = [
    `autonomic: ${rec.mode} (source: ${rec.source})${rec.problem === undefined ? '' : ` — autopilot refused: ${rec.problem}`}`,
    `scope: ${rec.scope.length === 0 ? 'none named (what the session has read)' : rec.scope.join(', ')}`,
    `policy: ${policyPath} (${(await policyText($)) === undefined ? 'missing or empty' : 'readable'})`,
    `ledger: ${await ledgerPath($)}`,
    `bell: ${rec.bell === undefined ? 'not set' : 'set'}; pain file: ${painPath === '' ? 'not set' : painPath}`,
    `pushes in a row with no change: ${pushes.get(id) ?? 0} of ${cfg.loopMax}`,
  ]
  if (rec.invalid !== undefined) lines.push(`AUTONOMIC_MODE="${rec.invalid}" is not a mode`)
  if (cfg.problems.length > 0) lines.push(`settings: ${cfg.problems.join('; ')}`)
  return lines.join('\n')
}

// Tools that change nothing: a turn of these alone is no progress for the loop guard.
const READ_ONLY = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'ToolSearch', 'AskUserQuestion', 'TaskOutput', 'TodoWrite'])

async function readStatus($: Engine): Promise<string | undefined> {
  const path = ((await $.env.get('MOLT_STATUS_PATH')) ?? '').trim()
  return path === '' ? undefined : readText($, path)
}

// The ask reflex (spec §3.2): answer from the policy and scope, or let the operator see
// the question and ring. A decision that cannot be recorded is not taken.
async function askReflex($: Engine, questions: readonly Question[]): Promise<{ questions: readonly Question[]; answers: Record<string, string> } | undefined> {
  if ((await modeOf($)).mode !== 'autopilot' || questions.length === 0) return undefined
  const id = await $.session.id()
  const j = await judge($, askPrompt(questions, (await policyText($)) ?? ''), t => parseAsk(t, questions))
  if ('v' in j && j.v.covered) {
    const { answers, reason } = j.v
    for (const q of questions) if (!(await record($, id, 'ask', q.question, answers[q.question] ?? '', reason, j.usage))) return undefined
    return { questions, answers }
  }
  const why = 'v' in j ? j.v.reason : 'fail' in j ? j.fail : 'nothing to judge yet'
  await pain($, id, 'question for you', `${questions[0]?.question ?? 'a question'} (${why})`)
  return undefined
}

const painedDeny = new Set<string>()   // session, tool and reason of each hard deny already rung

async function where($: Engine): Promise<Where> {
  const cwd = await $.session.cwd()
  const out = async (argv: string[]): Promise<string | undefined> => {
    try {
      const r = await $.process.run(argv)
      return r.exitCode === 0 ? r.stdout.trim() || undefined : undefined
    } catch {
      return undefined
    }
  }
  const root = (await out(['git', '-C', cwd, 'rev-parse', '--show-toplevel'])) ?? cwd
  const branch = await out(['git', '-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'])
  const originHead = await out(['git', '-C', cwd, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  const w: Where = { cwd, root, home: await home($) }
  if (branch !== undefined && branch !== 'HEAD') w.branch = branch
  if (originHead !== undefined) w.defaultBranch = originHead.replace(/^origin\//, '')
  return w
}

export const register: Register = (on, options) => {
  cfg = parseConfig(options as Readonly<Record<string, unknown>> | undefined)

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'autopilot', description: 'autonomic: on [scope docs] | off | status' })
      await writeDefaultPolicy($)
      await modeOf($)
      if (cfg.problems.length > 0) $.ui.toast(`autonomic: ${cfg.problems.join('; ')}`)
    } catch (err) {
      await log($, `session.start error ${String(err)}`)
    }
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    try {
      if ((await modeOf($)).mode !== 'autopilot') return r
      const text = await policyText($)
      if (text === undefined) return r
      return { sections: [...r.sections.filter(s => s.id !== POLICY_ID), { id: POLICY_ID, text, scope: 'session' as const }] }
    } catch (err) {
      await log($, `prompt.compose error ${String(err)}`)
      return r
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const context: string[] = []
    try {
      const id = await $.session.id()
      if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
        pushes.delete(id)
        try { if ((await read($, notice)) !== null) await update($, notice, () => null) } catch {}
      }
      const rec = await modeOf($)
      if (rec.mode === 'autopilot' && rec.source === 'lineage' && rec.scope.length > 0 && !announced.has(id)) {
        announced.add(id)
        context.push(scopeMessage(rec.scope))
      }
    } catch (err) {
      await log($, `prompt.submit error ${String(err)}`)
    }
    return context.length === 0 ? next(e) : next({ ...e, context: [...(e.context ?? []), ...context] })
  })

  on('command.run', { command: 'autopilot' }, async ($, e) => {
    const id = await $.session.id()
    const c = parseCommand(e.args ?? '')
    if (c.kind === 'usage') return { text: USAGE_TEXT }
    if (c.kind === 'status') return { text: await statusReport($, id) }
    const prev = await modeOf($)
    if (c.kind === 'off') {
      await save($, id, { ...prev, mode: 'manual', source: 'command', problem: undefined, invalid: undefined })
      pushes.delete(id)
      return { text: 'autopilot is off for this session: every ask reaches you.' }
    }
    const cwd = await $.session.cwd()
    const h = await home($)
    const scope = c.scope.map(p => resolveDoc(p, cwd, h))
    const missing: string[] = []
    for (const p of scope) if ((await readText($, p)) === undefined) missing.push(p)
    if (missing.length > 0) return { text: `autopilot stays ${prev.mode}: cannot read ${missing.join(', ')}.` }
    const bell = prev.bell ?? (await bellOf($))
    const rec = await guard($, { mode: 'autopilot', scope, source: 'command', ...(bell === undefined ? {} : { bell }) })
    await save($, id, rec)
    if (rec.mode !== 'autopilot') {
      const fix = rec.problem === 'no policy' ? `Write ${expandHome(cfg.policyPath, h)}.` : `Check that ${await ledgerPath($)} can be written.`
      return { text: `autopilot refused: ${rec.problem}. ${fix}` }
    }
    pushes.delete(id)
    if (scope.length === 0) return { text: 'autopilot is on. The scope is what this session has already read.' }
    const msg = scopeMessage(scope)
    // The host refuses $.prompt.submit here: it would wait on the turn this hook holds.
    const { isFilled } = await $.prompt.fill({ text: msg })
    if (isFilled) return { text: 'autopilot is on. The scope message is in the prompt box: press Enter to send it.' }
    return { text: 'autopilot is on. The next prompt you send carries the scope.', context: [msg] }
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    if (e.tool === 'AskUserQuestion') {
      try {
        const questions = (e as unknown as { questions?: Question[] }).questions ?? []
        const result = await askReflex($, questions)
        if (result !== undefined) return { result } as never
      } catch (err) {
        await log($, `ask reflex error ${String(err)}`)
      }
      return next(e)
    }
    const r = await next(e)
    try {
      if (r.deny === undefined && r.isError === undefined && !READ_ONLY.has(e.tool)) changed.add(await $.session.id())
    } catch {}
    return r
  })

  on('classic.Stop', async ($, e, next) => {
    const r = await next(e)
    try {
      const id = e.session_id
      if ((await modeOf($)).mode !== 'autopilot') return r
      // Another plugin continues this turn already (molt's command, plan decision 4).
      if (r.block !== undefined) { await log($, `stop: a block beneath stands session=${id}`); return r }
      const answer = e.last_assistant_message ?? ''
      if (hasMoltMarker(answer) || statusYields(await readStatus($))) {
        pushes.delete(id)
        changed.delete(id)
        await record($, id, 'molt', 'turn end in a molt handoff', 'let it stop', 'molt owns this turn end (amendment A2)')
        return r
      }
      const n = changed.has(id) ? 0 : (pushes.get(id) ?? 0)
      changed.delete(id)
      if (n >= cfg.loopMax) {
        pushes.delete(id)
        await record($, id, 'pain', 'turn end', 'ask the operator', `autopilot loop: ${n} pushes with no change`)
        await pain($, id, 'autopilot loop', `${n} turn ends pushed on with no change made`)
        return r
      }
      const j = await judge($, turnEndPrompt(answer.slice(-cfg.tailChars), (await policyText($)) ?? ''), parseTurn)
      if ('skip' in j) return r
      if ('fail' in j) {
        pushes.delete(id)
        await record($, id, 'pain', 'turn end', 'ask the operator', j.fail)
        await pain($, id, 'fork failed', j.fail)
        return r
      }
      const v = j.v
      if (v.case === 'covered' || v.case === 'stalled') {
        const a = v.case === 'covered' ? (v.answer ?? '') : (v.next_step ?? '')
        if (!(await record($, id, v.case, v.question ?? 'turn end', a, v.reason, j.usage))) return r
        pushes.set(id, n + 1)
        const text = v.case === 'covered' ? `Autopilot: ${a}. Proceed.` : `Autopilot: continue — ${a}.`
        return { ...r, block: text }
      }
      pushes.delete(id)
      if (v.case === 'waiting') return r
      if (v.case === 'done') {
        await record($, id, 'done', 'turn end', 'stop', v.reason, j.usage)
        $.ui.toast(`autopilot: done — ${oneLine(v.reason, 160)}`)
        return r
      }
      await record($, id, 'pain', v.question ?? 'turn end', 'ask the operator', v.reason, j.usage)
      await pain($, id, 'pain', v.question ?? v.reason)
      return r
    } catch (err) {
      await log($, `Stop error ${String(err)}`)
      return r
    }
  })

  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    try {
      if (r.decision === 'allow') return r
      if ((await modeOf($)).mode !== 'autopilot') return r
      const id = await $.session.id()
      if (r.decision === 'deny') {
        const key = `${id}\u0000${e.tool}\u0000${r.reason ?? ''}`
        if (!painedDeny.has(key)) {
          painedDeny.add(key)
          await pain($, id, 'hard deny', `${e.tool}: ${r.reason ?? 'denied'}`)
        }
        return r
      }
      if (e.tool === 'Bash') {
        const command = String((e.input as { command?: unknown } | undefined)?.command ?? '')
        const rules = neverRules(command, await where($))
        if (rules.length > 0) {
          await record($, id, 'permission', `Bash: ${command}`, 'ask the operator', `never-approve: ${rules.join(', ')}`)
          await pain($, id, 'never-approve', `${rules.join(', ')} — ${command}`)
          return r
        }
      }
      const j = await judge($, permissionPrompt(e.tool, e.input, (await policyText($)) ?? ''), parsePermission)
      if ('v' in j && j.v.decision === 'allow') {
        let shown = ''
        try { shown = JSON.stringify(e.input) ?? '' } catch {}
        if (await record($, id, 'permission', `${e.tool}: ${shown}`, 'allow', j.v.reason, j.usage))
          return { ...r, decision: 'allow', reason: `autonomic: ${j.v.reason}` }
        return r
      }
      const why = 'v' in j ? j.v.reason : 'fail' in j ? j.fail : 'nothing to judge yet'
      await pain($, id, 'permission for you', `${e.tool} (${why})`)
      return r
    } catch (err) {
      await log($, `tool.check error ${String(err)}`)
      return r
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const value = await read($, notice)
    if (value === null || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text>{value.text} </Text>
        <Button key="dismiss" label="Dismiss" onPress={() => update($, notice, () => null)} />
      </Box>
    )
  })
}
