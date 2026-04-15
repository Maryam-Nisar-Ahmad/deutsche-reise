import { useEffect, useRef } from 'react'
import { addAppActiveSeconds } from '../lib/db'

const IDLE_MS = 5 * 60 * 1000
const TICK_MS = 15_000

/**
 * Counts “engaged” time: tab visible and user activity within IDLE_MS (reading without clicks).
 * @param {boolean} enabled
 * @param {string} engagedRouteKey — bucket from pathnameToEngagedRouteKey (e.g. 'frequency', 'story').
 */
export function useGlobalActiveTime(enabled = true, engagedRouteKey = 'other') {
  const lastActivityRef = useRef(Date.now())
  const routeRef = useRef(engagedRouteKey)
  routeRef.current = engagedRouteKey

  useEffect(() => {
    if (!enabled) return undefined

    const bump = () => {
      lastActivityRef.current = Date.now()
    }

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'pointerdown']
    for (const ev of events) {
      window.addEventListener(ev, bump, { passive: true, capture: true })
    }

    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastActivityRef.current > IDLE_MS) return
      addAppActiveSeconds(TICK_MS / 1000, routeRef.current).catch(() => {})
    }, TICK_MS)

    return () => {
      window.clearInterval(id)
      for (const ev of events) {
        window.removeEventListener(ev, bump, true)
      }
    }
  }, [enabled])
}
