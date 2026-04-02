import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Zap } from 'lucide-react'

let toastQueue = []
let listeners = []

export function showXPToast(amount, label = '') {
  const id = Date.now() + Math.random()
  toastQueue = [...toastQueue, { id, type: 'xp', amount, label }]
  listeners.forEach(fn => fn([...toastQueue]))
  setTimeout(() => {
    toastQueue = toastQueue.filter(t => t.id !== id)
    listeners.forEach(fn => fn([...toastQueue]))
  }, 2500)
}

export function showTimerGoalToast(label) {
  const id = Date.now() + Math.random()
  toastQueue = [...toastQueue, {
    id,
    type: 'goal',
    message: `✓ ${label} goal reached! Great work.`,
  }]
  listeners.forEach(fn => fn([...toastQueue]))
  setTimeout(() => {
    toastQueue = toastQueue.filter(t => t.id !== id)
    listeners.forEach(fn => fn([...toastQueue]))
  }, 3500)
}

export function showAppToast(message) {
  const id = Date.now() + Math.random()
  toastQueue = [...toastQueue, { id, type: 'info', message }]
  listeners.forEach(fn => fn([...toastQueue]))
  setTimeout(() => {
    toastQueue = toastQueue.filter(t => t.id !== id)
    listeners.forEach(fn => fn([...toastQueue]))
  }, 3000)
}

export default function XPToastContainer() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    const fn = (newToasts) => setToasts(newToasts)
    listeners.push(fn)
    return () => {
      listeners = listeners.filter(l => l !== fn)
    }
  }, [])

  return (
    <div className="fixed bottom-20 right-4 z-[100] flex flex-col gap-2 pointer-events-none md:bottom-6">
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.9 }}
            transition={{ duration: 0.25, type: 'spring', damping: 20 }}
            className={
              toast.type === 'goal'
                ? 'flex items-center gap-2 bg-green-600 text-white font-semibold px-4 py-2 rounded-xl shadow-lg shadow-green-600/30 text-sm max-w-[min(100vw-2rem,320px)]'
                : toast.type === 'info'
                  ? 'flex items-center gap-2 bg-surface-800 border border-surface-600 text-white font-medium px-4 py-2 rounded-xl shadow-lg text-sm max-w-[min(100vw-2rem,320px)]'
                  : 'flex items-center gap-2 bg-brand-500 text-white font-bold px-4 py-2 rounded-xl shadow-lg shadow-brand-500/30 text-sm whitespace-nowrap'
            }
          >
            {toast.type === 'goal' || toast.type === 'info' ? (
              <span>{toast.message}</span>
            ) : (
              <>
                <Zap size={16} className="fill-current" />
                <span>+{toast.amount} XP</span>
                {toast.label && <span className="text-brand-200 font-normal">{toast.label}</span>}
              </>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
