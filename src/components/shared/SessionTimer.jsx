import { useRef, useEffect } from 'react'
import { Play, Pause, Check } from 'lucide-react'
import clsx from 'clsx'
import { useTimer } from '../../hooks/useTimer'
import { persistTimerMinutes } from '../../lib/db'
import { showTimerGoalToast } from './XPToast'

function formatMMSS(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function SessionTimer({ goalMinutes, label, pageKey }) {
  const goalToastFired = useRef(false)
  const wasGoalReached = useRef(false)

  useEffect(() => {
    goalToastFired.current = false
    wasGoalReached.current = false
  }, [pageKey])

  const { elapsed, isRunning, isGoalReached, start, pause } = useTimer({
    pageKey,
    goalMinutes,
    onPersist: (secs) => {
      persistTimerMinutes(pageKey, secs)
    },
  })

  useEffect(() => {
    if (isGoalReached && !wasGoalReached.current) {
      wasGoalReached.current = true
      if (!goalToastFired.current) {
        goalToastFired.current = true
        showTimerGoalToast(label)
      }
    }
    if (!isGoalReached) {
      wasGoalReached.current = false
      goalToastFired.current = false
    }
  }, [isGoalReached, label])

  const goalSecs = goalMinutes * 60

  return (
    <div
      className={clsx(
        'fixed z-[90] flex items-center gap-2 rounded-full px-3 h-11 min-w-[168px] max-w-[200px] justify-center text-sm font-medium tabular-nums shadow-lg transition-colors duration-300',
        'max-md:bottom-24 max-md:right-6',
        'md:bottom-6 md:right-6',
        isGoalReached && 'bg-green-600 text-white',
        !isGoalReached && isRunning && 'bg-brand-600 text-white',
        !isGoalReached && !isRunning && 'bg-slate-700 text-slate-300',
      )}
      role="timer"
      aria-label={`${label} session timer`}
    >
      {isGoalReached ? (
        <Check size={18} className="flex-shrink-0" strokeWidth={2.5} />
      ) : (
        <button
          type="button"
          onClick={() => (isRunning ? pause() : start())}
          className="p-1.5 rounded-full hover:bg-white/10 transition-colors flex-shrink-0 -ml-0.5"
          aria-label={isRunning ? 'Pause timer' : 'Start timer'}
        >
          {isRunning ? <Pause size={16} className="fill-current" /> : <Play size={16} className="fill-current ml-0.5" />}
        </button>
      )}
      <span className="flex-1 text-center whitespace-nowrap">
        {formatMMSS(elapsed)} / {formatMMSS(goalSecs)}
      </span>
    </div>
  )
}
