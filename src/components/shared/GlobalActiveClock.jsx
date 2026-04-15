import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { getTodaySession, pathnameToEngagedRouteKey } from '../../lib/db'
import { useGlobalActiveTime } from '../../hooks/useGlobalActiveTime'

function formatTodayMinutes(totalMin) {
  const m = Math.max(0, Math.floor(totalMin))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h <= 0) return `${r}m`
  return `${h}h ${r}m`
}

/**
 * Small always-visible study clock: global engaged time today (tab visible + recent input).
 */
export default function GlobalActiveClock() {
  const location = useLocation()
  const engagedRoute = pathnameToEngagedRouteKey(location.pathname)
  const [minutes, setMinutes] = useState(0)
  useGlobalActiveTime(true, engagedRoute)

  const refresh = async () => {
    const s = await getTodaySession()
    setMinutes(Math.floor((s.appActiveSeconds || 0) / 60))
  }

  useEffect(() => {
    refresh()
    const id = window.setInterval(refresh, 30_000)
    const onVis = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  return (
    <div
      className="flex items-center gap-1.5 text-[11px] sm:text-xs font-medium tabular-nums text-slate-400 bg-surface-800/80 border border-surface-700 px-2 sm:px-2.5 py-1 rounded-lg max-w-[min(42vw,9rem)] sm:max-w-none"
      title="Time with the app open and active today (pauses after ~5 min with no clicks, keys, or scroll — reading still counts)."
    >
      <Clock size={13} className="shrink-0 opacity-70" aria-hidden />
      <span>{formatTodayMinutes(minutes)}</span>
      <span className="text-slate-600 font-normal">today</span>
    </div>
  )
}
