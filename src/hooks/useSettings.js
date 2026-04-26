import { useState } from 'react'
import { applyTheme } from '../lib/theme.js'

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
  const [targetRetention, setTargetRetentionState] = useState(() => {
    const t = parseFloat(localStorage.getItem('dr_target_retention') || '0.9')
    return Number.isFinite(t) && t >= 0.8 && t <= 0.97 ? t : 0.9
  })
  const [frequencyWordsPerDay, setFrequencyWordsPerDayState] = useState(
    () => parseInt(localStorage.getItem('dr_frequency_words_per_day') || '25', 10)
  )
  const [speakGermanOnReveal, setSpeakGermanOnRevealState] = useState(
    () => localStorage.getItem('dr_flashcard_speak_on_reveal') === 'true'
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
    applyTheme(val)
    setDarkModeState(val)
  }

  const setDailyXPGoal = (n) => {
    localStorage.setItem('dr_daily_xp_goal', String(n))
    setDailyXPGoalState(n)
  }

  const setTargetRetention = (t) => {
    const v = Math.round(Number(t) * 100) / 100
    localStorage.setItem('dr_target_retention', String(v))
    setTargetRetentionState(v)
  }

  const setFrequencyWordsPerDay = (n) => {
    const v = Math.max(5, Math.min(40, parseInt(n, 10) || 25))
    localStorage.setItem('dr_frequency_words_per_day', String(v))
    setFrequencyWordsPerDayState(v)
  }

  const setSpeakGermanOnReveal = (val) => {
    localStorage.setItem('dr_flashcard_speak_on_reveal', String(!!val))
    setSpeakGermanOnRevealState(!!val)
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
    targetRetention,
    setTargetRetention,
    frequencyWordsPerDay,
    setFrequencyWordsPerDay,
    speakGermanOnReveal,
    setSpeakGermanOnReveal,
  }
}
