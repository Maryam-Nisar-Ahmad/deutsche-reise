import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initDB } from './lib/db'
import { applyThemeFromStorage } from './lib/theme'

applyThemeFromStorage()

// Remove legacy auto-timer keys (timers are manual-only now)
try {
  const toRemove = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('dr_timer_')) toRemove.push(k)
  }
  toRemove.forEach((k) => localStorage.removeItem(k))
} catch { /* ignore */ }

// Initialize IndexedDB on startup
initDB()
  .then(() => console.log('[DB] initDB completed in main.jsx'))
  .catch(console.error)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
