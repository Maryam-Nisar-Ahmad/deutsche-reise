import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Volume2, X, Heart, Check, Loader2 } from 'lucide-react'
import { germanVoice } from '../../lib/voice'
import { explainWord, checkStoryWordVaultDuplicate, generateStoryStudioWordLesson } from '../../lib/deepseek'
import { addWordFromStory, getAllWords } from '../../lib/db'
import { normalizeGerman, storyExplainExamplePairs, storyPopupGermanAudioPlaylist } from '../../lib/wordParser'
import { showAppToast } from '../shared/XPToast'
import { shouldIgnoreGlobalKeydown } from '../../lib/keyboardGuards'

function parseExplanation(text) {
  if (!text) return {}
  const result = {}
  const lines = text.split('\n')
  let currentKey = null
  const currentVal = []

  const labelRe =
    /^(GERMAN|GENDER & PLURAL|MEANING|FULL MEANING|EXAMPLE 1 DE|EXAMPLE 1 EN|EXAMPLE 2 DE|EXAMPLE 2 EN|EXAMPLE 1|EXAMPLE 2|MEMORY TIP|RELATED WORDS):\s*(.*)/

  for (const line of lines) {
    const match = line.match(labelRe)
    if (match) {
      if (currentKey) result[currentKey] = currentVal.join(' ').trim()
      currentKey = match[1]
      currentVal.length = 0
      if (match[2]) currentVal.push(match[2])
    } else if (currentKey && line.trim()) {
      currentVal.push(line.trim())
    }
  }
  if (currentKey) result[currentKey] = currentVal.join(' ').trim()
  return result
}

export default function WordPopup({
  word,
  context,
  onClose,
  onSaved,
  /** If set, called instead of addWordFromStory — e.g. Frequency Lab ranks + lesson cache */
  externalVaultSave,
}) {
  const [explanation, setExplanation] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [checkingSaved, setCheckingSaved] = useState(true)
  const [saveBusy, setSaveBusy] = useState(false)
  const leftExampleIdxRef = useRef(0)

  useEffect(() => {
    const check = async () => {
      const words = await getAllWords()
      const key = normalizeGerman(word)
      const exists = words.some((w) => w.normalizedKey === key)
      setSaved(exists)
      setCheckingSaved(false)
    }
    check()

    const apiKey = localStorage.getItem('dr_api_key')
    if (apiKey) {
      setLoading(true)
      explainWord(word, context)
        .then((text) => {
          setExplanation(parseExplanation(text))
          setLoading(false)
        })
        .catch((e) => {
          setError(e.message === 'NO_API_KEY' ? 'Add API key in Settings' : 'Could not load explanation')
          setLoading(false)
        })
    }
  }, [word, context])

  useEffect(() => {
    leftExampleIdxRef.current = 0
  }, [word, context, explanation])

  useEffect(() => {
    const onKey = (e) => {
      if (shouldIgnoreGlobalKeydown(e)) return

      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        if (germanVoice.isSpeaking()) {
          germanVoice.stop()
        } else {
          germanVoice.speakWord(word)
        }
        return
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopPropagation()
        const playlist = storyPopupGermanAudioPlaylist(explanation || {}, context)
        if (!playlist.length) return
        const line = playlist[leftExampleIdxRef.current % playlist.length]
        leftExampleIdxRef.current += 1
        germanVoice.speakSentence(line)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [word, context, explanation])

  const handleSave = async () => {
    if (saved || saveBusy) return
    const apiKey = localStorage.getItem('dr_api_key')
    if (!apiKey?.trim()) {
      showAppToast('Add your DeepSeek API key in Settings. Saving uses AI to match your vault and build examples.')
      return
    }
    setSaveBusy(true)
    try {
      const vault = await getAllWords()
      const dupCheck = await checkStoryWordVaultDuplicate({
        surfaceWord: word,
        storyContext: context,
        vaultWords: vault,
      })
      if (dupCheck.duplicate) {
        const hint = dupCheck.matchedLine || dupCheck.reason || dupCheck.lemma
        showAppToast(
          hint
            ? `Already in your vocabulary (${hint.slice(0, 120)}).`
            : 'Already in your vocabulary (same word family as something you saved).'
        )
        return
      }

      const lemma = String(dupCheck.lemma || word).trim() || word
      const knownGerman = vault.map((w) => w.german).filter(Boolean)
      const lesson = await generateStoryStudioWordLesson({
        lemma,
        surfaceForm: word,
        storyContext: context,
        knownGermanWords: knownGerman,
        cefrHint: 'A2',
      })

      const gloss =
        String(lesson.glossShort || '').trim() ||
        String(dupCheck.glossShort || '').trim() ||
        explanation?.MEANING ||
        context ||
        word

      const firstEx =
        Array.isArray(lesson.sentences) && lesson.sentences.length ? String(lesson.sentences[0].de || '').trim() : ''

      const variantList = [
        ...new Set(
          [...(Array.isArray(lesson.variants) ? lesson.variants : []), word]
            .map((x) => String(x || '').trim())
            .filter(Boolean)
        ),
      ].slice(0, 12)

      if (typeof externalVaultSave === 'function') {
        const ok = await externalVaultSave({
          lemma,
          gloss,
          lesson,
          variants: variantList,
          surfaceWord: word,
          context,
          explanation,
        })
        if (ok === false) return
        setSaved(true)
        onSaved?.()
        return
      }

      const res = await addWordFromStory(lemma, gloss, {
        microLesson: lesson,
        variants: variantList,
        example: firstEx || null,
        storyEncounterContext: String(context || '').trim().slice(0, 3500) || undefined,
      })

      if (res.alreadyExists) {
        showAppToast('That lemma is already in your vault.')
        setSaved(true)
        onSaved?.()
        return
      }

      setSaved(true)
      onSaved?.()
      showAppToast('Saved to Vocab Vault — newest words appear at the top of the list.')
    } catch (e) {
      showAppToast(
        e?.message === 'NO_API_KEY' ? 'Add API key in Settings' : e?.message || 'Could not save word. Try again.'
      )
    } finally {
      setSaveBusy(false)
    }
  }

  const parsed = explanation || {}
  const examplePairs = storyExplainExamplePairs(parsed)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
    >
      <motion.div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      />
      <motion.div
        className="relative w-full max-w-md card p-5 max-h-[85vh] overflow-y-auto"
        initial={{ y: 40 }}
        animate={{ y: 0 }}
      >
        {/* Header — speaker only on explicit click; no TTS in useEffect */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-3">
            <div className="flex flex-col items-center flex-shrink-0">
              <button
                type="button"
                onClick={() => germanVoice.speakWord(word)}
                className="min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center bg-brand-500/10 border border-brand-500/20 rounded-xl text-brand-400 hover:bg-brand-500/20 transition-colors"
                aria-label="Play pronunciation"
              >
                <Volume2 size={22} />
              </button>
              <span className="text-xs text-slate-400 mt-1 text-center max-w-[72px] leading-tight">
                Zum Hören klicken
              </span>
            </div>
            <div className="min-w-0 pt-0.5">
              <h2 className="text-xl font-bold text-white font-mono">{word}</h2>
              {parsed['GENDER & PLURAL'] && (
                <p className="text-sm text-slate-400">{parsed['GENDER & PLURAL']}</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-surface-800">
            <X size={18} />
          </button>
        </div>

        {/* Context */}
        {context && (
          <div className="bg-surface-800 rounded-xl p-3 mb-4 text-sm text-slate-400 italic border border-surface-700">
            "{context}"
          </div>
        )}

        {/* Meaning */}
        {parsed.MEANING && (
          <div className="mb-3">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Meaning</span>
            <p className="text-white font-semibold text-lg">{parsed.MEANING}</p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-2 text-slate-400 py-4">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Erkläre...</span>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-sm py-2">{error}</p>
        )}

        {/* Full explanation */}
        {parsed['FULL MEANING'] && (
          <div className="mb-3">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Full Meaning</span>
            <p className="text-slate-300 text-sm mt-0.5">{parsed['FULL MEANING']}</p>
          </div>
        )}

        {examplePairs.length > 0 && (
          <div className="mb-3 space-y-3">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Examples</span>
            {examplePairs.map((pair, i) => (
              <div key={i} className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => germanVoice.speakWord(pair.de)}
                  className="mt-0.5 text-slate-500 hover:text-brand-400 flex-shrink-0"
                >
                  <Volume2 size={12} />
                </button>
                <div className="min-w-0">
                  <p className="text-slate-300 text-sm italic">{pair.de}</p>
                  {pair.en ? (
                    <p className="text-slate-400 text-sm mt-1 leading-snug">{pair.en}</p>
                  ) : (
                    <p className="text-slate-500 text-xs mt-1 italic">English translation missing — reopen after a moment.</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {parsed['MEMORY TIP'] && (
          <div className="mb-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3">
            <span className="text-xs text-yellow-400 uppercase tracking-wider font-semibold">Memory Tip</span>
            <p className="text-slate-300 text-sm mt-0.5">{parsed['MEMORY TIP']}</p>
          </div>
        )}

        {parsed['RELATED WORDS'] && (
          <div className="mb-4">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Related Words</span>
            <p className="text-slate-400 text-sm mt-0.5">{parsed['RELATED WORDS']}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-3 border-t border-surface-700">
          {checkingSaved ? (
            <div className="flex-1 h-9 bg-surface-800 rounded-xl shimmer" />
          ) : saved ? (
            <div className="flex-1 flex items-center justify-center gap-2 py-2 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400 text-sm font-medium">
              <Check size={16} />
              In your vocabulary
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={saveBusy}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/20 rounded-xl text-brand-400 text-sm font-medium transition-colors disabled:opacity-60 disabled:pointer-events-none"
            >
              <span className="flex items-center gap-2">
                {saveBusy ? <Loader2 size={16} className="animate-spin" /> : <Heart size={16} />}
                {saveBusy ? 'Saving…' : 'Add to my list'}
              </span>
              <span className="text-[10px] text-slate-500 font-normal px-1 text-center leading-tight">
                AI checks your whole vault, then adds lemma + examples + story (Vocab Vault + Flashcards)
              </span>
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 bg-surface-800 hover:bg-surface-700 rounded-xl text-slate-400 text-sm font-medium transition-colors border border-surface-700"
          >
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
