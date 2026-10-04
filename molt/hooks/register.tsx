import type { Register } from 'claude-code'
import { parseConfig } from './config'

export const register: Register = (_on, options) => {
  parseConfig(options as Readonly<Record<string, unknown>> | undefined)
}
