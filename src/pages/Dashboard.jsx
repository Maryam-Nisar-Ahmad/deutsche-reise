import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CreditCard, BookOpen, Dumbbell, BookMarked, Clock, Brain, Flame } from 'lucide-react'
import { getWordCount, getCardStats, getTodaySession, getWeekSessions, addXP, sumStudyMinutesFromSession, updateTodaySession, getGrammarSessionsThisWeek, initDB } from '../lib/db'
import { useStreak } from '../hooks/useStreak'
import { useSettings } from '../hooks/useSettings'
import StreakCard from '../components/dashboard/StreakCard'
import LevelMeter from '../components/dashboard/LevelMeter'
import DailyPlan from '../components/dashboard/DailyPlan'
import WeekHeatmap from '../components/dashboard/WeekHeatmap'
import { showXPToast } from '../components/shared/XPToast'

function getCoverageInfo(knownWordCount) {
  if (knownWordCount < 1000) return { coverage: '< 78%', cefr: 'A1', nextMilestone: 1000, label: '1,000 words = 78% text coverage (A2)' }
  if (knownWordCount < 2000) return { coverage: '78–86%', cefr: 'A2', nextMilestone: 2000, label: '2,000 words = 86-90% coverage (B1)' }
  if (knownWordCount < 3000) return { coverage: '86–90%', cefr: 'B1', nextMilestone: 3000, label: '3,000 words = 93-95% coverage (B1-B2)' }
  if (knownWordCount < 5000) return { coverage: '93–95%', cefr: 'B1-B2', nextMilestone: 5000, label: '5,000 words = 95-96% coverage (B2)' }
  return { coverage: '95-96%', cefr: 'B2+', nextMilestone: null, label: 'B2 vocabulary achieved!' }
}

function getCurrentPhase() {
  const rawStart = localStorage.getItem('dr_start_date') || new Date().toISOString().split('T')[0]
  const start = new Date(rawStart)
  const now = new Date()
  const daysElapsed = Math.max(0, Math.floor((now - start) / 86400000))
  const month = Math.floor(daysElapsed / 30) + 1
  if (month <= 2) return { phase: 1, name: 'Foundation', daysRemaining: Math.max(0, 60 - daysElapsed), color: 'from-blue-500/20 to-cyan-500/10', desc: 'Focus on vocabulary (15–20 new cards/day), basic grammar, and short story chapters. Mine cloze cards from stories.', today: 'Today: Flashcards → Story (mine cloze) → Grammar Gym → Speak & Write (short)' }
  if (month <= 4) return { phase: 2, name: 'Input Immersion', daysRemaining: Math.max(0, 120 - daysElapsed), color: 'from-purple-500/20 to-indigo-500/10', desc: 'Reduce new cards toward 10/day. Prioritize Story Studio, listening, and narrow reading. Keep daily written output.', today: 'Today: Reviews → Story listening + cloze mining → Speak & Write' }
  return { phase: 3, name: 'Output & Fluency', daysRemaining: Math.max(0, 210 - daysElapsed), color: 'from-green-500/20 to-emerald-500/10', desc: 'Heavy immersion + production. Interleaved grammar, longer Speak & Write, exam-style tasks.', today: 'Today: Reviews, interleaved grammar, Speak & Write, shadowing' }
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { streakCount, isActiveToday, incrementStreak } = useStreak()
  const { dailyXPGoal } = useSettings()
  const [wordCount, setWordCount] = useState(0)
  const [stats, setStats] = useState({ due: 0, new: 0, learning: 0, review: 0, relearning: 0, total: 0 })
  const [session, setSession] = useState(null)
  const [weekSessions, setWeekSessions] = useState([])
  const [weekGrammarSessions, setWeekGrammarSessions] = useState(0)
  const [loading, setLoading] = useState(true)
  const [phaseInfo, setPhaseInfo] = useState(() => getCurrentPhase())
  const [phaseSuggestion, setPhaseSuggestion] = useState('')

  useEffect(() => {
    const load = async () => {
      await initDB()
      console.log('[DB] initDB completed before Dashboard reads')
      const [count, cardStats, todaySession, week] = await Promise.all([
        getWordCount(),
        getCardStats(),
        getTodaySession(),
        getWeekSessions(),
      ])
      const grammarWeekCount = await getGrammarSessionsThisWeek()
      setWordCount(count)
      setStats(cardStats)
      setSession(todaySession)
      setWeekSessions(week)
      setWeekGrammarSessions(grammarWeekCount)
      const p = getCurrentPhase()
      setPhaseInfo(p)
      const newCards = parseInt(localStorage.getItem('dr_new_cards_per_day') || '15')
      if (p.phase === 1 && newCards > 20) {
        localStorage.setItem('dr_new_cards_per_day', '20')
        setPhaseSuggestion('Phase 1 cap applied: new cards/day set to 20.')
      } else if (p.phase === 2 && newCards >= 20) {
        setPhaseSuggestion('Suggestion: reduce new cards/day to 10 for better immersion balance.')
      } else if (p.phase === 3 && grammarWeekCount < 2) {
        setPhaseSuggestion('B2 push: use Speak & Write most days plus Grammar Gym or shadowing.')
      } else {
        setPhaseSuggestion('')
      }
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

  const coverage = getCoverageInfo(wordCount)
  let rawEntryTotal = 0
  try {
    rawEntryTotal = parseInt(localStorage.getItem('dr_vocab_raw_entry_total') || '0', 10)
  } catch { /* ignore */ }
  const vocabTooltip =
    'Duolingo counts each verb form separately. Your true vocabulary size is measured by unique word families — the root word and all its forms.'
  const passiveMinutes = session?.passiveMinutes || 0
  const passivePct = Math.min(100, Math.round((passiveMinutes / 90) * 100))
  const wordsToB2 = Math.max(0, 4000 - wordCount)

  const addPassiveMinutes = async (mins) => {
    const current = session || await getTodaySession()
    const next = (current.passiveMinutes || 0) + mins
    await updateTodaySession({ passiveMinutes: next })
    setSession({ ...current, passiveMinutes: next })
  }

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
      <div className={`card p-4 bg-gradient-to-r ${phaseInfo.color}`}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-300">Current Phase</div>
            <div className="text-lg font-bold text-white">Phase {phaseInfo.phase}: {phaseInfo.name}</div>
            <p className="text-sm text-slate-300 mt-1">{phaseInfo.desc}</p>
            <p className="text-sm text-brand-300 mt-1 font-medium">{phaseInfo.today}</p>
            {phaseSuggestion && <p className="text-xs text-yellow-300 mt-2">{phaseSuggestion}</p>}
          </div>
          <div className="text-sm text-slate-200">Days remaining in phase: <span className="font-semibold text-white">{phaseInfo.daysRemaining}</span></div>
        </div>
      </div>
      {/* Top: greeting + level */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StreakCard streakCount={streakCount} isActiveToday={isActiveToday} />
        <LevelMeter masteredCount={stats.review} vocabularyExposure={wordCount} />
      </div>

      <p className="text-xs text-slate-500 text-center px-2" title={vocabTooltip}>
        <span className="cursor-help border-b border-dotted border-slate-600">
          Entries: {rawEntryTotal > 0 ? rawEntryTotal.toLocaleString() : '—'}
        </span>
        {' · '}
        <span className="cursor-help border-b border-dotted border-slate-600">
          Unique word families: ~{wordCount.toLocaleString()}
        </span>
      </p>

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

      <div className="card p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">Coverage Meter</h3>
          <span className="text-xs text-slate-400">{coverage.coverage} · {coverage.cefr}</span>
        </div>
        <p className="text-sm text-slate-300 mt-2">
          You know ~{wordCount.toLocaleString()} words → ~{coverage.coverage} of everyday German text (CEFR: {coverage.cefr})
        </p>
        <div className="mt-3 h-2 rounded-full bg-surface-800 overflow-hidden">
          <div className="h-full bg-brand-500" style={{ width: `${Math.min(100, Math.round((wordCount / 5000) * 100))}%` }} />
        </div>
        <p className="text-xs text-slate-500 mt-2">{coverage.label}</p>
        <p className="text-xs text-slate-400 mt-1">
          Words needed for B2: 4,000–5,000. You need {wordsToB2.toLocaleString()} more.
        </p>
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-white">Passive Immersion Today</h3>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => addPassiveMinutes(15)} className="px-3 py-2 rounded-xl bg-surface-800 text-slate-200 text-sm hover:text-white">🎵 +15 min (Music/Radio)</button>
          <button onClick={() => addPassiveMinutes(30)} className="px-3 py-2 rounded-xl bg-surface-800 text-slate-200 text-sm hover:text-white">🎙️ +30 min (Podcast)</button>
          <button onClick={() => addPassiveMinutes(30)} className="px-3 py-2 rounded-xl bg-surface-800 text-slate-200 text-sm hover:text-white">📺 +30 min (TV/YouTube)</button>
        </div>
        <p className="text-sm text-slate-300">Passive immersion: {passiveMinutes} / 90 min today</p>
        <div className="h-2 rounded-full bg-surface-800 overflow-hidden">
          <div className="h-full bg-teal-400" style={{ width: `${passivePct}%` }} />
        </div>
        <p className="text-xs text-slate-500">Tip: Queue a German podcast for your commute. Even unfocused listening trains your ear.</p>
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
