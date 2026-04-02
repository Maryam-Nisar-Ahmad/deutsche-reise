export function normalizeGerman(word) {
  return word.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function parseDuolingoFormat(rawText) {
  const blocks = rawText.split(/\n\s*\n/)
  const seen = new Set()
  const result = []

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) continue

    const german = lines[0]
    const translation = lines[1]

    if (!german || !translation) continue

    const normalizedKey = normalizeGerman(german)
    if (seen.has(normalizedKey)) continue
    seen.add(normalizedKey)

    result.push({
      german: german.trim(),
      translation: translation.trim(),
      normalizedKey,
    })
  }

  return result
}

export function parseManualEntry(germanLine, translationLine) {
  const german = germanLine.trim()
  const translation = translationLine.trim()
  if (!german || !translation) return null
  return {
    german,
    translation,
    normalizedKey: normalizeGerman(german),
  }
}
