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
  const [onboarded, setOnboarded] = useState(
    () => localStorage.getItem('dr_onboarded') === 'true'
  )

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
