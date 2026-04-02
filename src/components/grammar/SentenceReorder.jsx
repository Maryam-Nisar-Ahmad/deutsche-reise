import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, RotateCcw } from 'lucide-react'
import clsx from 'clsx'

export default function SentenceReorder({ exercise, onAnswer }) {
  const [available, setAvailable] = useState(() =>
    [...exercise.words].map((w, i) => ({ word: w, id: i }))
  )
  const [placed, setPlaced] = useState([])
  const [checked, setChecked] = useState(false)
  const [dragId, setDragId] = useState(null)

  const userSentence = placed.map(w => w.word).join(' ')
  const isCorrect = userSentence === exercise.correct

  const addWord = (item) => {
    setAvailable(a => a.filter(w => w.id !== item.id))
    setPlaced(p => [...p, item])
  }

  const removeWord = (item) => {
    setPlaced(p => p.filter(w => w.id !== item.id))
    setAvailable(a => [...a, item])
  }

  const reset = () => {
    setAvailable([...exercise.words].map((w, i) => ({ word: w, id: i })))
    setPlaced([])
    setChecked(false)
  }

  const handleCheck = () => {
    if (placed.length === 0) return
    setChecked(true)
    onAnswer(isCorrect)
  }

  return (
    <div className="space-y-5">
      <p className="text-slate-400 text-sm">Arrange these words into a correct German sentence:</p>

      {/* Answer area */}
      <div className="min-h-[56px] p-3 bg-surface-800 border border-dashed border-surface-600 rounded-xl flex flex-wrap gap-2 items-center">
        {placed.length === 0 && (
          <span className="text-slate-600 text-sm">Click words below to build your sentence...</span>
        )}
        <AnimatePresence>
          {placed.map(item => (
            <motion.button
              key={item.id}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              onClick={() => !checked && removeWord(item)}
              className={clsx(
                'drag-word',
                checked && isCorrect && 'border-green-500 bg-green-500/20 text-green-300',
                checked && !isCorrect && 'border-red-500 bg-red-500/20 text-red-300',
              )}
            >
              {item.word}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>

      {/* Available words */}
      <div className="flex flex-wrap gap-2">
        <AnimatePresence>
          {available.map(item => (
            <motion.button
              key={item.id}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              onClick={() => !checked && addWord(item)}
              className="drag-word"
            >
              {item.word}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>

      {/* Actions */}
      {!checked ? (
        <div className="flex gap-2">
          <button
            onClick={reset}
            className="flex items-center gap-1.5 px-3 py-2 bg-surface-800 rounded-xl text-slate-400 hover:text-white text-sm border border-surface-700 transition-colors"
          >
            <RotateCcw size={13} />
            Reset
          </button>
          <button
            onClick={handleCheck}
            disabled={placed.length === 0}
            className="flex-1 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-all"
          >
            Check Answer
          </button>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={clsx(
            'p-4 rounded-xl border',
            isCorrect ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'
          )}
        >
          <div className="flex items-center gap-2 font-semibold mb-1.5">
            {isCorrect
              ? <><Check size={16} className="text-green-400" /><span className="text-green-400">Richtig! Perfect word order!</span></>
              : <><X size={16} className="text-red-400" /><span className="text-red-400">Falsch. Correct sentence:</span></>
            }
          </div>
          {!isCorrect && (
            <p className="text-white font-medium mb-1.5">{exercise.correct}</p>
          )}
          {exercise.explanation && (
            <p className="text-sm text-slate-400">{exercise.explanation}</p>
          )}
        </motion.div>
      )}
    </div>
  )
}
