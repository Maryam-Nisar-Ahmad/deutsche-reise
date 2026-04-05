import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSettings } from '../hooks/useSettings'
import { motion } from 'framer-motion'
import {
  Sparkles, Volume2, Plus, Loader2, RefreshCw, ListOrdered, CheckCircle2, BookOpen, Database,
  ChevronRight,
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
} from '../lib/deepseek'
import { germanVoice } from '../lib/voice'
import { getLevel } from '../lib/levelCalc'
import SessionTimer from '../components/shared/SessionTimer'
import Button from '../components/shared/Button'
import { showXPToast, showAppToast } from '../components/shared/XPToast'

const AI_MATCH_BATCH = 36
/** Next learnable ranks: gloss + AI lesson prefetch window (matches daily batch size). */
const FREQUENCY_PREFETCH_WINDOW = 30
/** Parallel DeepSeek calls while prefetching lessons (stays under typical rate limits). */
const LESSON_PREFETCH_CONCURRENCY = 3

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

function tryBuildCloze(sentence, lemma) {
  if (!sentence || !lemma) return null
  const forms = [lemma, lemma.charAt(0).toUpperCase() + lemma.slice(1)]
  for (const f of forms) {
    const i = sentence.indexOf(f)
    if (i >= 0) {
      const blanked = sentence.slice(0, i) + '____' + sentence.slice(i + f.length)
      return {
        id: `fl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sentence: blanked,
        fullSentence: sentence,
        answer: f,
        surface: f,
        storyId: '',
        chapterTitle: 'Frequency Lab',
      }
    }
  }
  return null
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
  /** Corpus ranks covered by the last bulk gloss (or lesson-only) prefetch — skip re-calling until current leaves this range. */
  const glossBulkMinRankRef = useRef(null)
  const glossBulkMaxRankRef = useRef(null)
  const dailyGoal = frequencyWordsPerDay
  const cefrHint = useMemo(() => {
    const lv = getLevel(mastered).level
    return lv || 'A2'
  }, [mastered])

  const vaultKeys = useMemo(() => buildVaultKeySet(words), [words])

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
            (Array.isArray(L.sentences) && L.sentences.length > 0))
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

  const speak = (text) => {
    if (!text?.trim()) return
    germanVoice.speakWord(text)
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
        if (batch.length >= AI_MATCH_BATCH) break
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
    const approxBatches = Math.ceil(pending / AI_MATCH_BATCH)
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
          if (batch.length >= AI_MATCH_BATCH) break
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
      const gloss = lesson?.glossShort || baseGloss || 'Imported'
      const seedClozes = []
      const story = lesson?.storyDe || ''
      const sents = lesson?.sentences || []
      const trySents = [story, ...sents.map((s) => s.de).filter(Boolean)]
      for (const s of trySents) {
        const c = tryBuildCloze(s, current.headword)
        if (c) {
          seedClozes.push(c)
          break
        }
      }
      const res = await addWordFromFrequency(current.headword, gloss, current.rank, {
        example: baseGloss.slice(0, 200),
        seedClozes,
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
      <SessionTimer goalMinutes={25} label="Frequency Lab" pageKey="frequency" />

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
          <Button variant="secondary" onClick={handleAiSync} disabled={syncing || fullMatchBusy}>
            {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Next 36 only
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
              {Array.isArray(lesson.sentences) && lesson.sentences.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-300 mb-2">AI sentences</h4>
                  <ul className="space-y-3">
                    {lesson.sentences.map((s, i) => (
                      <li key={i} className="bg-surface-800/80 rounded-xl p-3 text-sm">
                        <p className="text-white">{s.de}</p>
                        <p className="text-slate-400 mt-1">{s.en}</p>
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
        <h4 className="text-sm font-semibold text-white mb-1">Words added from Frequency Lab</h4>
        <p className="text-xs text-slate-500 mb-3">
          Newest at top · same words appear in Vocab Vault (also newest first) and in Flashcards as new cards.
        </p>
        {freqList.length === 0 ? (
          <p className="text-xs text-slate-500">None yet. Add words above; they also appear in Vocab Vault & Flashcards.</p>
        ) : (
          <>
            <div className="border-t border-surface-800 pt-3 mb-3">
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
                <div className="rounded-xl bg-surface-800/60 border border-surface-700 p-3 text-sm mb-3">
                  <p className="text-white font-medium">{freqPracticeWord.german}</p>
                  <p className="text-slate-500 text-xs">{freqPracticeWord.translation || '—'}</p>
                  {freqPracticeSentence && (
                    <p className="text-slate-300 mt-2 italic">{freqPracticeSentence}</p>
                  )}
                </div>
              )}
            </div>
            <ul className="max-h-56 overflow-y-auto space-y-2 text-sm">
              {[...freqList]
                .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
                .map((w) => (
                  <li key={w.id} className="border-b border-surface-800 pb-2">
                    <div className="flex justify-between gap-3 items-start">
                      <div className="min-w-0">
                        <span className="font-medium text-white">{w.german}</span>
                        <p className="text-xs text-slate-400 mt-0.5 leading-snug">{w.translation || '—'}</p>
                      </div>
                      <span className="text-slate-500 text-xs shrink-0">#{w.frequencyRank ?? '—'}</span>
                    </div>
                  </li>
                ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
