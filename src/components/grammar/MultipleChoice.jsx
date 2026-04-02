import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, X } from 'lucide-react'
import clsx from 'clsx'

export default function MultipleChoice({ exercise, onAnswer }) {
  const [selected, setSelected] = useState(null)
  const [checked, setChecked] = useState(false)

  const isCorrect = selected === exercise.correct_index

  const handleCheck = () => {
    if (selected === null) return
    setChecked(true)
    onAnswer(isCorrect)
  }

  return (
    <div className="space-y-5">
      <p className="text-lg text-white font-medium">{exercise.question}</p>

      <div className="space-y-2">
        {exercise.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => !checked && setSelected(i)}
            className={clsx(
              'w-full text-left py-3 px-4 rounded-xl border transition-all text-sm font-medium',
              !checked && selected === i && 'bg-brand-500/20 border-brand-500 text-brand-300',
              !checked && selected !== i && 'bg-surface-800 border-surface-700 text-slate-300 hover:border-surface-600',
              checked && i === exercise.correct_index && 'bg-green-500/20 border-green-500 text-green-300',
              checked && i !== exercise.correct_index && i === selected && 'bg-red-500/20 border-red-500 text-red-300',
              checked && i !== exercise.correct_index && i !== selected && 'bg-surface-800 border-surface-700 text-slate-500',
            )}
          >
            <span className="font-bold mr-2 opacity-60">{String.fromCharCode(65 + i)}.</span>
            {opt}
          </button>
        ))}
      </div>

      {!checked && (
        <button
          onClick={handleCheck}
          disabled={selected === null}
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
            isCorrect ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'
          )}
        >
          <div className="flex items-center gap-2 font-semibold mb-1.5">
            {isCorrect
              ? <><Check size={16} className="text-green-400" /><span className="text-green-400">Richtig!</span></>
              : <><X size={16} className="text-red-400" /><span className="text-red-400">Falsch. Correct: {exercise.options[exercise.correct_index]}</span></>
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
