export function normalizeGerman(word) {
  return word.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Strip umlauts for matching masculine ↔ feminine noun pairs (Arzt / Ärztin). */
function umlautFold(str) {
  return normalizeGerman(str)
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
}

const VERB_SUFFIXES = ['est', 'en', 'st', 'et', 't', 'e']

const VERB_ENDING_RE = /(e|st|t|en|et|est)$/i

function hasVerbLikeEnding(word) {
  const w = word.trim()
  if (w.length < 3) return false
  return VERB_ENDING_RE.test(w)
}

/** Returns stem after stripping one verb suffix, or null if not verb-like / too short. */
function getVerbStem(word) {
  const lower = word.trim().toLowerCase()
  if (!hasVerbLikeEnding(lower)) return null
  for (const suf of VERB_SUFFIXES) {
    if (lower.endsWith(suf)) {
      const stem = lower.slice(0, -suf.length)
      if (stem.length >= 2) return stem
    }
  }
  return null
}

function pickVerbLemma(entries) {
  const inf = entries.find((e) => /en$/i.test(e.german.trim()))
  if (inf) return inf
  return [...entries].sort((a, b) => b.german.length - a.german.length)[0]
}

function mergeTranslations(entries) {
  const parts = [...new Set(entries.map((e) => (e.translation || '').trim()).filter(Boolean))]
  return parts.length ? parts.join('; ') : 'Imported'
}

function uniqueGermanForms(entries) {
  const seen = new Set()
  const out = []
  for (const e of entries) {
    const g = e.german.trim()
    const k = g.toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      out.push(g)
    }
  }
  return out.sort((a, b) => a.localeCompare(b, 'de'))
}

function isProbablyFeminineNoun(word) {
  const w = word.trim()
  if (w.length < 5) return false
  const lower = w.toLowerCase()
  if (!lower.endsWith('in')) return false
  if (lower === 'bin' || lower === 'kein' || lower === 'dein' || lower === 'sein') return false
  return true
}

/**
 * After parseDuolingoFormat: merge verb conjugations and gendered noun pairs.
 * Returns rows ready for importWords + stats for UI messages.
 */
export function prepareGroupedImport(parsed) {
  const list = parsed.filter((p) => p?.german?.trim())
  if (list.length === 0) {
    return {
      words: [],
      stats: {
        verbFormsInGroups: 0,
        verbFamilies: 0,
        nounSurfacesInPairs: 0,
        nounPairFamilies: 0,
      },
    }
  }

  const used = new Set()
  const output = []

  // ── Verb groups by stem ─────────────────────────────────────────────
  const stemToIndices = new Map()
  list.forEach((entry, i) => {
    const stem = getVerbStem(entry.german)
    if (!stem) return
    if (!stemToIndices.has(stem)) stemToIndices.set(stem, [])
    stemToIndices.get(stem).push(i)
  })

  let verbFormsInGroups = 0
  let verbFamilies = 0

  for (const [, indices] of stemToIndices) {
    if (indices.length < 2) continue
    const group = indices.map((i) => list[i]).filter((e) => hasVerbLikeEnding(e.german))
    if (group.length < 2) continue

    indices.forEach((i) => {
      if (group.includes(list[i])) used.add(i)
    })

    const lemma = pickVerbLemma(group)
    const forms = uniqueGermanForms(group)
    const variants = forms.filter((g) => normalizeGerman(g) !== normalizeGerman(lemma.german))

    verbFormsInGroups += group.length
    verbFamilies += 1

    output.push({
      german: lemma.german.trim(),
      translation: mergeTranslations(group),
      normalizedKey: normalizeGerman(lemma.german),
      variants,
      frequencyTier: getFrequencyTier(lemma.german),
    })
  }

  // ── Gendered noun pairs (Lehrer/Lehrerin, Arzt/Ärztin via umlaut fold) ──
  const remIndices = list.map((_, i) => i).filter((i) => !used.has(i))
  const remEntries = remIndices.map((i) => ({ ...list[i], _i: i }))
  const foldToEntries = new Map()
  for (const e of remEntries) {
    const f = umlautFold(e.german)
    if (!foldToEntries.has(f)) foldToEntries.set(f, [])
    foldToEntries.get(f).push(e)
  }

  let nounSurfacesInPairs = 0
  let nounPairFamilies = 0

  for (const ent of remEntries) {
    if (used.has(ent._i)) continue
    if (!isProbablyFeminineNoun(ent.german)) continue

    const femStemFold = umlautFold(ent.german.slice(0, -2))
    const bucket = foldToEntries.get(femStemFold) || []
    const masc = bucket.find(
      (e) =>
        e._i !== ent._i &&
        !e.german.trim().toLowerCase().endsWith('in') &&
        umlautFold(e.german) === femStemFold
    )
    if (!masc) continue

    used.add(ent._i)
    used.add(masc._i)

    const head = masc.german.trim()
    const forms = uniqueGermanForms([masc, ent])
    const variants = forms.filter((x) => normalizeGerman(x) !== normalizeGerman(head))

    nounSurfacesInPairs += 2
    nounPairFamilies += 1

    output.push({
      german: head,
      translation: mergeTranslations([masc, ent]),
      normalizedKey: normalizeGerman(head),
      variants,
      frequencyTier: getFrequencyTier(head),
    })
  }

  // Singles
  list.forEach((entry, i) => {
    if (used.has(i)) return
    const g = entry.german.trim()
    output.push({
      german: g,
      translation: (entry.translation || '').trim() || 'Imported',
      normalizedKey: entry.normalizedKey || normalizeGerman(g),
      variants: [],
      frequencyTier: getFrequencyTier(g),
    })
  })

  return {
    words: output,
    stats: {
      verbFormsInGroups,
      verbFamilies,
      nounSurfacesInPairs,
      nounPairFamilies,
    },
  }
}

const TIER_1_WORDS = new Set([
  'sein', 'haben', 'werden', 'können', 'müssen', 'sollen', 'wollen',
  'dürfen', 'mögen', 'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr',
  'nicht', 'und', 'oder', 'aber', 'in', 'an', 'auf', 'mit', 'zu',
  'der', 'die', 'das', 'ein', 'eine', 'ist', 'hat', 'bin', 'bist',
  'sind', 'ja', 'nein', 'gut', 'auch', 'wie', 'was', 'wo', 'wer',
  'von', 'aus', 'nach', 'bei', 'für', 'über', 'noch', 'mehr', 'sehr',
  'hier', 'da', 'dann', 'jetzt', 'schon', 'immer', 'nie', 'nur',
  'kommen', 'gehen', 'sehen', 'machen', 'sagen', 'geben', 'wissen',
])

const TIER_2_WORDS = new Set([
  'kaufen', 'arbeiten', 'leben', 'wohnen', 'essen', 'trinken',
  'fahren', 'laufen', 'sprechen', 'lernen', 'lesen', 'schreiben',
  'haus', 'familie', 'arbeit', 'zeit', 'mensch', 'jahr', 'tag',
  'frau', 'mann', 'kind', 'stadt', 'land', 'welt', 'geld', 'weg',
])

export function getFrequencyTier(germanWord) {
  const lower = germanWord.toLowerCase()
  if (TIER_1_WORDS.has(lower) || TIER_1_WORDS.has(germanWord)) return 1
  if (TIER_2_WORDS.has(lower) || TIER_2_WORDS.has(germanWord)) return 2
  return 3
}

export function parseDuolingoFormat(rawText) {
  const seen = new Set()
  const result = []

  const blocks = rawText.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length >= 2) {
      const german = lines[0]
      const translation = lines[1]
      const normalizedKey = normalizeGerman(german)
      if (!seen.has(normalizedKey)) {
        seen.add(normalizedKey)
        result.push({ german, translation, normalizedKey })
      }
      continue
    }

    const line = lines[0] || ''
    if (!line) continue

    const tabParts = line.split('\t').map(s => s.trim()).filter(Boolean)
    if (tabParts.length >= 2) {
      const german = tabParts[0]
      const translation = tabParts.slice(1).join(' ')
      const normalizedKey = normalizeGerman(german)
      if (!seen.has(normalizedKey)) {
        seen.add(normalizedKey)
        result.push({ german, translation, normalizedKey })
      }
      continue
    }

    const dashParts = line.split(/\s+[—-]\s+/).map(s => s.trim()).filter(Boolean)
    if (dashParts.length >= 2) {
      const german = dashParts[0]
      const translation = dashParts.slice(1).join(' ')
      const normalizedKey = normalizeGerman(german)
      if (!seen.has(normalizedKey)) {
        seen.add(normalizedKey)
        result.push({ german, translation, normalizedKey })
      }
      continue
    }

    const normalizedKey = normalizeGerman(line)
    if (!seen.has(normalizedKey)) {
      seen.add(normalizedKey)
      result.push({ german: line, translation: '', normalizedKey })
    }
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
