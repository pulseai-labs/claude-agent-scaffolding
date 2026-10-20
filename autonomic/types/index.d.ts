// The band's notice. `credential` is its own plain-text line; `seq` tells one notice from the
// next. #873: a turn-end pain no longer exists, so no notice carries options or a question.
export type Pain = { text: string; credential?: string; seq?: number } | null

declare module 'claude-code' {
  interface PluginState {
    autonomic: { notice: Pain }
  }
}
