import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSettings } from '../hooks/useSettings'
import { motion } from 'framer-motion'
import {
  Sparkles, Volume2, Plus, Loader2, RefreshCw, ListOrdered, CheckCircle2, BookOpen, Database,
  ChevronRight, ScrollText,
} from 'lucide-react'
import {
  initDB,
  getAllWords,
  getTodaySession,
  updateTodaySession,
  addWordFromFrequency,
  addXP,
  getAllFrequencyStatuses,
  putFrequencyStatusesBatch,
  putFrequencyStatus,
  buildVaultKeySet,
  getWordsFromFrequencySource,
  getMasteredWordCount,
  getFrequencyGloss,
  putFrequencyGlossesBatch,
  getFrequencyLesson,
  putFrequencyLesson,
  getFrequencyReviewStories,
  saveFrequencyReviewStory,
} from '../lib/db'
import {
  loadFrequencyEntries,
  pickNextLearnRank,
  extractExamplesFromDetail,
  shortGlossFromDetail,
  isFrequencyEntryInVault,
  collectUpcomingFrequencyEntries,
} from '../lib/frequencyData'
import {
  matchFrequencyEntriesToVault,
  generateFrequencyWordLesson,
  generateExampleSentenceForWord,
  polishFrequencyGlossesBatch,
  generateFrequencyLabConsolidationStory,
  normalizeSurfaceGlosses,
} from '../lib/deepseek'
import { normalizeGerman } from '../lib/wordParser'
import { germanVoice } from '../lib/voice'
import { getLevel } from '../lib/levelCalc'
import Button from '../components/shared/Button'
import Modal from '../components/shared/Modal'
import StoryText from '../components/story/StoryText'
import { showXPToast, showAppToast } from '../components/shared/XPToast'
import { unlockStoryReadyAudio, playStoryReadyChime } from '../lib/storyReadySound'
import { shouldIgnoreGlobalKeydown } from '../lib/keyboardGuards'

/** Next learnable ranks: gloss + AI lesson prefetch window. */
const FREQUENCY_PREFETCH_WINDOW = 30
/** Parallel DeepSeek calls while prefetching lessons (stays under typical rate limits). */
const LESSON_PREFETCH_CONCURRENCY = 3
/** Recent additions highlighted in the Frequency Lab review story (limits cognitive load). */
const CONSOLIDATION_FOCUS_MAX = 12
/** High-frequency items from the same list as narrative glue (Nation-style coverage). */
const CONSOLIDATION_GLUE_MAX = 48

/**
 * Run async `fn(item)` for each item with at most `concurrency` in flight.
 */
async function mapPool(items, concurrency, fn) {
  if (!items?.length) return
  let next = 0
  const worker = async () => {
    while (true) {
      const idx = next++
      if (idx >= items.length) return
      await fn(items[idx], idx)
    }
  }
  const workers = Math.min(Math.max(1, concurrency), items.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
}

function rankForConsolidation(w) {
  if (w.frequencyRank != null && Number.isFinite(Number(w.frequencyRank))) {
    return Number(w.frequencyRank)
  }
  return 999999
}

/** Build focus (newest) + glue (lowest rank, excluding focus) for the consolidation-story prompt. */
function buildConsolidationPayload(freqList) {
  const list = Array.isArray(freqList) ? freqList : []
  const byRecent = [...list].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
  const focus = byRecent
    .slice(0, CONSOLIDATION_FOCUS_MAX)
    .map((w) => ({
      german: String(w.german || '').trim(),
      translation: String(w.translation || '').trim().slice(0, 80),
      frequencyRank: rankForConsolidation(w),
    }))
    .filter((x) => x.german)

  const focusKeys = new Set(focus.map((w) => normalizeGerman(w.german)))
  const byRank = [...list].sort((a, b) => rankForConsolidation(a) - rankForConsolidation(b))
  const glue = []
  const seenGlue = new Set()
  for (const w of byRank) {
    const g = String(w.german || '').trim()
    if (!g) continue
    const k = normalizeGerman(g)
    if (focusKeys.has(k)) continue
    if (seenGlue.has(k)) continue
    seenGlue.add(k)
    glue.push({
      german: g,
      translation: String(w.translation || '').trim().slice(0, 80),
      frequencyRank: rankForConsolidation(w),
    })
    if (glue.length >= CONSOLIDATION_GLUE_MAX) break
  }
  return { focus, glue }
}

function formatRelativeTime(ts) {
  const ms = Number(ts) || 0
  if (!ms) return 'saved just now'
  const diff = Date.now() - ms
  if (diff < 60_000) return 'saved just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `saved ${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `saved ${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `saved ${days}d ago`
  const d = new Date(ms)
  return `saved ${d.toLocaleDateString()}`
}

export default function FrequencyLab() {
  const { frequencyWordsPerDay } = useSettings()
  const [entries, setEntries] = useState([])
  const [words, setWords] = useState([])
  const [statusByRank, setStatusByRank] = useState(() => new Map())
  const [current, setCurrent] = useState(null)
  const [lesson, setLesson] = useState(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingLesson, setLoadingLesson] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [session, setSession] = useState(null)
  const [mastered, setMastered] = useState(0)
  const [freqList, setFreqList] = useState([])
  const [lessonError, setLessonError] = useState('')
  const [fullMatchBusy, setFullMatchBusy] = useState(false)
  const [fullMatchProgress, setFullMatchProgress] = useState('')
  const [freqPracticeWord, setFreqPracticeWord] = useState(null)
  const [freqPracticeSentence, setFreqPracticeSentence] = useState('')
  const [freqPracticeBusy, setFreqPracticeBusy] = useState(false)
  const [glossByRank, setGlossByRank] = useState(() => new Map())
  const [lessonByRank, setLessonByRank] = useState(() => new Map())
  const [glossPrefetching, setGlossPrefetching] = useState(false)
  const [lessonPrefetching, setLessonPrefetching] = useState(false)
  /** Saved AI lesson for a word from "Words added from Frequency Lab" (loaded from IndexedDB). */
  const [savedLessonModal, setSavedLessonModal] = useState(null)
  /** AI consolidation story (recent focus + rank-based glue) — separate from Story Studio. */
  const [consolidationModal, setConsolidationModal] = useState(null)
  /** Last 4 persisted review stories (IndexedDB). */
  const [reviewStoryArchive, setReviewStoryArchive] = useState([])
  /** Corpus ranks covered by the last bulk gloss (or lesson-only) prefetch — skip re-calling until current leaves this range. */
  const glossBulkMinRankRef = useRef(null)
  const glossBulkMaxRankRef = useRef(null)
  /** → Arrow: step through current rank’s word → examples → AI lesson (main card). */
  const lessonPlaylistIdxRef = useRef(0)
  /** ← Arrow: cycle German audio for words in list order (newest first, same as UI). */
  const freqListAudioIdxRef = useRef(0)
  const dailyGoal = frequencyWordsPerDay
  /** Same cap as Settings → Frequency Lab words per day (5–40); drives AI sync batch size. */
  const syncBatchSize = useMemo(
    () => Math.max(5, Math.min(40, Number(frequencyWordsPerDay) || 25)),
    [frequencyWordsPerDay]
  )
  const cefrHint = useMemo(() => {
    const lv = getLevel(mastered).level
    return lv || 'A2'
  }, [mastered])

  const vaultKeys = useMemo(() => buildVaultKeySet(words), [words])

  /** Same vocabulary highlighting as Story Studio (hover = translation); includes surface variants. */
  const storyKnownWordsSet = useMemo(() => {
    const s = new Set()
    for (const w of words) {
      s.add(w.normalizedKey)
      for (const v of w.variants || []) {
        const nk = normalizeGerman(String(v).trim())
        if (nk) s.add(nk)
      }
    }
    return s
  }, [words])
  const storyKnownWordMap = useMemo(() => {
    const m = new Map()
    for (const w of words) {
      const t = w.translation || 'In your vocabulary'
      m.set(w.normalizedKey, t)
      for (const v of w.variants || []) {
        const nk = normalizeGerman(String(v).trim())
        if (nk) m.set(nk, t)
      }
    }
    return m
  }, [words])

  const freqListSorted = useMemo(
    () => [...freqList].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)),
    [freqList]
  )

  const refreshStatuses = useCallback(async () => {
    const rows = await getAllFrequencyStatuses()
    const m = new Map()
    for (const r of rows) {
      m.set(r.rank, r.status)
    }
    setStatusByRank(m)
  }, [])

  const load = useCallback(async () => {
    setLoadingList(true)
    await initDB()
    try {
      const [e, w, mCount] = await Promise.all([
        loadFrequencyEntries(),
        getAllWords(),
        getMasteredWordCount(),
      ])
      setEntries(e)
      setWords(w)
      setMastered(mCount)
      await refreshStatuses()
      const sess = await getTodaySession()
      setSession(sess)
      setReviewStoryArchive(await getFrequencyReviewStories())
    } catch (err) {
      console.error(err)
      showAppToast('Could not load frequency list. Run: npm run build:frequency')
    } finally {
      setLoadingList(false)
    }
  }, [refreshStatuses])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!entries.length) return
    const next = pickNextLearnRank(entries, vaultKeys, statusByRank, 1)
    setCurrent(next)
  }, [entries, vaultKeys, statusByRank])

  useEffect(() => {
    setLessonError('')
  }, [current?.rank])

  useEffect(() => {
    if (!current) {
      setLesson(null)
      return
    }
    const cached = lessonByRank.get(current.rank)
    setLesson(cached ?? null)
  }, [current?.rank, lessonByRank])

  useEffect(() => {
    if (loadingList || !entries.length) return
    const apiKey = localStorage.getItem('dr_api_key')
    let cancelled = false
    ;(async () => {
      await initDB()
      const first = pickNextLearnRank(entries, vaultKeys, statusByRank, 1)
      const startRank = first?.rank ?? 1
      const upcoming = collectUpcomingFrequencyEntries(
        entries,
        vaultKeys,
        statusByRank,
        FREQUENCY_PREFETCH_WINDOW,
        startRank
      )
      if (!upcoming.length) return

      const [dbGlossRows, dbLessonRows] = await Promise.all([
        Promise.all(upcoming.map((e) => getFrequencyGloss(e.rank))),
        Promise.all(upcoming.map((e) => getFrequencyLesson(e.rank))),
      ])
      if (cancelled) return

      const needGloss = []
      const fromDbGloss = []
      upcoming.forEach((e, i) => {
        const g = dbGlossRows[i]?.glossEn
        if (g) fromDbGloss.push({ rank: e.rank, glossEn: g })
        else needGloss.push(e)
      })
      if (fromDbGloss.length) {
        setGlossByRank((prev) => {
          const m = new Map(prev)
          for (const r of fromDbGloss) m.set(r.rank, r.glossEn)
          return m
        })
      }

      const lessonFromDb = new Map()
      const needLesson = []
      upcoming.forEach((e, i) => {
        const L = dbLessonRows[i]?.lesson
        const ok =
          L &&
          typeof L === 'object' &&
          (String(L.storyDe || '').trim() ||
            (Array.isArray(L.sentences) && L.sentences.length > 0) ||
            String(L.fullMeaning || '').trim())
        if (ok) lessonFromDb.set(e.rank, L)
        else needLesson.push(e)
      })
      if (lessonFromDb.size) {
        setLessonByRank((prev) => {
          const m = new Map(prev)
          for (const [rank, les] of lessonFromDb) m.set(rank, les)
          return m
        })
      }

      const curRank = first?.rank
      const bulkMin = glossBulkMinRankRef.current
      const bulkMax = glossBulkMaxRankRef.current
      const insideLastBulk =
        curRank != null &&
        bulkMin != null &&
        bulkMax != null &&
        curRank >= bulkMin &&
        curRank <= bulkMax

      if (insideLastBulk) {
        return
      }

      if (apiKey?.trim() && needGloss.length) {
        setGlossPrefetching(true)
        try {
          const batch = needGloss.slice(0, FREQUENCY_PREFETCH_WINDOW).map((e) => ({
            rank: e.rank,
            headword: e.headword,
            detailSnippet: e.detail,
          }))
          const ranks = batch.map((e) => e.rank)
          const results = await polishFrequencyGlossesBatch(batch)
          if (cancelled) return
          await putFrequencyGlossesBatch(results)
          glossBulkMinRankRef.current = Math.min(...ranks)
          glossBulkMaxRankRef.current = Math.max(...ranks)
          setGlossByRank((prev) => {
            const m = new Map(prev)
            for (const r of results) m.set(r.rank, r.glossEn)
            return m
          })
        } catch (e) {
          console.error(e)
          glossBulkMinRankRef.current = null
          glossBulkMaxRankRef.current = null
        } finally {
          setGlossPrefetching(false)
        }
      }

      if (cancelled || !apiKey?.trim() || !needLesson.length) return

      setLessonPrefetching(true)
      try {
        const w = await getAllWords()
        const knownGerman = w.map((x) => x.german)
        const toFetch = needLesson.slice(0, FREQUENCY_PREFETCH_WINDOW)
        const fetchedRanks = []
        await mapPool(toFetch, LESSON_PREFETCH_CONCURRENCY, async (e) => {
          if (cancelled) return
          try {
            const data = await generateFrequencyWordLesson({
              headword: e.headword,
              rank: e.rank,
              detailSnippet: e.detail,
              knownGermanWords: knownGerman,
              cefrHint,
            })
            if (cancelled) return
            await putFrequencyLesson(e.rank, data)
            fetchedRanks.push(e.rank)
            setLessonByRank((prev) => {
              const m = new Map(prev)
              m.set(e.rank, data)
              return m
            })
          } catch (err) {
            console.error(err)
          }
        })
        if (fetchedRanks.length && glossBulkMinRankRef.current == null) {
          glossBulkMinRankRef.current = Math.min(...fetchedRanks)
          glossBulkMaxRankRef.current = Math.max(...fetchedRanks)
        }
      } finally {
        setLessonPrefetching(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadingList, entries, vaultKeys, statusByRank, cefrHint])

  const fileExamples = current ? extractExamplesFromDetail(current.detail, 8) : []
  const fileGloss = current ? shortGlossFromDetail(current.headword, current.detail) : ''
  const displayGloss = current ? glossByRank.get(current.rank) || fileGloss : ''

  useEffect(() => {
    lessonPlaylistIdxRef.current = 0
  }, [current?.rank, lesson])

  useEffect(() => {
    freqListAudioIdxRef.current = 0
  }, [freqList])

  /** Main card: Space = headword audio; → = word → file examples → AI sentences → story (one step per key). */
  useEffect(() => {
    if (savedLessonModal != null || consolidationModal != null || fullMatchBusy || !current) return undefined

    const buildMainPlaylist = () => {
      const out = []
      const hw = String(current.headword || '').trim()
      if (hw) out.push({ kind: 'sentence', text: hw })
      for (const ex of fileExamples) {
        const t = String(ex?.de || '').trim()
        if (t) out.push({ kind: 'sentence', text: t })
      }
      if (lesson && typeof lesson === 'object') {
        for (const s of lesson.sentences || []) {
          const de = String(s?.de || '').trim()
          if (de) out.push({ kind: 'sentence', text: de })
        }
        const story = String(lesson.storyDe || '').trim()
        if (story) out.push({ kind: 'story', text: story })
      }
      return out
    }

    const onKey = (e) => {
      if (shouldIgnoreGlobalKeydown(e)) return

      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        const hw = String(current.headword || '').trim()
        if (!hw) return
        if (germanVoice.isSpeaking()) germanVoice.stop()
        else germanVoice.speakWord(hw)
        return
      }

      if (e.key === 'ArrowRight') {
        const pl = buildMainPlaylist()
        if (!pl.length) return
        e.preventDefault()
        const item = pl[lessonPlaylistIdxRef.current % pl.length]
        lessonPlaylistIdxRef.current += 1
        if (item.kind === 'story') germanVoice.speak(item.text)
        else germanVoice.speakSentence(item.text)
        return
      }

      if (e.key === 'ArrowLeft') {
        if (!freqListSorted.length) return
        e.preventDefault()
        const w = freqListSorted[freqListAudioIdxRef.current % freqListSorted.length]
        freqListAudioIdxRef.current += 1
        const g = String(w?.german || '').trim()
        if (!g) return
        germanVoice.stop()
        germanVoice.speakWord(g)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [savedLessonModal, consolidationModal, fullMatchBusy, current, lesson, fileExamples, freqListSorted])

  useEffect(() => {
    if (!savedLessonModal || savedLessonModal.status !== 'ready' || !savedLessonModal.lesson) return undefined
    const modalLesson = savedLessonModal.lesson
    const playlist = []
    const head = String(savedLessonModal.word?.german || '').trim()
    if (head) playlist.push({ kind: 'sentence', text: head })
    for (const s of modalLesson.sentences || []) {
      const de = String(s?.de || '').trim()
      if (de) playlist.push({ kind: 'sentence', text: de })
    }
    const story = String(modalLesson.storyDe || '').trim()
    if (story) playlist.push({ kind: 'story', text: story })
    if (!playlist.length) return undefined
    let idx = 0
    const onKey = (e) => {
      if (e.key !== 'ArrowRight') return
      if (shouldIgnoreGlobalKeydown(e)) return
      e.preventDefault()
      e.stopPropagation()
      const item = playlist[idx % playlist.length]
      idx += 1
      if (item.kind === 'story') germanVoice.speak(item.text)
      else germanVoice.speakSentence(item.text)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [savedLessonModal])

  const speak = (text) => {
    if (!text?.trim()) return
    germanVoice.speakWord(text)
  }

  const closeSavedLessonModal = () => setSavedLessonModal(null)

  const openSavedLessonForWord = async (w) => {
    setSavedLessonModal({ word: w, status: 'loading', lesson: null })
    const micro = w.microLesson
    if (micro && typeof micro === 'object') {
      const hasContent =
        String(micro.storyDe || '').trim() ||
        (Array.isArray(micro.sentences) && micro.sentences.length > 0) ||
        String(micro.glossShort || '').trim() ||
        String(micro.fullMeaning || '').trim()
      setSavedLessonModal({
        word: w,
        status: hasContent ? 'ready' : 'empty',
        lesson: hasContent ? micro : null,
      })
      return
    }
    const rank = w.frequencyRank
    if (rank == null) {
      setSavedLessonModal({ word: w, status: 'empty', lesson: null })
      return
    }
    try {
      const row = await getFrequencyLesson(rank)
      const L = row?.lesson
      const hasContent =
        L &&
        typeof L === 'object' &&
        (String(L.storyDe || '').trim() ||
          (Array.isArray(L.sentences) && L.sentences.length > 0) ||
          String(L.glossShort || '').trim() ||
          String(L.fullMeaning || '').trim())
      setSavedLessonModal({
        word: w,
        status: hasContent ? 'ready' : 'empty',
        lesson: hasContent ? L : null,
      })
    } catch (e) {
      console.error(e)
      setSavedLessonModal({ word: w, status: 'error', lesson: null })
    }
  }

  const closeConsolidationModal = () => setConsolidationModal(null)

  const handleGenerateConsolidationStory = async () => {
    if (freqList.length < 3) {
      showAppToast('Add at least three Frequency Lab words first.')
      return
    }
    const apiKey = localStorage.getItem('dr_api_key')
    if (!apiKey?.trim()) {
      showAppToast('Add your DeepSeek API key in Settings.')
      return
    }
    const { focus, glue } = buildConsolidationPayload(freqList)
    if (focus.length < 2) {
      showAppToast('Need at least two words in your Frequency Lab list.')
      return
    }
    unlockStoryReadyAudio()
    setConsolidationModal({ status: 'loading' })
    try {
      const data = await generateFrequencyLabConsolidationStory({
        focusWords: focus,
        glueWords: glue,
        cefrHint,
        totalFrequencyWords: freqList.length,
      })
      setConsolidationModal({
        status: 'ready',
        storyDe: data.storyDe,
        storyEn: data.storyEn,
        titleDe: data.titleDe,
        focusCount: focus.length,
        glueCount: glue.length,
        focusLemmas: focus.map((f) => f.german),
        tokenGlosses: data.tokenGlosses || {},
      })
      await saveFrequencyReviewStory({
        titleDe: data.titleDe || 'Review story',
        storyDe: data.storyDe,
        storyEn: data.storyEn,
        focusLemmas: focus.map((f) => f.german),
        focusCount: focus.length,
        glueCount: glue.length,
        tokenGlosses: data.tokenGlosses || {},
      })
      setReviewStoryArchive(await getFrequencyReviewStories())
      showAppToast('Review story ready — read or listen below.')
      playStoryReadyChime()
    } catch (e) {
      console.error(e)
      setConsolidationModal({
        status: 'error',
        message: e?.message || 'Could not generate story',
      })
    }
  }

  const pickRandomFreqWord = () => {
    if (!freqList.length) return
    const w = freqList[Math.floor(Math.random() * freqList.length)]
    setFreqPracticeWord(w)
    setFreqPracticeSentence('')
  }

  const loadFreqPracticeSentence = async () => {
    if (!freqPracticeWord) return
    const apiKey = localStorage.getItem('dr_api_key')
    if (!apiKey?.trim()) {
      showAppToast('Add API key in Settings for AI example sentences.')
      return
    }
    setFreqPracticeBusy(true)
    try {
      const lv = getLevel(mastered).level
      const s = await generateExampleSentenceForWord(
        freqPracticeWord.german,
        freqPracticeWord.translation,
        lv
      )
      setFreqPracticeSentence(s)
      germanVoice.speakWord(s)
    } catch (e) {
      showAppToast(e.message || 'Could not generate sentence')
    }
    setFreqPracticeBusy(false)
  }

  const handleAiSync = async () => {
    const key = localStorage.getItem('dr_api_key')
    if (!key?.trim()) {
      showAppToast('Add DeepSeek API key in Settings first.')
      return
    }
    setSyncing(true)
    try {
      const w = await getAllWords()
      const vaultKeys = buildVaultKeySet(w)
      const existing = await getAllFrequencyStatuses()
      const done = new Set(existing.map((x) => x.rank))
      const sorted = [...entries].sort((a, b) => a.rank - b.rank)
      const batch = []
      const vaultKnown = []
      for (const e of sorted) {
        if (done.has(e.rank)) continue
        if (isFrequencyEntryInVault(e, vaultKeys)) {
          vaultKnown.push({ rank: e.rank, status: 'known', note: 'vault' })
          continue
        }
        batch.push(e)
        if (batch.length >= syncBatchSize) break
      }
      if (vaultKnown.length) {
        await putFrequencyStatusesBatch(vaultKnown)
        await refreshStatuses()
      }
      if (!batch.length) {
        showAppToast(
          vaultKnown.length
            ? `Marked ${vaultKnown.length} ranks as already in your vault (no AI call).`
            : 'Nothing left to sync for this pass.'
        )
        setSyncing(false)
        return
      }
      const results = await matchFrequencyEntriesToVault(batch, w)
      if (!results.length) {
        showAppToast('AI returned no results. Check API key and billing, then try again.')
        setSyncing(false)
        return
      }
      await putFrequencyStatusesBatch(
        results.map((r) => ({
          rank: r.rank,
          status: r.status === 'known' ? 'known' : 'unknown',
          note: r.note || '',
        }))
      )
      await refreshStatuses()
      showAppToast(`Synced ${results.length} ranks with AI.`)
    } catch (e) {
      console.error(e)
      showAppToast(e.message || 'AI sync failed')
    }
    setSyncing(false)
  }

  const handleFullVaultMatch = async () => {
    const key = localStorage.getItem('dr_api_key')
    if (!key?.trim()) {
      showAppToast('Add DeepSeek API key in Settings first.')
      return
    }
    if (!entries.length) return
    const pending = entries.filter((e) => {
      if (statusByRank.has(e.rank)) return false
      if (isFrequencyEntryInVault(e, vaultKeys)) return false
      return true
    }).length
    if (pending === 0) {
      showAppToast('Nothing left to match (vault + saved status cover the list).')
      return
    }
    const approxBatches = Math.ceil(pending / syncBatchSize)
    if (
      !window.confirm(
        `Match ${pending} remaining ranks to your vault? About ${approxBatches} AI requests; may take several minutes. Keep this tab open.`
      )
    ) {
      return
    }
    setFullMatchBusy(true)
    let saved = 0
    let batchIndex = 0
    try {
      while (true) {
        const w = await getAllWords()
        const vKeys = buildVaultKeySet(w)
        const existing = await getAllFrequencyStatuses()
        const done = new Set(existing.map((x) => x.rank))
        const batch = []
        const vaultKnown = []
        for (const e of [...entries].sort((a, b) => a.rank - b.rank)) {
          if (done.has(e.rank)) continue
          if (isFrequencyEntryInVault(e, vKeys)) {
            vaultKnown.push({ rank: e.rank, status: 'known', note: 'vault' })
            continue
          }
          batch.push(e)
          if (batch.length >= syncBatchSize) break
        }
        if (vaultKnown.length) {
          await putFrequencyStatusesBatch(vaultKnown)
          await refreshStatuses()
          saved += vaultKnown.length
          setFullMatchProgress(`Marked ${saved} ranks (vault + AI)…`)
        }
        if (!batch.length) {
          if (!vaultKnown.length) break
          continue
        }
        batchIndex += 1
        setFullMatchProgress(`Request ${batchIndex} (~${batch.length} ranks)…`)
        const results = await matchFrequencyEntriesToVault(batch, w)
        if (!results.length) {
          showAppToast('AI returned nothing; stopped. Check API key and try again.')
          break
        }
        await putFrequencyStatusesBatch(
          results.map((r) => ({
            rank: r.rank,
            status: r.status === 'known' ? 'known' : 'unknown',
            note: r.note || '',
          }))
        )
        await refreshStatuses()
        saved += results.length
        setFullMatchProgress(`Saved ${saved} ranks…`)
        await new Promise((r) => setTimeout(r, 300))
      }
      localStorage.setItem('dr_frequency_full_match_at', new Date().toISOString())
      if (saved > 0) showAppToast(`Done. Saved ${saved} rank results.`)
    } catch (e) {
      console.error(e)
      showAppToast(e.message || 'Full match failed')
    } finally {
      setFullMatchBusy(false)
      setFullMatchProgress('')
    }
  }

  const handleGenerateLesson = async () => {
    if (!current) return
    const key = localStorage.getItem('dr_api_key')
    if (!key?.trim()) {
      showAppToast('Add DeepSeek API key for story + extra sentences.')
      return
    }
    setLoadingLesson(true)
    setLesson(null)
    setLessonError('')
    try {
      const w = await getAllWords()
      const knownGerman = w.map((x) => x.german)
      const data = await generateFrequencyWordLesson({
        headword: current.headword,
        rank: current.rank,
        detailSnippet: current.detail,
        knownGermanWords: knownGerman,
        cefrHint,
      })
      await putFrequencyLesson(current.rank, data)
      setLessonByRank((prev) => {
        const m = new Map(prev)
        m.set(current.rank, data)
        return m
      })
      setLesson(data)
    } catch (e) {
      console.error(e)
      const msg = e?.message || 'Lesson generation failed'
      setLessonError(msg)
      showAppToast(msg)
    }
    setLoadingLesson(false)
  }

  const handleAddWord = async () => {
    if (!current) return
    setAdding(true)
    try {
      const baseGloss = current
        ? glossByRank.get(current.rank) || shortGlossFromDetail(current.headword, current.detail)
        : ''

      let lessonForAdd = lesson
      if (!String(lessonForAdd?.glossShort || '').trim()) {
        lessonForAdd = lessonByRank.get(current.rank) ?? null
      }
      const apiKey = localStorage.getItem('dr_api_key')?.trim()
      if (!String(lessonForAdd?.glossShort || '').trim() && apiKey) {
        try {
          const w = await getAllWords()
          const knownGerman = w.map((x) => x.german)
          lessonForAdd = await generateFrequencyWordLesson({
            headword: current.headword,
            rank: current.rank,
            detailSnippet: current.detail,
            knownGermanWords: knownGerman,
            cefrHint,
          })
          await putFrequencyLesson(current.rank, lessonForAdd)
          setLessonByRank((prev) => {
            const m = new Map(prev)
            m.set(current.rank, lessonForAdd)
            return m
          })
          setLesson(lessonForAdd)
        } catch (e) {
          console.error(e)
          showAppToast(e?.message || 'Could not fetch AI gloss; using fallback meaning.')
        }
      }

      const glossShort = String(lessonForAdd?.glossShort || '').trim()
      const polished = String(glossByRank.get(current.rank) || '').trim()
      const gloss = glossShort || polished || baseGloss || 'Imported'

      const exampleDe =
        (Array.isArray(lessonForAdd?.sentences) && String(lessonForAdd.sentences[0]?.de || '').trim()) ||
        (String(lessonForAdd?.storyDe || '').trim() ? String(lessonForAdd.storyDe).trim().split(/\n+/)[0].slice(0, 400) : '') ||
        null

      const res = await addWordFromFrequency(current.headword, gloss, current.rank, {
        example: exampleDe || null,
      })
      if (res.alreadyExists) {
        showAppToast('Already in your vault.')
        await putFrequencyStatus(current.rank, { status: 'known', note: 'vault' })
        const wNew = await getAllWords()
        setWords(wNew)
        await refreshStatuses()
        const rows = await getAllFrequencyStatuses()
        const m = new Map()
        for (const r of rows) m.set(r.rank, r.status)
        setStatusByRank(m)
        setCurrent(pickNextLearnRank(entries, buildVaultKeySet(wNew), m, current.rank + 1))
        setFreqList(await getWordsFromFrequencySource())
        setAdding(false)
        return
      }
      await putFrequencyStatus(current.rank, { status: 'known', note: 'added' })
      const sess = await getTodaySession()
      await updateTodaySession({
        frequencyWordsLearned: (sess.frequencyWordsLearned || 0) + 1,
        newWordsLearned: (sess.newWordsLearned || 0) + 1,
      })
      setSession(await getTodaySession())
      await addXP(15)
      showXPToast(15, 'Word added!')
      showAppToast('Added to vault & flashcards.')
      const wNew = await getAllWords()
      setWords(wNew)
      await refreshStatuses()
      const rows = await getAllFrequencyStatuses()
      const m = new Map()
      for (const r of rows) m.set(r.rank, r.status)
      setStatusByRank(m)
      setCurrent(pickNextLearnRank(entries, buildVaultKeySet(wNew), m, current.rank + 1))
      setFreqList(await getWordsFromFrequencySource())
    } catch (e) {
      console.error(e)
      showAppToast('Could not add word')
    }
    setAdding(false)
  }

  const learnedToday = session?.frequencyWordsLearned || 0

  useEffect(() => {
    getWordsFromFrequencySource().then(setFreqList)
  }, [words, learnedToday])

  if (loadingList) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <Loader2 className="animate-spin text-brand-400" size={36} />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="card p-6 bg-gradient-to-r from-amber-500/10 to-orange-500/5 border-amber-500/20">
        <div className="flex items-start gap-3">
          <ListOrdered className="text-amber-400 shrink-0 mt-0.5" size={22} />
          <div>
            <h2 className="text-lg font-bold text-white">Frequency Lab</h2>
            <p className="text-sm text-slate-400 mt-1">
              5,009 lemmas by frequency. How it works: see <code className="text-amber-200/90">public/FIRST_WEEK_GUIDE.txt</code>{' '}
              (or <code className="text-amber-200/90">/FIRST_WEEK_GUIDE.txt</code> with the dev server).
            </p>
          </div>
        </div>
      </div>

      <div className="card p-5 flex flex-wrap items-center gap-3 justify-between">
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wider">Today</div>
          <div className="text-2xl font-bold text-white">
            {learnedToday} <span className="text-slate-500 text-base font-normal">/ {dailyGoal}</span>
          </div>
          <div className="text-xs text-slate-500">words added from this list</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={handleFullVaultMatch}
            disabled={fullMatchBusy || syncing}
            title="One pass over all ranks still missing a saved known/unknown decision"
          >
            {fullMatchBusy ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
            Match whole list once
          </Button>
          <Button
            variant="secondary"
            onClick={handleAiSync}
            disabled={syncing || fullMatchBusy}
            title="Batch size matches Settings → Frequency Lab words per day (5–40)"
          >
            {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Next {syncBatchSize} only
          </Button>
          <Button variant="secondary" onClick={load} disabled={fullMatchBusy}>
            Refresh
          </Button>
        </div>
        {fullMatchProgress && (
          <p className="text-xs text-slate-500 mt-2 w-full">{fullMatchProgress}</p>
        )}
      </div>

      {current ? (
        <motion.div
          key={current.rank}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-6 space-y-5"
        >
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <span className="text-xs font-semibold text-amber-400">Rank #{current.rank}</span>
              <h3 className="text-3xl font-bold text-white mt-1">{current.headword}</h3>
              <p className="text-sm text-slate-400 mt-2 line-clamp-3">{displayGloss}</p>
              {glossPrefetching && (
                <p className="text-[11px] text-brand-400/90 mt-1">
                  Polishing short English meanings (next ~{FREQUENCY_PREFETCH_WINDOW} words)…
                </p>
              )}
              {lessonPrefetching && (
                <p className="text-[11px] text-brand-400/90 mt-1">
                  Saving AI stories and sentences for the next ~{FREQUENCY_PREFETCH_WINDOW} words (persists after you
                  close the app)…
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => speak(current.headword)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-800 border border-surface-700 text-slate-200 hover:text-white text-sm"
            >
              <Volume2 size={16} />
              Word
            </button>
          </div>

          {fileExamples.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-slate-300 mb-2 flex items-center gap-2">
                <BookOpen size={16} className="text-brand-400" />
                Examples (from frequency list)
              </h4>
              <ul className="space-y-3">
                {fileExamples.map((ex, i) => (
                  <li key={i} className="bg-surface-800/80 rounded-xl p-3 text-sm">
                    <p className="text-white">{ex.de}</p>
                    <p className="text-slate-400 mt-1">{ex.en}</p>
                    <button
                      type="button"
                      onClick={() => speak(ex.de)}
                      className="mt-2 text-xs text-brand-400 hover:underline"
                    >
                      Play German
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {lessonError && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3">{lessonError}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleGenerateLesson} disabled={loadingLesson || lessonPrefetching}>
              {loadingLesson ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  {lesson ? 'Regenerate story + sentences' : 'AI: story + extra sentences'}
                </>
              )}
            </Button>
            <Button onClick={handleAddWord} disabled={adding} variant="secondary">
              {adding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Add to my list & SRS
            </Button>
          </div>

          {lesson && (
            <div className="space-y-4 border-t border-surface-700 pt-5">
              {lesson.glossShort && (
                <p className="text-brand-300 text-sm font-medium">{lesson.glossShort}</p>
              )}
              {String(lesson.fullMeaning || '').trim() && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-300 mb-1.5">Full meaning</h4>
                  <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">
                    {String(lesson.fullMeaning).trim()}
                  </p>
                </div>
              )}
              {Array.isArray(lesson.sentences) && lesson.sentences.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-300 mb-2">AI sentences</h4>
                  <ul className="space-y-3">
                    {lesson.sentences.map((s, i) => (
                      <li key={i} className="bg-surface-800/80 rounded-xl p-3 text-sm">
                        <p className="text-white">{s.de}</p>
                        <p className="text-slate-400 mt-1">{String(s.en || '').trim() || '—'}</p>
                        <button
                          type="button"
                          onClick={() => speak(s.de)}
                          className="mt-2 text-xs text-brand-400 hover:underline"
                        >
                          Play
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {lesson.storyDe && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-300 mb-2">Story (German)</h4>
                  <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">{lesson.storyDe}</p>
                  <button
                    type="button"
                    onClick={() => speak(lesson.storyDe)}
                    className="mt-2 text-xs text-brand-400 hover:underline"
                  >
                    Play full story
                  </button>
                  {lesson.storyEn && (
                    <p className="text-slate-500 text-xs mt-3 italic border-l-2 border-surface-600 pl-3">
                      {lesson.storyEn}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </motion.div>
      ) : (
        <div className="card p-8 text-center text-slate-400">
          <CheckCircle2 className="mx-auto mb-3 text-green-400" size={40} />
          <p>No next word found — your vault may already cover the list, or run AI sync.</p>
        </div>
      )}

      <div className="card p-5">
        <h4 className="text-sm font-semibold text-white mb-1">
          Words from Frequency Lab &amp; Story Studio
          {freqListSorted.length > 0 && (
            <span className="text-slate-500 font-normal">
              {' '}
              · {freqListSorted.length.toLocaleString()}{' '}
              {freqListSorted.length === 1 ? 'word' : 'words'}
            </span>
          )}
        </h4>
        <p className="text-xs text-slate-500 mb-3">
          Newest at top · click a word for saved AI examples and micro-story · badge shows source · same words appear in
          Vocab Vault and Flashcards.
        </p>
        {freqList.length === 0 ? (
          <p className="text-xs text-slate-500">None yet. Add words above; they also appear in Vocab Vault & Flashcards.</p>
        ) : (
          <>
            <div className="border-t border-surface-800 pt-3 mb-3">
              <p className="text-xs text-slate-500 mb-2 leading-relaxed">
                <span className="text-slate-400">Consolidation story:</span> one German mini-story built only from this
                list — up to {CONSOLIDATION_FOCUS_MAX} <span className="text-slate-300">newest</span>{' '}
                words drive the plot; up to {CONSOLIDATION_GLUE_MAX}{' '}
                <span className="text-slate-300">most frequent (lowest rank)</span> words scaffold the
                text so it stays comprehensible (i+1 / narrow recycling).
              </p>
              {reviewStoryArchive.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] text-slate-500 mb-1.5">
                    Saved review stories (last 4) — tap a title to reopen
                  </p>
                  <ul className="max-h-28 overflow-y-auto space-y-1 pr-0.5">
                    {reviewStoryArchive.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() =>
                            setConsolidationModal({
                              status: 'ready',
                              storyDe: s.storyDe,
                              storyEn: s.storyEn,
                              titleDe: s.titleDe,
                              focusCount: s.focusCount,
                              glueCount: s.glueCount,
                              focusLemmas: Array.isArray(s.focusLemmas) ? s.focusLemmas : [],
                              tokenGlosses: s.tokenGlosses || {},
                            })
                          }
                          className="w-full text-left rounded-lg border border-surface-700 bg-surface-900/60 px-2 py-1.5 text-[11px] text-slate-300 hover:border-brand-500/30 hover:bg-surface-800/80 transition-colors"
                        >
                          <div className="truncate">{s.titleDe?.trim() || 'Review story'}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{formatRelativeTime(s.createdAt)}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap gap-2 mb-3">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleGenerateConsolidationStory}
                  disabled={freqList.length < 3 || consolidationModal?.status === 'loading'}
                  icon={
                    consolidationModal?.status === 'loading' ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <ScrollText size={14} />
                    )
                  }
                >
                  {consolidationModal?.status === 'loading' ? 'Writing story…' : 'AI review story'}
                </Button>
              </div>
              <p className="text-xs text-slate-500 mb-2">Revise: random word from this list + AI example</p>
              <div className="flex flex-wrap gap-2 mb-3">
                <Button type="button" size="sm" variant="secondary" onClick={pickRandomFreqWord}>
                  Random word
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={loadFreqPracticeSentence}
                  disabled={!freqPracticeWord || freqPracticeBusy}
                  icon={freqPracticeBusy ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
                >
                  {freqPracticeBusy ? '…' : 'Make example sentence'}
                </Button>
              </div>
              {freqPracticeWord && (
                <button
                  type="button"
                  onClick={() => openSavedLessonForWord(freqPracticeWord)}
                  className="w-full rounded-xl bg-surface-800/60 border border-surface-700 p-3 text-sm mb-3 text-left hover:border-brand-500/35 hover:bg-surface-800/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                >
                  <p className="text-white font-medium">{freqPracticeWord.german}</p>
                  <p className="text-slate-500 text-xs">{freqPracticeWord.translation || '—'}</p>
                  <p className="text-[10px] text-brand-400/90 mt-1">Open saved lesson and story →</p>
                  {freqPracticeSentence && (
                    <p className="text-slate-300 mt-2 italic">{freqPracticeSentence}</p>
                  )}
                </button>
              )}
            </div>
            <ul className="max-h-72 overflow-y-auto space-y-1 text-sm">
              {freqListSorted.map((w) => (
                  <li key={w.id} className="border-b border-surface-800 pb-1 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => openSavedLessonForWord(w)}
                      className="w-full text-left rounded-xl px-2 py-2 hover:bg-surface-800/80 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                    >
                      <div className="flex justify-between gap-3 items-start">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-white">{w.german}</span>
                            {(w.learnSource === 'story' || w.source === 'story') && (
                              <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-300 border border-violet-500/25">
                                Story
                              </span>
                            )}
                            {(w.learnSource === 'frequency' || w.source === 'frequency') && (
                              <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                                Freq
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5 leading-snug">{w.translation || '—'}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <BookOpen size={14} className="text-slate-600" aria-hidden />
                          <span className="text-slate-500 text-xs">#{w.frequencyRank ?? '—'}</span>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
            </ul>
          </>
        )}
      </div>

      <Modal
        isOpen={savedLessonModal != null}
        onClose={closeSavedLessonModal}
        title={
          savedLessonModal
            ? `${savedLessonModal.word.german} · ${
                savedLessonModal.word.learnSource === 'story' || savedLessonModal.word.source === 'story'
                  ? 'Story Studio'
                  : `rank #${savedLessonModal.word.frequencyRank ?? '—'}`
              }`
            : ''
        }
        size="lg"
      >
        {savedLessonModal && (
          <>
            <p className="text-sm text-slate-400 mb-4 -mt-1">{savedLessonModal.word.translation || '—'}</p>

            {savedLessonModal.status === 'loading' && (
              <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
                <Loader2 className="animate-spin shrink-0" size={22} />
                <span className="text-sm">Loading saved lesson…</span>
              </div>
            )}

            {savedLessonModal.status === 'error' && (
              <p className="text-sm text-red-400">Could not load the saved lesson. Try again.</p>
            )}

            {savedLessonModal.status === 'empty' && (
              <p className="text-sm text-slate-400 leading-relaxed">
                {savedLessonModal.word.learnSource === 'story' || savedLessonModal.word.source === 'story' ? (
                  <>
                    No micro-lesson is stored on this word (unusual). Try saving the word again from Story Studio, or
                    check that the save completed.
                  </>
                ) : (
                  <>
                    No AI lesson is stored for this frequency rank yet. If you added the word before the story and
                    sentences finished loading, open this word in the main lab above and tap{' '}
                    <span className="text-slate-300">AI: story + extra sentences</span>, wait until it completes, then
                    click the word here again.
                  </>
                )}
              </p>
            )}

            {savedLessonModal.status === 'ready' && savedLessonModal.lesson && (
              <div className="space-y-5">
                {savedLessonModal.lesson.glossShort && (
                  <p className="text-brand-300 text-sm font-medium">{savedLessonModal.lesson.glossShort}</p>
                )}
                {String(savedLessonModal.lesson.fullMeaning || '').trim() && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-300 mb-1.5">Full meaning</h4>
                    <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">
                      {String(savedLessonModal.lesson.fullMeaning).trim()}
                    </p>
                  </div>
                )}
                {Array.isArray(savedLessonModal.lesson.sentences) &&
                  savedLessonModal.lesson.sentences.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-2">AI example sentences</h4>
                      <ul className="space-y-3">
                        {savedLessonModal.lesson.sentences.map((s, i) => (
                          <li key={i} className="bg-surface-800/80 rounded-xl p-3 text-sm">
                            <p className="text-white">{s.de}</p>
                            <p className="text-slate-400 mt-1">{String(s.en || '').trim() || '—'}</p>
                            <button
                              type="button"
                              onClick={() => speak(s.de)}
                              className="mt-2 text-xs text-brand-400 hover:underline"
                            >
                              Play
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                {savedLessonModal.lesson.storyDe && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-300 mb-2">Story (German)</h4>
                    <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">
                      {savedLessonModal.lesson.storyDe}
                    </p>
                    <button
                      type="button"
                      onClick={() => speak(savedLessonModal.lesson.storyDe)}
                      className="mt-2 text-xs text-brand-400 hover:underline"
                    >
                      Play full story
                    </button>
                    {savedLessonModal.lesson.storyEn && (
                      <p className="text-slate-500 text-xs mt-3 italic border-l-2 border-surface-600 pl-3">
                        {savedLessonModal.lesson.storyEn}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Modal>

      <Modal
        isOpen={consolidationModal != null}
        onClose={closeConsolidationModal}
        title={
          consolidationModal?.status === 'ready' && consolidationModal.titleDe
            ? consolidationModal.titleDe
            : 'Frequency Lab review story'
        }
        size="lg"
      >
        {consolidationModal?.status === 'loading' && (
          <div className="flex flex-col items-center justify-center py-14 gap-3 text-slate-400">
            <Loader2 className="animate-spin" size={28} />
            <p className="text-sm text-center px-2">
              Writing a short German story from your Frequency Lab words (recent focus + high-frequency scaffolding)…
            </p>
          </div>
        )}

        {consolidationModal?.status === 'error' && (
          <p className="text-sm text-red-400">{consolidationModal.message}</p>
        )}

        {consolidationModal?.status === 'ready' && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              Plot focus: {consolidationModal.focusCount} newest · Scaffolding: {consolidationModal.glueCount} most
              frequent from your list (excluding focus lemmas)
            </p>
            {Array.isArray(consolidationModal.focusLemmas) && consolidationModal.focusLemmas.length > 0 && (
              <p className="text-[11px] text-slate-600 leading-snug">
                Focus lemmas: {consolidationModal.focusLemmas.join(', ')}
              </p>
            )}
            <div>
              <h4 className="text-sm font-semibold text-slate-300 mb-2">German</h4>
              <StoryText
                text={consolidationModal.storyDe}
                knownWords={storyKnownWordsSet}
                knownTranslations={storyKnownWordMap}
                unknownMeanings={{}}
                surfaceGlosses={normalizeSurfaceGlosses(consolidationModal.tokenGlosses || {})}
              />
              <button
                type="button"
                onClick={() => speak(consolidationModal.storyDe)}
                className="mt-3 text-xs text-brand-400 hover:underline inline-flex items-center gap-1"
              >
                <Volume2 size={12} />
                Play full story
              </button>
            </div>
            {consolidationModal.storyEn && (
              <div className="pt-3 border-t border-surface-700">
                <h4 className="text-sm font-semibold text-slate-300 mb-2">English summary</h4>
                <p className="text-slate-400 text-sm leading-relaxed">{consolidationModal.storyEn}</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
