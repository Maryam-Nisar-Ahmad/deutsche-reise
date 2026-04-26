import { normalizeGerman } from './wordParser'

/** Match a normalized lemma to one of the tale's frequency target rows (rank + headword). */
export function matchFrequencyTargetEntry(targetEntries, lemmaNormalized) {
  const nk = String(lemmaNormalized || '').trim()
  if (!nk) return null
  for (const t of targetEntries || []) {
    const hw = String(t.headword || '').trim()
    if (!hw) continue
    const parts = hw.split(/[,;/]/).map((s) => normalizeGerman(s.trim())).filter(Boolean)
    if (parts.some((p) => p === nk)) return t
    const firstTok = normalizeGerman(hw.split(/\s+/)[0])
    if (firstTok === nk) return t
  }
  return null
}

/** Keys used by StoryText to style frequency targets (red). */
export function frequencyTargetEntriesToKeySet(targetEntries) {
  const s = new Set()
  for (const t of targetEntries || []) {
    const parts = String(t.headword || '')
      .split(/[,;/]/)
      .map((x) => normalizeGerman(x.trim()))
      .filter(Boolean)
    for (const p of parts) s.add(p)
    const first = normalizeGerman(String(t.headword || '').split(/\s+/)[0])
    if (first) s.add(first)
  }
  return s
}
