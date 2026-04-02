import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CreditCard, BookOpen, Dumbbell, Mic, Zap, CheckCircle2, Circle } from 'lucide-react'
import clsx from 'clsx'

const TASKS = [
  {
    id: 'flashcards',
    icon: CreditCard,
    label: 'Flashcard Review',
    path: '/flashcards',
    xp: 50,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
  },
  {
    id: 'story',
    icon: BookOpen,
    label: 'Read Story',
    path: '/story',
    xp: 45,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
  },
  {
    id: 'grammar',
    icon: Dumbbell,
    label: 'Grammar Gym',
    path: '/grammar',
    xp: 40,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
  },
  {
    id: 'shadow',
    icon: Mic,
    label: 'Shadowing',
    path: '/story',
    xp: 25,
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
  },
]

export default function DailyPlan({ session, dueCount, dailyXPGoal = 300 }) {
  const navigate = useNavigate()
  const todayXP = session?.xpEarned || 0
  const xpProgress = Math.min(100, (todayXP / dailyXPGoal) * 100)

  const completedTasks = new Set()
  if ((session?.flashcardsReviewed || 0) >= 10) completedTasks.add('flashcards')
  if ((session?.storiesRead || 0) >= 1) completedTasks.add('story')
  if ((session?.grammarExercises || 0) >= 1) completedTasks.add('grammar')
  if ((session?.shadowingMinutes || 0) >= 5) completedTasks.add('shadow')

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="card p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white">Today's Plan</h3>
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Zap size={14} className="text-brand-400 fill-current" />
          <span className="text-brand-400">{todayXP}</span>
          <span className="text-slate-500">/ {dailyXPGoal} XP</span>
        </div>
      </div>

      {/* XP progress bar */}
      <div className="h-1.5 bg-surface-800 rounded-full mb-5 overflow-hidden">
        <motion.div
          className="h-full bg-brand-500 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${xpProgress}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>

      <div className="space-y-3">
        {TASKS.map((task, i) => {
          const done = completedTasks.has(task.id)
          const Icon = task.icon
          return (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.05 }}
              className={clsx(
                'flex items-center gap-3 p-3 rounded-xl border transition-all',
                done
                  ? 'bg-green-500/5 border-green-500/20'
                  : 'bg-surface-800/50 border-surface-700/50 hover:border-surface-600 cursor-pointer'
              )}
              onClick={() => !done && navigate(task.path)}
            >
              <div className={clsx('p-2 rounded-lg', done ? 'bg-green-500/10' : task.bg)}>
                <Icon size={16} className={done ? 'text-green-400' : task.color} />
              </div>

              <div className="flex-1 min-w-0">
                <div className={clsx('text-sm font-medium', done ? 'text-slate-400 line-through' : 'text-white')}>
                  {task.label}
                </div>
                {task.id === 'flashcards' && dueCount > 0 && !done && (
                  <div className="text-xs text-slate-500">{dueCount} cards due</div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium">+{task.xp} XP</span>
                {done
                  ? <CheckCircle2 size={18} className="text-green-400" />
                  : <Circle size={18} className="text-slate-600" />
                }
              </div>
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}
