import { callDeepSeek } from './deepseek.js'
import { normalizeGerman, prepareGroupedImportRules } from './wordParser.js'

const BATCH_SIZE = 40

function aiGroupsToImportRows(groups) {
  return (groups || [])
    .map((g) => {
      const lemma = (g.lemma || '').trim()
      if (!lemma) return null
      const nk = normalizeGerman(lemma)
      const vars = (g.variants || [])
        .map((v) => String(v).trim())
        .filter(Boolean)
        .filter((v) => normalizeGerman(v) !== nk)
      const tier = Number(g.frequencyTier)
      const frequencyTier = tier >= 1 && tier <= 3 ? tier : 3
      return {
        german: lemma,
        translation: (g.translation || '').trim() || 'Imported',
        normalizedKey: nk,
        variants: vars,
        frequencyTier,
      }
    })
    .filter(Boolean)
}

async function groupBatch(words, apiKey) {
  console.log('[WordGrouper] Calling DeepSeek for batch of', words.length, 'words')

  const wordLines = words
    .map((w, i) => `${i + 1}. ${w.german} — ${w.translation || ''}`)
    .join('\n')

  const prompt = `You are a German linguistics expert.
I have a list of German words exported from Duolingo.
Duolingo saves every conjugated verb form and gendered noun pair
as a separate entry. Your job is to group them into word families.

Rules:
- Group all conjugations of the same verb under the infinitive
  (e.g., laufe/läufst/läuft/laufen/fährt/fuhr → infinitive family, lemma = infinitive e.g. laufen or fahren)
- Group gendered noun pairs under the masculine/base form
  (e.g., Lehrer/Lehrerin → Lehrer, Arzt/Ärztin → Arzt)
- Group singular/plural pairs under the singular
  (e.g., Gurke/Gurken → Gurke)
- Group inflected adjectives/pronouns under the base form
  (e.g., mein/meine/meinen → mein)
- Keep truly unique words as individual entries (one group each)
- For each group, provide the best single English translation

Return ONLY valid JSON, no explanation, no markdown, in this format:
{
  "groups": [
    {
      "lemma": "laufen",
      "translation": "to run",
      "variants": ["laufe", "läufst", "läuft", "lauft"],
      "frequencyTier": 1
    }
  ]
}

frequencyTier rules:
- 1 = essential (sein, haben, ich, nicht, und, common verbs)
- 2 = high frequency everyday words
- 3 = regular vocabulary

Word list to group:
${wordLines}`

  const response = await callDeepSeek(
    [{ role: 'user', content: prompt }],
    apiKey,
    {
      systemPrompt: 'You are a German linguistics expert. Return only valid JSON.',
      temperature: 0.1,
      maxTokens: 4000,
    }
  )

  try {
    let text = typeof response === 'string' ? response : JSON.stringify(response)

    text = text.replace(/```json\s*/gi, '')
    text = text.replace(/```\s*/gi, '')
    text = text.trim()

    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      text = text.substring(firstBrace, lastBrace + 1)
    }

    console.log('[WordGrouper] Attempting to parse:', text.substring(0, 200))

    const parsed = JSON.parse(text)
    if (!parsed.groups || parsed.groups.length < words.length * 0.5) {
      console.warn(
        '[WordGrouper] Suspiciously few groups returned:',
        parsed.groups?.length,
        'for',
        words.length,
        'words'
      )
    }
    return { groups: parsed.groups || [], parseOk: true }
  } catch (e) {
    console.error('[WordGrouper] Parse failed:', e?.message)
    console.error('[WordGrouper] Full error:', e)
    console.log('[WordGrouper] Raw response was:', response)
    return {
      groups: words.map((w) => ({
        lemma: w.german,
        translation: w.translation || 'Imported',
        variants: [],
        frequencyTier: 3,
      })),
      parseOk: false,
    }
  }
}

/**
 * @param {Array<{german: string, translation?: string}>} wordList
 * @param {string} apiKey
 * @param {{ onBatchProgress?: (current: number, total: number) => void }} [opts]
 */
export async function groupWordFamiliesWithAI(wordList, apiKey, opts = {}) {
  console.log('[WordGrouper] apiKey present:', !!apiKey)
  console.log(
    '[WordGrouper] apiKey value:',
    apiKey ? String(apiKey).substring(0, 8) + '...' : 'MISSING'
  )
  console.log('[WordGrouper] wordList length:', wordList?.length ?? 0)

  const { onBatchProgress } = opts
  const list = wordList.filter((w) => w?.german?.trim())
  if (!list.length) {
    return { groups: [], method: 'rules' }
  }

  if (!apiKey?.trim()) {
    return {
      groups: list.map((w) => ({
        lemma: w.german.trim(),
        translation: (w.translation || '').trim() || 'Imported',
        variants: [],
        frequencyTier: 3,
      })),
      method: 'rules',
    }
  }

  const batches = Math.ceil(list.length / BATCH_SIZE)
  const allGroups = []
  let allBatchesParsedOk = true

  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE)
    const batchIndex = Math.floor(i / BATCH_SIZE) + 1
    onBatchProgress?.(batchIndex, batches)
    const { groups: batchGroups, parseOk } = await groupBatch(batch, apiKey)
    if (!parseOk) allBatchesParsedOk = false
    allGroups.push(...batchGroups)
  }

  return {
    groups: allGroups,
    method: allBatchesParsedOk ? 'ai' : 'rules',
  }
}

/**
 * AI grouping when apiKey is set; otherwise rule-based fallback.
 * @param {Array<{german: string, translation?: string, normalizedKey?: string}>} parsed — output of parseDuolingoFormat
 * @param {string | null | undefined} apiKey
 * @param {{ onBatchProgress?: (current: number, total: number) => void }} [opts]
 */
export async function prepareGroupedImport(parsed, apiKey, opts = {}) {
  const list = parsed.filter((p) => p?.german?.trim())
  if (!list.length) {
    return {
      words: [],
      stats: {
        verbFormsInGroups: 0,
        verbFamilies: 0,
        nounSurfacesInPairs: 0,
        nounPairFamilies: 0,
        rawEntries: 0,
        familyCount: 0,
        method: 'none',
      },
    }
  }

  if (!apiKey?.trim()) {
    const rule = prepareGroupedImportRules(parsed)
    return {
      words: rule.words,
      stats: {
        ...rule.stats,
        rawEntries: list.length,
        familyCount: rule.words.length,
        method: 'rules',
      },
    }
  }

  const wordPairs = list.map((w) => ({
    german: w.german.trim(),
    translation: (w.translation || '').trim() || 'Imported',
  }))

  const { groups, method } = await groupWordFamiliesWithAI(wordPairs, apiKey.trim(), opts)
  const words = aiGroupsToImportRows(groups)
  const familyCount = words.length

  return {
    words,
    stats: {
      verbFormsInGroups: Math.max(0, list.length - familyCount),
      verbFamilies: familyCount,
      nounSurfacesInPairs: 0,
      nounPairFamilies: 0,
      rawEntries: list.length,
      familyCount,
      method,
    },
  }
}
