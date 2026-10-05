export type Pain = { text: string } | null

declare module 'claude-code' {
  interface PluginState {
    autonomic: { notice: Pain }
  }
}
