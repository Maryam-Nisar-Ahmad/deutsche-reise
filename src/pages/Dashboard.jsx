import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CreditCard, BookOpen, Dumbbell, BookMarked, Clock, Brain, Flame } from 'lucide-react'
import { getWordCount, getCardStats, getTodaySession, getWeekSessions, addXP, sumStudyMinutesFromSession } from '../lib/db'
import { useStreak } from '../hooks/useStreak'
import { useSettings } from '../hooks/useSettings'
import StreakCard from '../components/dashboard/StreakCard'
import LevelMeter from '../components/dashboard/LevelMeter'
import DailyPlan from '../components/dashboard/DailyPlan'
import WeekHeatmap from '../components/dashboard/WeekHeatmap'
import { showXPToast } from '../components/shared/XPToast'

export default function Dashboard() {
  const navigate = useNavigate()
  const { streakCount, isActiveToday, incrementStreak } = useStreak()
  const { dailyXPGoal } = useSettings()
  const [wordCount, setWordCount] = useState(0)
  const [stats, setStats] = useState({ due: 0, new: 0, learning: 0, review: 0, relearning: 0, total: 0 })
  const [session, setSession] = useState(null)
  const [weekSessions, setWeekSessions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [count, cardStats, todaySession, week] = await Promise.all([
        getWordCount(),
        getCardStats(),
        getTodaySession(),
        getWeekSessions(),
      ])
      setWordCount(count)
      setStats(cardStats)
      setSession(todaySession)
      setWeekSessions(week)
      setLoading(false)

      // First visit of day — login bonus
      if (!isActiveToday && count > 0) {
        incrementStreak()
        await addXP(10)
        showXPToast(10, 'Daily bonus!')
      }
    }
    load()
  }, [])

  const quickCards = [
    {
      icon: CreditCard,
      label: 'Start Flashcards',
      subtitle: `${stats.due} due today`,
      path: '/flashcards',
      color: 'text-blue-400',
      bg: 'from-blue-500/10 to-blue-500/5',
      border: 'border-blue-500/20 hover:border-blue-400/40',
    },
    {
      icon: BookOpen,
      label: 'Read a Story',
      subtitle: 'Comprehensible input',
      path: '/story',
      color: 'text-purple-400',
      bg: 'from-purple-500/10 to-purple-500/5',
      border: 'border-purple-500/20 hover:border-purple-400/40',
    },
    {
      icon: Dumbbell,
      label: 'Grammar Gym',
      subtitle: 'Practice grammar',
      path: '/grammar',
      color: 'text-green-400',
      bg: 'from-green-500/10 to-green-500/5',
      border: 'border-green-500/20 hover:border-green-400/40',
    },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="h-10 w-10 rounded-full border-3 border-surface-700 border-t-brand-500 animate-spin" style={{borderWidth:3}} />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Top: greeting + level */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StreakCard streakCount={streakCount} isActiveToday={isActiveToday} />
        <LevelMeter masteredCount={stats.review} vocabularyExposure={wordCount} />
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: BookMarked, label: 'Mastered (SRS)', value: stats.review.toLocaleString(), color: 'text-brand-400', sub: `${wordCount.toLocaleString()} exposure` },
          { icon: CreditCard, label: 'Due Today', value: stats.due, color: 'text-red-400' },
          { icon: Flame, label: 'Day Streak', value: streakCount, color: 'text-orange-400' },
          { icon: Clock, label: 'Minutes Today', value: sumStudyMinutesFromSession(session).toLocaleString(), color: 'text-teal-400' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="card p-4 text-center"
          >
            <stat.icon size={20} className={`${stat.color} mx-auto mb-2`} />
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            {stat.sub && <div className="text-[11px] text-slate-600 mt-0.5">{stat.sub}</div>}
            <div className="text-xs text-slate-500 mt-0.5">{stat.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Daily Plan + Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <DailyPlan session={session} dueCount={stats.due} dailyXPGoal={dailyXPGoal} />
        </div>
        <WeekHeatmap sessions={weekSessions} />
      </div>

      {/* Quick access */}
      <div>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Quick Start</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {quickCards.map((card, i) => (
            <motion.button
              key={card.path}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.06 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate(card.path)}
              className={`card border ${card.border} bg-gradient-to-br ${card.bg} p-5 text-left transition-all duration-200 cursor-pointer w-full`}
            >
              <card.icon size={24} className={`${card.color} mb-3`} />
              <div className="font-semibold text-white">{card.label}</div>
              <div className="text-sm text-slate-400 mt-0.5">{card.subtitle}</div>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  )
}
