import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, CheckCircle, RotateCcw, Brain, Zap, Timer, Star } from 'lucide-react'
import {
  getDueCards,
  getNewCards,
  updateCardAfterReview,
  getCardForWord,
  updateTodaySession,
  getTodaySession,
  addXP,
  getCardStats,
  attachFlashExamplesToCards,
} from '../lib/db'
import { useStreak } from '../hooks/useStreak'
import { useSettings } from '../hooks/useSettings'
import { estimateWeeklyReviewLoad } from '../lib/reviewLoad'
import { germanVoice } from '../lib/voice'
import { shouldIgnoreGlobalKeydown } from '../lib/keyboardGuards'
import FlashCard from '../components/flashcards/FlashCard'
import RatingButtons from '../components/flashcards/RatingButtons'
import Button from '../components/shared/Button'
import { showXPToast } from '../components/shared/XPToast'

const STAGE = { PRE: 'pre', REVIEW: 'review', POST: 'post' }

/** Fetch all due cards for one session (safety cap so pathological backlogs stay usable). */
const MAX_DUE_PER_LOAD = 3000
const SHORT_TERM_REQUEUE_MAX_MS = 15 * 60 * 1000

export default function Flashcards() {
  const navigate = useNavigate()
  const { incrementStreak } = useStreak()
  const {
    newCardsPerDay: settingsNewPerDay,
    speakGermanOnReveal,
    setSpeakGermanOnReveal,
  } = useSettings()
  const [stage, setStage] = useState(STAGE.PRE)
  const [dueCards, setDueCards] = useState([])
  const [newCards, setNewCards] = useState([])
  const [allCards, setAllCards] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [sessionMode, setSessionMode] = useState('both') // both | only_reviews | only_new
  const [stats, setStats] = useState({ due: 0, new: 0 })
  const [sessionStats, setSessionStats] = useState({
    reviewed: 0, correct: 0, xp: 0, startTime: null, streak: 0, maxStreak: 0
  })
  const [loading, setLoading] = useState(true)
  const exampleAudioIdxRef = useRef(0)
  const sessionStartMsRef = useRef(null)
  const dailyNewWordsCountedRef = useRef(new Set())

  const newCardsPerDay = settingsNewPerDay

  useEffect(() => {
    exampleAudioIdxRef.current = 0
  }, [currentIndex])

  useEffect(() => {
    if (!isFlipped) exampleAudioIdxRef.current = 0
  }, [isFlipped])

  useEffect(() => {
    loadCards()
  }, [])

  const revealAnswer = useCallback(() => {
    const c = allCards[currentIndex]
    setIsFlipped(true)
    if (speakGermanOnReveal) {
      const g = String(c?.word?.german || '').trim()
      if (g) germanVoice.speakWord(g)
    }
  }, [allCards, currentIndex, speakGermanOnReveal])

  const loadCards = async () => {
    const cardStats = await getCardStats()
    const dueLimit = Math.min(Math.max(cardStats.due, 1), MAX_DUE_PER_LOAD)
    const [due, newC] = await Promise.all([
      getDueCards(dueLimit),
      getNewCards(newCardsPerDay),
    ])
    setDueCards(due)
    setNewCards(newC)
    setStats({ due: cardStats.due, new: cardStats.new })
    setLoading(false)
  }

  const handleFlashcardWordSaved = useCallback((wordId, patch) => {
    setAllCards((prev) =>
      prev.map((c) =>
        c.word?.id === wordId ? { ...c, word: { ...c.word, ...patch } } : c
      )
    )
  }, [])

  const startSession = async () => {
    let cards = []
    if (sessionMode === 'both' || sessionMode === 'only_new') {
      cards = [...newCards]
    }
    if (sessionMode === 'both' || sessionMode === 'only_reviews') {
      cards = [...cards, ...dueCards]
    }
    if (cards.length === 0) return
    // Shuffle
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]]
    }
    const marked = cards.map((c) => ({ ...c, _sessionStartedAsNew: c.state === 'new' }))
    const withExamples = await attachFlashExamplesToCards(marked)
    setAllCards(withExamples)
    setCurrentIndex(0)
    setIsFlipped(false)
    sessionStartMsRef.current = Date.now()
    dailyNewWordsCountedRef.current = new Set()
    setSessionStats({ reviewed: 0, correct: 0, xp: 0, startTime: Date.now(), streak: 0, maxStreak: 0 })
    setStage(STAGE.REVIEW)
    incrementStreak()
  }

  const handleRate = useCallback(async (rating) => {
    const card = allCards[currentIndex]
    if (!card) return

    const updatedCard = await updateCardAfterReview(card.wordId, rating)
    if (!updatedCard) return

    const isCorrect = rating >= 3
    const newReviewed = sessionStats.reviewed + 1
    const newCorrect = sessionStats.correct + (isCorrect ? 1 : 0)
    const now = Date.now()
    const shouldRequeueShortTerm =
      !!updatedCard &&
      (updatedCard.state === 'learning' || updatedCard.state === 'relearning') &&
      updatedCard.nextReview > now &&
      updatedCard.nextReview - now <= SHORT_TERM_REQUEUE_MAX_MS

    if (shouldRequeueShortTerm) {
      const latest = (await getCardForWord(card.wordId)) || updatedCard
      setAllCards(prev => ([
        ...prev,
        {
          ...latest,
          word: card.word,
          flashExamples: card.flashExamples,
          _sessionStartedAsNew: false,
          _shortTermRequeue: true,
        },
      ]))
    }

    const xpEarned = rating === 4 ? 10 : isCorrect ? 5 : 1
    const newStreak = isCorrect ? sessionStats.streak + 1 : 0

    setSessionStats(prev => ({
      ...prev,
      reviewed: prev.reviewed + 1,
      correct: prev.correct + (isCorrect ? 1 : 0),
      xp: prev.xp + xpEarned,
      streak: newStreak,
      maxStreak: Math.max(prev.maxStreak, newStreak),
    }))

    const dailyRow = await getTodaySession()
    const dailyPatch = {
      flashcardsReviewed: (dailyRow.flashcardsReviewed || 0) + 1,
    }
    if (card._sessionStartedAsNew && !dailyNewWordsCountedRef.current.has(card.wordId)) {
      dailyNewWordsCountedRef.current.add(card.wordId)
      dailyPatch.newWordsLearned = (dailyRow.newWordsLearned || 0) + 1
    }
    await updateTodaySession(dailyPatch)

    await addXP(xpEarned)
    showXPToast(xpEarned)

    const next = currentIndex + 1
    const queueLengthAfterUpdate = allCards.length + (shouldRequeueShortTerm ? 1 : 0)
    if (next >= queueLengthAfterUpdate) {
      // Session complete — flashcardsReviewed / newWordsLearned already updated per rating
      const startMs = sessionStartMsRef.current ?? sessionStats.startTime
      const timeMin = Math.round((Date.now() - startMs) / 60000)
      const session = await getTodaySession()
      await updateTodaySession({
        minutesStudied: (session.minutesStudied || 0) + Math.max(0, timeMin),
      })
      // Perfect session bonus
      if (newCorrect === newReviewed) {
        await addXP(50)
        showXPToast(50, 'Perfect session!')
      }
      // Session complete XP bonus
      await addXP(30)
      showXPToast(30, 'Session complete!')
      setStage(STAGE.POST)
      return
    }

    setCurrentIndex(next)
    setIsFlipped(false)
  }, [allCards, currentIndex, sessionStats])

  useEffect(() => {
    const handler = (e) => {
      if (stage !== STAGE.REVIEW) return
      if (shouldIgnoreGlobalKeydown(e)) return
      const card = allCards[currentIndex]
      const g = String(card?.word?.german || '').trim()
      if (!g) return

      if (e.key === ' ') {
        if (!isFlipped) return
        e.preventDefault()
        if (germanVoice.isSpeaking()) {
          germanVoice.stop()
        } else {
          germanVoice.speakWord(g)
        }
        return
      }
      if (e.key === 'ArrowLeft') {
        if (!isFlipped) return
        e.preventDefault()
        const ex = (Array.isArray(card?.flashExamples) ? card.flashExamples : []).filter(
          (x) => x && String(x.de || '').trim()
        )
        if (!ex.length) return
        const i = exampleAudioIdxRef.current % ex.length
        const line = String(ex[i].de || '').trim()
        if (line) germanVoice.speakSentence(line)
        exampleAudioIdxRef.current += 1
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (!isFlipped) revealAnswer()
        return
      }
      if (isFlipped && ['1', '2', '3', '4'].includes(e.key)) {
        handleRate(parseInt(e.key, 10))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [stage, isFlipped, handleRate, allCards, currentIndex, revealAnswer])

  if (loading) {
    return (
      <>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="h-8 w-8 rounded-full border-3 border-surface-700 border-t-brand-500 animate-spin" style={{borderWidth:3}} />
        </div>
      </>
    )
  }

  // PRE-SESSION SCREEN
  if (stage === STAGE.PRE) {
    const totalCards = (sessionMode !== 'only_new' ? dueCards.length : 0) + (sessionMode !== 'only_reviews' ? newCards.length : 0)
    const estimatedMin = Math.ceil(totalCards * 8 / 60)
    const reviewLoad = estimateWeeklyReviewLoad({ dueCount: stats.due, newCardsPerDay })

    return (
      <>
        <div className="max-w-lg mx-auto">
        <div className="card p-8 text-center space-y-6">
          <div>
            <Brain size={48} className="text-brand-400 mx-auto mb-3" />
            <h2 className="text-2xl font-bold text-white">Ready to review?</h2>
            <p className="text-slate-400 mt-1 text-sm">Reinforce your German vocabulary</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-800 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-red-400">{stats.due}</div>
              <div className="text-xs text-slate-500 mt-0.5">Due reviews</div>
            </div>
            <div className="bg-surface-800 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-blue-400">{Math.min(stats.new, newCardsPerDay)}</div>
              <div className="text-xs text-slate-500 mt-0.5">New today</div>
            </div>
          </div>

          {stats.due > MAX_DUE_PER_LOAD && (
            <p className="text-[11px] text-amber-400/90 text-left px-1">
              You have over {MAX_DUE_PER_LOAD.toLocaleString()} due reviews. This session includes the first{' '}
              {MAX_DUE_PER_LOAD.toLocaleString()} — finish it, then start another to clear the rest.
            </p>
          )}

          <p className="text-[11px] text-slate-500 text-left px-1">
            {reviewLoad.summary} Too many cards? Lower new cards/day in Settings. More detail:{' '}
            <code className="text-slate-400">public/FIRST_WEEK_GUIDE.txt</code>
          </p>

          {/* Mode selector */}
          <div>
            <p className="text-sm text-slate-400 mb-2 text-left">Session type:</p>
            <div className="flex rounded-xl bg-surface-800 p-1 gap-1">
              {[
                { value: 'both', label: 'Both' },
                { value: 'only_reviews', label: 'Reviews' },
                { value: 'only_new', label: 'New Only' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setSessionMode(opt.value)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                    sessionMode === opt.value
                      ? 'bg-brand-500 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="text-sm text-slate-500">
            {totalCards} cards · ~{estimatedMin} min
          </div>

          {totalCards === 0 ? (
            <div>
              <p className="text-slate-400 text-sm mb-3">No cards available for this selection.</p>
              {stats.due === 0 && stats.new === 0 && (
                <p className="text-slate-500 text-sm">
                  No words yet.{' '}
                  <button onClick={() => navigate('/vocab')} className="text-brand-400 hover:underline">
                    Import vocabulary →
                  </button>
                </p>
              )}
            </div>
          ) : (
            <Button onClick={startSession} size="lg" className="w-full">
              Start Session
            </Button>
          )}

          <p className="text-xs text-slate-600 mb-2">
            Tip: Enter = show answer · Space = hear German (after flip) · 1–4 = rate · Use “Speak on reveal” during review for auto pronunciation
          </p>
        </div>
      </div>
      </>
    )
  }

  // POST-SESSION SCREEN
  if (stage === STAGE.POST) {
    const timeTaken = Math.round((Date.now() - sessionStats.startTime) / 60000)
    const accuracy = allCards.length > 0 ? Math.round((sessionStats.correct / allCards.length) * 100) : 0

    return (
      <>
        <div className="max-w-lg mx-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="card p-8 text-center space-y-5"
        >
          <div>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', damping: 12 }}
            >
              <CheckCircle size={56} className="text-green-400 mx-auto mb-3" />
            </motion.div>
            <h2 className="text-2xl font-bold text-white">Session Complete! 🎉</h2>
            <p className="text-slate-400 text-sm mt-1 italic">
              "Weiter so! Du wirst jeden Tag besser."
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Cards Reviewed', value: allCards.length, icon: Brain, color: 'text-brand-400' },
              { label: 'Accuracy', value: `${accuracy}%`, icon: Star, color: accuracy >= 80 ? 'text-green-400' : 'text-yellow-400' },
              { label: 'Time Taken', value: `${timeTaken}m`, icon: Timer, color: 'text-teal-400' },
              { label: 'XP Earned', value: `+${sessionStats.xp}`, icon: Zap, color: 'text-brand-400' },
            ].map(s => (
              <div key={s.label} className="bg-surface-800 rounded-xl p-4 text-center">
                <s.icon size={18} className={`${s.color} mx-auto mb-1`} />
                <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>

          {sessionStats.maxStreak >= 5 && (
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-3">
              <p className="text-orange-400 text-sm font-medium">🔥 Best streak: {sessionStats.maxStreak} correct in a row!</p>
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => navigate('/')} className="flex-1">
              <ArrowLeft size={16} />
              Dashboard
            </Button>
            <Button onClick={() => { setStage(STAGE.PRE); loadCards() }} className="flex-1">
              <RotateCcw size={16} />
              Review Again
            </Button>
          </div>
        </motion.div>
      </div>
      </>
    )
  }

  // REVIEW SCREEN
  const card = allCards[currentIndex]
  const progress = currentIndex / allCards.length
  const progressPct = Math.round(progress * 100)

  return (
    <>
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => setStage(STAGE.PRE)}
          className="text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <div className="flex justify-between text-xs text-slate-500 mb-1.5">
            <span>{currentIndex} / {allCards.length} cards</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{
                background: `linear-gradient(90deg, #ef4444, #eab308 50%, #22c55e)`,
                backgroundSize: `${Math.max(progressPct * 3, 100)}% 100%`,
              }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={speakGermanOnReveal}
              onChange={(e) => setSpeakGermanOnReveal(e.target.checked)}
              className="rounded border-surface-600 bg-surface-800 text-brand-500 focus:ring-brand-500 focus:ring-offset-0"
            />
            <span className="text-[11px] text-slate-400 leading-tight max-w-[7.5rem] sm:max-w-none">
              Speak on reveal
            </span>
          </label>
          <div className="flex items-center gap-1 text-sm font-semibold text-brand-400">
            <Zap size={14} className="fill-current" />
            <span>{sessionStats.xp}</span>
          </div>
        </div>
      </div>

      {/* Card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
          transition={{ duration: 0.2 }}
        >
          <FlashCard
            card={card}
            mode="en_to_de"
            isFlipped={isFlipped}
            onFlip={revealAnswer}
            onWordSaved={handleFlashcardWordSaved}
          />
        </motion.div>
      </AnimatePresence>

      {/* Rating buttons */}
      <AnimatePresence>
        {isFlipped && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <RatingButtons card={card} onRate={handleRate} />
            <p className="text-center text-xs text-slate-600 mt-2">
              Space = hear German · Press 1/2/3/4 to rate
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </>
  )
}
