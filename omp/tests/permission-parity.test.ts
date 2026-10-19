// Permission parity (Plan Task 7, Steps 1-2): one synthetic input set and one fixed model,
// through both adapters. The spec (§4) defines parity as the same floor, the same routing, the
// same prompt and the same inputs on both hosts; each host decides with its own model, so the
// model is stubbed equal here (one verdict table) and any difference would be an adapter's.
//
// The OMP adapter is driven for real: createAutonomic over an in-memory AutonomicIO, unenrolled
// (no authority env), so every judge plan takes judgeDirect - the lane with no role/grants,
// comparable to Claude Code's. The Claude Code adapter's plan step is literally
// planPermission(input, ctx) (register.tsx:706-714 builds the input and context this test
// builds); register.tsx itself value-imports the claude-code host kit, which bun cannot load,
// and its input construction is already pinned by autonomic/tests/permission.test.ts.
//
// Tool names: the corpus carries the names the OMP tool_call wiring emits into PermissionInput
// (bash, read); every call also asserts that the Claude Code spellings (Bash, Read) change the
// Plan kind not at all and the prompt only in its tool-name token.
//
// Test tooling, not product code (skill-first: outside the shipped plugin's path).
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import corpus from '../../autonomic/tests/fixtures/parity-corpus.json'
import { NEVER_RULES } from '../../autonomic/hooks/config'
import { planPermission, settlePermission } from '../../autonomic/hooks/decide'
import type { DecideContext, PermissionInput, Plan } from '../../autonomic/hooks/decide'
import type { Where } from '../../autonomic/hooks/never'
import { parsePark, parkText } from '../../autonomic/hooks/parks'
import type { Park } from '../../autonomic/hooks/parks'
import { parsePermission } from '../../autonomic/hooks/verdict'
import { createAutonomic } from '../../autonomic/omp/extension'
import type { AutonomicIO } from '../../autonomic/omp/extension'

type Category = 'red-line' | 'left-floor' | 'routed' | 'text-only' | 'no-route'
type Expected = { plan: 'park-floor' | 'park-integrity' | 'judge' | 'pass'; redLine?: 1 | 2 | 3 }
type Call = { id: string; category: Category; tool: string; input: unknown; expect: Expected; why: string }

const CATEGORIES: readonly string[] = ['red-line', 'left-floor', 'routed', 'text-only', 'no-route']
const PLANS: readonly string[] = ['park-floor', 'park-integrity', 'judge', 'pass']

// The JSON import is boundary data: validate its shape once, then read a typed value.
function isCall(value: unknown): value is Call {
  if (value === null || typeof value !== 'object') return false
  if (!('id' in value) || typeof value.id !== 'string') return false
  if (!('category' in value) || typeof value.category !== 'string' || !CATEGORIES.includes(value.category)) return false
  if (!('tool' in value) || typeof value.tool !== 'string') return false
  if (!('input' in value)) return false
  const expected = 'expect' in value ? value.expect : undefined
  if (expected === null || expected === undefined || typeof expected !== 'object') return false
  if (!('plan' in expected) || typeof expected.plan !== 'string' || !PLANS.includes(expected.plan)) return false
  if ('redLine' in expected && typeof expected.redLine !== 'number') return false
  return 'why' in value && typeof value.why === 'string'
}

const DOCUMENT: unknown = corpus
if (DOCUMENT === null || typeof DOCUMENT !== 'object' || !('calls' in DOCUMENT) ||
    !Array.isArray(DOCUMENT.calls) || !DOCUMENT.calls.every(isCall)) {
  throw new Error('parity corpus: expected a calls array of well-formed calls')
}
const CALLS: readonly Call[] = DOCUMENT.calls
const byId = (id: string): Call | undefined => CALLS.find(c => c.id === id)

// One context and one placement for every call, on both hosts.
const HOME = '/fixture/home'
const TREE = '/fixture/tree'
const PARKS = '/fixture/parks'
const POLICY = '# Parity policy\n\nSynthetic policy: no deployment, no publication, and no credential read without the operator.'
const WHERE: Where = { cwd: TREE, root: TREE, home: HOME, branch: 'feat/x', defaultBranch: 'main' }
const CTX: DecideContext = { policy: POLICY, recent: '', role: null, grants: null, parks: [], now: '2026-10-19T00:00:00.000Z', enabled: [...NEVER_RULES] }

// One fixed model: a reply per call id, and one default allow. The same table is applied on both
// sides; the last entry is unparseable on purpose (it settles to the judge's non-answer park).
const ALLOW = JSON.stringify({ decision: 'allow', red_line: null, reason: 'inside the synthetic policy' })
const VERDICTS: Readonly<Record<string, string>> = {
  'r4-vercel': JSON.stringify({ decision: 'allow', red_line: 4, reason: 'a deploy that looked routine' }),
  'r6-ssh-key': JSON.stringify({ decision: 'ask', red_line: 6, reason: 'a credential read' }),
  'r6-printenv': JSON.stringify({ decision: 'ask', red_line: null, reason: 'the environment is operator state' }),
  'r4-npm-publish': 'not a verdict',
}
const replyFor = (id: string): string => VERDICTS[id] ?? ALLOW

const CC_TOOL: Readonly<Record<string, string>> = { bash: 'Bash', read: 'Read', write: 'Write', edit: 'Edit' }

function commandOf(input: unknown): string | null {
  if (input === null || typeof input !== 'object' || !('command' in input)) return null
  return typeof input.command === 'string' ? input.command : null
}

// The Claude Code adapter's input construction (register.tsx:706-710): the call's own command
// text, else null; cwd and the git facts are the ones the adapter reads for the session.
function ccInput(call: Call, tool: string): PermissionInput {
  return { tool, input: call.input, command: commandOf(call.input), cwd: TREE, where: WHERE }
}

// SEAT_MODS_ROLE is read by PinnedAuthority at construction; an ambient guard role must not
// leak into the fixture (judgment-world.ts does the same for its enrolled worlds).
const ambientSeatRole = process.env.SEAT_MODS_ROLE
beforeEach(() => { delete process.env.SEAT_MODS_ROLE })
afterAll(() => {
  if (ambientSeatRole === undefined) delete process.env.SEAT_MODS_ROLE
  else process.env.SEAT_MODS_ROLE = ambientSeatRole
})

// The one adapter method this test drives.
type Adapter = {
  onToolCall: (event: { toolName?: string; input?: unknown }) => Promise<{ block: true; reason: string } | undefined>
}
type Fixture = {
  files: Map<string, string>
  generations: Array<{ promptText?: string }>
  setVerdict: (reply: string) => void
  adapter: Adapter
}

// A real adapter over an in-memory AutonomicIO: real files in memory, a git stub that returns
// the one WHERE above, and one side turn that answers from the verdict table. Unenrolled, so no
// decision service and no lease: route() sends every judged call to judgeDirect.
function fixture(): Fixture {
  const files = new Map<string, string>()
  files.set(join(HOME, '.claude/autonomic/policy.md'), POLICY)
  const generations: Array<{ promptText?: string }> = []
  let verdict = ALLOW
  const env: Record<string, string | undefined> = {
    HOME, AUTONOMIC_MODE: 'autopilot', AUTONOMIC_LEDGER: '/fixture/ledger.md',
    AUTONOMIC_PAIN_PATH: '/fixture/pain.log', AUTONOMIC_PARKS_DIR: PARKS,
  }
  const io = {
    pid: 4242,
    launchCwd: TREE,
    cwd: TREE,
    env,
    sessionId: () => 'S1',
    setEnv: (name: string, value: string | undefined) => { if (value === undefined) delete env[name]; else env[name] = value },
    remove: (path: string) => { files.delete(path) },
    writeMode: () => {},
    rename: () => {},
    readText: async (path: string) => files.get(path),
    readDir: async (path: string) => {
      const prefix = `${path.replace(/\/+$/, '')}/`
      return [...files.keys()].filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .map(k => k.slice(prefix.length))
    },
    writePark: async (path: string, text: string) => { files.set(path, text) },
    exists: async (path: string) => files.has(path),
    writeText: async (path: string, text: string) => { files.set(path, text) },
    appendLine: async (path: string, line: string) => { files.set(path, `${files.get(path) ?? ''}${line}\n`); return true },
    touch: async (path: string) => { if (!files.has(path)) files.set(path, ''); return true },
    run: async (argv: string[]) => {
      const line = argv.join(' ')
      if (line === `git -C ${TREE} rev-parse --show-toplevel`) return { exitCode: 0, stdout: TREE }
      if (line === `git -C ${TREE} rev-parse --abbrev-ref HEAD`) return { exitCode: 0, stdout: 'feat/x' }
      if (line === `git -C ${TREE} symbolic-ref --short refs/remotes/origin/HEAD`) return { exitCode: 0, stdout: 'origin/main' }
      return { exitCode: 1, stdout: '' }
    },
    captureHost: () => ({
      sessionId: 'S1', cwd: TREE, sessionFile: undefined, judge: undefined, asyncJobs: () => null,
      generate: async (opts: { promptText?: string }) => { generations.push(opts); return { replyText: verdict } },
    }),
    usage: () => 10,
    systemPrompt: () => 'FIXTURE BASE PROMPT',
    notify: () => {},
    status: () => {},
    bell: async () => {},
  }
  // The in-memory IO answers every noun the adapter calls; several host SDK types are not
  // constructible here, so the fixture crosses that boundary once, as a named value.
  const inMemory = io as AutonomicIO
  return { files, generations, setVerdict: reply => { verdict = reply }, adapter: createAutonomic(inMemory) }
}

function parksWritten(files: Map<string, string>, before: Set<string>): string[] {
  return [...files.keys()].filter(k => k.startsWith(`${PARKS}/`) && k.endsWith('.json') && !before.has(k))
}

function expectKind(call: Call, cc: Plan): void {
  const want = call.expect.plan === 'park-floor' || call.expect.plan === 'park-integrity' ? 'park' : call.expect.plan
  expect(cc.kind).toBe(want)
  if (cc.kind === 'park') {
    expect(cc.source).toBe(call.expect.plan === 'park-floor' ? 'floor' : 'integrity')
    expect(cc.redLine).toBe(call.expect.redLine ?? null)
  }
}

describe('the parity corpus (Plan Task 7 Step 1)', () => {
  test('splits exactly as the plan says, with the part-a shapes present', () => {
    expect(CALLS).toHaveLength(40)
    const ids = CALLS.map(c => c.id)
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
    const count = (category: Category): number => CALLS.filter(c => c.category === category).length
    expect(count('red-line')).toBe(10)
    expect(count('left-floor')).toBe(10)
    expect(count('routed')).toBe(10)
    expect(count('text-only')).toBe(5)
    expect(count('no-route')).toBe(5)
    expect(byId('nr-skill-approve')?.category).toBe('no-route')
    expect(byId('nr-bash-drop')?.category).toBe('no-route')
    expect(byId('r6-read-file')?.category).toBe('routed')
  })
})

for (const call of CALLS) {
  test(`${call.category}: ${call.id}`, async () => {
    const cc = planPermission(ccInput(call, call.tool), CTX)
    expectKind(call, cc)

    // The Claude Code host spelling: same Plan kind; the prompt moves only in its tool token.
    const ccTool = CC_TOOL[call.tool] ?? call.tool
    const host = planPermission(ccInput(call, ccTool), CTX)
    expect(host.kind).toBe(cc.kind)
    if (cc.kind === 'judge' && host.kind === 'judge') {
      const token = (prompt: string): string | undefined => /<tool>([^<]*)<\/tool>/.exec(prompt)?.[1]
      expect(token(cc.prompt)).toBe(call.tool)
      expect(token(host.prompt)).toBe(ccTool)
      expect(host.prompt.replace(`<tool>${ccTool}</tool>`, `<tool>${call.tool}</tool>`)).toBe(cc.prompt)
    }

    const fx = fixture()
    fx.setVerdict(replyFor(call.id))
    const before = new Set(fx.files.keys())
    const r = await fx.adapter.onToolCall({ toolName: call.tool, input: call.input })
    const written = parksWritten(fx.files, before)

    if (cc.kind === 'pass') {
      expect(r).toBeUndefined()
      expect(fx.generations).toHaveLength(0)
      expect(written).toHaveLength(0)
    } else if (cc.kind === 'park') {
      expect(r?.block).toBe(true)
      expect(fx.generations).toHaveLength(0)
      expect(written).toHaveLength(1)
      const park: Park = parsePark(fx.files.get(written[0]!)!)
      expect(park.source).toBe(cc.source)
      expect(park.redLine).toBe(cc.redLine)
      expect(park.reason).toBe(cc.reason)
      expect(r?.reason).toBe(parkText(park))
    } else if (cc.kind === 'judge') {
      expect(fx.generations).toHaveLength(1)
      expect(fx.generations[0]!.promptText).toBe(cc.prompt)
      const settled = settlePermission(parsePermission(replyFor(call.id)))
      if (settled.kind === 'allow') {
        expect(r).toBeUndefined()
        expect(written).toHaveLength(0)
      } else {
        expect(r?.block).toBe(true)
        expect(written).toHaveLength(1)
        const park: Park = parsePark(fx.files.get(written[0]!)!)
        expect(park.source).toBe('judge')
        expect(park.redLine).toBe(settled.redLine)
        expect(park.reason).toBe(settled.reason)
        expect(r?.reason).toBe(parkText(park))
      }
    } else {
      // No corpus call carries an approved park.
      throw new Error(`unexpected plan ${cc.kind}`)
    }

    // The next call starts from the same empty store the one DecideContext names.
    for (const path of written) fx.files.delete(path)
  })
}
