import { useState, useEffect, useRef, useCallback } from 'react'

/** @deprecated No-op; legacy dr_timer_* keys are cleared at app startup. */
export function clearTimerStorage() {
  /* manual timers only — no localStorage */
}

/**
 * Manual study timer: stopped by default, no localStorage.
 * @param {object} opts
 * @param {string} opts.pageKey — resets when this changes
 * @param {number} opts.goalMinutes
 * @param {(minutes: number) => void | Promise<void>} [opts.onSaveMinutes] — Stop & Save only
 */
export function useTimer({ pageKey, goalMinutes, onSaveMinutes }) {
  const goalSeconds = Math.max(1, goalMinutes * 60)
  const [timerState, setTimerState] = useState('stopped') // 'stopped' | 'running' | 'paused'
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef(null)
  const elapsedRef = useRef(0)
  const onSaveRef = useRef(onSaveMinutes)
  onSaveRef.current = onSaveMinutes

  useEffect(() => {
    elapsedRef.current = elapsed
  }, [elapsed])

  const clearTick = useCallback(() => {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => clearTick()
  }, [clearTick])

  useEffect(() => {
    clearTick()
    setElapsed(0)
    elapsedRef.current = 0
    setTimerState('stopped')
  }, [pageKey, clearTick])

  const start = useCallback(() => {
    if (intervalRef.current != null) return
    setTimerState('running')
    intervalRef.current = setInterval(() => {
      setElapsed((e) => e + 1)
    }, 1000)
  }, [])

  const pause = useCallback(() => {
    clearTick()
    setTimerState((s) => (s === 'running' ? 'paused' : s))
  }, [clearTick])

  const stopAndSave = useCallback(async () => {
    clearTick()
    const minutes = Math.floor(elapsedRef.current / 60)
    setElapsed(0)
    elapsedRef.current = 0
    setTimerState('stopped')
    if (minutes > 0) {
      await onSaveRef.current?.(minutes)
    }
  }, [clearTick])

  const isGoalReached = elapsed >= goalSeconds
  const isRunning = timerState === 'running'

  return {
    elapsed,
    timerState,
    isRunning,
    isGoalReached,
    goalSeconds,
    start,
    pause,
    stopAndSave,
  }
}
