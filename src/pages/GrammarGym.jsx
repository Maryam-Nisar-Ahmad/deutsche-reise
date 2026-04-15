import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Dumbbell, ChevronRight, ArrowLeft, Loader2, MessageCircle,
  X, Send, RotateCcw, Trophy, Target
} from 'lucide-react'
import { generateGrammarExercises, explainGrammarFocus, chatWithTutor } from '../lib/deepseek'
import { getAllWords, saveGrammarSession, updateTodaySession, getTodaySession, addXP } from '../lib/db'
import { showXPToast } from '../components/shared/XPToast'
import FillBlank from '../components/grammar/FillBlank'
import MultipleChoice from '../components/grammar/MultipleChoice'
import SentenceReorder from '../components/grammar/SentenceReorder'

const TOPICS = [
  // Foundation A1
  { id: 'present_tense',          label: 'Present Tense',          level: 'A1', desc: 'Regular & irregular verb conjugation' },
  { id: 'articles_gender',        label: 'Articles & Gender',       level: 'A1', desc: 'der/die/das — mastering noun gender' },
  { id: 'basic_sentence_order',   label: 'Basic Sentence Order',    level: 'A1', desc: 'V2 rule, subject-verb-object' },
  { id: 'nominative',             label: 'Nominative Case',         level: 'A1', desc: 'Subject identification & articles' },
  // Building A2
  { id: 'accusative',             label: 'Accusative Case',         level: 'A2', desc: 'Direct object articles & pronouns' },
  { id: 'dative',                 label: 'Dative Case',             level: 'A2', desc: 'Indirect object — dative verbs' },
  { id: 'perfekt',                label: 'Perfekt',                 level: 'A2', desc: 'Past tense with haben/sein' },
  { id: 'modal_verbs',            label: 'Modal Verbs',             level: 'A2', desc: 'können, müssen, dürfen...' },
  // Intermediate B1
  { id: 'adjective_endings',      label: 'Adjective Endings',       level: 'B1', desc: 'All three declension tables' },
  { id: 'prepositions',           label: 'Two-Way Prepositions',    level: 'B1', desc: 'Accusative vs. dative with in/an/auf...' },
  { id: 'word_order',             label: 'Word Order',              level: 'B1', desc: 'Subordinate clauses, position of nicht' },
  { id: 'praeteritum',            label: 'Präteritum',              level: 'B1', desc: 'Narrative past tense' },
  // Advanced B2
  { id: 'konjunktiv_II',          label: 'Konjunktiv II',           level: 'B2', desc: 'Hypotheticals with würde/wäre/hätte' },
  { id: 'passive',                label: 'Passive Voice',           level: 'B2', desc: 'werden-passive in all tenses' },
  { id: 'konjunktiv_I',           label: 'Konjunktiv I',            level: 'B2', desc: 'Reported speech forms' },
  { id: 'relative_clauses',       label: 'Relative Clauses',        level: 'B2', desc: 'Relative pronouns & word order' },
  { id: 'genitive',               label: 'Genitive Case',           level: 'B2', desc: 'Possession & genitive prepositions' },
  { id: 'infinitive_constructions', label: 'Infinitive Constructions', level: 'B2', desc: 'zu + Infinitiv, um...zu, ohne...zu' },
]

const LEVEL_COLORS = {
  A1: 'text-red-400 bg-red-500/10',
  A2: 'text-orange-400 bg-orange-500/10',
  B1: 'text-yellow-400 bg-yellow-500/10',
  B2: 'text-green-400 bg-green-500/10',
}

function shuffleArray(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function GrammarGym() {
  const { focus: focusParam } = useParams()
  const navigate = useNavigate()
  const [selectedTopic, setSelectedTopic] = useState(null)
  const [phase, setPhase] = useState('topics') // topics | loading | exercise | complete
  const [exercises, setExercises] = useState([])
  const [currentEx, setCurrentEx] = useState(0)
  const [answers, setAnswers] = useState([]) // true/false per exercise
  const [explanation, setExplanation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showCoach, setShowCoach] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [tutorHistory, setTutorHistory] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [practiceMode, setPracticeMode] = useState('focused')
  const [knownWords, setKnownWords] = useState(0)
  const chatRef = useRef(null)

  const INTERLEAVED_TOPICS = ['dative', 'konjunktiv_II', 'passive', 'word_order', 'relative_clauses', 'prepositions']

  useEffect(() => {
    getAllWords().then(words => {
      setKnownWords(words.length)
      if (words.length > 2000) setPracticeMode('interleaved')
      else if (words.length < 1000) setPracticeMode('focused')
    })
  }, [])

  useEffect(() => {
    if (focusParam) {
      const topic = TOPICS.find(t => t.id === focusParam)
      if (topic) startSession(topic)
    }
  }, [focusParam])

  const startSession = async (topic) => {
    setSelectedTopic(topic)
    setPhase('loading')
    setError('')
    setAnswers([])
    setCurrentEx(0)

    const apiKey = localStorage.getItem('dr_api_key')
    if (!apiKey) {
      setError('Add your DeepSeek API key in Settings first.')
      setPhase('topics')
      return
    }

    try {
      const [words, expl] = await Promise.all([
        getAllWords(),
        explainGrammarFocus(topic.id).catch(() => ''),
      ])

      setExplanation(expl)

      const mixedTopics = shuffleArray(INTERLEAVED_TOPICS).slice(0, 3)
      const result = await generateGrammarExercises({
        focus: practiceMode === 'interleaved' ? mixedTopics : topic.id,
        level: topic.level,
        userWords: words,
        count: 8,
      })

      setExercises(result.exercises || [])
      setPhase('exercise')
    } catch (e) {
      setError(e.message)
      setPhase('topics')
    }
  }

  const handleAnswer = async (isCorrect) => {
    setAnswers(prev => [...prev, isCorrect])
    const next = currentEx + 1

    setTimeout(async () => {
      if (next >= exercises.length) {
        // Complete
        const score = [...answers, isCorrect].filter(Boolean).length
        const xpEarned = score * 5 + 40
        await addXP(xpEarned)
        showXPToast(xpEarned, 'Grammar complete!')

        const session = await getTodaySession()
        await updateTodaySession({ grammarExercises: (session.grammarExercises || 0) + 1 })

        await saveGrammarSession({
          type: 'mixed',
          focus: selectedTopic.id,
          questions: exercises,
          answers: [...answers, isCorrect],
          score: Math.round((score / exercises.length) * 100),
        })

        setPhase('complete')
      } else {
        setCurrentEx(next)
      }
    }, 1500)
  }

  const handleChatSend = async () => {
    if (!chatInput.trim() || chatLoading) return
    const msg = chatInput.trim()
    setChatInput('')
    const newMessages = [...chatMessages, { role: 'user', content: msg }]
    setChatMessages(newMessages)
    setChatLoading(true)

    try {
      const reply = await chatWithTutor(msg, tutorHistory.slice(-20), 'B1')
      setChatMessages(m => [...m, { role: 'assistant', content: reply }])
      setTutorHistory(h => [...h, { role: 'user', content: msg }, { role: 'assistant', content: reply }].slice(-20))
    } catch (e) {
      setChatMessages(m => [...m, { role: 'assistant', content: 'Sorry, check your API key in Settings.' }])
    }
    setChatLoading(false)
    setTimeout(() => chatRef.current?.scrollTo({ top: 9999, behavior: 'smooth' }), 100)
  }

  const currentTopic = selectedTopic
  const score = answers.filter(Boolean).length

  // Group topics by level
  const grouped = { A1: [], A2: [], B1: [], B2: [] }
  TOPICS.forEach(t => grouped[t.level]?.push(t))

  return (
    <>
    <div className="max-w-5xl mx-auto">
      <div className="flex gap-6">
        {/* Left panel — topic list */}
        <div className={`${phase === 'topics' ? 'w-full' : 'hidden lg:block lg:w-72'} flex-shrink-0`}>
          <h2 className="text-xl font-bold text-white mb-4">Grammar Gym</h2>
          <div className="card p-3 mb-4">
            <div className="text-xs text-slate-400 mb-2">Mode</div>
            <div className="flex gap-2">
              <button
                onClick={() => setPracticeMode('focused')}
                className={`flex-1 py-1.5 rounded-lg text-xs ${practiceMode === 'focused' ? 'bg-brand-500 text-white' : 'bg-surface-800 text-slate-400'}`}
              >
                Focused
              </button>
              <button
                onClick={() => setPracticeMode('interleaved')}
                className={`flex-1 py-1.5 rounded-lg text-xs ${practiceMode === 'interleaved' ? 'bg-brand-500 text-white' : 'bg-surface-800 text-slate-400'}`}
              >
                Interleaved
              </button>
            </div>
            {practiceMode === 'interleaved' && (
              <p className="text-[11px] text-slate-500 mt-2">
                Interleaved practice is recommended at your level - mixing topics improves long-term retention by 40%.
              </p>
            )}
            <p className="text-[11px] text-slate-600 mt-1">Known words: {knownWords.toLocaleString()}</p>
          </div>
          <div className="space-y-5">
            {Object.entries(grouped).map(([level, topics]) => (
              <div key={level}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`badge ${LEVEL_COLORS[level]} font-bold`}>{level}</span>
                  <span className="text-xs text-slate-500 uppercase tracking-wider">
                    {level === 'A1' ? 'Foundation' : level === 'A2' ? 'Building' : level === 'B1' ? 'Intermediate' : 'Advanced'}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {topics.map(topic => (
                    <button
                      key={topic.id}
                      onClick={() => startSession(topic)}
                      className={`w-full text-left p-3 rounded-xl border transition-all group ${
                        currentTopic?.id === topic.id && phase !== 'topics'
                          ? 'bg-brand-500/15 border-brand-500/40 text-white'
                          : 'bg-surface-800/50 border-surface-700/50 hover:border-surface-600 text-slate-300'
                      }`}
                    >
                      <div className="font-medium text-sm">{topic.label}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{topic.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel — exercise area */}
        {phase !== 'topics' && (
          <div className="flex-1 min-w-0">
            {/* Back button on mobile */}
            <button
              onClick={() => { setPhase('topics'); setSelectedTopic(null) }}
              className="lg:hidden flex items-center gap-2 text-slate-400 hover:text-white mb-4 text-sm"
            >
              <ArrowLeft size={16} />
              Back to topics
            </button>

            {/* Topic header */}
            {currentTopic && (
              <div className="card p-5 mb-5">
                <div className="flex items-center gap-3 mb-2">
                  <Dumbbell size={20} className="text-brand-400" />
                  <h3 className="font-bold text-white">{currentTopic.label}</h3>
                  <span className={`badge ${LEVEL_COLORS[currentTopic.level]}`}>{currentTopic.level}</span>
                </div>
                {explanation && (
                  <p className="text-sm text-slate-400 leading-relaxed">{explanation}</p>
                )}
              </div>
            )}

            {/* Loading */}
            {phase === 'loading' && (
              <div className="card p-12 flex flex-col items-center gap-4">
                <Loader2 size={32} className="animate-spin text-brand-400" />
                <p className="text-slate-400">Bereite Übungen vor...</p>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="card p-5 border-red-500/30 bg-red-500/5">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* Exercise */}
            {phase === 'exercise' && exercises.length > 0 && (
              <div className="card p-6">
                {/* Progress bar */}
                <div className="flex items-center gap-3 mb-6">
                  <div className="flex gap-1 flex-1">
                    {exercises.map((_, i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full transition-all ${
                          i < currentEx ? (answers[i] ? 'bg-green-500' : 'bg-red-500') :
                          i === currentEx ? 'bg-brand-500' : 'bg-surface-700'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    {currentEx + 1} / {exercises.length}
                  </span>
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentEx}
                    initial={{ opacity: 0, x: 30 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -30 }}
                    transition={{ duration: 0.2 }}
                  >
                    {exercises[currentEx]?.type === 'fill_blank' && (
                      <FillBlank exercise={exercises[currentEx]} onAnswer={handleAnswer} />
                    )}
                    {exercises[currentEx]?.type === 'multiple_choice' && (
                      <MultipleChoice exercise={exercises[currentEx]} onAnswer={handleAnswer} />
                    )}
                    {exercises[currentEx]?.type === 'reorder' && (
                      <SentenceReorder exercise={exercises[currentEx]} onAnswer={handleAnswer} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            )}

            {/* Complete */}
            {phase === 'complete' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="card p-8 text-center"
              >
                <Trophy size={48} className="text-yellow-400 mx-auto mb-4" />
                <h3 className="text-2xl font-bold text-white mb-1">Session Complete!</h3>
                <p className="text-slate-400 mb-6">{currentTopic?.label}</p>

                <div className="grid grid-cols-3 gap-3 mb-6">
                  <div className="bg-surface-800 rounded-xl p-4">
                    <div className="text-2xl font-bold text-green-400">{score}/{exercises.length}</div>
                    <div className="text-xs text-slate-500">Correct</div>
                  </div>
                  <div className="bg-surface-800 rounded-xl p-4">
                    <div className="text-2xl font-bold text-brand-400">{Math.round((score / exercises.length) * 100)}%</div>
                    <div className="text-xs text-slate-500">Score</div>
                  </div>
                  <div className="bg-surface-800 rounded-xl p-4">
                    <div className="text-2xl font-bold text-yellow-400">+{score * 5 + 40}</div>
                    <div className="text-xs text-slate-500">XP Earned</div>
                  </div>
                </div>

                {score < exercises.length && (
                  <p className="text-slate-400 text-sm mb-5">
                    You struggled with some questions. Try this topic again to reinforce your understanding.
                  </p>
                )}

                <div className="flex gap-2 justify-center">
                  <button
                    onClick={() => startSession(currentTopic)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-surface-800 rounded-xl text-slate-300 hover:text-white text-sm font-medium border border-surface-700 hover:border-surface-600 transition-all"
                  >
                    <RotateCcw size={14} />
                    Practice Again
                  </button>
                  <button
                    onClick={() => { setPhase('topics'); setSelectedTopic(null) }}
                    className="flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-400 rounded-xl text-white text-sm font-medium transition-all"
                  >
                    <Target size={14} />
                    Next Topic
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        )}
      </div>

      {/* Grammar Coach floating button */}
      <button
        onClick={() => setShowCoach(v => !v)}
        className="fixed bottom-24 right-4 md:bottom-8 md:right-8 flex items-center gap-2 bg-brand-500 hover:bg-brand-400 text-white px-4 py-3 rounded-2xl shadow-xl shadow-brand-500/30 font-semibold text-sm transition-all z-30"
      >
        <MessageCircle size={18} />
        Ask Coach
      </button>

      {/* Coach chat panel */}
      <AnimatePresence>
        {showCoach && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-44 right-4 md:bottom-28 md:right-8 w-80 card shadow-2xl z-30 overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
              <div className="flex items-center gap-2">
                <MessageCircle size={16} className="text-brand-400" />
                <span className="font-semibold text-white text-sm">Grammar Coach</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setTutorHistory([]); setChatMessages([]) }}
                  className="text-[11px] px-2 py-1 rounded bg-surface-800 text-slate-300 hover:text-white"
                >
                  Clear conversation
                </button>
                <button onClick={() => setShowCoach(false)} className="text-slate-400 hover:text-white">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div ref={chatRef} className="h-56 overflow-y-auto p-3 space-y-2">
              {chatMessages.length === 0 && (
                <p className="text-slate-500 text-xs text-center py-4">
                  Ask me any grammar question!
                </p>
              )}
              {chatMessages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-brand-500/20 text-brand-100'
                      : 'bg-surface-800 text-slate-300'
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-surface-800 px-3 py-2 rounded-xl">
                    <Loader2 size={12} className="animate-spin text-slate-400" />
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 p-3 border-t border-surface-700">
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleChatSend()}
                placeholder="Ask a grammar question..."
                className="flex-1 bg-surface-800 border border-surface-700 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-brand-500"
              />
              <button
                onClick={handleChatSend}
                disabled={!chatInput.trim() || chatLoading}
                className="p-2 bg-brand-500 hover:bg-brand-400 disabled:opacity-40 rounded-xl text-white transition-colors"
              >
                <Send size={13} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </>
  )
}
