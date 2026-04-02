import { useRef, useEffect } from 'react'
import { Play, Pause, Square } from 'lucide-react'
import clsx from 'clsx'
import { useTimer } from '../../hooks/useTimer'
import { addTimerMinutesToSession } from '../../lib/db'
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

  const { elapsed, timerState, isRunning, isGoalReached, start, pause, stopAndSave } = useTimer({
    pageKey,
    goalMinutes,
    onSaveMinutes: (mins) => addTimerMinutesToSession(pageKey, mins),
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
  const active = timerState === 'running' || timerState === 'paused'

  return (
    <div
      className={clsx(
        'fixed z-[90] flex items-center gap-1.5 rounded-full px-2.5 h-11 min-w-[168px] max-w-[min(92vw,280px)] justify-center text-sm font-medium tabular-nums shadow-lg transition-colors duration-300',
        'max-md:bottom-24 max-md:right-6',
        'md:bottom-6 md:right-6',
        isGoalReached && 'bg-green-600 text-white',
        !isGoalReached && isRunning && 'bg-brand-600 text-white',
        !isGoalReached && timerState === 'paused' && 'bg-slate-600 text-slate-200',
        !isGoalReached && timerState === 'stopped' && 'bg-slate-700 text-slate-300',
      )}
      role="timer"
      aria-label={`${label} session timer`}
    >
      {!active ? (
        <>
          <button
            type="button"
            onClick={start}
            className="p-1.5 rounded-full hover:bg-white/10 transition-colors flex-shrink-0"
            aria-label="Start timer"
          >
            <Play size={16} className="fill-current ml-0.5" />
          </button>
          <span className="flex-1 text-center whitespace-nowrap">{formatMMSS(elapsed)}</span>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => (isRunning ? pause() : start())}
            className="p-1.5 rounded-full hover:bg-white/10 transition-colors flex-shrink-0"
            aria-label={isRunning ? 'Pause timer' : 'Resume timer'}
          >
            {isRunning ? <Pause size={16} className="fill-current" /> : <Play size={16} className="fill-current ml-0.5" />}
          </button>
          <span className="flex-1 text-center whitespace-nowrap min-w-[4.5rem]">
            {formatMMSS(elapsed)}
            <span className={clsx('text-[10px] ml-1 opacity-80', isGoalReached ? 'text-white/80' : 'text-slate-300')}>
              / {formatMMSS(goalSecs)}
            </span>
          </span>
          <button
            type="button"
            onClick={() => stopAndSave()}
            className="p-1.5 rounded-full hover:bg-white/10 transition-colors flex-shrink-0"
            aria-label="Stop and save session time"
            title="Stop & save"
          >
            <Square size={14} className="fill-current" />
          </button>
        </>
      )}
    </div>
  )
}
