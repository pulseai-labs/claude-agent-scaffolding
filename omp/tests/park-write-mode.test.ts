// Test tooling (skill-first: outside the shipped plugin's path). The Claude Code adapter's park
// store is written by one sh script; this pins the mode from creation and the claim's exclusivity
// on a real filesystem, which the in-memory world cannot show.
import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLAIM, PARK_WRITE } from '../../autonomic/hooks/io'

const roots: string[] = []
const root = (): string => { const d = mkdtempSync(join(tmpdir(), 'park-io-')); roots.push(d); return d }
afterEach(() => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('the Claude Code park store IO (0.10.0 fixes B2 and B4)', () => {
  test('PARK_WRITE creates the file 0600 and the folder 0700 from the first byte', () => {
    const dir = root()
    const path = join(dir, 'store', 'aabbccddeeff.json')
    const previous = process.umask(0)
    try {
      expect(spawnSync('sh', ['-c', PARK_WRITE, 'sh', path], { input: '{"id":"aabbccddeeff"}\n' }).status).toBe(0)
    } finally { process.umask(previous) }
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(join(dir, 'store')).mode & 0o777).toBe(0o700)
  })

  test('nothing is ever created wider than 0700/0600: every chmod sees the created mode first', () => {
    // The final-mode pin above cannot see the window B4 is about: a file created 0644 and chmodded
    // 0600 right after has the right final mode. This shim is called by the script and records the
    // mode of its target BEFORE the real chmod runs, so the mode at creation is the assertion.
    const dir = root()
    const bin = join(dir, 'bin'), log = join(dir, 'modes')
    mkdirSync(bin, { recursive: true })
    // GNU stat first, BSD (macOS) second: `-c` is a hard error there, so the fallback branch is the
    // one macOS takes; both print "<octal mode> <path>". Test tooling only, outside the plugin.
    writeFileSync(join(bin, 'chmod'), '#!/bin/sh\nfor last; do :; done\n[ -e "$last" ] && { stat -c "%a %n" "$last" 2>/dev/null || stat -f "%Lp %N" "$last"; } >> "$CHMOD_LOG"\nexec /bin/chmod "$@"\n')
    chmodSync(join(bin, 'chmod'), 0o755)
    const store = join(dir, 'store'), path = join(store, 'aabbccddeeff.json')
    const previous = process.umask(0)
    try {
      const r = spawnSync('sh', ['-c', PARK_WRITE, 'sh', path], {
        input: '{"id":"aabbccddeeff"}\n',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, CHMOD_LOG: log },
      })
      expect(r.status).toBe(0)
    } finally { process.umask(previous) }
    const modes = readFileSync(log, 'utf8').trim().split('\n').sort()
    expect(modes).toEqual([`600 ${path}`, `700 ${store}`].sort())
  })

  test('a rewrite of an existing park keeps 0600 (approve and consume do not widen it)', () => {
    const dir = root()
    const path = join(dir, 'store', 'aabbccddeeff.json')
    const previous = process.umask(0)
    try {
      expect(spawnSync('sh', ['-c', PARK_WRITE, 'sh', path], { input: 'first\n' }).status).toBe(0)
      expect(spawnSync('sh', ['-c', PARK_WRITE, 'sh', path], { input: 'second\n' }).status).toBe(0)
    } finally { process.umask(previous) }
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  test('CLAIM is exclusive: the first create wins and a second sees the marker', () => {
    const dir = root()
    const store = join(dir, 'store')
    mkdirSync(store, { recursive: true, mode: 0o700 })
    const path = join(store, 'aabbccddeeff.used')
    expect(spawnSync('sh', ['-c', CLAIM, 'sh', path]).status).toBe(0)
    expect(spawnSync('sh', ['-c', CLAIM, 'sh', path]).status).not.toBe(0)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })
})
