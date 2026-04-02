import { openDB } from 'idb'
import { updateCard, getNextReviewTimestamp } from './srs.js'
import { getFrequencyTier } from './wordParser.js'

const DB_NAME = 'deutsche-reise-db'
const DB_VERSION = 1

let dbPromise = null

export function initDB() {
  if (dbPromise) return dbPromise
  dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
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
        source: 'import',
        gender: null,
        plural: null,
        example: null,
        variants,
        frequencyTier: tier,
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
    gender: null,
    plural: null,
    example: null,
    variants: [],
    frequencyTier: getFrequencyTier(german.trim()),
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

export async function updateWord(id, updates) {
  const db = await getDB()
  const word = await safeGet(db, 'words', id, 'updateWord')
  if (!word) return
  await safePut(db, 'words', { ...word, ...updates }, 'updateWord')
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
  withWords.sort((a, b) => (a.word.frequencyTier ?? 3) - (b.word.frequencyTier ?? 3))
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
  const updated = updateCard(normalized, rating)
  await safePut(db, 'srs_cards', updated, 'updateCardAfterReview')
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
  storiesRead: 0,
  grammarExercises: 0,
  shadowingMinutes: 0,
  xpEarned: 0,
  minutesStudied: 0,
  flashcardsMinutes: 0,
  storyReadMinutes: 0,
  storyListenMinutes: 0,
  storyShadowMinutes: 0,
  grammarMinutes: 0,
  vocabMinutes: 0,
  passiveMinutes: 0,
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
    (session.vocabMinutes || 0)
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
