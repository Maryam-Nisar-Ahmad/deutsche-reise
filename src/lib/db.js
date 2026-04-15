import { openDB } from 'idb'
import { updateCard, readRetentionTarget, isFirmMasteredRow } from './srs.js'
import {
  getFrequencyTier,
  normalizeGerman,
  germanLikenessScore,
  orientGermanEnglishPair,
  germanTextContainsAnySurface,
} from './wordParser.js'
import { extractNormalizedKeysFromText } from './storyMining.js'

const DB_NAME = 'deutsche-reise-db'
const DB_VERSION = 8

/** Words in SRS state `new` only enter Flashcards after this delay from `word.addedAt` (FSRS hygiene). */
export const FLASHCARD_NEW_INTRO_DELAY_MS = 24 * 60 * 60 * 1000

/**
 * @param {object | null} word
 * @param {object | null} card — srs_cards row (optional `flashEligibleAt`)
 * @param {number} [now]
 */
export function isFlashcardNewEligible(word, card, now = Date.now()) {
  const explicit = card?.flashEligibleAt
  if (explicit != null && Number.isFinite(explicit)) {
    return now >= explicit
  }
  const added = Number(word?.addedAt)
  if (!Number.isFinite(added) || added <= 0) return true
  return now >= added + FLASHCARD_NEW_INTRO_DELAY_MS
}

function bootstrapNewSrsCard(wordId, wordAddedAtMs) {
  const added =
    Number(wordAddedAtMs) && Number.isFinite(wordAddedAtMs) ? wordAddedAtMs : Date.now()
  return {
    wordId,
    easeFactor: 2.5,
    interval: 0,
    scheduledDays: 0,
    learningSteps: 0,
    repetitions: 0,
    nextReview: Date.now(),
    lastReview: null,
    lapses: 0,
    state: 'new',
    totalReviews: 0,
    stability: 0,
    difficulty: 5,
    flashEligibleAt: added + FLASHCARD_NEW_INTRO_DELAY_MS,
  }
}

let dbPromise = null

export function initDB() {
  if (dbPromise) return dbPromise
  dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      // Words store
      if (!db.objectStoreNames.contains('words')) {
        const wordStore = db.createObjectStore('words', { keyPath: 'id', autoIncrement: true })
        wordStore.createIndex('normalizedKey', 'normalizedKey', { unique: true })
      }

      // SRS cards store
      if (!db.objectStoreNames.contains('srs_cards')) {
        const cardStore = db.createObjectStore('srs_cards', { keyPath: 'wordId' })
        cardStore.createIndex('nextReview', 'nextReview')
        cardStore.createIndex('state', 'state')
      }

      // Stories store
      if (!db.objectStoreNames.contains('stories')) {
        db.createObjectStore('stories', { keyPath: 'id', autoIncrement: true })
      }

      // Grammar sessions store
      if (!db.objectStoreNames.contains('grammar_sessions')) {
        db.createObjectStore('grammar_sessions', { keyPath: 'id', autoIncrement: true })
      }

      // Daily sessions store
      if (!db.objectStoreNames.contains('daily_sessions')) {
        db.createObjectStore('daily_sessions', { keyPath: 'date' })
      }

      if (oldVersion < 2 && !db.objectStoreNames.contains('frequency_status')) {
        db.createObjectStore('frequency_status', { keyPath: 'rank' })
      }
      if (oldVersion < 3 && !db.objectStoreNames.contains('frequency_gloss')) {
        db.createObjectStore('frequency_gloss', { keyPath: 'rank' })
      }
      if (oldVersion < 4 && !db.objectStoreNames.contains('frequency_lesson')) {
        db.createObjectStore('frequency_lesson', { keyPath: 'rank' })
      }

      // Strip fill-in-the-blank cloze payloads from all words (feature removed from flashcards).
      if (oldVersion < 5 && transaction && db.objectStoreNames.contains('words')) {
        const store = transaction.objectStore('words')
        store.openCursor().onsuccess = (ev) => {
          const cursor = ev.target.result
          if (!cursor) return
          const w = cursor.value
          if (Array.isArray(w.storyClozes) && w.storyClozes.length > 0) {
            cursor.update({ ...w, storyClozes: [] })
          }
          cursor.continue()
        }
      }

      // FSRS: persist scheduledDays + learningSteps; normalize new-card due times.
      if (oldVersion < 6 && transaction && db.objectStoreNames.contains('srs_cards')) {
        const store = transaction.objectStore('srs_cards')
        store.openCursor().onsuccess = (ev) => {
          const cursor = ev.target.result
          if (!cursor) return
          const c = cursor.value
          const patch = {
            ...c,
            learningSteps: c.learningSteps ?? 0,
            scheduledDays: c.scheduledDays ?? c.interval ?? 0,
          }
          if (c.state === 'new') {
            patch.nextReview = Date.now()
          }
          cursor.update(patch)
          cursor.continue()
        }
      }

      // v7 first shipped this behind `oldVersion < 7` — browsers already at v7 skipped creation.
      // v8: create whenever missing (safe no-op if present).
      if (!db.objectStoreNames.contains('frequency_review_stories')) {
        const frs = db.createObjectStore('frequency_review_stories', { keyPath: 'id', autoIncrement: true })
        frs.createIndex('createdAt', 'createdAt')
      }
    }
  })
  return dbPromise.then((db) => {
    console.log('[DB] initDB resolved successfully')
    return db
  })
}

async function getDB() {
  return initDB()
}

async function safeGetAll(db, store, context = 'unknown') {
  try {
    return await db.getAll(store)
  } catch (error) {
    console.error(`[DB] getAll failed (${store}) in ${context}`, error)
    return []
  }
}

async function safeGet(db, store, key, context = 'unknown') {
  try {
    return await db.get(store, key)
  } catch (error) {
    console.error(`[DB] get failed (${store}) in ${context}`, error)
    return null
  }
}

async function safePut(db, store, value, context = 'unknown') {
  try {
    return await db.put(store, value)
  } catch (error) {
    console.error(`[DB] put failed (${store}) in ${context}`, error)
    return null
  }
}

// ─── Words ────────────────────────────────────────────────────────────────────

export async function importWords(wordsArray, meta = {}) {
  const db = await getDB()
  let added = 0, skipped = 0

  for (const word of wordsArray) {
    if (!word?.german?.trim()) continue
    try {
      const tx = db.transaction(['words', 'srs_cards'], 'readwrite')
      const wordStore = tx.objectStore('words')
      const cardStore = tx.objectStore('srs_cards')

      const existing = await wordStore.index('normalizedKey').get(word.normalizedKey)
      if (existing) {
        skipped++
        await tx.done
        continue
      }

      const tier = word.frequencyTier ?? getFrequencyTier(word.german)
      const variants = Array.isArray(word.variants) ? word.variants : []

      const addedAt = Date.now()
      const wordData = {
        german: word.german,
        translation: (word.translation || '').trim() || 'Imported',
        normalizedKey: word.normalizedKey,
        addedAt,
        source: word.source || 'import',
        learnSource: word.learnSource || null,
        frequencyRank: word.frequencyRank ?? null,
        gender: null,
        plural: null,
        example: word.example || null,
        variants,
        frequencyTier: tier,
        encounterCount: 0,
        storyClozes: [],
      }
      const wordId = await wordStore.add(wordData)

      await cardStore.add(bootstrapNewSrsCard(wordId, addedAt))

      await tx.done
      added++
    } catch (e) {
      if (e.name === 'ConstraintError') {
        skipped++
      }
    }
  }

  return {
    added,
    skipped,
    existing: skipped,
    newAdded: added,
    groupingStats: meta.groupingStats || null,
  }
}

export async function addWord(german, translation) {
  const db = await getDB()
  const normalizedKey = german.trim().toLowerCase().replace(/\s+/g, ' ')

  const tx = db.transaction(['words', 'srs_cards'], 'readwrite')
  const wordStore = tx.objectStore('words')
  const cardStore = tx.objectStore('srs_cards')

  const existing = await wordStore.index('normalizedKey').get(normalizedKey)
  if (existing) {
    await tx.done
    return { wordId: existing.id, alreadyExists: true }
  }

  const addedAt = Date.now()
  const wordId = await wordStore.add({
    german: german.trim(),
    translation: translation.trim(),
    normalizedKey,
    addedAt,
    source: 'manual',
    learnSource: null,
    frequencyRank: null,
    gender: null,
    plural: null,
    example: null,
    variants: [],
    frequencyTier: getFrequencyTier(german.trim()),
    encounterCount: 0,
    storyClozes: [],
  })

  await cardStore.add(bootstrapNewSrsCard(wordId, addedAt))

  await tx.done
  return { wordId, alreadyExists: false }
}

/**
 * Add a word from the frequency curriculum (prioritized in getNewCards).
 * @param {string} german
 * @param {string} translation
 * @param {number} frequencyRank
 * @param {{ example?: string }} [options]
 */
export async function addWordFromFrequency(german, translation, frequencyRank, options = {}) {
  const db = await getDB()
  const g = String(german || '').trim()
  if (!g) return { wordId: null, alreadyExists: true, error: 'empty' }
  const normalizedKey = normalizeGerman(g)

  const tx = db.transaction(['words', 'srs_cards'], 'readwrite')
  const wordStore = tx.objectStore('words')
  const cardStore = tx.objectStore('srs_cards')

  const existing = await wordStore.index('normalizedKey').get(normalizedKey)
  if (existing) {
    await tx.done
    return { wordId: existing.id, alreadyExists: true }
  }

  const addedAt = Date.now()
  const wordId = await wordStore.add({
    german: g,
    translation: (translation || '').trim() || 'Imported',
    normalizedKey,
    addedAt,
    source: 'frequency',
    learnSource: 'frequency',
    frequencyRank: frequencyRank ?? null,
    gender: null,
    plural: null,
    example: options.example || null,
    variants: [],
    frequencyTier: Math.min(2, getFrequencyTier(g) || 1),
    encounterCount: 0,
    storyClozes: [],
  })

  await cardStore.add(bootstrapNewSrsCard(wordId, addedAt))

  await tx.done
  return { wordId, alreadyExists: false }
}

/**
 * Add a word saved from Story Studio (lemma + cached micro-lesson on the word row).
 * Same SRS card bootstrap as Frequency Lab imports.
 */
export async function addWordFromStory(german, translation, options = {}) {
  const db = await getDB()
  const g = String(german || '').trim()
  if (!g) return { wordId: null, alreadyExists: true, error: 'empty' }
  const normalizedKey = normalizeGerman(g)

  const tx = db.transaction(['words', 'srs_cards'], 'readwrite')
  const wordStore = tx.objectStore('words')
  const cardStore = tx.objectStore('srs_cards')

  const existing = await wordStore.index('normalizedKey').get(normalizedKey)
  if (existing) {
    await tx.done
    return { wordId: existing.id, alreadyExists: true }
  }

  const rawLesson = options.microLesson && typeof options.microLesson === 'object' ? options.microLesson : null
  const microLesson = rawLesson
    ? {
        glossShort: String(rawLesson.glossShort || '').trim().slice(0, 240),
        fullMeaning: String(rawLesson.fullMeaning || '').trim().slice(0, 2500),
        sentences: Array.isArray(rawLesson.sentences)
          ? rawLesson.sentences
              .slice(0, 8)
              .map((s) => ({
                de: String(s?.de || '').trim(),
                en: String(s?.en || '').trim(),
              }))
              .filter((s) => s.de)
          : [],
        storyDe: String(rawLesson.storyDe || '').trim(),
        storyEn: String(rawLesson.storyEn || '').trim(),
      }
    : null

  const variantsRaw = Array.isArray(options.variants) ? options.variants : []
  const variants = [...new Set(variantsRaw.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 12)

  const addedAt = Date.now()
  const wordId = await wordStore.add({
    german: g,
    translation: (translation || '').trim() || 'Imported',
    normalizedKey,
    addedAt,
    source: 'story',
    learnSource: 'story',
    frequencyRank: null,
    gender: null,
    plural: null,
    example: options.example || null,
    variants,
    frequencyTier: Math.min(2, getFrequencyTier(g) || 1),
    encounterCount: 0,
    storyClozes: [],
    microLesson,
  })

  await cardStore.add(bootstrapNewSrsCard(wordId, addedAt))

  await tx.done
  return { wordId, alreadyExists: false }
}

// ─── Frequency list (AI match cache) ─────────────────────────────────────────

export async function getFrequencyStatus(rank) {
  const db = await getDB()
  return safeGet(db, 'frequency_status', rank, 'getFrequencyStatus')
}

export async function putFrequencyStatus(rank, payload) {
  const db = await getDB()
  await safePut(
    db,
    'frequency_status',
    {
      rank,
      status: payload.status,
      note: payload.note || '',
      updatedAt: Date.now(),
    },
    'putFrequencyStatus'
  )
}

export async function putFrequencyStatusesBatch(entries) {
  const db = await getDB()
  for (const e of entries) {
    if (e == null || e.rank == null) continue
    await safePut(
      db,
      'frequency_status',
      {
        rank: e.rank,
        status: e.status,
        note: e.note || '',
        updatedAt: Date.now(),
      },
      'putFrequencyStatusesBatch'
    )
  }
}

export async function getAllFrequencyStatuses() {
  const db = await getDB()
  return safeGetAll(db, 'frequency_status', 'getAllFrequencyStatuses')
}

/** Cached short English gloss for a frequency rank (AI-polished). */
export async function getFrequencyGloss(rank) {
  const db = await getDB()
  return safeGet(db, 'frequency_gloss', rank, 'getFrequencyGloss')
}

export async function putFrequencyGlossesBatch(rows) {
  const db = await getDB()
  for (const r of rows || []) {
    if (r == null || r.rank == null) continue
    const glossEn = String(r.glossEn || '').trim().slice(0, 240)
    if (!glossEn) continue
    await safePut(
      db,
      'frequency_gloss',
      { rank: r.rank, glossEn, updatedAt: Date.now() },
      'putFrequencyGlossesBatch'
    )
  }
}

/** Cached AI micro-lesson (story + sentences) for a frequency rank. */
export async function getFrequencyLesson(rank) {
  const db = await getDB()
  return safeGet(db, 'frequency_lesson', rank, 'getFrequencyLesson')
}

export async function putFrequencyLesson(rank, lesson) {
  const db = await getDB()
  if (rank == null || !lesson || typeof lesson !== 'object') return
  await safePut(
    db,
    'frequency_lesson',
    { rank, lesson, updatedAt: Date.now() },
    'putFrequencyLesson'
  )
}

const FLASHCARD_EXAMPLE_MAX = 2

/**
 * Up to FLASHCARD_EXAMPLE_MAX pairs: prefer sentences where lemma/variants appear as whole words,
 * then fill remaining slots from other lesson lines (same lesson is lemma-specific; AI often
 * uses only inflected forms). Dedupe by German sentence text.
 */
function flashcardExamplePairsFromSentences(sentences, surfaces) {
  if (!Array.isArray(sentences) || !sentences.length) return []
  const surf = [...new Set((surfaces || []).map((x) => String(x || '').trim()).filter(Boolean))]
  const seenDe = new Set()
  const out = []

  const pushPair = (de, en) => {
    if (!de || seenDe.has(de)) return
    seenDe.add(de)
    out.push({ de, en: en || '' })
  }

  for (const s of sentences) {
    const de = String(s?.de || '').trim()
    const en = String(s?.en || '').trim()
    if (!de) continue
    if (surf.length && !germanTextContainsAnySurface(de, surf)) continue
    pushPair(de, en)
    if (out.length >= FLASHCARD_EXAMPLE_MAX) return out
  }

  for (const s of sentences) {
    const de = String(s?.de || '').trim()
    const en = String(s?.en || '').trim()
    if (!de) continue
    pushPair(de, en)
    if (out.length >= FLASHCARD_EXAMPLE_MAX) return out
  }
  return out
}

/**
 * Up to two { de, en } pairs from Story micro-lesson on the word row, else cached Frequency Lab lesson for rank.
 * Used on flashcard backs for context beyond a one-line gloss.
 */
export async function getFlashcardExamplePairs(word) {
  if (!word) return []
  const surfaces = [word.german, ...(Array.isArray(word.variants) ? word.variants : [])]

  const micro = word.microLesson
  if (micro && typeof micro === 'object' && Array.isArray(micro.sentences) && micro.sentences.length) {
    const pairs = flashcardExamplePairsFromSentences(micro.sentences, surfaces)
    if (pairs.length) return pairs
  }

  const rank = word.frequencyRank
  if (rank == null || !Number.isFinite(Number(rank))) return []
  try {
    const row = await getFrequencyLesson(Number(rank))
    const sents = row?.lesson?.sentences
    if (!Array.isArray(sents) || !sents.length) return []
    return flashcardExamplePairsFromSentences(sents, surfaces)
  } catch {
    return []
  }
}

/** Attach flashExamples to each SRS card before a review session (IndexedDB reads in parallel). */
export async function attachFlashExamplesToCards(cards) {
  if (!Array.isArray(cards) || !cards.length) return []
  return Promise.all(
    cards.map(async (c) => ({
      ...c,
      flashExamples: await getFlashcardExamplePairs(c.word),
    }))
  )
}

/** Normalized keys + variants for vault (frequency matching). */
export function buildVaultKeySet(words) {
  const set = new Set()
  for (const w of words || []) {
    set.add(normalizeGerman(w.german))
    for (const v of w.variants || []) {
      set.add(normalizeGerman(v))
    }
  }
  return set
}

export async function getWordsFromFrequencySource() {
  const words = await getAllWords()
  return words.filter(
    (w) =>
      w.learnSource === 'frequency' ||
      w.source === 'frequency' ||
      w.learnSource === 'story' ||
      w.source === 'story'
  )
}

export async function getAllWords() {
  const db = await getDB()
  return safeGetAll(db, 'words', 'getAllWords')
}

export async function getWordCount() {
  const db = await getDB()
  return db.count('words')
}

/**
 * Firm mastery for CEFR / B2 progress: FSRS `review` + stability + enough reps
 * (not a single lucky recall right after the first short interval).
 */
export async function getMasteredWordCount() {
  const db = await getDB()
  const all = await safeGetAll(db, 'srs_cards', 'getMasteredWordCount')
  return all.filter(isFirmMasteredRow).length
}

/** Graduated to FSRS review stage (may still be early in spacing). */
export async function getReviewStageCount() {
  const db = await getDB()
  const all = await safeGetAll(db, 'srs_cards', 'getReviewStageCount')
  return all.filter((c) => c.state === 'review').length
}

export async function deleteWord(id) {
  const db = await getDB()
  const tx = db.transaction(['words', 'srs_cards'], 'readwrite')
  await tx.objectStore('words').delete(id)
  await tx.objectStore('srs_cards').delete(id)
  await tx.done
}

/**
 * Merge existing IndexedDB words using AI `groups` (lemma + variants + translation + tier).
 * Keeps one card per family (lemma match preferred, else best SRS repetitions / totalReviews).
 */
export async function applyAIFamilyMerge(aiGroups) {
  const db = await getDB()
  let wordsSnapshot = await safeGetAll(db, 'words', 'applyAIFamilyMerge')
  const beforeCount = wordsSnapshot.length
  const cards = await safeGetAll(db, 'srs_cards', 'applyAIFamilyMerge')
  const cardByWordId = new Map(cards.map((c) => [c.wordId, c]))

  let groupsTouched = 0
  let deletedTotal = 0

  const list = Array.isArray(aiGroups) ? aiGroups : []

  for (const g of list) {
    const lemma = (g.lemma || '').trim()
    if (!lemma) continue
    const translation = (g.translation || '').trim() || 'Imported'
    const rawVariants = Array.isArray(g.variants) ? g.variants : []
    const tier = Number(g.frequencyTier)
    const frequencyTier = tier >= 1 && tier <= 3 ? tier : 3

    const nkLemma = normalizeGerman(lemma)
    const surfaceKeys = new Set([nkLemma, ...rawVariants.map((v) => normalizeGerman(String(v).trim())).filter(Boolean)])

    const matches = wordsSnapshot.filter((w) => surfaceKeys.has(normalizeGerman(w.german)))
    if (matches.length === 0) continue

    const lemmaLower = lemma.toLowerCase()
    let keeper =
      matches.find((w) => w.german.trim().toLowerCase() === lemmaLower) ||
      [...matches].sort((a, b) => {
        const ca = cardByWordId.get(a.id) || { repetitions: 0, totalReviews: 0 }
        const cb = cardByWordId.get(b.id) || { repetitions: 0, totalReviews: 0 }
        if (cb.repetitions !== ca.repetitions) return cb.repetitions - ca.repetitions
        return (cb.totalReviews || 0) - (ca.totalReviews || 0)
      })[0]

    const dupIds = matches.filter((w) => w.id !== keeper.id).map((w) => w.id)

    const variantSet = new Set()
    for (const w of matches) {
      const surf = w.german.trim()
      if (normalizeGerman(surf) !== nkLemma) variantSet.add(surf)
    }
    for (const v of rawVariants) {
      const t = String(v).trim()
      if (t && normalizeGerman(t) !== nkLemma) variantSet.add(t)
    }
    const variantList = [...variantSet].sort((a, b) => a.localeCompare(b, 'de'))

    for (const id of dupIds) {
      await deleteWord(id)
      deletedTotal++
      cardByWordId.delete(id)
    }

    wordsSnapshot = wordsSnapshot.filter((w) => !dupIds.includes(w.id))

    const updatedWord = {
      ...keeper,
      german: lemma,
      translation,
      normalizedKey: nkLemma,
      variants: variantList,
      frequencyTier,
      storyClozes: [],
    }
    await safePut(db, 'words', updatedWord, 'applyAIFamilyMerge')

    const ki = wordsSnapshot.findIndex((w) => w.id === keeper.id)
    if (ki >= 0) wordsSnapshot[ki] = updatedWord

    groupsTouched++
  }

  const afterCount = wordsSnapshot.length

  return {
    beforeCount,
    afterCount,
    removedDuplicates: deletedTotal,
    groupsTouched,
  }
}

export async function updateWord(id, updates) {
  const db = await getDB()
  const word = await safeGet(db, 'words', id, 'updateWord')
  if (!word) return
  await safePut(db, 'words', { ...word, ...updates }, 'updateWord')
}

/**
 * Fix entries where English was stored as `german` (common with Duolingo EN-first exports).
 * Swaps fields when the translation line is clearly more German than the german field.
 */
export async function fixSwappedGermanEnglishInDB() {
  const words = await getAllWords()
  const db = await getDB()
  let fixed = 0
  for (const w of words) {
    const g = (w.german || '').trim()
    const t = (w.translation || '').trim()
    if (!g || !t) continue
    if (germanLikenessScore(t) <= germanLikenessScore(g) + 1) continue
    const { german: ng, translation: nt } = orientGermanEnglishPair(g, t)
    if (ng === g && nt === t) continue
    await safePut(
      db,
      'words',
      {
        ...w,
        german: ng,
        translation: nt,
        normalizedKey: normalizeGerman(ng),
      },
      'fixSwappedGermanEnglish'
    )
    fixed++
  }
  return { fixed, checked: words.length }
}

// ─── SRS Cards ────────────────────────────────────────────────────────────────

export async function getDueCards(limit = 20) {
  const db = await getDB()
  const now = Date.now()
  const cards = await db.getAllFromIndex('srs_cards', 'nextReview')
  const due = cards.filter(c => c.nextReview <= now && c.state !== 'new')
  const result = []
  for (const card of due.slice(0, limit)) {
    const word = await safeGet(db, 'words', card.wordId, 'getDueCards')
    if (word) result.push({ ...card, word })
  }
  return result
}

export async function getNewCards(limit = 15) {
  const db = await getDB()
  const now = Date.now()
  const cards = await db.getAllFromIndex('srs_cards', 'state')
  const newCards = cards.filter(c => c.state === 'new')
  const withWords = []
  for (const card of newCards) {
    const word = await safeGet(db, 'words', card.wordId, 'getNewCards')
    if (word && isFlashcardNewEligible(word, card, now)) withWords.push({ ...card, word })
  }
  // Oldest eligible first — avoids rushing the same “just saved” items once the 24h gate opens.
  withWords.sort((a, b) => (a.word.addedAt || 0) - (b.word.addedAt || 0))
  return withWords.slice(0, limit)
}

export async function updateCardAfterReview(wordId, rating) {
  const db = await getDB()
  const card = await safeGet(db, 'srs_cards', wordId, 'updateCardAfterReview')
  if (!card) return
  const normalized = {
    ...card,
    stability: card.stability ?? 0,
    difficulty: card.difficulty ?? 5,
    scheduledDays: card.scheduledDays ?? card.interval ?? 0,
    learningSteps: card.learningSteps ?? 0,
  }
  const updated = updateCard(normalized, rating, { retentionTarget: readRetentionTarget() })
  await safePut(db, 'srs_cards', updated, 'updateCardAfterReview')
}

/**
 * Count one contextual encounter per vocabulary word in this chapter (once per chapter per story).
 */
export async function recordStoryChapterEncounters(storyId, chapterIndex, chapterText) {
  const story = await getStory(storyId)
  if (!story) return { bumped: 0, skipped: true }
  const counted = Array.isArray(story.encounterCountedChapters) ? story.encounterCountedChapters : []
  if (counted.includes(chapterIndex)) return { bumped: 0, skipped: true }

  const keys = extractNormalizedKeysFromText(chapterText)
  const words = await getAllWords()
  const byKey = new Map(words.map((w) => [w.normalizedKey, w]))
  const db = await getDB()
  let bumped = 0
  for (const k of keys) {
    const w = byKey.get(k)
    if (!w) continue
    const next = (w.encounterCount || 0) + 1
    await safePut(db, 'words', { ...w, encounterCount: next }, 'recordEncounters')
    byKey.set(k, { ...w, encounterCount: next })
    bumped++
  }
  await updateStoryRecord(storyId, {
    encounterCountedChapters: [...counted, chapterIndex],
  })
  return { bumped, skipped: false }
}

export async function getCardStats() {
  const db = await getDB()
  const now = Date.now()
  const [all, words] = await Promise.all([
    safeGetAll(db, 'srs_cards', 'getCardStats'),
    safeGetAll(db, 'words', 'getCardStats'),
  ])
  const wordById = new Map(words.map((w) => [w.id, w]))
  let newEligible = 0
  for (const c of all) {
    if (c.state !== 'new') continue
    const w = wordById.get(c.wordId)
    if (isFlashcardNewEligible(w, c, now)) newEligible++
  }
  return {
    due: all.filter(c => c.nextReview <= now && c.state !== 'new').length,
    new: newEligible,
    learning: all.filter(c => c.state === 'learning').length,
    review: all.filter(c => c.state === 'review').length,
    relearning: all.filter(c => c.state === 'relearning').length,
    total: all.length,
  }
}

export async function getCardForWord(wordId) {
  const db = await getDB()
  const card = await safeGet(db, 'srs_cards', wordId, 'getCardForWord')
  if (!card) return null
  return {
    ...card,
    stability: card.stability ?? 0,
    difficulty: card.difficulty ?? 5,
    scheduledDays: card.scheduledDays ?? card.interval ?? 0,
    learningSteps: card.learningSteps ?? 0,
  }
}

// ─── Stories ──────────────────────────────────────────────────────────────────

export async function saveStory(storyData) {
  const db = await getDB()
  return db.add('stories', {
    ...storyData,
    createdAt: Date.now(),
    lastRead: null,
    readCount: 0,
    currentChapter: 0,
  })
}

export async function getAllStories() {
  const db = await getDB()
  const stories = await safeGetAll(db, 'stories', 'getAllStories')
  return stories.sort((a, b) => b.createdAt - a.createdAt)
}

export async function getStory(id) {
  const db = await getDB()
  return safeGet(db, 'stories', id, 'getStory')
}

export async function updateStoryProgress(id, currentChapter) {
  const db = await getDB()
  const story = await safeGet(db, 'stories', id, 'updateStoryProgress')
  if (!story) return
  await safePut(db, 'stories', {
    ...story,
    currentChapter,
    lastRead: Date.now(),
    readCount: (story.readCount || 0) + 1,
  }, 'updateStoryProgress')
}

export async function deleteStory(id) {
  const db = await getDB()
  return db.delete('stories', id)
}

export async function updateStoryRecord(id, patch) {
  const db = await getDB()
  const prev = await safeGet(db, 'stories', id, 'updateStoryRecord')
  if (!prev) return
  await safePut(db, 'stories', { ...prev, ...patch, id: prev.id }, 'updateStoryRecord')
}

// ─── Frequency Lab review stories (persist last 4) ───────────────────────────

const FREQ_REVIEW_ARCHIVE_KEY = 'dr_freq_review_story_archive_v1'

function readFreqReviewArchiveFallback() {
  try {
    const raw = localStorage.getItem(FREQ_REVIEW_ARCHIVE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((r, idx) => ({
        id: r.id ?? `ls-${idx}-${r.createdAt || 0}`,
        createdAt: Number(r.createdAt) || 0,
        titleDe: String(r.titleDe || ''),
        storyDe: String(r.storyDe || ''),
        storyEn: String(r.storyEn || ''),
        focusLemmas: Array.isArray(r.focusLemmas) ? r.focusLemmas : [],
        focusCount: Number(r.focusCount) || 0,
        glueCount: Number(r.glueCount) || 0,
        tokenGlosses: r.tokenGlosses && typeof r.tokenGlosses === 'object' ? r.tokenGlosses : {},
      }))
      .filter((r) => r.storyDe)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 4)
  } catch {
    return []
  }
}

function writeFreqReviewArchiveFallback(rows) {
  try {
    localStorage.setItem(FREQ_REVIEW_ARCHIVE_KEY, JSON.stringify((rows || []).slice(0, 4)))
  } catch {
    /* ignore */
  }
}

export async function saveFrequencyReviewStory(payload) {
  const row = {
    id: payload.id || `frs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    titleDe: String(payload.titleDe || '').trim().slice(0, 200),
    storyDe: String(payload.storyDe || '').trim(),
    storyEn: String(payload.storyEn || '').trim(),
    focusLemmas: Array.isArray(payload.focusLemmas) ? payload.focusLemmas : [],
    focusCount: Number(payload.focusCount) || 0,
    glueCount: Number(payload.glueCount) || 0,
    tokenGlosses: payload.tokenGlosses && typeof payload.tokenGlosses === 'object' ? payload.tokenGlosses : {},
  }
  const currentFallback = readFreqReviewArchiveFallback()
  writeFreqReviewArchiveFallback([row, ...currentFallback])

  try {
    const db = await getDB()
    if (!db.objectStoreNames.contains('frequency_review_stories')) {
      return
    }
    await db.add('frequency_review_stories', row)
    const all = await safeGetAll(db, 'frequency_review_stories', 'saveFrequencyReviewStory')
    all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    for (let i = 4; i < all.length; i++) {
      await db.delete('frequency_review_stories', all[i].id)
    }
  } catch (e) {
    console.warn('[DB] frequency_review_stories write failed; fallback kept', e)
  }
}

export async function getFrequencyReviewStories() {
  const fallback = readFreqReviewArchiveFallback()
  try {
    const db = await getDB()
    if (!db.objectStoreNames.contains('frequency_review_stories')) {
      return fallback
    }
    const all = await safeGetAll(db, 'frequency_review_stories', 'getFrequencyReviewStories')
    const sorted = all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 4)
    if (sorted.length) {
      writeFreqReviewArchiveFallback(sorted)
      return sorted
    }
    return fallback
  } catch (e) {
    console.warn('[DB] frequency_review_stories read failed; using fallback', e)
    return fallback
  }
}

// ─── Daily Sessions ───────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

const DEFAULT_DAILY_SESSION = {
  flashcardsReviewed: 0,
  newWordsLearned: 0,
  frequencyWordsLearned: 0,
  storiesRead: 0,
  grammarExercises: 0,
  shadowingMinutes: 0,
  productionSubmissions: 0,
  passiveMinutes: 0,
  xpEarned: 0,
  minutesStudied: 0,
  /** Cumulative seconds with tab visible and recent activity (global study clock). */
  appActiveSeconds: 0,
  /** Engaged-tab seconds attributed to the current route (subset of appActiveSeconds after tracking exists). */
  flashcardsEngagedSeconds: 0,
  frequencyEngagedSeconds: 0,
  storyEngagedSeconds: 0,
  grammarEngagedSeconds: 0,
  speakEngagedSeconds: 0,
  vocabEngagedSeconds: 0,
  dashEngagedSeconds: 0,
  otherEngagedSeconds: 0,
  flashcardsMinutes: 0,
  storyReadMinutes: 0,
  storyListenMinutes: 0,
  storyShadowMinutes: 0,
  grammarMinutes: 0,
  vocabMinutes: 0,
  speakMinutes: 0,
  frequencyMinutes: 0,
}

export async function getTodaySession() {
  const db = await getDB()
  const today = todayStr()
  const session = await safeGet(db, 'daily_sessions', today, 'getTodaySession')
  if (!session) return { date: today, ...DEFAULT_DAILY_SESSION }
  return { date: today, ...DEFAULT_DAILY_SESSION, ...session }
}

/** Daily session row for a calendar date (YYYY-MM-DD), same shape as getTodaySession. */
export async function getDailySessionByDate(dateStr) {
  const db = await getDB()
  const key = String(dateStr || '').trim().slice(0, 10) || todayStr()
  const session = await safeGet(db, 'daily_sessions', key, 'getDailySessionByDate')
  if (!session) return { date: key, ...DEFAULT_DAILY_SESSION }
  return { date: key, ...DEFAULT_DAILY_SESSION, ...session }
}

const TIMER_FIELD_BY_PAGE_KEY = {
  flashcards: 'flashcardsMinutes',
  story_read: 'storyReadMinutes',
  story_listen: 'storyListenMinutes',
  story_shadow: 'storyShadowMinutes',
  grammar: 'grammarMinutes',
  vocab: 'vocabMinutes',
  speak: 'speakMinutes',
  frequency: 'frequencyMinutes',
}

/** Add whole minutes to today's session for a study page (manual timer Stop & Save). */
export async function addTimerMinutesToSession(pageKey, minutes) {
  const field = TIMER_FIELD_BY_PAGE_KEY[pageKey]
  if (!field || minutes <= 0) return
  const session = await getTodaySession()
  await updateTodaySession({ [field]: (session[field] || 0) + minutes })
}

const ENGAGED_ROUTE_TO_FIELD = {
  flashcards: 'flashcardsEngagedSeconds',
  frequency: 'frequencyEngagedSeconds',
  story: 'storyEngagedSeconds',
  grammar: 'grammarEngagedSeconds',
  speak: 'speakEngagedSeconds',
  vocab: 'vocabEngagedSeconds',
  dashboard: 'dashEngagedSeconds',
  other: 'otherEngagedSeconds',
}

/** Map React Router pathname to a bucket for engaged-time attribution. */
export function pathnameToEngagedRouteKey(pathname) {
  const p = String(pathname || '')
  if (p === '/' || p === '') return 'dashboard'
  if (p.startsWith('/flashcards')) return 'flashcards'
  if (p.startsWith('/frequency')) return 'frequency'
  if (p.startsWith('/story')) return 'story'
  if (p.startsWith('/grammar')) return 'grammar'
  if (p.startsWith('/speak')) return 'speak'
  if (p.startsWith('/vocab')) return 'vocab'
  return 'other'
}

/** Global “time in app while engaged” — increments from the header clock; also credits the active screen. */
export async function addAppActiveSeconds(seconds, routeKey = 'other') {
  if (seconds <= 0) return
  const field = ENGAGED_ROUTE_TO_FIELD[routeKey] || ENGAGED_ROUTE_TO_FIELD.other
  const session = await getTodaySession()
  await updateTodaySession({
    appActiveSeconds: (session.appActiveSeconds || 0) + seconds,
    [field]: (session[field] || 0) + seconds,
  })
}

export function getAppActiveMinutesFromSession(session) {
  if (!session) return 0
  return Math.floor((session.appActiveSeconds || 0) / 60)
}

/** Legacy per-page manual timers (mostly unused after global clock). */
export function sumStudyMinutesFromSession(session) {
  if (!session) return 0
  return (
    (session.flashcardsMinutes || 0) +
    (session.storyReadMinutes || 0) +
    (session.storyListenMinutes || 0) +
    (session.storyShadowMinutes || 0) +
    (session.grammarMinutes || 0) +
    (session.vocabMinutes || 0) +
    (session.speakMinutes || 0) +
    (session.frequencyMinutes || 0)
  )
}

/** Primary “how long was I in the app today” number for the dashboard. */
export function getTotalTrackedMinutesToday(session) {
  return getAppActiveMinutesFromSession(session) + sumStudyMinutesFromSession(session)
}

function engagedMinutesFromSeconds(sec) {
  return (Number(sec) || 0) / 60
}

/**
 * Per-area study minutes for a day (history tooltips): manual timers + engaged time on that screen.
 * Each row includes `pct` = share of getTotalTrackedMinutesToday (0–100, one decimal).
 */
export function getSessionStudyBreakdown(session) {
  if (!session) return []
  const totalMin = getTotalTrackedMinutesToday(session)

  const appTotalMin = (session.appActiveSeconds || 0) / 60
  const routedSumMin =
    engagedMinutesFromSeconds(session.flashcardsEngagedSeconds) +
    engagedMinutesFromSeconds(session.frequencyEngagedSeconds) +
    engagedMinutesFromSeconds(session.storyEngagedSeconds) +
    engagedMinutesFromSeconds(session.grammarEngagedSeconds) +
    engagedMinutesFromSeconds(session.speakEngagedSeconds) +
    engagedMinutesFromSeconds(session.vocabEngagedSeconds) +
    engagedMinutesFromSeconds(session.dashEngagedSeconds) +
    engagedMinutesFromSeconds(session.otherEngagedSeconds)
  const unattributedEngagedMin = Math.max(0, appTotalMin - routedSumMin)

  const raw = [
    {
      label: 'Flashcards',
      minutes: (session.flashcardsMinutes || 0) + engagedMinutesFromSeconds(session.flashcardsEngagedSeconds),
    },
    {
      label: 'Frequency Lab',
      minutes: (session.frequencyMinutes || 0) + engagedMinutesFromSeconds(session.frequencyEngagedSeconds),
    },
    {
      label: 'Story Studio',
      minutes:
        (session.storyReadMinutes || 0) +
        (session.storyListenMinutes || 0) +
        (session.storyShadowMinutes || 0) +
        engagedMinutesFromSeconds(session.storyEngagedSeconds),
    },
    {
      label: 'Grammar Gym',
      minutes: (session.grammarMinutes || 0) + engagedMinutesFromSeconds(session.grammarEngagedSeconds),
    },
    {
      label: 'Speak & Write',
      minutes: (session.speakMinutes || 0) + engagedMinutesFromSeconds(session.speakEngagedSeconds),
    },
    {
      label: 'Vocab Vault',
      minutes: (session.vocabMinutes || 0) + engagedMinutesFromSeconds(session.vocabEngagedSeconds),
    },
    {
      label: 'Dashboard',
      minutes: engagedMinutesFromSeconds(session.dashEngagedSeconds),
    },
    {
      label: 'Other screens',
      minutes: engagedMinutesFromSeconds(session.otherEngagedSeconds),
    },
  ]
  if (unattributedEngagedMin > 0.05) {
    raw.push({
      label: 'Engaged (before per-page tracking)',
      minutes: unattributedEngagedMin,
    })
  }

  const filtered = raw.filter((r) => r.minutes > 0.0001).sort((a, b) => b.minutes - a.minutes)
  if (totalMin <= 0) {
    return filtered.map((r) => ({ ...r, pct: 0 }))
  }
  return filtered.map((r) => ({
    ...r,
    pct: Math.min(100, Math.round((r.minutes / totalMin) * 1000) / 10),
  }))
}

function addCalendarDayStr(dateStr, deltaDays) {
  const dt = new Date(`${dateStr}T12:00:00`)
  dt.setDate(dt.getDate() + deltaDays)
  const y = dt.getFullYear()
  const mo = String(dt.getMonth() + 1).padStart(2, '0')
  const da = String(dt.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

/**
 * Every calendar day from journey start (localStorage `dr_start_date`, else earliest saved session) through today,
 * merged with `daily_sessions` rows (empty days use defaults).
 */
export async function getJourneyHistorySessions() {
  const db = await getDB()
  const allSessions = await safeGetAll(db, 'daily_sessions', 'getJourneyHistorySessions')
  let startStr = null
  try {
    const ls = localStorage.getItem('dr_start_date')
    if (ls && /^\d{4}-\d{2}-\d{2}/.test(ls)) startStr = ls.slice(0, 10)
  } catch {
    /* ignore */
  }
  if (!startStr && allSessions.length) {
    const dates = allSessions.map((s) => s.date).filter(Boolean).sort()
    startStr = dates[0] || todayStr()
  }
  if (!startStr) startStr = todayStr()
  const endStr = todayStr()
  if (startStr > endStr) startStr = endStr

  const byDate = {}
  for (const s of allSessions) {
    if (!s?.date) continue
    byDate[s.date] = { ...DEFAULT_DAILY_SESSION, ...s, date: s.date }
  }

  const days = []
  let cursor = startStr
  while (cursor <= endStr) {
    days.push(byDate[cursor] || { date: cursor, ...DEFAULT_DAILY_SESSION })
    cursor = addCalendarDayStr(cursor, 1)
  }
  return days
}

export async function updateTodaySession(updates) {
  const db = await getDB()
  const today = todayStr()
  const existing = await getTodaySession()
  await safePut(db, 'daily_sessions', { ...existing, ...updates, date: today }, 'updateTodaySession')
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function getTotalXP() {
  const db = await getDB()
  const all = await safeGetAll(db, 'daily_sessions', 'getTotalXP')
  return all.reduce((sum, s) => sum + (s.xpEarned || 0), 0)
}

export async function addXP(amount) {
  const session = await getTodaySession()
  await updateTodaySession({ xpEarned: (session.xpEarned || 0) + amount })
}

export async function getStudyStreakDays() {
  return parseInt(localStorage.getItem('dr_streak_count') || '0')
}

export async function saveGrammarSession(sessionData) {
  const db = await getDB()
  return db.add('grammar_sessions', {
    ...sessionData,
    completedAt: Date.now(),
  })
}

export async function getGrammarSessionsThisWeek() {
  const db = await getDB()
  const sessions = await safeGetAll(db, 'grammar_sessions', 'getGrammarSessionsThisWeek')
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - 6)
  return sessions.filter(s => (s.completedAt || 0) >= start.getTime()).length
}

export const FULL_BACKUP_FORMAT = 'deutsche-reise-full-backup'

/** Words, SRS cards, stories, sessions, frequency AI cache — for moving between machines. */
export async function exportFullBackup() {
  const db = await getDB()
  const [words, srs_cards, stories, grammar_sessions, daily_sessions, frequency_status, frequency_gloss, frequency_lesson, frequency_review_stories] =
    await Promise.all([
      safeGetAll(db, 'words', 'exportFullBackup'),
      safeGetAll(db, 'srs_cards', 'exportFullBackup'),
      safeGetAll(db, 'stories', 'exportFullBackup'),
      safeGetAll(db, 'grammar_sessions', 'exportFullBackup'),
      safeGetAll(db, 'daily_sessions', 'exportFullBackup'),
      safeGetAll(db, 'frequency_status', 'exportFullBackup'),
      safeGetAll(db, 'frequency_gloss', 'exportFullBackup'),
      safeGetAll(db, 'frequency_lesson', 'exportFullBackup'),
      db.objectStoreNames.contains('frequency_review_stories')
        ? safeGetAll(db, 'frequency_review_stories', 'exportFullBackup')
        : Promise.resolve([]),
    ])
  const keys = [
    'dr_streak_count',
    'dr_streak_last_date',
    'dr_streak_grace_used',
    'dr_start_date',
    'dr_onboarded',
    'dr_new_cards_per_day',
    'dr_frequency_words_per_day',
    'dr_target_retention',
    'dr_daily_xp_goal',
    'dr_vocab_raw_entry_total',
    'dr_dark_mode',
  ]
  const localStorageSnapshot = {}
  for (const k of keys) {
    try {
      const v = localStorage.getItem(k)
      if (v != null) localStorageSnapshot[k] = v
    } catch { /* ignore */ }
  }
  return {
    format: FULL_BACKUP_FORMAT,
    version: 4,
    exportedAt: new Date().toISOString(),
    words,
    srs_cards,
    stories,
    grammar_sessions,
    daily_sessions,
    frequency_status,
    frequency_gloss,
    frequency_lesson,
    frequency_review_stories,
    localStorageSnapshot,
  }
}

/**
 * Replace entire DB + restore selected localStorage keys. Caller should confirm with user first.
 */
export async function importFullBackup(payload) {
  const data = typeof payload === 'string' ? JSON.parse(payload) : payload
  if (!data || data.format !== FULL_BACKUP_FORMAT) {
    throw new Error('Not a full backup (missing format: deutsche-reise-full-backup).')
  }
  const db = await getDB()
  const stores = [
    'words',
    'srs_cards',
    'stories',
    'grammar_sessions',
    'daily_sessions',
    'frequency_status',
    'frequency_gloss',
    'frequency_lesson',
    'frequency_review_stories',
  ]
  for (const name of stores) {
    if (!db.objectStoreNames.contains(name)) continue
    const tx = db.transaction(name, 'readwrite')
    await tx.store.clear()
    await tx.done
  }
  const putRows = async (storeName, rows) => {
    for (const row of rows || []) {
      await safePut(db, storeName, row, 'importFullBackup')
    }
  }
  await putRows(
    'words',
    (data.words || []).map((w) => ({ ...w, storyClozes: [] }))
  )
  await putRows('srs_cards', data.srs_cards)
  await putRows('stories', data.stories)
  await putRows('grammar_sessions', data.grammar_sessions)
  await putRows('daily_sessions', data.daily_sessions)
  await putRows('frequency_status', data.frequency_status)
  await putRows('frequency_gloss', data.frequency_gloss)
  await putRows('frequency_lesson', data.frequency_lesson)
  await putRows('frequency_review_stories', data.frequency_review_stories)
  const snap = data.localStorageSnapshot || {}
  for (const [k, v] of Object.entries(snap)) {
    if (typeof v === 'string') {
      try {
        localStorage.setItem(k, v)
      } catch { /* ignore */ }
    }
  }
  return {
    words: (data.words || []).length,
    srs_cards: (data.srs_cards || []).length,
    stories: (data.stories || []).length,
  }
}
