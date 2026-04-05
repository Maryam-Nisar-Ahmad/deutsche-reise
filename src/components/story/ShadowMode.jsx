import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Mic, ChevronRight, X, Eye, EyeOff } from 'lucide-react'
import { germanVoice } from '../../lib/voice'

/**
 * Shadowing: listen then repeat. Research often contrasts "blind" (no text while listening)
 * vs text-supported — we default to text visible; optional blind listen hides text until repeat.
 */
export default function ShadowMode({ sentences, onClose, onChapterComplete }) {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [phase, setPhase] = useState('listen')
  const [blindListen, setBlindListen] = useState(false)
  const currentIdxRef = useRef(0)
  const sentencesRef = useRef(sentences)

  useEffect(() => { currentIdxRef.current = currentIdx }, [currentIdx])
  useEffect(() => { sentencesRef.current = sentences }, [sentences])

  const goNext = useCallback(() => {
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

    germanVoice.stop()

    let cancelled = false

    setPhase('listen')

    germanVoice.speakSentence(sentence, {
      onEnd: () => {
        if (cancelled) return
        setPhase('repeat')
      },
    })

    return () => {
      cancelled = true
      germanVoice.stop()
    }
  }, [currentIdx, sentences])

  const restartListen = () => {
    germanVoice.stop()
    setPhase('listen')
    setTimeout(() => {
      const sentence = sentences[currentIdx]
      if (!sentence) return
      germanVoice.speakSentence(sentence, {
        onEnd: () => {
          setPhase('repeat')
        },
      })
    }, 50)
  }

  const current = sentences[currentIdx]
  const total = sentences.length
  const showSentenceText = !blindListen || phase === 'repeat'

  return (
    <div className="fixed inset-0 z-40 bg-surface-950/98 flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-surface-800">
        <div className="flex items-center gap-2">
          <Mic size={18} className="text-orange-400" />
          <span className="font-semibold text-white">Shadow Mode</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => setBlindListen(v => !v)}
            className="flex items-center gap-2 text-xs text-slate-400 max-w-[200px] text-left"
            title="Blind listen: hide text while audio plays (closer to some research protocols). Text shows for the repeat phase."
          >
            {blindListen ? <EyeOff size={18} className="text-brand-400 shrink-0" /> : <Eye size={18} />}
            Blind listen
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
              <div className="card p-8 mb-6">
                {showSentenceText ? (
                  <p className="text-2xl font-medium text-white leading-relaxed">
                    {current}
                  </p>
                ) : (
                  <p className="text-lg text-slate-400 italic py-6">
                    Listen only — text hidden. After audio, the sentence appears for you to repeat.
                  </p>
                )}
              </div>

              <div className="flex flex-col items-center gap-4">
                {phase === 'listen' && (
                  <>
                    <motion.div
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                      className="flex items-center gap-3 text-brand-400"
                    >
                      <Play size={20} className="fill-current" />
                      <span className="text-lg font-medium">Listening…</span>
                    </motion.div>
                    <button
                      type="button"
                      onClick={goNext}
                      className="flex items-center gap-2 px-5 py-2.5 bg-surface-800 border border-surface-600 rounded-xl text-slate-200 text-sm font-medium hover:bg-surface-700"
                    >
                      Skip to repeat
                      <ChevronRight size={16} />
                    </button>
                  </>
                )}
                {phase === 'repeat' && (
                  <div className="flex flex-col items-center gap-4 w-full max-w-md">
                    <p className="text-orange-400 font-semibold text-lg">Now repeat out loud</p>
                    <p className="text-xs text-slate-500 text-center">
                      Go at your own pace — use the buttons; no forced countdown.
                    </p>
                    <div className="flex flex-wrap gap-3 justify-center w-full">
                      <button
                        type="button"
                        onClick={restartListen}
                        className="flex items-center gap-2 px-4 py-2 bg-surface-800 rounded-xl text-slate-300 hover:text-white text-sm"
                      >
                        <Play size={14} />
                        Listen again
                      </button>
                      <button
                        type="button"
                        onClick={goNext}
                        className="flex items-center gap-2 px-5 py-2 bg-brand-500 rounded-xl text-white text-sm font-medium hover:bg-brand-400"
                      >
                        Next sentence
                        <ChevronRight size={16} />
                      </button>
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
