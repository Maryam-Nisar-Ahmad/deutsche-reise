import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronRight, Key, Upload, Volume2, Rocket, Check,
  Eye, EyeOff, AlertTriangle, Loader2, CheckCircle2
} from 'lucide-react'
import { parseDuolingoFormat, prepareGroupedImportRules } from '../lib/wordParser'
import { prepareGroupedImport } from '../lib/wordGrouper'
import { importWords, getWordCount, getMasteredWordCount, initDB } from '../lib/db'
import { testConnection } from '../lib/deepseek'
import { germanVoice } from '../lib/voice'
import { getLevel } from '../lib/levelCalc'
import clsx from 'clsx'

const TOTAL_PAGES = 5

export default function Onboarding({ onComplete }) {
  const [page, setPage] = useState(1)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [wordText, setWordText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importStatus, setImportStatus] = useState('')
  const [importDone, setImportDone] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [voices, setVoices] = useState([])
  const [selectedVoiceURI, setSelectedVoiceURI] = useState('')
  const [speechRate, setSpeechRate] = useState(0.85)
  const [wordCount, setWordCount] = useState(0)
  const [summaryMastered, setSummaryMastered] = useState(0)
  const [summaryWords, setSummaryWords] = useState(0)
  const [restoreMessage, setRestoreMessage] = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    if (page !== 5) return
    Promise.all([getMasteredWordCount(), getWordCount()]).then(([m, w]) => {
      setSummaryMastered(m)
      setSummaryWords(w)
    })
  }, [page])

  useEffect(() => {
    const timer = setTimeout(() => {
      const v = germanVoice.getVoices()
      setVoices(v)
      if (v.length > 0 && !selectedVoiceURI) {
        setSelectedVoiceURI(v[0].voiceURI)
      }
    }, 600)
    return () => clearTimeout(timer)
  }, [])

  const importPreview = wordText.trim()
    ? (() => {
        const raw = parseDuolingoFormat(wordText)
        return { raw: raw.length, grouped: prepareGroupedImportRules(raw).words.length }
      })()
    : { raw: 0, grouped: 0 }

  const handleTestKey = async () => {
    if (!apiKey.trim()) return
    localStorage.setItem('dr_api_key', apiKey.trim())
    setTesting(true)
    setTestResult(null)
    try {
      await testConnection()
      setTestResult('success')
    } catch {
      setTestResult('fail')
    }
    setTesting(false)
  }

  const handleImport = async () => {
    if (!wordText.trim()) {
      next()
      return
    }
    setImporting(true)
    setImportStatus('')
    const parsed = parseDuolingoFormat(wordText)
    try {
      const prev = parseInt(localStorage.getItem('dr_vocab_raw_entry_total') || '0', 10)
      localStorage.setItem('dr_vocab_raw_entry_total', String(prev + parsed.length))
    } catch { /* ignore */ }
    const apiKey = localStorage.getItem('dr_api_key')
    if (apiKey?.trim()) {
      setImportStatus('🤖 AI is grouping your words into families...')
    }
    const { words: groupedWords, stats: groupingStats } = await prepareGroupedImport(parsed, apiKey, {
      onBatchProgress: (cur, tot) => {
        setImportStatus(`🤖 AI grouping batch ${cur} of ${tot}... (this takes ~10 seconds)`)
      },
    })
    setImportStatus('')
    const result = await importWords(groupedWords, { groupingStats })
    localStorage.setItem('dr_new_cards_per_day', parsed.length > 500 ? '15' : '20')
    const count = await getWordCount()
    setImportResult({ ...result, rawParsed: parsed.length, familyCount: groupedWords.length, groupingMethod: groupingStats?.method })
    setWordCount(count)
    setImportDone(true)
    setImporting(false)
    setImportStatus('')
  }

  const handleFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setWordText(ev.target.result)
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleVoiceTest = () => {
    if (selectedVoiceURI) germanVoice.setVoice(selectedVoiceURI)
    germanVoice.setRate(speechRate)
    germanVoice.speakWord('Guten Tag! Ich freue mich, mit dir Deutsch zu lernen.')
  }

  const saveApiKey = () => {
    if (apiKey.trim()) {
      localStorage.setItem('dr_api_key', apiKey.trim())
    }
  }

  const saveVoiceSettings = () => {
    if (selectedVoiceURI) germanVoice.setVoice(selectedVoiceURI)
    germanVoice.setRate(speechRate)
  }

  const next = () => {
    if (page === 2) saveApiKey()
    if (page === 4) saveVoiceSettings()
    if (page < TOTAL_PAGES) {
      setPage(p => p + 1)
    }
  }

  const finish = async () => {
    saveApiKey()
    saveVoiceSettings()
    if (!importDone && wordText.trim()) await handleImport()
    localStorage.setItem('dr_onboarded', 'true')
    localStorage.setItem('dr_start_date', new Date().toISOString().split('T')[0])
    try {
      const db = await initDB()
      const storedWords = await db.count('words')
      console.log('[Onboarding] IndexedDB read-back success after dr_onboarded set', { storedWords })
    } catch (error) {
      console.error('[Onboarding] IndexedDB read-back failed after dr_onboarded set', error)
    }
    onComplete()
  }

  const handleRestoreSession = async () => {
    setRestoreMessage('')
    try {
      const count = await getWordCount()
      if (count > 0) {
        localStorage.setItem('dr_onboarded', 'true')
        window.location.reload()
        return
      }
      setRestoreMessage('No previous data found. Please complete setup.')
    } catch {
      setRestoreMessage('No previous data found. Please complete setup.')
    }
  }

  const level = getLevel(summaryMastered)

  const targetDate = (() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 7)
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
  })()

  const newCardsPerDay = parseInt(localStorage.getItem('dr_new_cards_per_day') || '15')

  return (
    <div className="min-h-screen bg-surface-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-8">
          {Array.from({ length: TOTAL_PAGES }, (_, i) => (
            <div
              key={i}
              className={clsx(
                'h-2 rounded-full transition-all duration-300',
                i + 1 === page ? 'w-8 bg-brand-500' : i + 1 < page ? 'w-2 bg-brand-500/60' : 'w-2 bg-surface-700'
              )}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.25 }}
            className="card p-8"
          >
            {/* PAGE 1 — Welcome */}
            {page === 1 && (
              <div className="text-center space-y-5">
                <div className="text-6xl mb-2">🇩🇪</div>
                <div>
                  <h1 className="text-3xl font-bold text-white">Willkommen!</h1>
                  <p className="text-slate-400 mt-2 text-lg">Deutsche Reise</p>
                </div>
                <div className="bg-surface-800 rounded-2xl p-5 text-left space-y-3">
                  <p className="text-slate-300">You're starting your journey to German B2.</p>
                  <p className="text-slate-300">This app uses <strong className="text-white">spaced repetition</strong>, <strong className="text-white">Frequency Lab</strong> (5,009 ranked words + stories), <strong className="text-white">AI stories</strong>, and <strong className="text-white">grammar exercises</strong> to get you to B2 in 7 months.</p>
                  <p className="text-brand-400 font-medium">Let's set up in 2 minutes.</p>
                </div>
                <button
                  onClick={next}
                  className="w-full py-4 bg-brand-500 hover:bg-brand-400 text-white text-lg font-bold rounded-2xl transition-all flex items-center justify-center gap-2"
                >
                  Let's go <ChevronRight size={22} />
                </button>
                <button
                  onClick={handleRestoreSession}
                  className="w-full text-xs text-slate-500 hover:text-brand-400 transition-colors"
                >
                  Already set up? Click here to restore your session
                </button>
                {restoreMessage && (
                  <p className="text-xs text-yellow-300">{restoreMessage}</p>
                )}
              </div>
            )}

            {/* PAGE 2 — API Key */}
            {page === 2 && (
              <div className="space-y-5">
                <div className="text-center">
                  <div className="w-14 h-14 bg-brand-500/10 border border-brand-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Key size={26} className="text-brand-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-white">DeepSeek API Key</h2>
                  <p className="text-slate-400 text-sm mt-1">Powers AI stories, explanations, and exercises</p>
                </div>

                <div>
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="input-field pr-10 font-mono text-sm"
                    />
                    <button
                      onClick={() => setShowKey(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    Get key at{' '}
                    <a href="https://platform.deepseek.com" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">
                      platform.deepseek.com
                    </a>
                    {' '}→ API Keys → Create Key.
                    Your key is stored only on this device.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleTestKey}
                    disabled={!apiKey.trim() || testing}
                    className="flex items-center gap-2 px-4 py-2 bg-surface-800 hover:bg-surface-700 disabled:opacity-40 text-slate-300 text-sm font-medium rounded-xl border border-surface-700 transition-all"
                  >
                    {testing ? <Loader2 size={14} className="animate-spin" /> : null}
                    Test connection
                  </button>
                  {testResult === 'success' && (
                    <span className="flex items-center gap-1 text-green-400 text-sm">
                      <CheckCircle2 size={14} />
                      Connected!
                    </span>
                  )}
                  {testResult === 'fail' && (
                    <span className="flex items-center gap-1 text-red-400 text-sm">
                      <AlertTriangle size={14} />
                      Failed
                    </span>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={next}
                    className="flex-1 py-3 bg-surface-800 hover:bg-surface-700 text-slate-300 text-sm font-medium rounded-xl border border-surface-700 transition-all"
                  >
                    Skip for now
                  </button>
                  <button
                    onClick={next}
                    className="flex-1 py-3 bg-brand-500 hover:bg-brand-400 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    Continue <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* PAGE 3 — Import Words */}
            {page === 3 && (
              <div className="space-y-4">
                <div className="text-center">
                  <div className="w-14 h-14 bg-brand-500/10 border border-brand-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Upload size={26} className="text-brand-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-white">Import Your Vocabulary</h2>
                  <p className="text-slate-400 text-sm mt-1">Go to Duolingo → Words tab → copy all words → paste here</p>
                </div>
                <p className="text-xs text-slate-500">
                  Format: one German word per line, or German / English pairs.
                </p>

                <textarea
                  value={wordText}
                  onChange={e => setWordText(e.target.value)}
                  placeholder={"hilfreich\nhelpful\n\nSchatz\ntreasure\n\nordentlich\ntidy"}
                  rows={8}
                  className="input-field font-mono text-sm resize-none"
                />

                {importPreview.raw > 0 && (
                  <p className="text-brand-400 text-sm font-medium flex items-center gap-1.5">
                    <Check size={14} />
                    {importPreview.raw.toLocaleString()} lines → ~{importPreview.grouped.toLocaleString()} word families (estimate; import uses AI if API key is set)
                  </p>
                )}

                {importStatus && (
                  <p className="text-slate-300 text-sm flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin shrink-0" />
                    {importStatus}
                  </p>
                )}

                {importResult && (
                  <div className="space-y-2 text-sm p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                      <div>
                        <p>
                          {importResult.rawParsed != null && importResult.familyCount != null && (
                            <span className="block mb-1">
                              Done! {importResult.rawParsed.toLocaleString()} Duolingo entries → {importResult.familyCount.toLocaleString()} unique word families
                              {importResult.groupingMethod === 'ai' ? ' (AI)' : importResult.groupingMethod === 'rules' ? ' (rules)' : ''}.
                            </span>
                          )}
                          Added {importResult.added} new families · {importResult.skipped} already in vault
                        </p>
                        {importResult.groupingStats && (importResult.groupingStats.verbFamilies > 0 || importResult.groupingStats.nounPairFamilies > 0) && (
                          <p className="text-xs text-green-300/90 mt-1">
                            {importResult.groupingStats.verbFormsInGroups > 0 && importResult.groupingStats.verbFamilies > 0 && (
                              <>Grouped {importResult.groupingStats.verbFormsInGroups} conjugated forms into {importResult.groupingStats.verbFamilies} verb families. </>
                            )}
                            {importResult.groupingStats.nounSurfacesInPairs > 0 && importResult.groupingStats.nounPairFamilies > 0 && (
                              <>Grouped {importResult.groupingStats.nounSurfacesInPairs} gendered forms into {importResult.groupingStats.nounPairFamilies} noun entries.</>
                            )}
                          </p>
                        )}
                        {importResult.added > 0 && (
                          <p className="text-xs text-brand-300 mt-2">
                            {importResult.added} new words added. They will appear in tomorrow&apos;s flashcard session. Keep using them in Duolingo today to strengthen them!
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <input ref={fileRef} type="file" accept=".txt" onChange={handleFileUpload} className="hidden" />
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2.5 bg-surface-800 hover:bg-surface-700 text-slate-300 text-sm font-medium rounded-xl border border-surface-700 transition-all flex-shrink-0"
                  >
                    <Upload size={14} />
                    Upload .txt
                  </button>

                  {importDone ? (
                    <button
                      onClick={next}
                      className="flex-1 py-2.5 bg-brand-500 hover:bg-brand-400 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                      Continue <ChevronRight size={16} />
                    </button>
                  ) : (
                    <button
                      onClick={wordText.trim() ? handleImport : next}
                      disabled={importing}
                      className="flex-1 py-2.5 bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                      {importing ? (
                        <><Loader2 size={16} className="animate-spin" />Importing...</>
                      ) : (
                        <>{wordText.trim() ? 'Import & Continue' : 'Skip'} <ChevronRight size={16} /></>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* PAGE 4 — Voice Setup */}
            {page === 4 && (
              <div className="space-y-5">
                <div className="text-center">
                  <div className="w-14 h-14 bg-brand-500/10 border border-brand-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Volume2 size={26} className="text-brand-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-white">Choose Your German Voice</h2>
                  <p className="text-slate-400 text-sm mt-1">Used for stories and flashcard pronunciation</p>
                </div>

                {voices.length > 0 ? (
                  <select
                    value={selectedVoiceURI}
                    onChange={e => setSelectedVoiceURI(e.target.value)}
                    className="input-field"
                  >
                    {voices.map(v => (
                      <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                    ))}
                  </select>
                ) : (
                  <div className="bg-surface-800 rounded-xl p-4 text-sm text-slate-400">
                    No German voices found. TTS may not work until you install German voices from your OS settings.
                  </div>
                )}

                <button
                  onClick={handleVoiceTest}
                  className="flex items-center gap-2 px-4 py-2 bg-surface-800 hover:bg-surface-700 text-slate-300 text-sm font-medium rounded-xl border border-surface-700 transition-all"
                >
                  <Volume2 size={14} />
                  Test Voice
                </button>

                <div>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-sm text-slate-400">Speed</span>
                    <span className="text-sm text-white font-medium">{speechRate}×</span>
                  </div>
                  <input
                    type="range"
                    min={0.6}
                    max={1.2}
                    step={0.05}
                    value={speechRate}
                    onChange={e => setSpeechRate(parseFloat(e.target.value))}
                    className="w-full h-2 bg-surface-700 rounded-full appearance-none cursor-pointer accent-brand-500"
                  />
                  <div className="flex justify-between text-xs text-slate-600 mt-1">
                    <span>0.6× (slow)</span>
                    <span>1.2× (fast)</span>
                  </div>
                </div>

                <button
                  onClick={next}
                  className="w-full py-3 bg-brand-500 hover:bg-brand-400 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  Continue <ChevronRight size={16} />
                </button>
              </div>
            )}

            {/* PAGE 5 — Ready! */}
            {page === 5 && (
              <div className="text-center space-y-5">
                <div>
                  <div className="text-5xl mb-3">🚀</div>
                  <h2 className="text-3xl font-bold text-white">Alles bereit!</h2>
                  <p className="text-slate-400 mt-1">Everything is set up</p>
                </div>

                <div className="bg-surface-800 rounded-2xl p-5 text-left space-y-3">
                  <div className="flex items-center justify-between py-2 border-b border-surface-700">
                    <span className="text-slate-400 text-sm">Current level</span>
                    <span className="font-bold text-lg" style={{ color: level.color }}>
                      {level.level} — {level.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-surface-700">
                    <span className="text-slate-400 text-sm">Mastered words</span>
                    <span className="text-white font-semibold tabular-nums">{summaryMastered.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-surface-700">
                    <span className="text-slate-400 text-sm">Vocabulary exposure</span>
                    <span className="text-slate-300 text-sm font-medium tabular-nums">{summaryWords.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-surface-700">
                    <span className="text-slate-400 text-sm">B2 target</span>
                    <span className="text-brand-400 font-semibold">{targetDate}</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-400 text-sm">Daily goal</span>
                    <span className="text-white font-semibold">{newCardsPerDay} new words + reviews</span>
                  </div>
                </div>

                <button
                  onClick={finish}
                  className="w-full py-4 bg-brand-500 hover:bg-brand-400 text-white text-lg font-bold rounded-2xl transition-all flex items-center justify-center gap-2"
                >
                  <Rocket size={22} />
                  Start Learning!
                </button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
