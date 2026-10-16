// Closed JSON grammar; duplicate keys must be detected before JSON.parse erases them.
export function parseUniqueJSON(text: string): unknown {
  let cursor = 0
  function space(): void { while (cursor < text.length && /[\x20\t\r\n]/.test(text[cursor])) cursor++ }
  function string(): string {
    const start = cursor++
    while (cursor < text.length) {
      const c = text[cursor++]
      if (c === '"') return JSON.parse(text.slice(start, cursor)) as string // JSON token decoder validates escapes/control characters.
      if (c === '\\') cursor++
    }
    throw new Error('unterminated JSON string')
  }
  function value(): unknown {
    space()
    const c = text[cursor]
    if (c === '"') return string()
    if (c === '{') {
      cursor++; space()
      const result: Record<string, unknown> = Object.create(null), seen = new Set<string>()
      if (text[cursor] === '}') { cursor++; return result }
      for (;;) {
        space(); if (text[cursor] !== '"') throw new Error('expected object key')
        const key = string()
        if (seen.has(key)) throw new Error('duplicate JSON key')
        seen.add(key); space()
        if (text[cursor++] !== ':') throw new Error('expected colon')
        result[key] = value(); space()
        const end = text[cursor++]
        if (end === '}') return result
        if (end !== ',') throw new Error('expected object separator')
      }
    }
    if (c === '[') {
      cursor++; space(); const result: unknown[] = []
      if (text[cursor] === ']') { cursor++; return result }
      for (;;) {
        result.push(value()); space()
        const end = text[cursor++]
        if (end === ']') return result
        if (end !== ',') throw new Error('expected array separator')
      }
    }
    for (const [literal, decoded] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(literal, cursor)) { cursor += literal.length; return decoded }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(cursor))
    if (number === null) throw new Error('expected JSON value')
    cursor += number[0].length
    const decoded = Number(number[0])
    if (!Number.isFinite(decoded)) throw new Error('non-finite JSON number')
    return decoded
  }
  const result = value(); space()
  if (cursor !== text.length) throw new Error('trailing JSON input')
  return result
}
