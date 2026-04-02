import { useState } from 'react'

export function useSettings() {
  const [apiKey, setApiKeyState] = useState(
    () => localStorage.getItem('dr_api_key') || ''
  )
  const [newCardsPerDay, setNewCardsPerDayState] = useState(
    () => parseInt(localStorage.getItem('dr_new_cards_per_day') || '15')
  )
  const [darkMode, setDarkModeState] = useState(
    () => localStorage.getItem('dr_dark_mode') !== 'false'
  )
  const [dailyXPGoal, setDailyXPGoalState] = useState(
    () => parseInt(localStorage.getItem('dr_daily_xp_goal') || '300')
  )

  const setApiKey = (key) => {
    const trimmed = key.trim()
    localStorage.setItem('dr_api_key', trimmed)
    setApiKeyState(trimmed)
  }

  const setNewCardsPerDay = (n) => {
    localStorage.setItem('dr_new_cards_per_day', String(n))
    setNewCardsPerDayState(n)
  }

  const setDarkMode = (val) => {
    localStorage.setItem('dr_dark_mode', String(val))
    document.documentElement.classList.toggle('dark', val)
    setDarkModeState(val)
  }

  const setDailyXPGoal = (n) => {
    localStorage.setItem('dr_daily_xp_goal', String(n))
    setDailyXPGoalState(n)
  }

  return {
    apiKey,
    setApiKey,
    newCardsPerDay,
    setNewCardsPerDay,
    darkMode,
    setDarkMode,
    dailyXPGoal,
    setDailyXPGoal,
  }
}
