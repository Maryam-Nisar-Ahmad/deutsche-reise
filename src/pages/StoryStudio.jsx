import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Plus, BookOpen, Trash2, ChevronDown, Eye, EyeOff, Loader2, RefreshCw
} from 'lucide-react'
import {
  getAllStories, saveStory, deleteStory, updateStoryProgress,
  getAllWords, updateTodaySession, getTodaySession, addXP, getStory, updateStoryRecord
} from '../lib/db'
import { generateStory, explainUnknownWords } from '../lib/deepseek'
import { germanVoice } from '../lib/voice'
import { useVoice } from '../hooks/useVoice'
import { getSuggestedStoryLevelFromExposure } from '../lib/levelCalc'
import { showXPToast, showAppToast } from '../components/shared/XPToast'
import SessionTimer from '../components/shared/SessionTimer'
import { normalizeGerman } from '../lib/wordParser'
import StoryText from '../components/story/StoryText'
import AudioControls from '../components/story/AudioControls'
import ShadowMode from '../components/story/ShadowMode'
import WordPopup from '../components/story/WordPopup'
import Modal from '../components/shared/Modal'
import Button from '../components/shared/Button'

const THEMES = ['Adventure', 'Romance', 'Mystery', 'Science', 'History', 'Daily Life', 'Fantasy', 'Travel']
const LEVELS = ['Auto', 'A1-A2', 'A2-B1', 'B1-B2']
const CHAPTERS = [4, 6, 8]

function normalizeWordMeanings(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj || {})) {
    out[normalizeGerman(k)] = v
  }
  return out
}

function parseStoryContent(content) {
  const rawChapters = content.split(/---CHAPTER---/i)
  return rawChapters
    .map(raw => {
      const lines = raw.trim().split('\n').filter(Boolean)
      if (!lines.length) return null

      let text = raw.trim()
      let summary = ''

      // Extract English summary
      const summaryMatch = text.match(/\[ENGLISH_SUMMARY:\s*([^\]]+)\]/i)
      if (summaryMatch) {
        summary = summaryMatch[1].trim()
        text = text.replace(/\[ENGLISH_SUMMARY:[^\]]+\]/i, '').trim()
      }

      // Extract title (first line starting with Kapitel)
      const titleMatch = text.match(/^(Kapitel\s*\d+[^:\n]*:?[^\n]*)/im)
      const title = titleMatch ? titleMatch[1].trim() : `Kapitel ${rawChapters.indexOf(raw) + 1}`

      return { title, text, summary }
    })
    .filter(Boolean)
}

export default function StoryStudio() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { rate, changeRate, voices, selectedVoiceURI, changeVoice, stop } = useVoice()

  const [view, setView] = useState('library') // library | reader
  const [stories, setStories] = useState([])
  const [currentStory, setCurrentStory] = useState(null)
  const [currentChapterIdx, setCurrentChapterIdx] = useState(0)
  const [knownWordsSet, setKnownWordsSet] = useState(new Set())
  const [knownWordMap, setKnownWordMap] = useState(() => new Map())
  const [wordMeanings, setWordMeanings] = useState({})
  const [storyTimerMode, setStoryTimerMode] = useState('read') // read | listen | shadow
  const [regenTarget, setRegenTarget] = useState(null)
  const [regenLoadingId, setRegenLoadingId] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)

  /** Frozen chunk list for current listen session (same algorithm as germanVoice.speak). */
  const speakChunksRef = useRef([])
  /** 'stopped' | 'playing' | 'paused' */
  const playbackStateRef = useRef('stopped')
  /** Index to speak next on resume (also sentence to replay after pause mid-utterance). */
  const pausedAtSentenceRef = useRef(0)
  /** Chunk index currently being spoken. */
  const speakingSentenceIndexRef = useRef(0)
  const isPlayingRef = useRef(false)
  const [showSummary, setShowSummary] = useState(false)
  const [shadowMode, setShadowMode] = useState(false)
  const [activeWordPopup, setActiveWordPopup] = useState(null) // { word, context }
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [generateModal, setGenerateModal] = useState(false)
  const [genTheme, setGenTheme] = useState('')
  const [genLevel, setGenLevel] = useState('Auto')
  const [genChapters, setGenChapters] = useState(6)
  const [genError, setGenError] = useState('')
  const [wordCount, setWordCount] = useState(0)
  const [topicFilter, setTopicFilter] = useState('All')
  const [continueTopic, setContinueTopic] = useState(false)

  useEffect(() => {
    loadStories()
    loadKnownWords()
  }, [])

  useEffect(() => {
    if (id) {
      const story = stories.find(s => s.id === parseInt(id))
      if (story) openStory(story)
    }
  }, [id, stories])

  const loadStories = async () => {
    const all = await getAllStories()
    setStories(all)
    setLoading(false)
  }

  const loadKnownWords = async () => {
    const words = await getAllWords()
    const set = new Set(words.map(w => w.normalizedKey))
    setKnownWordsSet(set)
    const map = new Map()
    words.forEach(w => map.set(w.normalizedKey, w.translation))
    setKnownWordMap(map)
    setWordCount(words.length)
  }

  const resetStoryPlayback = useCallback(() => {
    window.speechSynthesis.cancel()
    germanVoice.stop()
    playbackStateRef.current = 'stopped'
    pausedAtSentenceRef.current = 0
    speakingSentenceIndexRef.current = 0
    speakChunksRef.current = []
    isPlayingRef.current = false
    setIsPlaying(false)
  }, [])

  const openStory = (story) => {
    resetStoryPlayback()
    setCurrentStory(story)
    setCurrentChapterIdx(story.currentChapter || 0)
    setWordMeanings(normalizeWordMeanings(story.wordMeanings || {}))
    setStoryTimerMode('read')
    setView('reader')
    setShowSummary(false)
    stop()
  }

  const handleGenerate = async () => {
    const apiKey = localStorage.getItem('dr_api_key')
    if (!apiKey) {
      setGenError('Add your DeepSeek API key in Settings first.')
      return
    }
    if (!genTheme.trim()) {
      setGenError('Enter a theme for the story.')
      return
    }

    setGenerating(true)
    setGenError('')

    try {
      const words = await getAllWords()
      const levelStr = genLevel === 'Auto'
        ? getSuggestedStoryLevelFromExposure(words.length)
        : genLevel

      const sameTopicStories = stories.filter(s => s.theme === genTheme)
      const previousTopicWords = continueTopic && sameTopicStories.length > 0
        ? [...new Set((sameTopicStories[0].content || '').toLowerCase().match(/[a-zäöüß]+/gi) || [])]
            .filter(w => w.length > 3)
            .slice(0, 50)
        : []

      const content = await generateStory({
        theme: genTheme,
        words,
        level: levelStr,
        chapterCount: genChapters,
        previousTopicWords,
      })

      const chapters = parseStoryContent(content)
      const title = chapters[0]?.title || genTheme

      // Find unknown words and explain them
      const allText = chapters.map(c => c.text).join(' ')
      const wordTokens = [...new Set(
        allText.toLowerCase().match(/[a-zäöüß]+/gi) || []
      )]
      const unknowns = wordTokens.filter(w => w.length > 3 && !knownWordsSet.has(w)).slice(0, 30)

      let meanings = {}
      if (unknowns.length > 0) {
        try {
          meanings = await explainUnknownWords(unknowns)
        } catch {}
      }

      const storyId = await saveStory({
        title,
        theme: genTheme,
        level: levelStr,
        content,
        chapters,
        wordMeanings: normalizeWordMeanings(meanings),
      })

      setGenerateModal(false)
      setGenTheme('')
      await loadStories()

      const saved = await getStory(storyId)
      if (saved) openStory(saved)
    } catch (e) {
      setGenError(e.message === 'NO_API_KEY' ? 'Add API key in Settings' : `Error: ${e.message}`)
    }
    setGenerating(false)
  }

  const handlePlay = useCallback(() => {
    if (!currentStory) return
    const chapter = currentStory.chapters[currentChapterIdx]
    if (!chapter) return

    if (playbackStateRef.current === 'playing' && window.speechSynthesis.speaking) return

    if (!shadowMode && storyTimerMode === 'read') {
      setStoryTimerMode('listen')
    }

    const onListenEnd = () => {
      playbackStateRef.current = 'stopped'
      pausedAtSentenceRef.current = 0
      speakingSentenceIndexRef.current = 0
      isPlayingRef.current = false
      setIsPlaying(false)
    }

    if (playbackStateRef.current === 'paused') {
      const start = Math.min(
        pausedAtSentenceRef.current,
        speakChunksRef.current.length
      )
      playbackStateRef.current = 'playing'
      isPlayingRef.current = true
      setIsPlaying(true)
      germanVoice.speakChunks(speakChunksRef.current, start, {
        onUtteranceStart: (idx) => {
          speakingSentenceIndexRef.current = idx
          pausedAtSentenceRef.current = idx
        },
        onAfterUtterance: (idx) => {
          pausedAtSentenceRef.current = idx + 1
        },
        onEnd: onListenEnd,
      })
      return
    }

    const chunks = germanVoice.getSpeakChunks(chapter.text).slice()
    speakChunksRef.current = chunks
    pausedAtSentenceRef.current = 0
    speakingSentenceIndexRef.current = 0
    playbackStateRef.current = 'playing'
    isPlayingRef.current = true
    setIsPlaying(true)

    germanVoice.speakChunks(chunks, 0, {
      onUtteranceStart: (idx) => {
        speakingSentenceIndexRef.current = idx
        pausedAtSentenceRef.current = idx
      },
      onAfterUtterance: (idx) => {
        pausedAtSentenceRef.current = idx + 1
      },
      onEnd: onListenEnd,
    })
  }, [currentStory, currentChapterIdx, shadowMode, storyTimerMode])

  const handlePause = useCallback(() => {
    window.speechSynthesis.cancel()
    germanVoice.stop()
    playbackStateRef.current = 'paused'
    pausedAtSentenceRef.current = speakingSentenceIndexRef.current
    isPlayingRef.current = false
    setIsPlaying(false)
  }, [])

  const handleChapterChange = async (newIdx) => {
    if (!currentStory || newIdx < 0 || newIdx >= currentStory.chapters.length) return
    window.speechSynthesis.cancel()
    germanVoice.stop()
    playbackStateRef.current = 'stopped'
    pausedAtSentenceRef.current = 0
    speakingSentenceIndexRef.current = 0
    speakChunksRef.current = []
    isPlayingRef.current = false
    setIsPlaying(false)
    stop()
    setShowSummary(false)

    // Award XP for reading a chapter
    const session = await getTodaySession()
    if (currentChapterIdx !== newIdx) {
      await updateTodaySession({ storiesRead: (session.storiesRead || 0) + 1 })
      await addXP(20)
      showXPToast(20, 'Chapter read!')
    }

    setCurrentChapterIdx(newIdx)
    await updateStoryProgress(currentStory.id, newIdx)
    setCurrentStory(prev => ({ ...prev, currentChapter: newIdx }))
  }

  const handleShadowComplete = async () => {
    setShadowMode(false)
    const session = await getTodaySession()
    await updateTodaySession({ shadowingMinutes: (session.shadowingMinutes || 0) + 10 })
    await addXP(25)
    showXPToast(25, 'Shadowing complete!')
  }

  const handleWordClick = (lookupKey, displayWord) => {
    const chapter = currentStory?.chapters[currentChapterIdx]
    const q = (lookupKey || displayWord || '').toLowerCase()
    const context = chapter?.text?.split(/[.!?]/).find(s => s.toLowerCase().includes(q)) || ''
    setActiveWordPopup({ word: displayWord || lookupKey, context: context.trim() })
  }

  const handleToggleShadow = () => {
    if (!shadowMode) {
      setStoryTimerMode('shadow')
      setShadowMode(true)
    } else {
      setStoryTimerMode('read')
      setShadowMode(false)
    }
  }

  const handleConfirmRegenerate = async () => {
    if (!regenTarget) return
    const story = regenTarget
    const apiKey = localStorage.getItem('dr_api_key')
    if (!apiKey) {
      showAppToast('Add your DeepSeek API key in Settings.')
      setRegenTarget(null)
      return
    }
    setRegenLoadingId(story.id)
    setRegenTarget(null)
    try {
      const words = await getAllWords()
      const keys = new Set(words.map(w => w.normalizedKey))
      const content = await generateStory({
        theme: story.theme,
        words,
        level: story.level,
        chapterCount: story.chapters?.length || 6,
      })
      const chapters = parseStoryContent(content)
      const allText = chapters.map(c => c.text).join(' ')
      const wordTokens = [...new Set(allText.toLowerCase().match(/[a-zäöüß]+/gi) || [])]
      const unknowns = wordTokens.filter(w => w.length > 3 && !keys.has(normalizeGerman(w))).slice(0, 30)
      let meanings = {}
      if (unknowns.length > 0) {
        try {
          meanings = await explainUnknownWords(unknowns)
        } catch {}
      }
      await updateStoryRecord(story.id, {
        content,
        chapters,
        wordMeanings: normalizeWordMeanings(meanings),
        title: chapters[0]?.title || story.title,
        createdAt: Date.now(),
      })
      await loadStories()
      showAppToast('Story regenerated!')
      if (currentStory?.id === story.id) {
        const updated = await getStory(story.id)
        if (updated) {
          setCurrentStory(updated)
          setWordMeanings(normalizeWordMeanings(updated.wordMeanings || {}))
        }
      }
    } catch (e) {
      showAppToast(e.message === 'NO_API_KEY' ? 'Add API key in Settings' : `Regenerate failed: ${e.message}`)
    }
    setRegenLoadingId(null)
  }

  // LIBRARY VIEW
  if (view === 'library') {
    const topicCounts = stories.reduce((acc, s) => {
      acc[s.theme] = (acc[s.theme] || 0) + 1
      return acc
    }, {})
    const visibleStories = topicFilter === 'All' ? stories : stories.filter(s => s.theme === topicFilter)

    return (
      <div className="max-w-4xl mx-auto space-y-5 relative">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Story Studio</h2>
            <p className="text-sm text-slate-400">Immerse yourself in German</p>
          </div>
          <Button
            onClick={() => setGenerateModal(true)}
            icon={<Plus size={16} />}
          >
            Generate Story
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Show stories by topic:</span>
          <select
            value={topicFilter}
            onChange={e => setTopicFilter(e.target.value)}
            className="bg-surface-800 border border-surface-700 text-slate-300 text-xs rounded-lg px-2 py-1"
          >
            <option value="All">All</option>
            {Object.keys(topicCounts).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-brand-400" />
          </div>
        ) : visibleStories.length === 0 ? (
          <div className="card p-16 text-center">
            <BookOpen size={48} className="text-slate-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-300 mb-2">No stories yet</h3>
            <p className="text-slate-500 mb-5">Generate your first immersive German story</p>
            <Button onClick={() => setGenerateModal(true)}>Generate Story</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visibleStories.map((story, i) => (
              <motion.div
                key={story.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="card p-5 hover:border-brand-500/40 transition-colors relative overflow-hidden"
              >
                {regenLoadingId === story.id && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-[inherit] bg-surface-950/85 backdrop-blur-[2px]">
                    <Loader2 size={28} className="animate-spin text-brand-400" />
                    <p className="text-sm text-slate-300 mt-2 font-medium">Generating...</p>
                  </div>
                )}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-white truncate">{story.title}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="badge-blue">{story.level}</span>
                      <span className="text-xs text-slate-500">Topic: {story.theme}</span>
                      {topicCounts[story.theme] > 1 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">Series</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 ml-2">
                    <button
                      type="button"
                      onClick={() => setRegenTarget(story)}
                      disabled={regenLoadingId != null}
                      className="text-slate-600 hover:text-brand-400 p-1.5 rounded-lg transition-colors disabled:opacity-40"
                      aria-label="Regenerate story"
                    >
                      <RefreshCw size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteStory(story.id).then(loadStories)}
                      disabled={regenLoadingId != null}
                      className="text-slate-600 hover:text-red-400 p-1.5 rounded-lg transition-colors disabled:opacity-40"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="mb-3">
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>Chapter {(story.currentChapter || 0) + 1} / {story.chapters?.length || 0}</span>
                    <span>{Math.round(((story.currentChapter || 0) / (story.chapters?.length || 1)) * 100)}%</span>
                  </div>
                  <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-500 rounded-full transition-all"
                      style={{ width: `${Math.round(((story.currentChapter || 0) / (story.chapters?.length || 1)) * 100)}%` }}
                    />
                  </div>
                </div>

                <div className="text-xs text-slate-500 mb-4">
                  Created {new Date(story.createdAt).toLocaleDateString()}
                  {story.readCount > 0 && ` · Read ${story.readCount}×`}
                </div>

                <Button
                  onClick={() => openStory(story)}
                  variant={story.currentChapter > 0 ? 'primary' : 'secondary'}
                  size="sm"
                  className="w-full"
                >
                  {story.currentChapter > 0 ? 'Continue Reading' : 'Start Reading'}
                </Button>
              </motion.div>
            )            )}
          </div>
        )}

        <Modal
          isOpen={!!regenTarget}
          onClose={() => !regenLoadingId && setRegenTarget(null)}
          title="Regenerate story?"
          size="md"
        >
          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            Regenerate this story? The current saved version will be replaced with a freshly generated one using the same theme and difficulty. This cannot be undone.
          </p>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setRegenTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmRegenerate}>Regenerate</Button>
          </div>
        </Modal>

        {/* Generate modal */}
        <Modal
          isOpen={generateModal}
          onClose={() => !generating && setGenerateModal(false)}
          title="Generate New Story"
          size="md"
        >
          <div className="space-y-4">
            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">Theme</label>
              <input
                value={genTheme}
                onChange={e => setGenTheme(e.target.value)}
                placeholder="What should the story be about?"
                className="input-field"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {THEMES.map(t => (
                  <button
                    key={t}
                    onClick={() => setGenTheme(t)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                      genTheme === t ? 'bg-brand-500 text-white' : 'bg-surface-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                <input type="checkbox" checked={continueTopic} onChange={e => setContinueTopic(e.target.checked)} />
                Continue this topic (narrow reading)
              </label>
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">Difficulty</label>
              <div className="flex gap-2">
                {LEVELS.map(l => (
                  <button
                    key={l}
                    onClick={() => setGenLevel(l)}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                      genLevel === l ? 'bg-brand-500 text-white' : 'bg-surface-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">Chapters</label>
              <div className="flex gap-2">
                {CHAPTERS.map(c => (
                  <button
                    key={c}
                    onClick={() => setGenChapters(c)}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                      genChapters === c ? 'bg-brand-500 text-white' : 'bg-surface-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {genError && (
              <p className="text-red-400 text-sm">{genError}</p>
            )}

            {generating ? (
              <div className="flex flex-col items-center py-8 gap-3">
                <Loader2 size={32} className="animate-spin text-brand-400" />
                <p className="text-slate-400 font-medium">Schreibe deine Geschichte...</p>
                <p className="text-xs text-slate-500">This may take 15–30 seconds</p>
              </div>
            ) : (
              <Button onClick={handleGenerate} disabled={!genTheme.trim()} className="w-full" size="lg">
                Generate Story
              </Button>
            )}
          </div>
        </Modal>
      </div>
    )
  }

  // READER VIEW
  if (!currentStory) return null
  const chapter = currentStory.chapters[currentChapterIdx]
  const sentences = chapter ? germanVoice.getSentences(chapter.text) : []

  const storyPageKey =
    storyTimerMode === 'read' ? 'story_read' :
    storyTimerMode === 'listen' ? 'story_listen' :
    'story_shadow'
  const storyGoalMinutes =
    storyTimerMode === 'read' ? 30 :
    storyTimerMode === 'listen' ? 25 :
    15
  const storyTimerLabel =
    storyTimerMode === 'read' ? 'Read' :
    storyTimerMode === 'listen' ? 'Listen' :
    'Shadow Mode'

  return (
    <div className="max-w-3xl mx-auto pb-32">
      {/* Top bar */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => {
            window.speechSynthesis.cancel()
            germanVoice.stop()
            playbackStateRef.current = 'stopped'
            pausedAtSentenceRef.current = 0
            speakingSentenceIndexRef.current = 0
            speakChunksRef.current = []
            isPlayingRef.current = false
            setIsPlaying(false)
            setView('library')
            stop()
            setShadowMode(false)
            setStoryTimerMode('read')
          }}
          className="text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-white truncate">{currentStory.title}</h2>
          <p className="text-xs text-slate-500">{currentStory.theme} · {currentStory.level}</p>
        </div>

        {/* Chapter selector */}
        <div className="relative">
          <select
            value={currentChapterIdx}
            onChange={e => handleChapterChange(parseInt(e.target.value))}
            className="bg-surface-800 border border-surface-700 text-slate-300 text-sm rounded-xl px-3 py-2 pr-8 focus:outline-none focus:border-brand-500 appearance-none cursor-pointer"
          >
            {currentStory.chapters.map((c, i) => (
              <option key={i} value={i}>{c.title}</option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* Chapter content */}
      {chapter && (
        <motion.div
          key={currentChapterIdx}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-6 md:p-8"
        >
          <h3 className="text-xl font-bold text-white mb-6">{chapter.title}</h3>

          <StoryText
            text={chapter.text.replace(/^Kapitel[^\n]+\n?/i, '')}
            knownWords={knownWordsSet}
            knownTranslations={knownWordMap}
            unknownMeanings={wordMeanings}
            onWordClick={handleWordClick}
          />

          {/* English summary */}
          {chapter.summary && (
            <div className="mt-6 pt-4 border-t border-surface-700">
              <button
                onClick={() => setShowSummary(v => !v)}
                className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                {showSummary ? <EyeOff size={14} /> : <Eye size={14} />}
                {showSummary ? 'Hide' : 'Show'} Chapter Summary
              </button>
              <AnimatePresence>
                {showSummary && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-2 text-sm text-slate-400 italic bg-surface-800/50 rounded-xl px-4 py-3"
                  >
                    {chapter.summary}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          )}
        </motion.div>
      )}

      {/* Audio controls */}
      <AudioControls
        isPlaying={isPlaying}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={() => {
          window.speechSynthesis.cancel()
          germanVoice.stop()
          playbackStateRef.current = 'stopped'
          pausedAtSentenceRef.current = 0
          speakingSentenceIndexRef.current = 0
          speakChunksRef.current = []
          isPlayingRef.current = false
          setIsPlaying(false)
          stop()
        }}
        onPrevChapter={() => handleChapterChange(currentChapterIdx - 1)}
        onNextChapter={() => handleChapterChange(currentChapterIdx + 1)}
        canGoPrev={currentChapterIdx > 0}
        canGoNext={currentChapterIdx < currentStory.chapters.length - 1}
        rate={rate}
        onRateChange={r => {
          changeRate(r)
          if (isPlaying) {
            const idx = speakingSentenceIndexRef.current
            window.speechSynthesis.cancel()
            germanVoice.stop()
            playbackStateRef.current = 'paused'
            pausedAtSentenceRef.current = idx
            isPlayingRef.current = false
            setIsPlaying(false)
            stop()
          }
        }}
        voices={voices}
        selectedVoiceURI={selectedVoiceURI}
        onVoiceChange={changeVoice}
        shadowMode={shadowMode}
        onToggleShadow={handleToggleShadow}
      />

      <SessionTimer
        key={storyPageKey}
        goalMinutes={storyGoalMinutes}
        label={storyTimerLabel}
        pageKey={storyPageKey}
      />

      {/* Shadow mode overlay */}
      {shadowMode && chapter && (
        <ShadowMode
          sentences={sentences}
          onClose={() => {
            setStoryTimerMode('read')
            setShadowMode(false)
          }}
          onChapterComplete={handleShadowComplete}
        />
      )}

      {/* Word popup */}
      <AnimatePresence>
        {activeWordPopup && (
          <WordPopup
            word={activeWordPopup.word}
            context={activeWordPopup.context}
            onClose={() => setActiveWordPopup(null)}
            onSaved={loadKnownWords}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
