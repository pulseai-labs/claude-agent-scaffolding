import type { EngineInterface } from 'claude-code'
import { logPath } from './records'

// File and process helpers. The host has no append, so appends go through sh; each
// returns whether it landed, and nothing here throws.

type Engine = EngineInterface

export const APPEND = 'mkdir -p "$(dirname "$2")" && printf "%s\\n" "$1" >> "$2"'
export const TOUCH = 'mkdir -p "$(dirname "$1")" && touch "$1"'

export async function home($: Engine): Promise<string> {
  return (await $.env.get('HOME')) ?? ''
}

export async function readText($: Engine, path: string): Promise<string | undefined> {
  try {
    const text = await $.fs.read(path)
    return typeof text === 'string' ? text : undefined
  } catch {
    return undefined
  }
}

export async function appendLine($: Engine, path: string, line: string): Promise<boolean> {
  try {
    return (await $.process.run(['sh', '-c', APPEND, 'sh', line, path])).exitCode === 0
  } catch {
    return false
  }
}

export async function touch($: Engine, path: string): Promise<boolean> {
  try {
    return (await $.process.run(['sh', '-c', TOUCH, 'sh', path])).exitCode === 0
  } catch {
    return false
  }
}

export async function log($: Engine, line: string): Promise<void> {
  await appendLine($, logPath(await home($)), `${new Date().toISOString()} ${line}`)
}
