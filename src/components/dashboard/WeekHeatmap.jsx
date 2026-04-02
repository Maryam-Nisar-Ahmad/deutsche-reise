import { motion } from 'framer-motion'
import clsx from 'clsx'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getXPColor(xp) {
  if (xp <= 0) return 'bg-surface-800'
  if (xp <= 50) return 'bg-green-900/60'
  if (xp <= 150) return 'bg-green-700/70'
  return 'bg-green-500'
}

function getPassiveOverlay(minutes) {
  if (minutes <= 0) return 'opacity-0'
  if (minutes < 30) return 'opacity-20'
  if (minutes < 60) return 'opacity-40'
  if (minutes < 90) return 'opacity-60'
  return 'opacity-80'
}

export default function WeekHeatmap({ sessions = [] }) {
  // sessions: array of 7 items, index 0 = 6 days ago, index 6 = today
  const today = new Date()
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - (6 - i))
    return {
      label: DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1],
      date: d.toISOString().split('T')[0],
      isToday: i === 6,
    }
  })

  const sessionMap = {}
  sessions.forEach(s => { if (s) sessionMap[s.date] = s })

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="card p-5"
    >
      <h3 className="font-semibold text-slate-300 text-sm uppercase tracking-wider mb-4">This Week</h3>

      <div className="grid grid-cols-7 gap-2">
        {days.map((day, i) => {
          const session = sessionMap[day.date]
          const xp = session?.xpEarned || 0
          const reviews = session?.flashcardsReviewed || 0
          const passiveMinutes = session?.passiveMinutes || 0

          return (
            <div key={day.date} className="flex flex-col items-center gap-1.5 group relative">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2 + i * 0.04 }}
                className={clsx(
                  'w-full aspect-square rounded-lg transition-all duration-200 cursor-default relative overflow-hidden',
                  getXPColor(xp),
                  day.isToday && 'ring-2 ring-brand-400 ring-offset-1 ring-offset-surface-950'
                )}
              >
                <div className={clsx('absolute inset-0 bg-blue-400', getPassiveOverlay(passiveMinutes))} />
              </motion.div>
              <span className={clsx(
                'text-[10px] font-medium',
                day.isToday ? 'text-brand-400' : 'text-slate-600'
              )}>
                {day.label}
              </span>

              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none
                            opacity-0 group-hover:opacity-100 transition-opacity duration-150
                            bg-surface-800 border border-surface-700 rounded-lg px-2.5 py-1.5 text-xs
                            whitespace-nowrap shadow-xl">
                <div className="font-semibold text-white">{day.label}</div>
                <div className="text-slate-400">{xp} XP</div>
                {reviews > 0 && <div className="text-slate-500">{reviews} reviews</div>}
                {passiveMinutes > 0 && <div className="text-blue-300">{(passiveMinutes / 60).toFixed(1)}h passive</div>}
              </div>
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}
