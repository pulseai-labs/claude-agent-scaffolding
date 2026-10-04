import { gitSubcommands } from './shell'

// Past the hard threshold only the handoff's own tools run: the file tools that write
// it, Skill (the instruction names a handoff skill), and Bash made only of git add and
// git commit segments. Everything else, reads included, is refused: a read is what
// overflows a window that is nearly full.
const HANDOFF_TOOLS = new Set(['Write', 'Edit', 'Skill'])
const GIT_ALLOWED = new Set(['add', 'commit'])

export function gateAllows(tool: string, args: Readonly<Record<string, unknown>>): boolean {
  if (HANDOFF_TOOLS.has(tool)) return true
  if (tool !== 'Bash' || typeof args.command !== 'string') return false
  const subs = gitSubcommands(args.command)
  return subs.length > 0 && subs.every(sub => sub !== undefined && GIT_ALLOWED.has(sub))
}

// Progress, for the autopilot loop guard (spec §2): a file written or a commit made.
export function isProgress(tool: string, args: Readonly<Record<string, unknown>>): boolean {
  if (tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit') return true
  return tool === 'Bash' && typeof args.command === 'string' && gitSubcommands(args.command).includes('commit')
}
