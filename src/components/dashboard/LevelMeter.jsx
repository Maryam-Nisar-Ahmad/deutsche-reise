import { motion } from 'framer-motion'
import { getLevel, getProgressToNextLevel, getNextLevel, getB2TargetDate, getWordsNeededForB2 } from '../../lib/levelCalc'
import { Target } from 'lucide-react'

export default function LevelMeter({ masteredCount, vocabularyExposure }) {
  const level = getLevel(masteredCount)
  const progress = getProgressToNextLevel(masteredCount)
  const nextLevel = getNextLevel(masteredCount)
  const wordsNeeded = nextLevel ? nextLevel.min - masteredCount : 0
  const b2Date = getB2TargetDate()
  const wordsToB2 = getWordsNeededForB2(masteredCount)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      className="card p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-300 text-sm uppercase tracking-wider">Your Level</h3>
        <Target size={16} className="text-slate-500" />
      </div>

      <div className="flex items-end gap-3 mb-3">
        <span className="text-5xl font-bold" style={{ color: level.color }}>
          {level.level}
        </span>
        <span className="text-slate-400 text-lg mb-1">{level.label}</span>
      </div>

      {/* Mastered (level driver) + vocabulary exposure */}
      <div className="mb-4 space-y-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-2xl font-bold text-white tabular-nums">
            {masteredCount.toLocaleString()}
          </span>
          <span className="text-sm text-slate-400">mastered words</span>
        </div>
        <p className="text-xs text-slate-500">
          <span className="text-slate-400 tabular-nums">{vocabularyExposure.toLocaleString()}</span>
          {' '}vocabulary exposure <span className="text-slate-600">(imported deck)</span>
        </p>
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-xs text-slate-500 mb-1.5">
          <span>{masteredCount.toLocaleString()} mastered</span>
          {nextLevel && <span>{nextLevel.min.toLocaleString()} for {nextLevel.level}</span>}
        </div>
        <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: level.color }}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
          />
        </div>
        {nextLevel && (
          <p className="text-xs text-slate-500 mt-1.5">
            {wordsNeeded.toLocaleString()} more mastered words to {nextLevel.level}
          </p>
        )}
      </div>

      <div className="pt-3 border-t border-surface-800">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">Goal: B2</span>
          <span className="text-slate-400 font-medium">
            {b2Date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
          </span>
        </div>
        {wordsToB2 > 0 && (
          <p className="text-xs text-slate-500 mt-0.5">
            {wordsToB2.toLocaleString()} mastered words to B2 (4,000)
          </p>
        )}
      </div>
    </motion.div>
  )
}
