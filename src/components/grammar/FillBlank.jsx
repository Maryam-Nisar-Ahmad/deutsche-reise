import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, X } from 'lucide-react'
import clsx from 'clsx'

export default function FillBlank({ exercise, onAnswer }) {
  const [selected, setSelected] = useState(null)
  const [checked, setChecked] = useState(false)

  const parts = exercise.sentence.split('___')
  const isCorrect = selected === exercise.correct

  const handleCheck = () => {
    if (!selected) return
    setChecked(true)
    onAnswer(isCorrect)
  }

  const displaySentence = (fill) => {
    return parts.map((part, i) => (
      <span key={i}>
        {part}
        {i < parts.length - 1 && (
          <span className={clsx(
            'inline-block min-w-[60px] text-center px-2 py-0.5 mx-1 rounded font-bold border-b-2',
            !checked && 'border-brand-400 text-brand-300',
            checked && isCorrect && 'border-green-400 text-green-300',
            checked && !isCorrect && 'border-red-400 text-red-300 line-through',
          )}>
            {fill || '___'}
          </span>
        )}
      </span>
    ))
  }

  return (
    <div className="space-y-5">
      <div className="text-lg text-white leading-relaxed font-medium">
        {displaySentence(selected)}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {exercise.options.map(opt => (
          <button
            key={opt}
            onClick={() => !checked && setSelected(opt)}
            className={clsx(
              'py-3 px-4 rounded-xl border font-medium text-sm transition-all',
              !checked && selected === opt && 'bg-brand-500/20 border-brand-500 text-brand-300',
              !checked && selected !== opt && 'bg-surface-800 border-surface-700 text-slate-300 hover:border-surface-600',
              checked && opt === exercise.correct && 'bg-green-500/20 border-green-500 text-green-300',
              checked && opt !== exercise.correct && opt === selected && 'bg-red-500/20 border-red-500 text-red-300',
              checked && opt !== exercise.correct && opt !== selected && 'bg-surface-800 border-surface-700 text-slate-500',
            )}
          >
            {opt}
          </button>
        ))}
      </div>

      {!checked && (
        <button
          onClick={handleCheck}
          disabled={!selected}
          className="w-full py-3 rounded-xl bg-brand-500 hover:bg-brand-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-all"
        >
          Check Answer
        </button>
      )}

      {checked && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={clsx(
            'p-4 rounded-xl border',
            isCorrect
              ? 'bg-green-500/10 border-green-500/30'
              : 'bg-red-500/10 border-red-500/30'
          )}
        >
          <div className="flex items-center gap-2 font-semibold mb-1.5">
            {isCorrect
              ? <><Check size={16} className="text-green-400" /><span className="text-green-400">Richtig!</span></>
              : <><X size={16} className="text-red-400" /><span className="text-red-400">Falsch. Correct: <span className="font-bold">{exercise.correct}</span></span></>
            }
          </div>
          {exercise.explanation && (
            <p className="text-sm text-slate-400">{exercise.explanation}</p>
          )}
        </motion.div>
      )}
    </div>
  )
}
