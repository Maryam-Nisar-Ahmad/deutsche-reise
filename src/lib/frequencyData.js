import { normalizeGerman } from './wordParser.js'

/** True if this frequency headword is already represented in the learner vault (by normalized lemma string). */
export function isFrequencyEntryInVault(entry, vaultKeySet) {
  return vaultKeySet.has(normalizeGerman(entry.headword))
}

let cached = null

export async function loadFrequencyEntries() {
  if (cached) return cached
  const res = await fetch('/data/frequency-vocab.json')
  if (!res.ok) throw new Error('Could not load frequency list')
  const data = await res.json()
  cached = data.entries || []
  return cached
}

export function clearFrequencyCache() {
  cached = null
}

/**
 * First rank ≥ startRank where the learner should study this lemma here.
 * Vault always wins: if the headword (or a variant key) is already in the vault, skip —
 * even when AI cache says "unknown" (stale/wrong batch results must not override the real vault).
 */
export function pickNextLearnRank(entries, vaultKeySet, statusByRank, startRank = 1) {
  const sorted = [...entries].sort((a, b) => a.rank - b.rank)
  for (const e of sorted) {
    if (e.rank < startRank) continue
    const nk = normalizeGerman(e.headword)
    const st = statusByRank.get(e.rank)
    if (vaultKeySet.has(nk)) continue
    if (st === 'known') continue
    if (st === 'unknown' || st == null) return e
  }
  return null
}

/** Next N learnable entries (same rules as pickNextLearnRank), for gloss prefetch. */
export function collectUpcomingFrequencyEntries(entries, vaultKeySet, statusByRank, limit = 30, startRank = 1) {
  const sorted = [...entries].sort((a, b) => a.rank - b.rank)
  const out = []
  for (const e of sorted) {
    if (e.rank < startRank) continue
    const nk = normalizeGerman(e.headword)
    if (vaultKeySet.has(nk)) continue
    if (statusByRank.get(e.rank) === 'known') continue
    if (statusByRank.get(e.rank) === 'unknown' || statusByRank.get(e.rank) == null) {
      out.push(e)
      if (out.length >= limit) break
    }
  }
  return out
}

/** Extract example pairs from bundled detail text (bullet + dash pattern). */
export function extractExamplesFromDetail(detail, max = 6) {
  const text = String(detail || '')
  const parts = text.split(/•/)
  const out = []
  for (const p of parts) {
    const m = p.match(/\s*(.+?)\s*[–—-]\s*(.+)/)
    if (m) {
      const de = m[1].trim()
      const en = m[2].trim()
      if (de.length > 3 && en.length > 2) out.push({ de, en })
    }
    if (out.length >= max) break
  }
  return out
}

/** Short one-line gloss from detail (after rank + headword). */
export function shortGlossFromDetail(headword, detail) {
  const t = String(detail || '').replace(/^\s*\d+\s+/, '').trim()
  const cut = t.split('•')[0] || t
  return cut.slice(0, 160).trim() || headword
}
