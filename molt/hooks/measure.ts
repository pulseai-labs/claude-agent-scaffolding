import type { MoltConfig } from './config'

// Tool output lands in the context before any response measures it. molt counts it at
// four characters per token, which runs high (auto-handoff measured 83.7k projected
// against 72.5k real), so a gate fires early rather than late.
export const CHARS_PER_TOKEN = 4

export type Stage = 'below' | 'soft' | 'hard' | 'fallback'
export type Thresholds = { soft: number; hard: number; fallback: number }

const ORDER: readonly Stage[] = ['below', 'soft', 'hard', 'fallback']

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
// minRoom points of room above that start before soft applies, and the soft-to-hard
// and hard-to-fallback gaps are kept.
export function thresholdsFor(
  cfg: Pick<MoltConfig, 'soft' | 'hard' | 'fallback' | 'minRoom'>,
  startPercent?: number,
): Thresholds {
  const soft = startPercent === undefined ? cfg.soft : Math.max(cfg.soft, startPercent + cfg.minRoom)
  const hard = soft + (cfg.hard - cfg.soft)
  return { soft, hard, fallback: hard + cfg.fallback }
}

export function stageOf(percent: number, t: Thresholds): Stage {
  if (percent >= t.fallback) return 'fallback'
  if (percent >= t.hard) return 'hard'
  if (percent >= t.soft) return 'soft'
  return 'below'
}

export function atLeast(stage: Stage, floor: Stage): boolean {
  return ORDER.indexOf(stage) >= ORDER.indexOf(floor)
}
