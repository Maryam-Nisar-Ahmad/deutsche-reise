import { normalizeGerman } from './wordParser.js'

export function extractNormalizedKeysFromText(text) {
  const matches = (text || '').toLowerCase().match(/[a-zäöüß]+/gi) || []
  return [...new Set(matches.map(normalizeGerman))]
}

/** Token coverage: known keys vs all tokens (research ~95% target for reading). */
export function estimateLexicalCoverage(text, knownKeysSet) {
  const matches = (text || '').toLowerCase().match(/[a-zäöüß]+/gi) || []
  if (!matches.length) return { percent: 100, known: 0, total: 0 }
  let known = 0
  for (const m of matches) {
    if (knownKeysSet.has(normalizeGerman(m))) known++
  }
  return {
    percent: Math.round((known / matches.length) * 1000) / 10,
    known,
    total: matches.length,
  }
}

export function splitIntoSentences(text) {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12)
}
