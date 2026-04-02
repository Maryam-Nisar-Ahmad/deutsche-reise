import { useState, useEffect, useRef, useCallback } from 'react'

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function storageKeyFor(pageKey) {
  return `dr_timer_${pageKey}_${todayStr()}`
}

export function clearTimerStorage(pageKey) {
  try {
    localStorage.removeItem(storageKeyFor(pageKey))
  } catch { /* ignore */ }
}

/**
 * @param {object} opts
 * @param {string} opts.pageKey
 * @param {number} opts.goalMinutes
 * @param {(elapsedSeconds: number) => void} [opts.onPersist] — called every 5s and on unmount
 */
export function useTimer({ pageKey, goalMinutes, onPersist }) {
  const goalSeconds = Math.max(1, goalMinutes * 60)
  const key = storageKeyFor(pageKey)

  const [elapsed, setElapsed] = useState(0)
  const [isRunning, setIsRunning] = useState(true)
  const elapsedRef = useRef(0)
  const persistRef = useRef(onPersist)
  persistRef.current = onPersist

  useEffect(() => {
    elapsedRef.current = elapsed
  }, [elapsed])

  // Restore on mount / pageKey change
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (typeof parsed.elapsed === 'number' && parsed.elapsed >= 0) {
          setElapsed(parsed.elapsed)
          elapsedRef.current = parsed.elapsed
        }
      } else {
        setElapsed(0)
        elapsedRef.current = 0
      }
    } catch {
      setElapsed(0)
    }
    setIsRunning(true)
  }, [key])

  const persist = useCallback(
    (seconds) => {
      try {
        localStorage.setItem(key, JSON.stringify({ elapsed: seconds }))
      } catch { /* ignore */ }
      persistRef.current?.(seconds)
    },
    [key]
  )

  // Tick
  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => {
      setElapsed(e => e + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [isRunning])

  // Persist every 5s
  useEffect(() => {
    const id = setInterval(() => {
      persist(elapsedRef.current)
    }, 5000)
    return () => clearInterval(id)
  }, [key, persist])

  // Final persist on unmount
  useEffect(() => {
    return () => {
      persist(elapsedRef.current)
    }
  }, [key, persist])

  const start = useCallback(() => setIsRunning(true), [])
  const pause = useCallback(() => setIsRunning(false), [])
  const reset = useCallback(() => {
    setElapsed(0)
    elapsedRef.current = 0
    persist(0)
  }, [persist])

  const isGoalReached = elapsed >= goalSeconds

  return {
    elapsed,
    isRunning,
    isGoalReached,
    goalSeconds,
    start,
    pause,
    reset,
    persistNow: () => persist(elapsedRef.current),
  }
}
