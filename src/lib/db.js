import { openDB } from 'idb'
import { updateCard, getNextReviewTimestamp, readRetentionTarget } from './srs.js'
import { getFrequencyTier, normalizeGerman, germanLikenessScore, orientGermanEnglishPair } from './wordParser.js'
import { extractNormalizedKeysFromText, splitIntoSentences } from './storyMining.js'

const DB_NAME = 'deutsche-reise-db'
const DB_VERSION = 4

let dbPromise = null

export function initDB() {
  if (dbPromise) return dbPromise
  dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
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
  const firstReviewAt = getNextReviewTimestamp(1)

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

      const wordData = {
        german: word.german,
        translation: (word.translation || '').trim() || 'Imported',
        normalizedKey: word.normalizedKey,
        addedAt: Date.now(),
        source: word.source || 'import',
        learnSource: word.learnSource || null,
        frequencyRank: word.frequencyRank ?? null,
        gender: null,
        plural: null,
        example: word.example || null,
        variants,
        frequencyTier: tier,
        encounterCount: 0,
        storyClozes: Array.isArray(word.storyClozes) ? word.storyClozes : [],
      }
      const wordId = await wordStore.add(wordData)

      await cardStore.add({
        wordId,
        easeFactor: 2.5,
        interval: 0,
        repetitions: 0,
        nextReview: firstReviewAt,
        lastReview: null,
        lapses: 0,
        state: 'new',
        totalReviews: 0,
        stability: 1,
        difficulty: 5,
      })

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

  const wordId = await wordStore.add({
    german: german.trim(),
    translation: translation.trim(),
    normalizedKey,
    addedAt: Date.now(),
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

  await cardStore.add({
    wordId,
    easeFactor: 2.5,
    interval: 0,
    repetitions: 0,
    nextReview: getNextReviewTimestamp(1),
    lastReview: null,
    lapses: 0,
    state: 'new',
    totalReviews: 0,
    stability: 1,
    difficulty: 5,
  })

  await tx.done
  return { wordId, alreadyExists: false }
}

/**
 * Add a word from the frequency curriculum (prioritized in getNewCards).
 * @param {string} german
 * @param {string} translation
 * @param {number} frequencyRank
 * @param {{ seedClozes?: Array<object>, example?: string }} [options]
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

  const seedClozes = Array.isArray(options.seedClozes) ? options.seedClozes : []
  const wordId = await wordStore.add({
    german: g,
    translation: (translation || '').trim() || 'Imported',
    normalizedKey,
    addedAt: Date.now(),
    source: 'frequency',
    learnSource: 'frequency',
    frequencyRank: frequencyRank ?? null,
    gender: null,
    plural: null,
    example: options.example || null,
    variants: [],
    frequencyTier: Math.min(2, getFrequencyTier(g) || 1),
    encounterCount: 0,
    storyClozes: seedClozes,
  })

  await cardStore.add({
    wordId,
    easeFactor: 2.5,
    interval: 0,
    repetitions: 0,
    nextReview: getNextReviewTimestamp(1),
    lastReview: null,
    lapses: 0,
    state: 'new',
    totalReviews: 0,
    stability: 1,
    difficulty: 5,
  })

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
  return words.filter((w) => w.learnSource === 'frequency' || w.source === 'frequency')
}

/**
 * New cards stuck in `new` (backlog) — for SRS Placement / calibration.
 * Sort: newest `addedAt` first. For a single top-to-bottom import (e.g. words.txt),
 * that is the end of the file (last rows imported = slightly later timestamps).
 */
export async function getNewCardsForPlacement(limit = 40) {
  const db = await getDB()
  const cards = await db.getAllFromIndex('srs_cards', 'state')
  const fresh = cards.filter((c) => c.state === 'new')
  const withWords = []
  for (const card of fresh) {
    const word = await safeGet(db, 'words', card.wordId, 'getNewCardsForPlacement')
    if (word) withWords.push({ ...card, word })
  }
  withWords.sort((a, b) => (b.word.addedAt || 0) - (a.word.addedAt || 0))
  return withWords.slice(0, limit)
}

export async function getAllWords() {
  const db = await getDB()
  return safeGetAll(db, 'words', 'getAllWords')
}

export async function getWordCount() {
  const db = await getDB()
  return db.count('words')
}

/** Words with SRS card in `review` state (mastered for level / progress). */
export async function getMasteredWordCount() {
  const db = await getDB()
  const all = await safeGetAll(db, 'srs_cards', 'getMasteredWordCount')
  return all.filter(c => c.state === 'review').length
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
  const cards = await db.getAllFromIndex('srs_cards', 'state')
  const newCards = cards.filter(c => c.state === 'new')
  const withWords = []
  for (const card of newCards) {
    const word = await safeGet(db, 'words', card.wordId, 'getNewCards')
    if (word) withWords.push({ ...card, word })
  }
  // Newest additions first so recent learning (Frequency Lab, story, manual) hits flashcards soon.
  withWords.sort((a, b) => (b.word.addedAt || 0) - (a.word.addedAt || 0))
  return withWords.slice(0, limit)
}

export async function updateCardAfterReview(wordId, rating) {
  const db = await getDB()
  const card = await safeGet(db, 'srs_cards', wordId, 'updateCardAfterReview')
  if (!card) return
  const normalized = {
    ...card,
    stability: card.stability || 1,
    difficulty: card.difficulty || 5,
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

/**
 * Sentence-mine cloze cards from chapter text (links to existing SRS words).
 */
export async function mineChapterClozes(storyId, chapterTitle, chapterText, maxPerChapter = 8) {
  const words = await getAllWords()
  const sentences = splitIntoSentences(chapterText)
  const sortedWords = [...words].sort(
    (a, b) => (b.german?.length || 0) - (a.german?.length || 0)
  )
  let added = 0
  const seenBlank = new Set()
  const db = await getDB()

  outer: for (const sent of sentences) {
    if (added >= maxPerChapter) break
    for (const w of sortedWords) {
      if (added >= maxPerChapter) break outer
      const forms = [w.german, ...(w.variants || [])]
        .map((f) => String(f || '').trim())
        .filter((f) => f.length > 2)
      let hit = null
      for (const form of forms) {
        const lower = sent.toLowerCase()
        const fl = form.toLowerCase()
        const idx = lower.indexOf(fl)
        if (idx < 0) continue
        const before = idx > 0 ? sent[idx - 1] : ' '
        const after = idx + form.length < sent.length ? sent[idx + form.length] : ' '
        const boundaryOk = !/^[a-zäöüß]$/i.test(before) && !/^[a-zäöüß]$/i.test(after)
        if (!boundaryOk) continue
        hit = { idx, len: form.length }
        break
      }
      if (!hit) continue
      const surface = sent.slice(hit.idx, hit.idx + hit.len)
      const blanked = sent.slice(0, hit.idx) + '____' + sent.slice(hit.idx + hit.len)
      if (seenBlank.has(blanked)) continue
      seenBlank.add(blanked)
      const clozeId = `cz_${storyId}_${added}_${Date.now()}`
      const newCloze = {
        id: clozeId,
        sentence: blanked,
        fullSentence: sent,
        answer: w.german,
        surface,
        storyId,
        chapterTitle: chapterTitle || '',
      }
      const existing = Array.isArray(w.storyClozes) ? w.storyClozes : []
      if (existing.length >= 12) continue
      if (existing.some((c) => c.sentence === blanked || c.fullSentence === sent)) continue
      await safePut(db, 'words', { ...w, storyClozes: [...existing, newCloze] }, 'mineCloze')
      Object.assign(w, { storyClozes: [...existing, newCloze] })
      added++
    }
  }
  return added
}

export async function getCardStats() {
  const db = await getDB()
  const now = Date.now()
  const all = await safeGetAll(db, 'srs_cards', 'getCardStats')
  return {
    due: all.filter(c => c.nextReview <= now && c.state !== 'new').length,
    new: all.filter(c => c.state === 'new').length,
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
  return { ...card, stability: card.stability || 1, difficulty: card.difficulty || 5 }
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

// ─── Daily Sessions ───────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

const DEFAULT_DAILY_SESSION = {
  flashcardsReviewed: 0,
  newWordsLearned: 0,
  frequencyWordsLearned: 0,
  placementCardsDone: 0,
  storiesRead: 0,
  grammarExercises: 0,
  shadowingMinutes: 0,
  productionSubmissions: 0,
  passiveMinutes: 0,
  xpEarned: 0,
  minutesStudied: 0,
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

export async function updateTodaySession(updates) {
  const db = await getDB()
  const today = todayStr()
  const existing = await getTodaySession()
  await safePut(db, 'daily_sessions', { ...existing, ...updates, date: today }, 'updateTodaySession')
}

export async function getWeekSessions() {
  const db = await getDB()
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split('T')[0]
    const session = await safeGet(db, 'daily_sessions', dateStr, 'getWeekSessions')
    days.push(session || { date: dateStr, xpEarned: 0, flashcardsReviewed: 0 })
  }
  return days
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
  const [words, srs_cards, stories, grammar_sessions, daily_sessions, frequency_status, frequency_gloss, frequency_lesson] =
    await Promise.all([
      safeGetAll(db, 'words', 'exportFullBackup'),
      safeGetAll(db, 'srs_cards', 'exportFullBackup'),
      safeGetAll(db, 'stories', 'exportFullBackup'),
      safeGetAll(db, 'grammar_sessions', 'exportFullBackup'),
      safeGetAll(db, 'daily_sessions', 'exportFullBackup'),
      safeGetAll(db, 'frequency_status', 'exportFullBackup'),
      safeGetAll(db, 'frequency_gloss', 'exportFullBackup'),
      safeGetAll(db, 'frequency_lesson', 'exportFullBackup'),
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
    version: 3,
    exportedAt: new Date().toISOString(),
    words,
    srs_cards,
    stories,
    grammar_sessions,
    daily_sessions,
    frequency_status,
    frequency_gloss,
    frequency_lesson,
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
  await putRows('words', data.words)
  await putRows('srs_cards', data.srs_cards)
  await putRows('stories', data.stories)
  await putRows('grammar_sessions', data.grammar_sessions)
  await putRows('daily_sessions', data.daily_sessions)
  await putRows('frequency_status', data.frequency_status)
  await putRows('frequency_gloss', data.frequency_gloss)
  await putRows('frequency_lesson', data.frequency_lesson)
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
