// The park store and the operator's approval (slice 2 plan, Task 3; design §3, §9).
//
// Skill-first Q2: every function here reads closed input — park files we write, ids we mint
// from a fixed tuple, exact string equality (callKey, the exact string a park and its release
// are keyed on) — and the one deterministic approval this slice
// allows is exactly this store's match (design §9). The IO around it (a park written to
// <parksDir>/<id>.json at mode 0600, the directory 0700, a file that does not parse ignored
// and logged) is the adapters' (Tasks 5 and 6). Nothing here normalizes a path or a command
// text: an approval that almost matches — another cwd, one extra space, another tool — is no
// match at all and parks again (Review Focus 3).
//
// This module imports only its own files. A hooks module may import its own files by relative
// path and 'claude-code', nothing else — the mod loader and every test child under it enforce
// that — so node:crypto is out here, and the runtime's crypto.subtle is async while parkId is
// sync; sha256Hex below is therefore local (FIPS 180-4). exactKeys restates authority.ts's
// exactObject, which would drag node:path into this graph.

import { parseUniqueJSON } from './strict-json'

export type Park = {
  id: string
  session: string
  host: 'claude-code' | 'omp'
  tool: string
  command: string
  cwd: string
  source: 'floor' | 'judge' | 'integrity'
  redLine: 1 | 2 | 3 | 4 | 5 | 6 | null
  reason: string
  parkedAt: string
  approval: null | { by: 'operator'; at: string; expiresAt: string; usedAt: string | null }
}

// An approval holds for one use and 72 hours (call 2).
const APPROVED_FOR_MS = 72 * 60 * 60 * 1000
// The park store's path fragment. Task 2's word list routes any call that names it, and Task 4
// parks it as the integrity guard (call 3): only the operator clears a park.
export const PARKS_DIR_MARK = 'autonomic/parks'

// The id grammar: the twelve hex a park id is minted in. Both adapters check a word of operator
// text against it before the word is compared or becomes a path (Task 7a: one copy, never two).
export const PARK_ID = /^[a-f0-9]{12}$/
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/

function str(v: unknown): string {
  if (typeof v !== 'string') throw new Error('expected string')
  return v
}
function utc(v: unknown): string {
  const s = str(v)
  if (!UTC.test(s) || !Number.isFinite(Date.parse(s))) throw new Error('expected UTC timestamp')
  return s
}
function exactKeys(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object')
  const object = value as Record<string, unknown>
  if (Object.keys(object).length !== keys.length || keys.some(k => !Object.hasOwn(object, k))) throw new Error('unknown or missing field')
  return object
}
function hostOf(v: unknown): Park['host'] {
  if (v !== 'claude-code' && v !== 'omp') throw new Error('invalid host')
  return v
}
function sourceOf(v: unknown): Park['source'] {
  if (v !== 'floor' && v !== 'judge' && v !== 'integrity') throw new Error('invalid source')
  return v
}
function redLineOf(v: unknown): Park['redLine'] {
  if (v === null) return null
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 6) throw new Error('invalid red line')
  return v as 1 | 2 | 3 | 4 | 5 | 6
}
function approvalOf(v: unknown): Park['approval'] {
  if (v === null) return null
  const o = exactKeys(v, ['by', 'at', 'expiresAt', 'usedAt'])
  if (o.by !== 'operator') throw new Error('approval is not the operator\'s')
  return { by: 'operator', at: utc(o.at), expiresAt: utc(o.expiresAt), usedAt: o.usedAt === null ? null : utc(o.usedAt) }
}

// SHA-256 (FIPS 180-4). The vectors in parks.test.ts are the published digests of the canonical
// JSONs, computed with coreutils sha256sum, never with this function.
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]
const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0

function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  const bits = bytes.length * 8
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000))
  view.setUint32(padded.length - 4, bits >>> 0)
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  const w = new Uint32Array(64)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!, y = w[i - 2]!
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i]! + w[i]!) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      h = g, g = f, f = e, e = (d + t1) >>> 0, d = c, c = b, b = a, a = (t1 + t2) >>> 0
    }
    h0 = (h0 + a) >>> 0, h1 = (h1 + b) >>> 0, h2 = (h2 + c) >>> 0, h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0, h5 = (h5 + f) >>> 0, h6 = (h6 + g) >>> 0, h7 = (h7 + h) >>> 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(x => x.toString(16).padStart(8, '0')).join('')
}

// The first 12 hex of a sha256 over the canonical JSON of the five fields that name a park. The
// key order is part of the contract: both hosts mint and look up the same id for the same call.
export function parkId(p: { session: string; tool: string; command: string; cwd: string; parkedAt: string }): string {
  const canonical = JSON.stringify({ session: p.session, tool: p.tool, command: p.command, cwd: p.cwd, parkedAt: p.parkedAt })
  return sha256Hex(canonical).slice(0, 12)
}

// The exact string a park is keyed on: a command's own text, or a tool's whole input as JSON
// (Task 7a: one copy — the id minted at the park and the match at the release both read it, on
// both hosts). Q2: exact string equality on our own state; nothing is normalized.
export function callKey(call: { command: string | null; input: unknown }): string {
  return call.command ?? JSON.stringify(call.input ?? {})
}

// Exact keys at both levels; a park that does not parse is the adapters' to ignore and log,
// never to match (Task 3 step 3).
export function parsePark(text: string): Park {
  const o = exactKeys(parseUniqueJSON(text), ['id', 'session', 'host', 'tool', 'command', 'cwd', 'source', 'redLine', 'reason', 'parkedAt', 'approval'])
  const id = str(o.id)
  if (!PARK_ID.test(id)) throw new Error('invalid park id')
  return {
    id,
    session: str(o.session),
    host: hostOf(o.host),
    tool: str(o.tool),
    command: str(o.command),
    cwd: str(o.cwd),
    source: sourceOf(o.source),
    redLine: redLineOf(o.redLine),
    reason: str(o.reason),
    parkedAt: utc(o.parkedAt),
    approval: approvalOf(o.approval),
  }
}

export function serializePark(p: Park): string {
  return `${JSON.stringify(p, null, 2)}\n`
}

// One use, 72 hours: the operator's yes is data on the park, and only this store reads it.
export function approve(p: Park, now: string): Park {
  if (p.approval !== null) throw new Error('park is already approved')
  const at = utc(now)
  return { ...p, approval: { by: 'operator', at, expiresAt: new Date(Date.parse(at) + APPROVED_FOR_MS).toISOString(), usedAt: null } }
}

// Approved, unused, unexpired, and exactly this tool, this command text and this cwd. No
// normalization: an almost-match is not a match.
export function matches(p: Park, call: { tool: string; command: string; cwd: string }, now: string): boolean {
  const a = p.approval
  return a !== null && a.usedAt === null && Date.parse(a.expiresAt) > Date.parse(now) &&
    p.tool === call.tool && p.command === call.command && p.cwd === call.cwd
}

export function consume(p: Park, now: string): Park {
  if (p.approval === null) throw new Error('park is not approved')
  return { ...p, approval: { ...p.approval, usedAt: utc(now) } }
}

// AUTONOMIC_PARKS_DIR, else the state dir. The value is used verbatim: the operator names the
// store, and PARKS_DIR_MARK routes any call that names it to the integrity park.
export function parksDir(env: Record<string, string | undefined>, home: string): string {
  const dir = env.AUTONOMIC_PARKS_DIR
  return dir !== undefined && dir.trim() !== '' ? dir : `${home}/.local/state/autonomic/parks`
}

// The exact reason a seat sees. The parenthetical names what stopped the call: the red line,
// the judge's ask, or the operator-only state the integrity guard protects.
export function parkText(p: Park): string {
  const what = p.redLine !== null ? `red line ${p.redLine}` : p.source === 'integrity' ? 'operator-only state' : 'the judge asked'
  return `autonomic: parked for the operator (park ${p.id}; ${what}): ${p.reason}. Do not retry this call or an equivalent one. Record it as parked and continue the work that does not depend on it.`
}
