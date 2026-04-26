import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Plus, Trash2, ChevronDown, Eye, EyeOff, Loader2, RefreshCw,
  BarChart3, ListOrdered,
} from 'lucide-react'
import {
  initDB,
  getAllStories,
  saveStory,
  deleteStory,
  updateStoryProgress,
  getAllWords,
  updateTodaySession,
  getTodaySession,
  addXP,
  getStory,
  updateStoryRecord,
  recordStoryChapterEncounters,
  getAllFrequencyStatuses,
  putFrequencyLesson,
  putFrequencyStatus,
  addWordFromFrequency,
  addWordFromFrequencyTale,
  buildVaultKeySet,
} from '../lib/db'
import { estimateLexicalCoverage } from '../lib/storyMining'
import {
  generateFrequencyTargetsStory,
  explainUnknownWords,
  generateSurfaceGlossesForGermanText,
  normalizeSurfaceGlosses,
} from '../lib/deepseek'
import { germanVoice } from '../lib/voice'
import { useVoice } from '../hooks/useVoice'
import { showXPToast, showAppToast } from '../components/shared/XPToast'
import { unlockStoryReadyAudio, playStoryReadyChime } from '../lib/storyReadySound'
import { shouldIgnoreGlobalKeydown } from '../lib/keyboardGuards'
import { normalizeGerman } from '../lib/wordParser'
import StoryText from '../components/story/StoryText'
import AudioControls from '../components/story/AudioControls'
import ShadowMode from '../components/story/ShadowMode'
import WordPopup from '../components/story/WordPopup'
import { extractStoryEncounterContext } from '../lib/storyContext'
import { parseStoryContent } from '../lib/storyParse'
import Modal from '../components/shared/Modal'
import Button from '../components/shared/Button'
import { loadFrequencyEntries, collectUpcomingFrequencyEntries } from '../lib/frequencyData'
import { matchFrequencyTargetEntry, frequencyTargetEntriesToKeySet } from '../lib/frequencyTargetMatch'
import {
  FREQ_TALES_TARGET_OPTIONS,
  FREQ_TALES_DEFAULT_TARGET_COUNT,
  STORY_TYPE_FREQUENCY_TALES,
  chaptersForFrequencyTargets,
  loadSavedFrequencyTaleGoal,
  persistFrequencyTaleGoal,
} from '../lib/frequencyTalesConstants'

function normalizeWordMeanings(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj || {})) {
    out[normalizeGerman(k)] = v
  }
  return out
}

export default function FrequencyTales() {
  const { id } = useParams()
  const { rate, changeRate, voices, selectedVoiceURI, changeVoice, stop } = useVoice()

  const [view, setView] = useState('library')
  const [stories, setStories] = useState([])
  const [entries, setEntries] = useState([])
  const [statusByRank, setStatusByRank] = useState(() => new Map())
  const [currentStory, setCurrentStory] = useState(null)
  const [currentChapterIdx, setCurrentChapterIdx] = useState(0)
  const [knownWordsSet, setKnownWordsSet] = useState(new Set())
  const [knownWordMap, setKnownWordMap] = useState(() => new Map())
  const [wordMeanings, setWordMeanings] = useState({})
  const [storyTimerMode, setStoryTimerMode] = useState('read')
  const [regenTarget, setRegenTarget] = useState(null)
  const [regenLoadingId, setRegenLoadingId] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)

  const speakChunksRef = useRef([])
  const playbackStateRef = useRef('stopped')
  const pausedAtSentenceRef = useRef(0)
  const speakingSentenceIndexRef = useRef(0)
  const isPlayingRef = useRef(false)
  const [showSummary, setShowSummary] = useState(false)
  const [shadowMode, setShadowMode] = useState(false)
  const [activeWordPopup, setActiveWordPopup] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [words, setWords] = useState([])
  const [wordCount, setWordCount] = useState(0)
  /** How many queued frequency targets to pull into the next tale (10–40); chapters = targets actually collected. */
  const [targetGoal, setTargetGoal] = useState(() => loadSavedFrequencyTaleGoal())

  const vaultKeys = useMemo(() => buildVaultKeySet(words), [words])

  const frequencyTargetKeys = useMemo(
    () => frequencyTargetEntriesToKeySet(currentStory?.frequencyTargetEntries),
    [currentStory]
  )

  useEffect(() => {
    ;(async () => {
      await initDB()
      try {
        const [e, w, allStories, rows] = await Promise.all([
          loadFrequencyEntries(),
          getAllWords(),
          getAllStories(),
          getAllFrequencyStatuses(),
        ])
        setEntries(e)
        setWords(w)
        const m = new Map()
        for (const r of rows) m.set(r.rank, r.status)
        setStatusByRank(m)
        setStories(allStories.filter((s) => s.storyType === STORY_TYPE_FREQUENCY_TALES))
        rebuildKnownFromWords(w)
      } catch (err) {
        console.error(err)
        showAppToast('Could not load Frequency Tales data.')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (id) {
      const story = stories.find((s) => s.id === parseInt(id, 10))
      if (story) openStory(story)
    }
  }, [id, stories])

  useEffect(() => {
    persistFrequencyTaleGoal(targetGoal)
  }, [targetGoal])

  function rebuildKnownFromWords(w) {
    const set = new Set(w.map((x) => x.normalizedKey))
    const map = new Map()
    w.forEach((x) => map.set(x.normalizedKey, x.translation))
    setKnownWordsSet(set)
    setKnownWordMap(map)
    setWordCount(w.length)
  }

  const refreshStatuses = useCallback(async () => {
    const rows = await getAllFrequencyStatuses()
    const m = new Map()
    for (const r of rows) m.set(r.rank, r.status)
    setStatusByRank(m)
  }, [])

  const loadStories = async () => {
    const all = await getAllStories()
    setStories(all.filter((s) => s.storyType === STORY_TYPE_FREQUENCY_TALES))
  }

  const loadKnownWords = async () => {
    const w = await getAllWords()
    setWords(w)
    rebuildKnownFromWords(w)
  }

  const resetStoryPlayback = useCallback(() => {
    window.speechSynthesis.cancel()
    germanVoice.stop()
    playbackStateRef.current = 'stopped'
    pausedAtSentenceRef.current = 0
    speakingSentenceIndexRef.current = 0
    speakChunksRef.current = []
    isPlayingRef.current = false
    setIsPlaying(false)
  }, [])

  const openStory = (story) => {
    resetStoryPlayback()
    setCurrentStory(story)
    setCurrentChapterIdx(story.currentChapter || 0)
    setWordMeanings(normalizeWordMeanings(story.wordMeanings || {}))
    setStoryTimerMode('read')
    setView('reader')
    setShowSummary(false)
    stop()
  }

  const buildKnownGermanWithVariants = useCallback(() => {
    const seenGk = new Set()
    const knownGerman = []
    for (const w of words) {
      for (const g of [w.german, ...(Array.isArray(w.variants) ? w.variants : [])]) {
        const t = String(g || '').trim()
        if (!t) continue
        const nk = normalizeGerman(t)
        if (seenGk.has(nk)) continue
        seenGk.add(nk)
        knownGerman.push(t)
      }
    }
    return knownGerman
  }, [words])

  const pickTargetsForTale = useCallback(
    (goal) => {
      const nGoal = Math.max(1, Math.floor(Number(goal) || 1))
      const primary = collectUpcomingFrequencyEntries(entries, vaultKeys, statusByRank, nGoal, 1)
      if (primary.length >= nGoal) return primary

      // Top-up path: stale AI status can mark words "known" even when not in vault.
      // For tales, prioritize hitting the selected batch size from not-in-vault entries.
      const usedRanks = new Set(primary.map((e) => e.rank))
      const extras = []
      for (const e of [...entries].sort((a, b) => a.rank - b.rank)) {
        if (usedRanks.has(e.rank)) continue
        const nk = normalizeGerman(e.headword)
        if (vaultKeys.has(nk)) continue
        extras.push(e)
        if (primary.length + extras.length >= nGoal) break
      }
      return [...primary, ...extras]
    },
    [entries, vaultKeys, statusByRank]
  )

  const handleGenerate = async () => {
    const apiKey = localStorage.getItem('dr_api_key')
    if (!apiKey?.trim()) {
      showAppToast('Add your DeepSeek API key in Settings.')
      return
    }
    const targets = pickTargetsForTale(targetGoal)
    if (!targets.length) {
      showAppToast('No upcoming frequency words — sync your list in Frequency Lab or check your vault.')
      return
    }

    const chapterCount = chaptersForFrequencyTargets(targets.length)
    if (targets.length < targetGoal) {
      showAppToast(
        `Only ${targets.length} words left in your queue — generating ${chapterCount} chapter${chapterCount === 1 ? '' : 's'}.`
      )
    }

    setGenerating(true)
    unlockStoryReadyAudio()
    try {
      const knownGerman = buildKnownGermanWithVariants()
      const raw = await generateFrequencyTargetsStory({
        targetEntries: targets.map((e) => ({
          rank: e.rank,
          headword: e.headword,
          detailSnippet: e.detail || '',
        })),
        knownGermanWords: knownGerman,
        chapterCount,
        cefrHint: 'A1',
      })
      const chapters = parseStoryContent(raw)
      if (!chapters.length) throw new Error('Could not parse chapters — try again.')

      const title = chapters[0]?.title || 'Frequency tale'
      const allText = chapters.map((c) => c.text).join(' ')
      const wordTokens = [...new Set(allText.toLowerCase().match(/[a-zäöüß]+/gi) || [])]
      const unknowns = wordTokens.filter((w) => w.length > 3 && !knownWordsSet.has(normalizeGerman(w))).slice(0, 30)

      let meanings = {}
      if (unknowns.length > 0) {
        try {
          meanings = await explainUnknownWords(unknowns)
        } catch {}
      }

      let surfaceGlosses = {}
      try {
        surfaceGlosses = await generateSurfaceGlossesForGermanText(allText)
      } catch (e) {
        console.warn('[FrequencyTales] surface glosses', e)
      }

      const rankSummary = targets.map((t) => t.rank).join(', ')
      const themeLabel = `Targets: ranks ${rankSummary}`

      const storyId = await saveStory({
        storyType: STORY_TYPE_FREQUENCY_TALES,
        title,
        theme: themeLabel,
        level: 'A1',
        content: raw,
        chapters,
        wordMeanings: normalizeWordMeanings(meanings),
        surfaceGlosses,
        frequencyTargetEntries: targets.map((e) => ({ rank: e.rank, headword: e.headword })),
        frequencyTargetGoal: targetGoal,
        frequencyChapterCount: chapterCount,
      })

      await loadStories()
      const saved = await getStory(storyId)
      if (saved) openStory(saved)
      playStoryReadyChime()
      showAppToast('Tale saved — red highlights are your frequency targets.')
      showAppToast(`Selected ${targets.length} targets, generated ${chapters.length} chapters.`)
    } catch (e) {
      showAppToast(e.message === 'NO_API_KEY' ? 'Add API key in Settings' : `Error: ${e.message}`)
    }
    setGenerating(false)
  }

  const handleConfirmRegenerate = async () => {
    if (!regenTarget) return
    const story = regenTarget
    const apiKey = localStorage.getItem('dr_api_key')
    if (!apiKey?.trim()) {
      showAppToast('Add your DeepSeek API key in Settings.')
      setRegenTarget(null)
      return
    }
    setRegenLoadingId(story.id)
    setRegenTarget(null)
    try {
      const goal =
        story.frequencyTargetGoal ??
        story.frequencyTargetEntries?.length ??
        FREQ_TALES_DEFAULT_TARGET_COUNT
      const targets = pickTargetsForTale(goal)
      if (!targets.length) {
        showAppToast('No upcoming frequency words to build a new tale.')
        setRegenLoadingId(null)
        return
      }
      const chapterCount = chaptersForFrequencyTargets(targets.length)
      const knownGerman = buildKnownGermanWithVariants()
      const raw = await generateFrequencyTargetsStory({
        targetEntries: targets.map((e) => ({
          rank: e.rank,
          headword: e.headword,
          detailSnippet: e.detail || '',
        })),
        knownGermanWords: knownGerman,
        chapterCount,
        cefrHint: 'A1',
      })
      const chapters = parseStoryContent(raw)
      if (!chapters.length) throw new Error('Could not parse chapters — try again.')

      const allText = chapters.map((c) => c.text).join(' ')
      const wordTokens = [...new Set(allText.toLowerCase().match(/[a-zäöüß]+/gi) || [])]
      const unknowns = wordTokens.filter((w) => w.length > 3 && !knownWordsSet.has(normalizeGerman(w))).slice(0, 30)

      let meanings = {}
      if (unknowns.length > 0) {
        try {
          meanings = await explainUnknownWords(unknowns)
        } catch {}
      }

      let surfaceGlosses = {}
      try {
        surfaceGlosses = await generateSurfaceGlossesForGermanText(allText)
      } catch (e) {
        console.warn('[FrequencyTales] regenerate glosses', e)
      }

      const rankSummary = targets.map((t) => t.rank).join(', ')
      await updateStoryRecord(story.id, {
        content: raw,
        chapters,
        wordMeanings: normalizeWordMeanings(meanings),
        surfaceGlosses,
        frequencyTargetEntries: targets.map((e) => ({ rank: e.rank, headword: e.headword })),
        frequencyTargetGoal: goal,
        frequencyChapterCount: chapterCount,
        title: chapters[0]?.title || story.title,
        theme: `Targets: ranks ${rankSummary}`,
        createdAt: Date.now(),
      })
      await loadStories()
      showAppToast('Tale regenerated!')
      showAppToast(`Selected ${targets.length} targets, generated ${chapters.length} chapters.`)
      if (currentStory?.id === story.id) {
        const updated = await getStory(story.id)
        if (updated) {
          setCurrentStory(updated)
          setWordMeanings(normalizeWordMeanings(updated.wordMeanings || {}))
        }
      }
    } catch (e) {
      showAppToast(e.message === 'NO_API_KEY' ? 'Add API key in Settings' : `Regenerate failed: ${e.message}`)
    }
    setRegenLoadingId(null)
  }

  const handlePlay = useCallback(() => {
    if (!currentStory) return
    const chapter = currentStory.chapters[currentChapterIdx]
    if (!chapter) return

    if (playbackStateRef.current === 'playing' && window.speechSynthesis.speaking) return

    if (!shadowMode && storyTimerMode === 'read') {
      setStoryTimerMode('listen')
    }

    const onListenEnd = () => {
      playbackStateRef.current = 'stopped'
      pausedAtSentenceRef.current = 0
      speakingSentenceIndexRef.current = 0
      isPlayingRef.current = false
      setIsPlaying(false)
    }

    if (playbackStateRef.current === 'paused') {
      const start = Math.min(pausedAtSentenceRef.current, speakChunksRef.current.length)
      playbackStateRef.current = 'playing'
      isPlayingRef.current = true
      setIsPlaying(true)
      germanVoice.speakChunks(speakChunksRef.current, start, {
        onUtteranceStart: (idx) => {
          speakingSentenceIndexRef.current = idx
          pausedAtSentenceRef.current = idx
        },
        onAfterUtterance: (idx) => {
          pausedAtSentenceRef.current = idx + 1
        },
        onEnd: onListenEnd,
      })
      return
    }

    const chunks = germanVoice.getSpeakChunks(chapter.text).slice()
    speakChunksRef.current = chunks
    pausedAtSentenceRef.current = 0
    speakingSentenceIndexRef.current = 0
    playbackStateRef.current = 'playing'
    isPlayingRef.current = true
    setIsPlaying(true)

    germanVoice.speakChunks(chunks, 0, {
      onUtteranceStart: (idx) => {
        speakingSentenceIndexRef.current = idx
        pausedAtSentenceRef.current = idx
      },
      onAfterUtterance: (idx) => {
        pausedAtSentenceRef.current = idx + 1
      },
      onEnd: onListenEnd,
    })
  }, [currentStory, currentChapterIdx, shadowMode, storyTimerMode])

  const handlePause = useCallback(() => {
    window.speechSynthesis.cancel()
    germanVoice.stop()
    playbackStateRef.current = 'paused'
    pausedAtSentenceRef.current = speakingSentenceIndexRef.current
    isPlayingRef.current = false
    setIsPlaying(false)
  }, [])

  useEffect(() => {
    if (view !== 'reader' || !currentStory || shadowMode || activeWordPopup) return undefined
    const onKey = (e) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      if (shouldIgnoreGlobalKeydown(e)) return
      e.preventDefault()
      if (isPlaying) handlePause()
      else handlePlay()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [view, currentStory, shadowMode, activeWordPopup, isPlaying, handlePlay, handlePause])

  const flushChapterEncounters = async () => {
    if (!currentStory) return
    const ch = currentStory.chapters[currentChapterIdx]
    if (!ch) return
    const body = ch.text.replace(/^Kapitel[^\n]+\n?/i, '')
    await recordStoryChapterEncounters(currentStory.id, currentChapterIdx, body)
  }

  const handleChapterChange = async (newIdx) => {
    if (!currentStory || newIdx < 0 || newIdx >= currentStory.chapters.length) return
    window.speechSynthesis.cancel()
    germanVoice.stop()
    playbackStateRef.current = 'stopped'
    pausedAtSentenceRef.current = 0
    speakingSentenceIndexRef.current = 0
    speakChunksRef.current = []
    isPlayingRef.current = false
    setIsPlaying(false)
    stop()
    setShowSummary(false)

    const leaving = currentStory.chapters[currentChapterIdx]
    if (leaving && currentChapterIdx !== newIdx) {
      const body = leaving.text.replace(/^Kapitel[^\n]+\n?/i, '')
      await recordStoryChapterEncounters(currentStory.id, currentChapterIdx, body)
    }

    const session = await getTodaySession()
    if (currentChapterIdx !== newIdx) {
      await updateTodaySession({
        storiesRead: (session.storiesRead || 0) + 1,
        frequencyTalesChaptersRead: (session.frequencyTalesChaptersRead || 0) + 1,
      })
      await addXP(20)
      showXPToast(20, 'Chapter read!')
    }

    setCurrentChapterIdx(newIdx)
    await updateStoryProgress(currentStory.id, newIdx)
    setCurrentStory((prev) => ({ ...prev, currentChapter: newIdx }))
  }

  const handleShadowComplete = async () => {
    setShadowMode(false)
    const session = await getTodaySession()
    await updateTodaySession({
      shadowingMinutes: (session.shadowingMinutes || 0) + 10,
      storyShadowMinutes: (session.storyShadowMinutes || 0) + 10,
    })
    await addXP(25)
    showXPToast(25, 'Shadowing complete!')
  }

  const handleWordClick = (lookupKey, displayWord) => {
    const chapter = currentStory?.chapters[currentChapterIdx]
    const raw = chapter?.text || ''
    const richContext = extractStoryEncounterContext(raw, displayWord, lookupKey)
    const fallback =
      chapter?.text?.split(/[.!?]/).find((s) =>
        s.toLowerCase().includes((lookupKey || displayWord || '').toLowerCase())
      ) || ''
    const context = (richContext || '').trim() || fallback.trim()
    setActiveWordPopup({ word: displayWord || lookupKey, context })
  }

  const handleFreqTaleExternalSave = useCallback(
    async ({ lemma, gloss, lesson, context, variants }) => {
      const targets = currentStory?.frequencyTargetEntries
      const nk = normalizeGerman(lemma)
      const entry = matchFrequencyTargetEntry(targets, nk)
      const cueSentenceEn = String(lesson?.sentences?.[0]?.en || '').trim()
      const exampleDe = String(lesson?.sentences?.[0]?.de || '').trim()
      const glossFinal =
        String(lesson?.glossShort || '').trim() || String(gloss || '').trim() || 'Imported'
      const germanLemma = String(lemma || '').trim().split(/[,;/]/)[0].trim()
      const variantList = Array.isArray(variants) ? variants : []

      if (entry) {
        await putFrequencyLesson(entry.rank, lesson)
        const res = await addWordFromFrequency(germanLemma, glossFinal, entry.rank, {
          example: exampleDe || null,
          cueSentenceEn: cueSentenceEn || undefined,
          storyEncounterContext: String(context || '').trim().slice(0, 3500) || undefined,
        })
        if (res.alreadyExists) {
          showAppToast('Already in your vault.')
          await putFrequencyStatus(entry.rank, { status: 'known', note: 'vault' })
        } else {
          await putFrequencyStatus(entry.rank, { status: 'known', note: 'added' })
          const sess = await getTodaySession()
          await updateTodaySession({
            frequencyWordsLearned: (sess.frequencyWordsLearned || 0) + 1,
            newWordsLearned: (sess.newWordsLearned || 0) + 1,
          })
          await addXP(15)
          showXPToast(15, 'Word added!')
          showAppToast('Saved — flashcards use your story moment.')
        }
        await loadKnownWords()
        await refreshStatuses()
        return true
      }

      const resTale = await addWordFromFrequencyTale(germanLemma, glossFinal, {
        microLesson: lesson,
        variants: variantList,
        example: exampleDe || null,
        cueSentenceEn: cueSentenceEn || undefined,
        storyEncounterContext: String(context || '').trim().slice(0, 3500) || undefined,
      })
      if (resTale.alreadyExists) {
        showAppToast('Already in your vocabulary.')
      } else {
        const sess = await getTodaySession()
        await updateTodaySession({
          newWordsLearned: (sess.newWordsLearned || 0) + 1,
        })
        await addXP(15)
        showXPToast(15, 'Word added!')
        showAppToast('Saved — appears with Tales badge in Frequency Lab.')
      }
      await loadKnownWords()
      await refreshStatuses()
      return true
    },
    [currentStory, refreshStatuses]
  )

  const handleToggleShadow = () => {
    if (!shadowMode) {
      setStoryTimerMode('shadow')
      setShadowMode(true)
    } else {
      setStoryTimerMode('read')
      setShadowMode(false)
    }
  }

  const readerChapter = view === 'reader' && currentStory ? currentStory.chapters[currentChapterIdx] : null
  const coverage = useMemo(() => {
    if (!readerChapter) return null
    const body = readerChapter.text.replace(/^Kapitel[^\n]+\n?/i, '')
    return estimateLexicalCoverage(body, knownWordsSet)
  }, [readerChapter, knownWordsSet])

  const sentences = readerChapter ? germanVoice.getSentences(readerChapter.text) : []

  // ─── Library ───────────────────────────────────────────────────────────────
  if (view === 'library') {
    return (
      <div className="max-w-4xl mx-auto space-y-5 relative">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white">Frequency Tales</h2>
            <p className="text-sm text-slate-400 mt-1">
              Each tale pulls the next words from your frequency queue. New targets are highlighted in{' '}
              <span className="text-red-300">red</span> until you save them; all other content words come from your
              vault (plus basic German function words). Tap a word → save like Story Studio.
            </p>
          </div>
          <Button
            onClick={handleGenerate}
            disabled={generating || loading}
            className="shrink-0"
            icon={<Plus size={16} />}
          >
            {generating ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Writing tale…
              </>
            ) : (
              <>Generate next tale</>
            )}
          </Button>
        </div>

        {!loading && (
          <div className="card p-4 border border-teal-800/40 bg-teal-950/20">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              How many new words this time?
            </div>
            <div className="flex flex-wrap gap-2">
              {FREQ_TALES_TARGET_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={generating}
                  onClick={() => setTargetGoal(n)}
                  className={`min-w-[3rem] px-3 py-2 rounded-xl text-sm font-semibold transition-all border ${
                    targetGoal === n
                      ? 'bg-teal-500/25 border-teal-500 text-teal-200 shadow-sm'
                      : 'bg-surface-800 border-surface-600 text-slate-400 hover:text-slate-200 hover:border-surface-500'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-3 leading-relaxed">
              We target <strong className="text-slate-400">{targetGoal}</strong> new frequency words (if available), and
              the model decides the chapter count needed to cover them in simple A1 story flow. If fewer words are left in
              your queue, we shorten the batch and tell you.
            </p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-brand-400" />
          </div>
        ) : stories.length === 0 ? (
          <div className="card p-16 text-center">
            <ListOrdered size={48} className="text-teal-500/80 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-300 mb-2">No tales yet</h3>
            <p className="text-slate-500 mb-5">
              Uses the same generator as Frequency Lab — your known words plus the next ranks in your queue.
            </p>
            <Button onClick={handleGenerate} disabled={generating}>
              Generate your first tale
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {stories.map((story, i) => (
              <motion.div
                key={story.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="card p-5 hover:border-teal-500/40 transition-colors relative overflow-hidden"
              >
                {regenLoadingId === story.id && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-[inherit] bg-surface-950/85 backdrop-blur-[2px]">
                    <Loader2 size={28} className="animate-spin text-teal-400" />
                    <p className="text-sm text-slate-300 mt-2 font-medium">Generating…</p>
                  </div>
                )}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-white truncate">{story.title}</h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="badge-blue">{story.level || 'A1'}</span>
                      <span className="text-xs text-slate-500 truncate max-w-full">{story.theme}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 ml-2">
                    <button
                      type="button"
                      onClick={() => setRegenTarget(story)}
                      disabled={regenLoadingId != null}
                      className="text-slate-600 hover:text-teal-400 p-1.5 rounded-lg transition-colors disabled:opacity-40"
                      aria-label="Regenerate tale"
                    >
                      <RefreshCw size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteStory(story.id).then(loadStories)}
                      disabled={regenLoadingId != null}
                      className="text-slate-600 hover:text-red-400 p-1.5 rounded-lg transition-colors disabled:opacity-40"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="mb-3">
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>
                      Chapter {(story.currentChapter || 0) + 1} / {story.chapters?.length || 0}
                    </span>
                    <span>
                      {Math.round(((story.currentChapter || 0) / (story.chapters?.length || 1)) * 100)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-teal-500 rounded-full transition-all"
                      style={{
                        width: `${Math.round(((story.currentChapter || 0) / (story.chapters?.length || 1)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="text-xs text-slate-500 mb-4 space-y-1">
                  <div>
                    {((story.frequencyTargetEntries?.length ?? 0) > 0 || story.chapters?.length != null) && (
                      <span className="text-teal-500/90 font-medium">
                        {story.frequencyTargetEntries?.length ?? 0} new-word slots
                        {story.chapters?.length != null ? ` · ${story.chapters.length} chapters` : ''}
                        {story.frequencyTargetGoal != null &&
                          story.frequencyTargetGoal !== (story.frequencyTargetEntries?.length ?? 0) && (
                            <span className="text-slate-600 font-normal">
                              {' '}
                              (asked {story.frequencyTargetGoal})
                            </span>
                          )}
                      </span>
                    )}
                  </div>
                  <div>
                    Created {new Date(story.createdAt).toLocaleDateString()}
                    {story.readCount > 0 && ` · Read ${story.readCount}×`}
                    {typeof wordCount === 'number' && (
                      <span className="text-slate-600"> · {wordCount} vault words</span>
                    )}
                  </div>
                </div>

                <Button
                  onClick={() => openStory(story)}
                  variant={story.currentChapter > 0 ? 'primary' : 'secondary'}
                  size="sm"
                  className="w-full"
                >
                  {story.currentChapter > 0 ? 'Continue reading' : 'Start reading'}
                </Button>
              </motion.div>
            ))}
          </div>
        )}

        <Modal
          isOpen={!!regenTarget}
          onClose={() => !regenLoadingId && setRegenTarget(null)}
          title="Regenerate tale?"
          size="md"
        >
          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            Replace this tale with a freshly generated one using your current vault and the next frequency targets in
            queue. This cannot be undone.
          </p>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setRegenTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmRegenerate}>Regenerate</Button>
          </div>
        </Modal>
      </div>
    )
  }

  // ─── Reader ────────────────────────────────────────────────────────────────
  if (!currentStory) return null
  const chapter = currentStory.chapters[currentChapterIdx]

  return (
    <div className="max-w-3xl mx-auto pb-32">
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={async () => {
            await flushChapterEncounters()
            window.speechSynthesis.cancel()
            germanVoice.stop()
            playbackStateRef.current = 'stopped'
            pausedAtSentenceRef.current = 0
            speakingSentenceIndexRef.current = 0
            speakChunksRef.current = []
            isPlayingRef.current = false
            setIsPlaying(false)
            setView('library')
            stop()
            setShadowMode(false)
            setStoryTimerMode('read')
          }}
          className="text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-white truncate">{currentStory.title}</h2>
          <p className="text-xs text-slate-500">{currentStory.theme}</p>
        </div>

        <div className="relative">
          <select
            value={currentChapterIdx}
            onChange={(e) => handleChapterChange(parseInt(e.target.value, 10))}
            className="bg-surface-800 border border-surface-700 text-slate-300 text-sm rounded-xl px-3 py-2 pr-8 focus:outline-none focus:border-teal-500 appearance-none cursor-pointer"
          >
            {currentStory.chapters.map((c, i) => (
              <option key={i} value={i}>
                {c.title}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {chapter && (
        <motion.div
          key={currentChapterIdx}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-6 md:p-8"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
            <h3 className="text-xl font-bold text-white">{chapter.title}</h3>
            {coverage && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <BarChart3 size={14} className="text-teal-400 shrink-0" />
                <span>
                  ~{coverage.percent}% of tokens in your vault ({coverage.known}/{coverage.total})
                </span>
                {coverage.percent >= 95 && <span className="text-green-400/90">· strong coverage</span>}
                {coverage.percent < 85 && <span className="text-amber-400/90">· add vocab or keep reading</span>}
              </div>
            )}
          </div>

          <StoryText
            text={chapter.text.replace(/^Kapitel[^\n]+\n?/i, '')}
            knownWords={knownWordsSet}
            knownTranslations={knownWordMap}
            unknownMeanings={wordMeanings}
            surfaceGlosses={normalizeSurfaceGlosses(currentStory.surfaceGlosses || {})}
            frequencyTargetKeys={frequencyTargetKeys}
            onWordClick={handleWordClick}
          />

          {chapter.summary && (
            <div className="mt-6 pt-4 border-t border-surface-700">
              <button
                type="button"
                onClick={() => setShowSummary((v) => !v)}
                className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                {showSummary ? <EyeOff size={14} /> : <Eye size={14} />}
                {showSummary ? 'Hide' : 'Show'} chapter summary
              </button>
              <AnimatePresence>
                {showSummary && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-2 text-sm text-slate-400 italic bg-surface-800/50 rounded-xl px-4 py-3"
                  >
                    {chapter.summary}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          )}
        </motion.div>
      )}

      <AudioControls
        isPlaying={isPlaying}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={() => {
          window.speechSynthesis.cancel()
          germanVoice.stop()
          playbackStateRef.current = 'stopped'
          pausedAtSentenceRef.current = 0
          speakingSentenceIndexRef.current = 0
          speakChunksRef.current = []
          isPlayingRef.current = false
          setIsPlaying(false)
          stop()
        }}
        onPrevChapter={() => handleChapterChange(currentChapterIdx - 1)}
        onNextChapter={() => handleChapterChange(currentChapterIdx + 1)}
        canGoPrev={currentChapterIdx > 0}
        canGoNext={currentChapterIdx < currentStory.chapters.length - 1}
        rate={rate}
        onRateChange={(r) => {
          changeRate(r)
          if (isPlaying) {
            const idx = speakingSentenceIndexRef.current
            window.speechSynthesis.cancel()
            germanVoice.stop()
            playbackStateRef.current = 'paused'
            pausedAtSentenceRef.current = idx
            isPlayingRef.current = false
            setIsPlaying(false)
            stop()
          }
        }}
        voices={voices}
        selectedVoiceURI={selectedVoiceURI}
        onVoiceChange={changeVoice}
        shadowMode={shadowMode}
        onToggleShadow={handleToggleShadow}
      />

      {shadowMode && chapter && (
        <ShadowMode
          sentences={sentences}
          onClose={() => {
            setStoryTimerMode('read')
            setShadowMode(false)
          }}
          onChapterComplete={handleShadowComplete}
        />
      )}

      <AnimatePresence>
        {activeWordPopup && (
          <WordPopup
            word={activeWordPopup.word}
            context={activeWordPopup.context}
            onClose={() => setActiveWordPopup(null)}
            externalVaultSave={handleFreqTaleExternalSave}
            onSaved={loadKnownWords}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
