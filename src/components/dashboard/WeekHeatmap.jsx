import { useEffect, useRef, useState, useCallback, useReducer, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import {
  getTotalTrackedMinutesToday,
  getSessionStudyBreakdown,
} from '../../lib/db'

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getXPColor(xp) {
  if (xp <= 0) return 'bg-surface-800'
  if (xp <= 50) return 'bg-green-900/60'
  if (xp <= 150) return 'bg-green-700/70'
  return 'bg-green-500'
}

function getPassiveOverlay(minutes) {
  if (minutes <= 0) return 'opacity-0'
  if (minutes < 30) return 'opacity-20'
  if (minutes < 60) return 'opacity-40'
  if (minutes < 90) return 'opacity-60'
  return 'opacity-80'
}

function formatHeatmapMinutes(totalMin) {
  const m = Math.max(0, Math.round(Number(totalMin) || 0))
  if (m < 1) return '—'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h}h${r}m` : `${h}h`
}

/** Ultra-compact label for tiny calendar cells. */
function formatCellMinutes(totalMin) {
  const m = Math.max(0, Math.round(Number(totalMin) || 0))
  if (m < 1) return '—'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h >= 3 || r === 0) return `${h}h`
  return `${h}h${r}m`
}

function weekdayShort(dateStr) {
  const dt = new Date(`${dateStr}T12:00:00`)
  const dow = dt.getDay()
  const idx = dow === 0 ? 6 : dow - 1
  return WEEKDAY_LABELS[idx]
}

function monthDayShort(dateStr) {
  const dt = new Date(`${dateStr}T12:00:00`)
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getMonth()]
  return `${mon} ${dt.getDate()}`
}

function parseLocalNoon(ymd) {
  const [y, mo, d] = String(ymd).slice(0, 10).split('-').map(Number)
  return new Date(y, mo - 1, d, 12, 0, 0)
}

function toYMD(d) {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}

function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0)
  x.setDate(x.getDate() + n)
  return x
}

/** Monday 00:00 local of the week containing `d`. */
function startOfWeekMonday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0)
  const dow = x.getDay()
  const diff = dow === 0 ? -6 : 1 - dow
  x.setDate(x.getDate() + diff)
  return x
}

function endOfWeekSunday(d) {
  const mon = startOfWeekMonday(d)
  return addDays(mon, 6)
}

/**
 * Rows = calendar weeks (Mon–Sun), newest week first so the current week stays at the top.
 */
function buildCalendarWeeks(sessions) {
  if (!sessions?.length) return []
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date))
  const startDate = sorted[0].date
  const endDate = sorted[sorted.length - 1].date
  const map = Object.fromEntries(sorted.map((s) => [s.date, s]))

  const gridStart = startOfWeekMonday(parseLocalNoon(startDate))
  const gridEnd = endOfWeekSunday(parseLocalNoon(endDate))

  const cells = []
  for (let d = new Date(gridStart); d <= gridEnd; d = addDays(d, 1)) {
    const key = toYMD(d)
    if (key < startDate || key > endDate) {
      cells.push({ kind: 'pad', date: key })
    } else {
      cells.push({ kind: 'day', date: key, session: map[key] || { date: key } })
    }
  }

  const weeksOldestFirst = []
  for (let i = 0; i < cells.length; i += 7) {
    weeksOldestFirst.push(cells.slice(i, i + 7))
  }
  return weeksOldestFirst.reverse()
}

function HistoryTooltipPanel({ session, anchorRect }) {
  const day = session.date
  const xp = session?.xpEarned || 0
  const reviews = session?.flashcardsReviewed || 0
  const passiveMinutes = session?.passiveMinutes || 0
  const studyMin = getTotalTrackedMinutesToday(session)
  const breakdown = getSessionStudyBreakdown(session)

  const vw = typeof window !== 'undefined' ? window.innerWidth : 400
  const panelW = Math.min(280, vw - 24)
  const centerX = anchorRect.left + anchorRect.width / 2
  const left = Math.min(Math.max(panelW / 2 + 8, centerX), vw - panelW / 2 - 8)
  const top = anchorRect.top - 8

  return (
    <div
      className="fixed z-[100] pointer-events-none bg-surface-800 border border-surface-700 rounded-lg px-2.5 py-2 text-[11px] shadow-xl text-left"
      style={{
        width: panelW,
        left,
        top,
        transform: 'translate(-50%, -100%)',
      }}
    >
      <div className="font-semibold text-white border-b border-surface-700 pb-1 mb-1.5">
        {weekdayShort(day)} · {monthDayShort(day)}
      </div>
      <div className="text-slate-400 mb-0.5">{xp} XP</div>
      <div className="text-teal-300 font-medium mb-1">{formatHeatmapMinutes(studyMin)} total</div>
      {reviews > 0 && <div className="text-slate-500 mb-1.5">{reviews} card reviews</div>}
      {passiveMinutes > 0 && (
        <div className="text-blue-300 text-[10px] mb-1.5">
          {(passiveMinutes / 60).toFixed(1)}h passive immersion
        </div>
      )}
      {breakdown.length > 0 ? (
        <>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">By area</div>
          <ul className="space-y-0.5 max-h-52 overflow-y-auto pr-0.5">
            {breakdown.map((row) => (
              <li key={row.label} className="flex justify-between gap-2 text-slate-300 items-baseline">
                <span className="truncate shrink min-w-0">{row.label}</span>
                <span className="text-slate-400 shrink-0 tabular-nums text-right">
                  {formatHeatmapMinutes(row.minutes)}
                  {studyMin > 0 && row.pct != null && (
                    <span className="text-slate-600 ml-1.5">({row.pct}%)</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : studyMin > 0 ? (
        <p className="text-[10px] text-slate-500 leading-snug">
          No per-area breakdown for this day yet.
        </p>
      ) : null}
    </div>
  )
}

export default function WeekHeatmap({ sessions = [] }) {
  const scrollRef = useRef(null)
  const todayStr = new Date().toISOString().split('T')[0]
  const [hover, setHover] = useState(null)
  const [, bumpRender] = useReducer((x) => x + 1, 0)

  const bumpScroll = useCallback(() => bumpRender(), [])

  const calendarWeeks = useMemo(() => buildCalendarWeeks(sessions), [sessions])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = 0
  }, [sessions])

  useEffect(() => {
    if (!hover) return undefined
    const el = scrollRef.current
    const onScroll = () => bumpScroll()
    el?.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      el?.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [hover, bumpScroll])

  let anchorRect = null
  if (hover?.tileEl?.isConnected) {
    anchorRect = hover.tileEl.getBoundingClientRect()
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="card p-4 sm:p-5 flex flex-col min-h-0 h-full max-h-[70vh] lg:max-h-none"
    >
      <div className="mb-2 shrink-0">
        <h3 className="font-semibold text-slate-300 text-sm uppercase tracking-wider">Study trail</h3>
        <p className="text-[10px] sm:text-[11px] text-slate-500 mt-1 leading-snug">
          Mon–Sun calendar · recent weeks at top · hover a square for time, XP, and area %. Scroll for earlier weeks.
        </p>
      </div>

      {calendarWeeks.length === 0 ? (
        <p className="text-xs text-slate-500 flex-1">Your study days will show here once you begin.</p>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-0.5 sm:gap-1 shrink-0 mb-1.5 text-[8px] sm:text-[9px] font-semibold text-slate-500 uppercase tracking-tight text-center">
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} className="truncate px-0.5">
                {d}
              </div>
            ))}
          </div>

          <div
            ref={scrollRef}
            className="overflow-y-auto overflow-x-hidden flex-1 min-h-0 -mx-0.5 px-0.5 scroll-smooth [scrollbar-gutter:stable]"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            <div className="flex flex-col gap-1 sm:gap-1.5 pb-1">
              {calendarWeeks.map((week, wi) => (
                <div key={week.map((c) => c.date).join('|')} className="grid grid-cols-7 gap-0.5 sm:gap-1">
                  {week.map((cell) => {
                    if (cell.kind === 'pad') {
                      return (
                        <div
                          key={cell.date}
                          className="aspect-square rounded-md bg-surface-900/80 border border-surface-800/60 min-w-0"
                          aria-hidden
                        />
                      )
                    }

                    const session = cell.session
                    const day = cell.date
                    const xp = session?.xpEarned || 0
                    const passiveMinutes = session?.passiveMinutes || 0
                    const studyMin = getTotalTrackedMinutesToday(session || { date: day })
                    const isToday = day === todayStr

                    return (
                      <div
                        key={day}
                        className="relative min-w-0"
                        onMouseEnter={(e) =>
                          setHover({ session, tileEl: e.currentTarget.querySelector('[data-heat-tile]') })
                        }
                        onMouseLeave={() => setHover(null)}
                      >
                        <div
                          data-heat-tile
                          className={clsx(
                            'aspect-square w-full rounded-md transition-colors duration-150 cursor-default relative overflow-hidden border border-surface-800/80',
                            getXPColor(xp),
                            isToday && 'ring-2 ring-brand-400 ring-offset-1 ring-offset-surface-950'
                          )}
                        >
                          <div className={clsx('absolute inset-0 bg-blue-400', getPassiveOverlay(passiveMinutes))} />
                          <div className="absolute inset-0 flex items-center justify-center p-0.5 z-[1] pointer-events-none">
                            <span
                              className={clsx(
                                'text-[6px] sm:text-[8px] font-bold text-center leading-none tracking-tight',
                                xp > 0
                                  ? 'text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]'
                                  : 'text-slate-500 drop-shadow-sm'
                              )}
                            >
                              {formatCellMinutes(studyMin)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {hover && anchorRect && typeof document !== 'undefined'
        ? createPortal(<HistoryTooltipPanel session={hover.session} anchorRect={anchorRect} />, document.body)
        : null}
    </motion.div>
  )
}
