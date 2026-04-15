import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Home, CreditCard, BookOpen, Dumbbell, Library, Bell, Zap, Mic,
} from 'lucide-react'
import Sidebar from './Sidebar'
import XPToastContainer from './shared/XPToast'
import GlobalActiveClock from './shared/GlobalActiveClock'
import { getWordCount, getTodaySession, getMasteredWordCount } from '../lib/db'

const PAGE_TITLES = {
  '/': 'Dashboard',
  '/flashcards': 'Flashcards',
  '/frequency': 'Frequency Lab',
  '/story': 'Story Studio',
  '/grammar': 'Grammar Gym',
  '/speak': 'Speak & Write',
  '/vocab': 'Vocab Vault',
  '/settings': 'Settings',
}

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [wordCount, setWordCount] = useState(0)
  const [masteredCount, setMasteredCount] = useState(0)
  const [todayXP, setTodayXP] = useState(0)
  const [sidebarWidth, setSidebarWidth] = useState(240)

  const pageTitle = PAGE_TITLES[location.pathname] || 'Deutsche Reise'

  useEffect(() => {
    const load = async () => {
      const [count, mastered] = await Promise.all([getWordCount(), getMasteredWordCount()])
      setWordCount(count)
      setMasteredCount(mastered)
      const session = await getTodaySession()
      setTodayXP(session.xpEarned || 0)
    }
    load()
  }, [location.pathname])

  return (
    <div className="min-h-screen bg-surface-950 flex">
      {/* Desktop Sidebar */}
      <Sidebar wordCount={wordCount} masteredCount={masteredCount} onWidthChange={(w) => setSidebarWidth(w)} />

      {/* Main content */}
      <div
        className="flex-1 flex flex-col min-h-screen main-with-sidebar transition-all duration-300"
        style={{ paddingLeft: sidebarWidth || 240 }}
      >
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-4 px-6 py-4 bg-surface-950/90 backdrop-blur-sm border-b border-surface-800">
          <h1 className="font-bold text-white text-lg flex-1">{pageTitle}</h1>

          <GlobalActiveClock />

          <div className="flex items-center gap-1.5 text-sm font-semibold text-brand-400 bg-brand-500/10 border border-brand-500/20 px-3 py-1.5 rounded-xl">
            <Zap size={14} className="fill-current" />
            <span>{todayXP} XP today</span>
          </div>

          <button className="relative text-slate-400 hover:text-white p-2 rounded-xl hover:bg-surface-800 transition-colors">
            <Bell size={18} />
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="bottom-nav fixed bottom-0 left-0 right-0 z-40 bg-surface-900 border-t border-surface-800 safe-area-pb">
        {[
          { path: '/',          icon: Home,        label: 'Home' },
          { path: '/flashcards', icon: CreditCard,  label: 'Cards' },
          { path: '/story',     icon: BookOpen,    label: 'Story' },
          { path: '/grammar',   icon: Dumbbell,    label: 'Grammar' },
          { path: '/speak',     icon: Mic,         label: 'Speak' },
          { path: '/vocab',     icon: Library,     label: 'Vocab' },
        ].map(({ path, icon: Icon, label }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            onClick={(e) => {
              if (e.defaultPrevented) return
              if (e.button !== 0) return
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              const t = e.currentTarget.getAttribute('target')
              if (t && t !== '_self') return
              e.preventDefault()
              navigate(path)
            }}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-1 py-2 text-xs font-medium transition-colors ${
                isActive ? 'text-brand-400' : 'text-slate-500'
              }`
            }
          >
            <Icon size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* XP Toast container */}
      <XPToastContainer />
    </div>
  )
}
