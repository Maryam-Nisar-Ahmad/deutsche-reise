import { Flame } from 'lucide-react'
import clsx from 'clsx'
import { motion } from 'framer-motion'

export default function StreakCard({ streakCount, isActiveToday }) {
  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Guten Morgen!'
    if (h < 17) return 'Guten Tag!'
    return 'Guten Abend!'
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-6"
    >
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">{greeting()}</h2>
          <p className="text-slate-400 text-sm mt-1">7 Monate. Jeden Tag. Du schaffst das.</p>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Flame
            size={36}
            className={clsx(
              isActiveToday ? 'text-orange-400 flame-active' : 'text-slate-600',
            )}
            fill={isActiveToday ? '#fb923c' : 'none'}
          />
          <span className={clsx(
            'text-xl font-bold',
            isActiveToday ? 'text-orange-400' : 'text-slate-500'
          )}>
            {streakCount}
          </span>
          <span className="text-xs text-slate-500">day streak</span>
        </div>
      </div>
    </motion.div>
  )
}
