import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Mic, ChevronRight, X, ToggleLeft, ToggleRight } from 'lucide-react'
import { germanVoice } from '../../lib/voice'

const COUNTDOWN_SEC = 6
const R = 40
const C = 2 * Math.PI * R

export default function ShadowMode({ sentences, onClose, onChapterComplete }) {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [phase, setPhase] = useState('listen')
  const [countdown, setCountdown] = useState(COUNTDOWN_SEC)
  const [autoAdvance, setAutoAdvance] = useState(true)
  const intervalRef = useRef(null)
  const currentIdxRef = useRef(0)
  const autoAdvanceRef = useRef(true)
  const sentencesRef = useRef(sentences)

  useEffect(() => { currentIdxRef.current = currentIdx }, [currentIdx])
  useEffect(() => { autoAdvanceRef.current = autoAdvance }, [autoAdvance])
  useEffect(() => { sentencesRef.current = sentences }, [sentences])

  const clearCountdownInterval = () => {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  const goNext = useCallback(() => {
    clearCountdownInterval()
    germanVoice.stop()
    const idx = currentIdxRef.current
    const total = sentencesRef.current.length
    if (idx >= total - 1) {
      setPhase('done')
      onChapterComplete?.()
    } else {
      setCurrentIdx(i => i + 1)
    }
  }, [onChapterComplete])

  useEffect(() => {
    const sentence = sentences[currentIdx]
    if (!sentence) return

    clearCountdownInterval()
    germanVoice.stop()

    let cancelled = false

    setPhase('listen')
    setCountdown(COUNTDOWN_SEC)

    germanVoice.speakSentence(sentence, {
      onEnd: () => {
        if (cancelled) return
        setPhase('repeat')
        setCountdown(COUNTDOWN_SEC)

        clearCountdownInterval()
        intervalRef.current = setInterval(() => {
          setCountdown(c => {
            if (c <= 1) {
              clearCountdownInterval()
              if (autoAdvanceRef.current) {
                queueMicrotask(() => goNext())
              }
              return 0
            }
            return c - 1
          })
        }, 1000)
      },
    })

    return () => {
      cancelled = true
      clearCountdownInterval()
      germanVoice.stop()
    }
  }, [currentIdx, sentences, goNext])

  const current = sentences[currentIdx]
  const total = sentences.length
  const progress = COUNTDOWN_SEC > 0 ? countdown / COUNTDOWN_SEC : 0
  const dashOffset = C * (1 - progress)
  const ringColor = countdown <= 0 ? '#22c55e' : '#0c8ee3'

  const restartListen = () => {
    clearCountdownInterval()
    germanVoice.stop()
    setPhase('listen')
    setCountdown(COUNTDOWN_SEC)
    setTimeout(() => {
      const sentence = sentences[currentIdx]
      if (!sentence) return
      germanVoice.speakSentence(sentence, {
        onEnd: () => {
          setPhase('repeat')
          setCountdown(COUNTDOWN_SEC)
          clearCountdownInterval()
          intervalRef.current = setInterval(() => {
            setCountdown(c => {
              if (c <= 1) {
                clearCountdownInterval()
                if (autoAdvanceRef.current) queueMicrotask(() => goNext())
                return 0
              }
              return c - 1
            })
          }, 1000)
        },
      })
    }, 50)
  }

  return (
    <div className="fixed inset-0 z-40 bg-surface-950/98 flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-surface-800">
        <div className="flex items-center gap-2">
          <Mic size={18} className="text-orange-400" />
          <span className="font-semibold text-white">Shadow Mode</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setAutoAdvance(v => !v)}
            className="flex items-center gap-2 text-xs text-slate-400"
          >
            {autoAdvance ? <ToggleRight size={18} className="text-brand-400" /> : <ToggleLeft size={18} />}
            Auto-advance
          </button>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="px-6 py-3">
        <div className="flex justify-between text-xs text-slate-500 mb-1.5">
          <span>Sentence {currentIdx + 1} / {total}</span>
          <span>{Math.round(((currentIdx + 1) / total) * 100)}%</span>
        </div>
        <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-orange-400 rounded-full"
            animate={{ width: `${((currentIdx + 1) / total) * 100}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        <AnimatePresence mode="wait">
          {phase === 'done' ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <div className="text-6xl mb-4">🎉</div>
              <h2 className="text-2xl font-bold text-white mb-2">Chapter Complete!</h2>
              <p className="text-slate-400 mb-6">+25 XP earned for shadowing!</p>
              <button type="button" onClick={onClose} className="btn-primary px-8 py-3 rounded-xl font-semibold">
                Continue
              </button>
            </motion.div>
          ) : (
            <motion.div
              key={currentIdx}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center max-w-2xl w-full"
            >
              <div className="card p-8 mb-8">
                <p className="text-2xl font-medium text-white leading-relaxed">
                  {current}
                </p>
              </div>

              <div className="flex flex-col items-center gap-4">
                {phase === 'listen' && (
                  <motion.div
                    animate={{ scale: [1, 1.05, 1] }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                    className="flex items-center gap-3 text-brand-400"
                  >
                    <Play size={20} className="fill-current" />
                    <span className="text-lg font-medium">Listening...</span>
                  </motion.div>
                )}
                {phase === 'repeat' && (
                  <div className="flex flex-col items-center gap-4">
                    <div className="relative w-[120px] h-[120px] flex items-center justify-center">
                      <svg className="absolute inset-0 -rotate-90" width="120" height="120" viewBox="0 0 100 100">
                        <circle
                          cx="50"
                          cy="50"
                          r={R}
                          fill="none"
                          className="text-surface-700"
                          stroke="currentColor"
                          strokeWidth="6"
                        />
                        <circle
                          cx="50"
                          cy="50"
                          r={R}
                          fill="none"
                          stroke={ringColor}
                          strokeWidth="6"
                          strokeLinecap="round"
                          strokeDasharray={C}
                          strokeDashoffset={dashOffset}
                          className="transition-all duration-300"
                          style={{ transitionProperty: 'stroke-dashoffset, stroke' }}
                        />
                      </svg>
                      <span
                        className={`relative z-10 text-3xl font-bold tabular-nums transition-colors duration-300 ${
                          countdown <= 0 ? 'text-green-400' : 'text-brand-400'
                        }`}
                      >
                        {countdown}
                      </span>
                    </div>
                    <p className="text-orange-400 font-semibold text-lg">Now repeat!</p>

                    <div className="flex flex-wrap gap-3 mt-2 justify-center">
                      <button
                        type="button"
                        onClick={restartListen}
                        className="flex items-center gap-2 px-4 py-2 bg-surface-800 rounded-xl text-slate-400 hover:text-white text-sm"
                      >
                        <Play size={14} />
                        Listen again
                      </button>
                      {!autoAdvance && countdown <= 0 && (
                        <button
                          type="button"
                          onClick={goNext}
                          className="flex items-center gap-2 px-4 py-2 bg-brand-500 rounded-xl text-white text-sm font-medium hover:bg-brand-400"
                        >
                          Next
                          <ChevronRight size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
