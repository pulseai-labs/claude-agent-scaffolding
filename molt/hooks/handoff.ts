// Finding the handoff a session wrote, and writing one when it did not.

const MARKER_LINE = /^[ \t]*MOLT-HANDOFF:[ \t]*(\S(?:.*\S)?)[ \t]*$/gm

export function markerPath(answer: string): string | undefined {
  let last: string | undefined
  for (const m of answer.matchAll(MARKER_LINE)) last = m[1]
  if (last === undefined) return undefined
  const path = last.replace(/^[`'"<]+/, '').replace(/[`'">]+$/, '')
  return path === '' ? undefined : path
}

export function resolvePath(path: string, cwd: string, home: string): string {
  if (path.startsWith('~/')) return `${home}/${path.slice(2)}`
  if (path.startsWith('/')) return path
  return `${cwd.replace(/\/+$/, '')}/${path}`
}

export type Handoff = { path: string; source: 'marker' | 'write' | 'fallback' }

export function pickHandoff(marker: string | undefined, lastWritten: string | undefined): Handoff | undefined {
  if (marker !== undefined) return { path: marker, source: 'marker' }
  if (lastWritten !== undefined) return { path: lastWritten, source: 'write' }
  return undefined
}

export type Message = {
  role: 'user' | 'assistant'
  text: string
  toolUses: ReadonlyArray<{ tool: string; input: Readonly<Record<string, unknown>> }>
}

export type Facts = { files: string[]; commits: string[]; issues: string[]; lastRequest: string }

export function extractFacts(messages: readonly Message[]): Facts {
  const files = new Set<string>()
  const commits: string[] = []
  const issues = new Set<string>()
  let lastRequest = ''
  for (const m of messages) {
    if (m.role === 'user' && m.text.trim() !== '') lastRequest = m.text.trim()
    for (const use of m.toolUses) {
      const path = use.input.file_path
      if ((use.tool === 'Write' || use.tool === 'Edit') && typeof path === 'string') files.add(path)
      const command = use.input.command
      if (use.tool === 'Bash' && typeof command === 'string' && /\bgit\b[^\n]*\bcommit\b/.test(command))
        commits.push((command.split('\n')[0] ?? '').slice(0, 160))
    }
    for (const ref of m.text.matchAll(/(?:^|[\s(])(#\d{1,6})\b/g)) if (ref[1] !== undefined) issues.add(ref[1])
  }
  return { files: [...files], commits, issues: [...issues], lastRequest: lastRequest.slice(0, 600) }
}

export function factsBrief(
  facts: Facts,
  meta: { sessionId: string; percent: number | undefined; summary?: string },
): string {
  const list = (xs: readonly string[]) => (xs.length ? xs.map(x => `- ${x}`).join('\n') : '- none recorded')
  const fill = meta.percent === undefined ? 'an unknown' : `${Math.round(meta.percent)}%`
  return [
    `# molt fallback handoff — session ${meta.sessionId}`,
    '',
    `The session reached ${fill} context fill without writing a handoff, so molt wrote this one. ` +
      'Its facts are read from the transcript; check every claim against the repository before you act on it.',
    '',
    ...(meta.summary !== undefined ? [meta.summary.trim(), ''] : []),
    '## Files written or edited', list(facts.files), '',
    '## Commits made', list(facts.commits), '',
    '## Issues mentioned', list(facts.issues), '',
    '## Last request', facts.lastRequest || '(none recorded)', '',
    '## Next step',
    'Read the files above and the git log, work out where the session stopped, and continue from there.',
    '',
  ].join('\n')
}

export function briefPrompt(messages: readonly Message[], facts: Facts): string {
  const tail = messages.slice(-60).map(m => `${m.role.toUpperCase()}: ${m.text.slice(0, 2000)}`).join('\n\n')
  return [
    'Below is the end of a coding session that ran out of context before it wrote a handoff.',
    'Write a handoff for a fresh session with exactly these sections, each a "## " heading:',
    '## Work in progress', '## Decisions', '## Assumptions to verify', '## Dead ends',
    '## Last request and whether it was answered', '## Next step',
    'State only what the transcript shows. Do not invent numbers, paths or file names.',
    `Files the session wrote: ${facts.files.join(', ') || 'none'}.`,
    '',
    '<transcript>', tail, '</transcript>',
  ].join('\n')
}

export function isUsableSummary(text: string): boolean {
  return /^## Next step/m.test(text)
}
