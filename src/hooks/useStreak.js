import { useState, useCallback } from 'react'
import { getLocalCalendarYmd } from '../lib/db'

function todayStr() {
  return getLocalCalendarYmd()
}

export function useStreak() {
  const [count, setCount] = useState(() =>
    parseInt(localStorage.getItem('dr_streak_count') || '0')
  )
  const [lastDate, setLastDate] = useState(() =>
    localStorage.getItem('dr_streak_last_date') || ''
  )

  const incrementStreak = useCallback(() => {
    const today = todayStr()
    const currentLastDate = localStorage.getItem('dr_streak_last_date') || ''
    if (currentLastDate === today) return

    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = getLocalCalendarYmd(yesterday)

    const dayBeforeYesterday = new Date()
    dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2)
    const dbStr = getLocalCalendarYmd(dayBeforeYesterday)

    const graceUsed = localStorage.getItem('dr_streak_grace_used') === 'true'
    const currentCount = parseInt(localStorage.getItem('dr_streak_count') || '0')

    let newCount
    if (currentLastDate === yesterdayStr || currentLastDate === today) {
      newCount = currentCount + 1
      localStorage.setItem('dr_streak_grace_used', 'false')
    } else if (currentLastDate === dbStr && !graceUsed) {
      newCount = currentCount + 1
      localStorage.setItem('dr_streak_grace_used', 'true')
    } else {
      newCount = 1
      localStorage.setItem('dr_streak_grace_used', 'false')
    }

    localStorage.setItem('dr_streak_count', String(newCount))
    localStorage.setItem('dr_streak_last_date', today)
    setCount(newCount)
    setLastDate(today)
  }, [])

  return {
    streakCount: count,
    lastDate,
    isActiveToday: lastDate === todayStr(),
    incrementStreak,
  }
}
