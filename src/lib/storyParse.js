/**
 * Parse Story Studio / Frequency Lab multi-chapter German story format (---CHAPTER--- splits).
 */
export function parseStoryContent(content) {
  const rawChapters = String(content || '').split(/---CHAPTER---/i)
  return rawChapters
    .map((raw) => {
      const lines = raw.trim().split('\n').filter(Boolean)
      if (!lines.length) return null

      let text = raw.trim()
      let summary = ''

      const summaryMatch = text.match(/\[ENGLISH_SUMMARY:\s*([^\]]+)\]/i)
      if (summaryMatch) {
        summary = summaryMatch[1].trim()
        text = text.replace(/\[ENGLISH_SUMMARY:[^\]]+\]/i, '').trim()
      }

      const titleMatch = text.match(/^(Kapitel\s*\d+[^:\n]*:?[^\n]*)/im)
      const title = titleMatch ? titleMatch[1].trim() : `Kapitel ${rawChapters.indexOf(raw) + 1}`

      return { title, text, summary }
    })
    .filter(Boolean)
}
