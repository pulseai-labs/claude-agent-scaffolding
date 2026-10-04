import type { Register } from 'claude-code'
import { parseRole, parseAllow, bashRules, commitMessageFiles, placeOf, decide, invalidText, statusText } from './rules'
import type { RoleState } from './rules'

async function roleOf($: any): Promise<RoleState> {
  return parseRole(await $.env.get('SEAT_MODS_ROLE'))
}

// Where a path lands: the path itself if it stats, else its nearest existing
// ancestor plus the rest (a Write may create the file and its folders). A `..`
// below a folder that does not exist cannot be resolved, so it is undefined.
async function realOf($: any, path: string): Promise<string | undefined> {
  const own = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  if (own?.realPath !== undefined) return own.realPath
  // A path that exists but does not resolve is a dangling link: a Write would follow it.
  if (await $.fs.stat(path).then(() => true, () => false)) return undefined
  const cut = path.lastIndexOf('/')
  const folder = cut < 0 ? '.' : cut === 0 ? '/' : path.slice(0, cut)
  const name = path.slice(cut + 1)
  if (folder === path || name === '..') return undefined
  const dir = await realOf($, folder)
  if (dir === undefined) return undefined
  return name === '' || name === '.' ? dir : `${dir.replace(/\/$/, '')}/${name}`
}

// The git top level of the session's working directory, or the directory itself outside git.
async function worktreeOf($: any): Promise<string | undefined> {
  const cwd = await $.session.cwd()
  const top = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel']).catch(() => undefined)
  return realOf($, top?.exitCode === 0 ? top.stdout.trim() : cwd)
}

async function allowOf($: any): Promise<string[]> {
  const dirs = parseAllow(await $.env.get('SEAT_MODS_ALLOW'))
  const real = await Promise.all(dirs.map(dir => realOf($, dir)))
  return real.filter((dir): dir is string => dir !== undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.ui.status(statusText(await roleOf($)))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const state = await roleOf($)
    if (state.kind === 'free') return next(e)
    if (state.kind === 'invalid') return { deny: invalidText(state.value) }
    const role = state.role // 'on' or 'default'

    if (e.tool === 'Bash') {
      const texts = await Promise.all(commitMessageFiles(e.command).map(file => $.fs.read(file).catch(() => '')))
      const text = texts.join('\n')
      const deny = decide(role, { kind: 'bash', rules: bashRules(e.command, text) })
      return deny === undefined ? next(e) : { deny }
    }

    if (e.tool === 'Edit' || e.tool === 'Write') {
      const [target, root, allow] = await Promise.all([realOf($, e.file_path), worktreeOf($), allowOf($)])
      const place = target === undefined || root === undefined ? 'outside' : placeOf(target, root, allow)
      const deny = decide(role, { kind: 'write', place })
      return deny === undefined ? next(e) : { deny }
    }

    return next(e)
  })
}
