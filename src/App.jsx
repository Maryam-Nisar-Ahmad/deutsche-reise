import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Flashcards from './pages/Flashcards'
import StoryStudio from './pages/StoryStudio'
import GrammarGym from './pages/GrammarGym'
import VocabVault from './pages/VocabVault'
import Settings from './pages/Settings'
import Onboarding from './pages/Onboarding'

export default function App() {
  const [onboarded, setOnboarded] = useState(null)

  try {
    console.log('[App] All localStorage keys:', Object.keys(localStorage))
    console.log('[App] dr_onboarded raw value:', localStorage.getItem('dr_onboarded'))
    console.log('[App] dr_start_date:', localStorage.getItem('dr_start_date'))
    console.log('[App] dr_api_key exists:', !!localStorage.getItem('dr_api_key'))
  } catch (error) {
    console.warn('[App] localStorage unavailable while logging startup values', error)
  }

  useEffect(() => {
    try {
      const value = localStorage.getItem('dr_onboarded')
      console.log('[App] dr_onboarded flag:', value)
      setOnboarded(value === 'true')
    } catch (error) {
      console.warn('[App] localStorage unavailable while reading dr_onboarded', error)
      setOnboarded(false)
    }
  }, [])

  useEffect(() => {
    if (!onboarded) return
    try {
      localStorage.setItem('dr_onboarded', 'true')
    } catch (error) {
      console.warn('[App] Failed to re-affirm dr_onboarded flag', error)
    }
  }, [onboarded])

  if (onboarded === null) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-3 border-surface-700 border-t-brand-500 animate-spin" style={{ borderWidth: 3 }} />
      </div>
    )
  }

  if (!onboarded) {
    return <Onboarding onComplete={() => setOnboarded(true)} />
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/flashcards" element={<Flashcards />} />
          <Route path="/story" element={<StoryStudio />} />
          <Route path="/story/:id" element={<StoryStudio />} />
          <Route path="/grammar" element={<GrammarGym />} />
          <Route path="/grammar/:focus" element={<GrammarGym />} />
          <Route path="/vocab" element={<VocabVault />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  )
}
