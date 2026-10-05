import type { MoltConfig } from './config'

// Tool output lands in the context before any response measures it. molt counts it at
// four characters per token, which runs high (auto-handoff measured 83.7k projected
// against 72.5k real), so a gate fires early rather than late.
export const CHARS_PER_TOKEN = 4

export type Stage = 'below' | 'warn' | 'warnAgain' | 'command' | 'block' | 'fallback'
export type Thresholds = { warn: number; warnAgain: number; command: number; block: number; fallback: number }

const ORDER: readonly Stage[] = ['below', 'warn', 'warnAgain', 'command', 'block', 'fallback']

export function projectedPercent(
  context: { tokens?: number; window: number; percent?: number },
  unmeasured: number,
): number | undefined {
  if (!(context.window > 0)) return undefined
  const tokens = context.tokens ?? (context.percent !== undefined ? (context.percent * context.window) / 100 : undefined)
  if (tokens === undefined) return undefined
  return ((tokens + Math.max(0, unmeasured)) / context.window) * 100
}

// A seeded session starts with its handoff and the resume already in context. It gets
// minRoom points of room above that start before its first warning, and the gaps between
// the steps are kept — but the ladder moves up only as far as keeps fallback at 99% or
// below, so the block and the fallback stay reachable.
export function thresholdsFor(
  cfg: Pick<MoltConfig, 'warn' | 'warnAgain' | 'command' | 'block' | 'fallback' | 'minRoom'>,
  startPercent?: number,
): Thresholds {
  const wanted = startPercent === undefined ? 0 : Math.max(0, startPercent + cfg.minRoom - cfg.warn)
  const shift = Math.min(wanted, Math.max(0, 99 - (cfg.block + cfg.fallback)))
  const block = cfg.block + shift
  return { warn: cfg.warn + shift, warnAgain: cfg.warnAgain + shift, command: cfg.command + shift, block, fallback: block + cfg.fallback }
}

export function stageOf(percent: number, t: Thresholds): Stage {
  if (percent >= t.fallback) return 'fallback'
  if (percent >= t.block) return 'block'
  if (percent >= t.command) return 'command'
  if (percent >= t.warnAgain) return 'warnAgain'
  if (percent >= t.warn) return 'warn'
  return 'below'
}

export function atLeast(stage: Stage, floor: Stage): boolean {
  return ORDER.indexOf(stage) >= ORDER.indexOf(floor)
}
