import { NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  Home, CreditCard, BookOpen, Dumbbell, Library, Settings,
  Flame, Zap, ChevronLeft, ChevronRight, Mic, ListOrdered, Target,
} from 'lucide-react'
import clsx from 'clsx'
import { getCardStats, getTotalXP } from '../lib/db'
import { getLevel, getProgressToNextLevel } from '../lib/levelCalc'

const navItems = [
  { path: '/',          icon: Home,      label: 'Dashboard' },
  { path: '/flashcards', icon: CreditCard, label: 'Flashcards', badge: true },
  { path: '/frequency', icon: ListOrdered, label: 'Frequency Lab' },
  { path: '/story',     icon: BookOpen,  label: 'Story Studio' },
  { path: '/grammar',   icon: Dumbbell,  label: 'Grammar Gym' },
  { path: '/speak',     icon: Mic,       label: 'Speak & Write' },
  { path: '/vocab',     icon: Library,   label: 'Vocab Vault' },
  { path: '/placement', icon: Target,    label: 'SRS Placement' },
]

export default function Sidebar({ wordCount, masteredCount = 0, onWidthChange }) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    onWidthChange?.(collapsed ? 64 : 240)
  }, [collapsed, onWidthChange])
  const [dueCount, setDueCount] = useState(0)
  const [streak] = useState(() => parseInt(localStorage.getItem('dr_streak_count') || '0'))
  const [totalXP, setTotalXP] = useState(0)

  const level = getLevel(masteredCount)
  const progress = getProgressToNextLevel(masteredCount)

  useEffect(() => {
    getCardStats().then(s => setDueCount(s.due))
  }, [])

  useEffect(() => {
    getTotalXP().then(setTotalXP)
  }, [])

  return (
    <aside
      className={clsx(
        'sidebar flex-col h-screen bg-surface-900 border-r border-surface-800 transition-all duration-300 fixed left-0 top-0 z-40',
        collapsed ? 'w-16' : 'w-60'
      )}
      style={{ display: 'flex' }}
    >
      {/* Logo */}
      <div className={clsx('flex items-center gap-3 px-4 py-5 border-b border-surface-800', collapsed && 'justify-center px-2')}>
        <span className="text-2xl flex-shrink-0">🇩🇪</span>
        {!collapsed && (
          <div>
            <div className="font-bold text-white text-sm leading-tight">Deutsche Reise</div>
            <div className="text-xs text-slate-500">German Journey</div>
          </div>
        )}
      </div>

      {/* Level meter */}
      {!collapsed && (
        <div className="px-4 py-3 border-b border-surface-800">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-slate-400">Level</span>
            <span className="text-xs font-bold" style={{ color: level.color }}>{level.level}</span>
          </div>
          <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${progress}%`, backgroundColor: level.color }}
            />
          </div>
          <div className="text-xs text-slate-500 mt-1">
            <span className="text-slate-400">{masteredCount}</span> mastered
            <span className="text-slate-600 mx-1">·</span>
            <span>{wordCount}</span> words
          </div>
        </div>
      )}

      {/* Nav items */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {navItems.map(({ path, icon: Icon, label, badge }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            className={({ isActive }) =>
              clsx(
                'relative flex items-center gap-3 mx-2 px-3 py-2.5 rounded-xl mb-1 transition-all duration-150 text-sm font-medium',
                isActive
                  ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-surface-800',
                collapsed && 'justify-center px-2'
              )
            }
          >
            <Icon size={18} className="flex-shrink-0" />
            {!collapsed && <span className="flex-1">{label}</span>}
            {!collapsed && badge && dueCount > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                {dueCount > 99 ? '99+' : dueCount}
              </span>
            )}
            {collapsed && badge && dueCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {dueCount > 9 ? '9+' : dueCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Streak & XP */}
      {!collapsed && (
        <div className="px-4 py-3 border-t border-surface-800 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <Flame size={16} className={clsx(streak > 0 ? 'text-orange-400 flame-active' : 'text-slate-600')} />
            <span className={clsx('font-semibold', streak > 0 ? 'text-orange-400' : 'text-slate-500')}>
              {streak} day streak
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Zap size={16} className="text-brand-400" />
            <span className="text-slate-400">{totalXP.toLocaleString()} XP total</span>
          </div>
        </div>
      )}

      {/* Settings & collapse */}
      <div className="border-t border-surface-800 py-3">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 mx-2 px-3 py-2.5 rounded-xl transition-all text-sm font-medium',
              isActive ? 'bg-brand-500/20 text-brand-400' : 'text-slate-400 hover:text-white hover:bg-surface-800',
              collapsed && 'justify-center px-2'
            )
          }
        >
          <Settings size={18} />
          {!collapsed && 'Settings'}
        </NavLink>

        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex items-center gap-3 mx-2 px-3 py-2.5 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-surface-800 transition-all text-sm w-[calc(100%-16px)]"
        >
          {collapsed ? <ChevronRight size={18} /> : <><ChevronLeft size={18} /><span>Collapse</span></>}
        </button>
      </div>
    </aside>
  )
}
