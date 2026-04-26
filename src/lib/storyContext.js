/** Strip leading "Kapitel …" heading from chapter body (matches Story Studio reader). */
export function stripChapterHeading(text) {
  return String(text || '').replace(/^Kapitel[^\n]+\n?/i, '').trim()
}

/** Prefer 1–2 lines of surrounding story text (readable context without a wall of text). */
const CONTEXT_LINES = 2
const CONTEXT_SENTENCES = 2

/**
 * Pull ~4 contiguous lines (preferred) or ~4 sentences around the tapped surface word
 * so "Add to my list" can store rich recall context.
 */
export function extractStoryEncounterContext(chapterText, displayWord, lookupKey) {
  const body = stripChapterHeading(chapterText)
  const needles = [...new Set(
    [displayWord, lookupKey]
      .map((s) => String(s || '').trim().toLowerCase())
      .filter(Boolean)
  )]

  if (!body.trim()) return ''

  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)

  let lineIdx = -1
  for (let i = 0; i < lines.length && lineIdx < 0; i++) {
    const low = lines[i].toLowerCase()
    if (needles.some((n) => low.includes(n))) lineIdx = i
  }

  if (lineIdx >= 0 && lines.length > 0) {
    let start = Math.max(0, lineIdx - 1)
    let end = Math.min(lines.length, start + CONTEXT_LINES)
    if (end - start < CONTEXT_LINES && lines.length >= CONTEXT_LINES) {
      start = Math.max(0, end - CONTEXT_LINES)
      end = Math.min(lines.length, start + CONTEXT_LINES)
    }
    const lineChunk = lines.slice(start, end).join('\n')
    if (lineChunk.length < 80) {
      const sent = sentenceWindowAroundNeedle(body, needles, CONTEXT_SENTENCES)
      if (sent.length > lineChunk.length) return sent.slice(0, 3500)
    }
    return lineChunk.slice(0, 3500)
  }

  return sentenceWindowAroundNeedle(body, needles, CONTEXT_SENTENCES)
}

function sentenceWindowAroundNeedle(text, needlesLower, maxSentences) {
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.length) return String(text).trim().slice(0, 3500)

  let si = -1
  for (let i = 0; i < parts.length && si < 0; i++) {
    const low = parts[i].toLowerCase()
    if (needlesLower.some((n) => low.includes(n))) si = i
  }
  if (si < 0) si = 0

  let start = Math.max(0, si - 1)
  let end = Math.min(parts.length, start + maxSentences)
  if (end - start < maxSentences && parts.length >= maxSentences) {
    start = Math.max(0, end - maxSentences)
    end = Math.min(parts.length, start + maxSentences)
  }
  return parts.slice(start, end).join(' ').slice(0, 3500)
}
