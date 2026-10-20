// The band's notice. `seq` tells one notice from the next. #873: no turn-end pain exists, so no
// notice carries options, a question or a credential.
export type Pain = { text: string; seq?: number } | null

declare module 'claude-code' {
  interface PluginState {
    autonomic: { notice: Pain }
  }
}
