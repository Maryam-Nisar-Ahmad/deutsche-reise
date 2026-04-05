import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Zap, Brain, Loader2 } from 'lucide-react'
import {
  initDB,
  getNewCardsForPlacement,
  updateCardAfterReview,
  getTodaySession,
  updateTodaySession,
  addXP,
} from '../lib/db'
import FlashCard from '../components/flashcards/FlashCard'
import Button from '../components/shared/Button'
import SessionTimer from '../components/shared/SessionTimer'
import { showXPToast } from '../components/shared/XPToast'

export default function Placement() {
  const navigate = useNavigate()
  const [queue, setQueue] = useState([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [flipped, setFlipped] = useState(false)
  const [done, setDone] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    await initDB()
    const batch = await getNewCardsForPlacement(50)
    setQueue(batch)
    setIndex(0)
    setFlipped(false)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const current = queue[index]
  const total = queue.length

  const rate = async (rating) => {
    if (!current) return
    await updateCardAfterReview(current.wordId, rating)
    const sess = await getTodaySession()
    await updateTodaySession({
      placementCardsDone: (sess.placementCardsDone || 0) + 1,
    })
    await addXP(2)
    showXPToast(2)
    setDone((d) => d + 1)
    if (index + 1 >= queue.length) {
      await load()
      return
    }
    setIndex((i) => i + 1)
    setFlipped(false)
  }

  if (loading && !queue.length) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="animate-spin text-brand-400" size={32} />
      </div>
    )
  }

  if (!queue.length) {
    return (
      <div className="max-w-lg mx-auto card p-8 text-center space-y-4">
        <Brain className="mx-auto text-green-400" size={40} />
        <h2 className="text-xl font-bold text-white">No backlog</h2>
        <p className="text-slate-400 text-sm">No cards in &quot;new&quot; state right now.</p>
        <Button onClick={() => navigate('/flashcards')}>Flashcards</Button>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <SessionTimer goalMinutes={15} label="Placement" pageKey="flashcards" />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/flashcards')}
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-surface-800"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-lg font-bold text-white">SRS placement</h1>
          <p className="text-xs text-slate-500">
            Already know it? Use <strong className="text-slate-300">Know it</strong> so it leaves the “new” pile.
            {' '}
            <span className="text-slate-600">
              Order: last part of your import first (e.g. bottom of words.txt), then toward the top.
            </span>
          </p>
        </div>
      </div>

      <div className="text-center text-sm text-slate-400">
        Card {index + 1} / {total} · Calibrated today: {done}
      </div>

      <AnimatePresence mode="wait">
        {current && (
          <motion.div
            key={current.wordId}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <FlashCard
              card={current}
              mode="de_to_en"
              isFlipped={flipped}
              onFlip={() => setFlipped(!flipped)}
              cloze={null}
            />
            {!flipped ? (
              <p className="text-center text-xs text-slate-500">Tap card to see translation</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="secondary"
                  className="py-3"
                  onClick={() => rate(4)}
                >
                  <Zap size={16} className="text-green-400" />
                  Know it (Easy)
                </Button>
                <Button className="py-3" onClick={() => rate(3)}>
                  Study (Good)
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <Button variant="ghost" onClick={load} className="w-full text-slate-500 text-sm">
        Load next 50
      </Button>
    </div>
  )
}
