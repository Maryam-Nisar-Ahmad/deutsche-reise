import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, CheckCircle, RotateCcw, Brain, Zap, Timer, Star } from 'lucide-react'
import { getDueCards, getNewCards, updateCardAfterReview, updateTodaySession, getTodaySession, addXP, getCardStats } from '../lib/db'
import { useStreak } from '../hooks/useStreak'
import { useSettings } from '../hooks/useSettings'
import { estimateWeeklyReviewLoad } from '../lib/reviewLoad'
import FlashCard from '../components/flashcards/FlashCard'
import RatingButtons from '../components/flashcards/RatingButtons'
import Button from '../components/shared/Button'
import SessionTimer from '../components/shared/SessionTimer'
import { showXPToast } from '../components/shared/XPToast'

const STAGE = { PRE: 'pre', REVIEW: 'review', POST: 'post' }

export default function Flashcards() {
  const navigate = useNavigate()
  const { incrementStreak } = useStreak()
  const { newCardsPerDay: settingsNewPerDay } = useSettings()
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
  const [cardMode, setCardMode] = useState('de_to_en')
  const [loading, setLoading] = useState(true)
  const clozeSessionSalt = useRef(Math.floor(Math.random() * 1e9))

  const newCardsPerDay = settingsNewPerDay

  const selectClozeForCard = useCallback((word, index) => {
    const list = word?.storyClozes
    if (!Array.isArray(list) || !list.length) return null
    const preferCloze = ((Number(word.id) * 17 + index * 13 + clozeSessionSalt.current) % 10) < 6
    if (!preferCloze) return null
    const i = Math.abs((Number(word.id) * 31 + index + clozeSessionSalt.current) % list.length)
    return list[i]
  }, [])

  useEffect(() => {
    loadCards()
  }, [])

  const loadCards = async () => {
    const [due, newC, cardStats] = await Promise.all([
      getDueCards(50),
      getNewCards(newCardsPerDay),
      getCardStats(),
    ])
    setDueCards(due)
    setNewCards(newC)
    setStats({ due: cardStats.due, new: cardStats.new })
    setLoading(false)
  }

  const startSession = () => {
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
    setAllCards(cards)
    clozeSessionSalt.current = Math.floor(Math.random() * 1e9)
    setCardMode('de_to_en')
    setCurrentIndex(0)
    setIsFlipped(false)
    setSessionStats({ reviewed: 0, correct: 0, xp: 0, startTime: Date.now(), streak: 0, maxStreak: 0 })
    setStage(STAGE.REVIEW)
    incrementStreak()
  }

  const handleRate = useCallback(async (rating) => {
    const card = allCards[currentIndex]
    if (!card) return

    await updateCardAfterReview(card.wordId, rating)

    const isCorrect = rating >= 3
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

    await addXP(xpEarned)
    showXPToast(xpEarned)

    const next = currentIndex + 1
    if (next >= allCards.length) {
      // Session complete
      const timeMin = Math.round((Date.now() - sessionStats.startTime) / 60000)
      const session = await getTodaySession()
      await updateTodaySession({
        flashcardsReviewed: (session.flashcardsReviewed || 0) + allCards.length,
        newWordsLearned: (session.newWordsLearned || 0) + newCards.filter(c => allCards.includes(c)).length,
        minutesStudied: (session.minutesStudied || 0) + timeMin,
      })
      // Perfect session bonus
      if (sessionStats.correct + (isCorrect ? 1 : 0) === allCards.length) {
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
    const nextCard = allCards[next]
    const nextCloze = nextCard ? selectClozeForCard(nextCard.word, next) : null
    if (!nextCloze && next % 3 === 0) {
      setCardMode(m => m === 'de_to_en' ? 'en_to_de' : 'de_to_en')
    }
  }, [allCards, currentIndex, sessionStats, newCards, selectClozeForCard])

  useEffect(() => {
    const handler = (e) => {
      if (stage !== STAGE.REVIEW) return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (!isFlipped) setIsFlipped(true)
      } else if (isFlipped && ['1', '2', '3', '4'].includes(e.key)) {
        handleRate(parseInt(e.key))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [stage, isFlipped, handleRate])

  if (loading) {
    return (
      <>
        <SessionTimer goalMinutes={20} label="Flashcards" pageKey="flashcards" />
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
        <SessionTimer goalMinutes={20} label="Flashcards" pageKey="flashcards" />
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

          <p className="text-xs text-slate-600 mb-2">Tip: Use keyboard 1/2/3/4 to rate, Space to flip</p>
          <button
            type="button"
            onClick={() => navigate('/placement')}
            className="text-xs text-brand-400 hover:underline w-full text-center"
          >
            SRS Placement — mark words you already know
          </button>
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
        <SessionTimer goalMinutes={20} label="Flashcards" pageKey="flashcards" />
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
  const activeCloze = selectClozeForCard(card.word, currentIndex)
  const progress = currentIndex / allCards.length
  const progressPct = Math.round(progress * 100)

  return (
    <>
    <SessionTimer goalMinutes={20} label="Flashcards" pageKey="flashcards" />
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
        <div className="flex items-center gap-1 text-sm font-semibold text-brand-400">
          <Zap size={14} className="fill-current" />
          <span>{sessionStats.xp}</span>
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
            mode={cardMode}
            cloze={activeCloze}
            isFlipped={isFlipped}
            onFlip={() => setIsFlipped(true)}
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
              Press 1/2/3/4 to rate
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </>
  )
}
