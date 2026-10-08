// One option of a pain band (0.3.0): the label shown, the instruction a press submits.
export type PainOption = { label: string; text: string; recommended: boolean }

// The band's notice. `question`, `options` and `credential` come only from a turn-end pain;
// `seq` tells one notice from the next, so one band takes one press.
export type Pain = { text: string; question?: string; options?: PainOption[]; credential?: string; seq?: number } | null

declare module 'claude-code' {
  interface PluginState {
    autonomic: { notice: Pain }
  }
}
