/**
 * English→German flashcard cues: sentence + highlighted gloss span.
 */

/** Split a translation line into candidate English glosses (primary first). */
export function glossCandidatesFromTranslation(translation) {
  const raw = String(translation || '').trim()
  if (!raw) return []
  const parts = raw
    .split(/[,;/]|(\s+or\s+)/i)
    .map((s) => String(s || '').trim())
    .filter(Boolean)
  const seen = new Set()
  const out = []
  for (const p of parts) {
    const low = p.toLowerCase()
    if (seen.has(low)) continue
    seen.add(low)
    out.push(p)
  }
  return out
}

/**
 * Full English cue sentence for the card front (manual → first lesson example → empty).
 */
export function resolveEnglishCueSentence(word, flashExamples) {
  const manual = String(word?.flashCueSentenceEn || '').trim()
  if (manual) return manual
  const firstEn = flashExamples?.[0]?.en
  if (String(firstEn || '').trim()) return String(firstEn).trim()
  return ''
}

/**
 * Find span of first matching gloss inside sentence (longest candidate wins).
 * @returns {{ start: number, end: number } | null}
 */
export function findGlossSpanInSentence(sentence, translation) {
  const s = String(sentence || '')
  if (!s.trim()) return null
  const candidates = glossCandidatesFromTranslation(translation)
    .sort((a, b) => b.length - a.length)
  const lower = s.toLowerCase()
  for (const g of candidates) {
    const gLow = g.toLowerCase()
    let idx = 0
    while (idx < lower.length) {
      const found = lower.indexOf(gLow, idx)
      if (found < 0) break
      const before = found > 0 ? lower[found - 1] : ' '
      const after = found + gLow.length < lower.length ? lower[found + gLow.length] : ' '
      const boundaryOk =
        !/\w/.test(before) && !/\w/.test(after)
      if (boundaryOk || gLow.length >= 4) {
        return { start: found, end: found + g.length }
      }
      idx = found + 1
    }
  }
  return null
}

/**
 * Split sentence into [before, emphasized, after] for React children.
 */
export function splitSentenceAtGloss(sentence, translation) {
  const span = findGlossSpanInSentence(sentence, translation)
  if (!span) {
    return { before: sentence, emphasized: null, after: '' }
  }
  return {
    before: sentence.slice(0, span.start),
    emphasized: sentence.slice(span.start, span.end),
    after: sentence.slice(span.end),
  }
}
