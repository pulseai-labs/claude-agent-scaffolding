export type Notice = { text: string; tone: 'info' | 'warn' } | null

declare module 'claude-code' {
  interface PluginState {
    molt: { notice: Notice }
  }
}
