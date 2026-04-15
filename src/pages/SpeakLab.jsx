import { useState, useMemo, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Mic, Send, Loader2, Sparkles, ChevronRight, BookOpen } from 'lucide-react'
import { reviewGermanProduction } from '../lib/deepseek'
import { updateTodaySession, getTodaySession, addXP, getMasteredWordCount } from '../lib/db'
import { getLevel } from '../lib/levelCalc'
import { useStreak } from '../hooks/useStreak'
import Button from '../components/shared/Button'
import { showXPToast, showAppToast } from '../components/shared/XPToast'

const PROMPTS = [
  {
    de: 'Beschreibe deinen typischen Morgen in 4–5 Sätzen. (Was machst du zuerst? Wo frühstückst du?)',
    en: 'Describe your typical morning in 4–5 German sentences.',
  },
  {
    de: 'Erzähl von einem Film oder einer Serie, die du magst — warum gefällt sie dir?',
    en: 'Talk about a film or series you like and why (in German).',
  },
  {
    de: 'Stell dir vor, du verpasst den Zug. Was sagst du am Bahnhof? Was machst du dann?',
    en: 'Imagine you missed your train: what you say at the station and what you do next.',
  },
  {
    de: 'Beschreibe dein Zuhause: Zimmer, Geräusche, was du dort am liebsten machst.',
    en: 'Describe your home: rooms, sounds, what you like doing there.',
  },
  {
    de: 'Argumentiere kurz: Ist es besser, in der Stadt oder auf dem Land zu leben?',
    en: 'Short argument: better to live in the city or countryside?',
  },
  {
    de: 'Was hast du letztes Wochenende gemacht? Nutze Perfekt.',
    en: 'What did you do last weekend? Use Perfekt.',
  },
  {
    de: 'Du beschwerst dich höflich im Restaurant: das Essen ist kalt. Was sagst du?',
    en: 'Politely complain in a restaurant that the food is cold.',
  },
  {
    de: 'Erkläre einem Freund, warum du Deutsch lernst und was du in 7 Monaten erreichen willst.',
    en: 'Explain to a friend why you learn German and your 7-month goal.',
  },
  {
    de: 'Schreib eine kurze E-Mail an einen Kollegen: du kommst morgen später zur Arbeit.',
    en: 'Short work email in German: you will arrive late tomorrow.',
  },
  {
    de: 'Erzähl von einem Problem, das du gelöst hast — was war schwierig, wie hast du es geschafft?',
    en: 'Tell about a problem you solved: what was hard and how you managed.',
  },
]

function dayIndex() {
  const t = new Date()
  return Math.floor(t.getTime() / 86400000)
}

export default function SpeakLab() {
  const { incrementStreak } = useStreak()
  const [offset, setOffset] = useState(0)
  const [text, setText] = useState('')
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(false)
  const [cefrLevel, setCefrLevel] = useState('A1')

  useEffect(() => {
    getMasteredWordCount().then((m) => {
      setCefrLevel(getLevel(m).level)
    })
  }, [])

  const prompt = useMemo(() => {
    const i = (dayIndex() + offset) % PROMPTS.length
    return PROMPTS[i]
  }, [offset])

  const handleSubmit = async () => {
    const apiKey = localStorage.getItem('dr_api_key')
    if (!apiKey) {
      showAppToast('Add your DeepSeek API key in Settings for AI feedback.')
      return
    }
    if (!text.trim()) {
      showAppToast('Write your answer in German in the box below.')
      return
    }
    setLoading(true)
    setFeedback('')
    try {
      const reply = await reviewGermanProduction(text, prompt.en, cefrLevel)
      setFeedback(reply)
      incrementStreak()
      const session = await getTodaySession()
      await updateTodaySession({ productionSubmissions: (session.productionSubmissions || 0) + 1 })
      await addXP(35)
      showXPToast(35, 'Production practice!')
    } catch (e) {
      showAppToast(e.message || 'Could not get feedback.')
    }
    setLoading(false)
  }

  return (
    <>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="card p-6">
          <div className="flex items-center gap-2 text-brand-400 mb-3">
            <Mic size={20} />
            <span className="text-sm font-semibold uppercase tracking-wide">Output lab</span>
          </div>
          <p className="text-xs text-slate-500 mb-2 flex flex-wrap items-center gap-1">
            <BookOpen size={12} />
            <span>
              Answer in German (typed). Your app level is about <strong className="text-slate-300">{cefrLevel}</strong>
              {' '}— write at that level; simple sentences are perfect. Mistakes are useful data.
            </span>
          </p>
          <p className="text-lg text-white font-medium leading-relaxed mb-1">{prompt.de}</p>
          <p className="text-sm text-slate-500 mb-4">{prompt.en}</p>
          <button
            type="button"
            onClick={() => { setOffset((o) => o + 1); setFeedback('') }}
            className="text-xs text-brand-400 hover:underline flex items-center gap-1 mb-4"
          >
            Another prompt <ChevronRight size={12} />
          </button>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="Schreib hier auf Deutsch…"
            className="w-full bg-surface-900 border border-surface-700 rounded-xl px-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-500 text-base leading-relaxed resize-y min-h-[160px]"
          />

          <Button
            className="mt-4 w-full sm:w-auto"
            onClick={handleSubmit}
            disabled={loading || !text.trim()}
            icon={loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          >
            {loading ? 'Getting feedback…' : 'Get AI feedback'}
          </Button>
        </div>

        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="card p-6 border border-brand-500/20"
          >
            <div className="flex items-center gap-2 text-brand-300 mb-3">
              <Sparkles size={18} />
              <span className="font-semibold text-sm">Feedback</span>
            </div>
            <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">{feedback}</p>
          </motion.div>
        )}
      </div>
    </>
  )
}
