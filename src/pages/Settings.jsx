import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Key, Eye, EyeOff, Volume2, Sliders, Calendar,
  Download, Upload, Trash2, AlertTriangle, CheckCircle2,
  RefreshCw, Loader2, Bell, BookMarked,
} from 'lucide-react'
import { useSettings } from '../hooks/useSettings'
import { useVoice } from '../hooks/useVoice'
import { testConnection } from '../lib/deepseek'
import { germanVoice } from '../lib/voice'
import { getAllWords, getWordCount, initDB, importWords, applyAIFamilyMerge } from '../lib/db.js'
import { groupWordFamiliesWithAI } from '../lib/wordGrouper.js'
import Button from '../components/shared/Button'
import Modal from '../components/shared/Modal'

function Section({ title, icon: Icon, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-6"
    >
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-surface-800">
        <div className="p-2 bg-brand-500/10 rounded-xl">
          <Icon size={18} className="text-brand-400" />
        </div>
        <h3 className="font-bold text-white">{title}</h3>
      </div>
      <div className="space-y-4">{children}</div>
    </motion.div>
  )
}

export default function Settings() {
  const { apiKey, setApiKey, newCardsPerDay, setNewCardsPerDay, darkMode, setDarkMode, dailyXPGoal, setDailyXPGoal } = useSettings()
  const { voices, selectedVoiceURI, changeVoice, rate, changeRate } = useVoice()

  const [showKey, setShowKey] = useState(false)
  const [keyInput, setKeyInput] = useState(apiKey)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null) // 'success' | 'fail' | null
  const [clearConfirm, setClearConfirm] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [startDate, setStartDate] = useState(
    () => localStorage.getItem('dr_start_date') || new Date().toISOString().split('T')[0]
  )
  const [dbStatus, setDbStatus] = useState('Checking...')
  const [wordsStored, setWordsStored] = useState(0)
  const [regroupConfirm, setRegroupConfirm] = useState(false)
  const [regroupBusy, setRegroupBusy] = useState(false)
  const [regroupProgress, setRegroupProgress] = useState('')
  const [regroupResult, setRegroupResult] = useState(null)

  useEffect(() => {
    const checkDb = async () => {
      try {
        await initDB()
        console.log('[DB] initDB completed in Settings.jsx')
        setDbStatus('Connected')
        const count = await getWordCount()
        setWordsStored(count)
      } catch (error) {
        console.error('[DB] Settings DB check failed', error)
        setDbStatus('Error')
      }
    }
    checkDb()
  }, [])

  // B2 target date (7 months from start)
  const targetDate = (() => {
    const d = new Date(startDate)
    d.setMonth(d.getMonth() + 7)
    return d.toISOString().split('T')[0]
  })()

  const daysRemaining = Math.max(0, Math.ceil(
    (new Date(targetDate) - new Date()) / 86400000
  ))

  const handleSaveKey = () => {
    setApiKey(keyInput)
    setTestResult(null)
  }

  const handleTestConnection = async () => {
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

  const handleVoiceTest = () => {
    germanVoice.speakWord('Guten Tag! Ich heiße Deutsche Reise. Schön, mit dir Deutsch zu lernen.')
  }

  const handleExportData = async () => {
    const words = await getAllWords()
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      words,
      settings: {
        newCardsPerDay,
        dailyXPGoal,
        startDate,
      }
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `deutsche-reise-backup-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportData = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        if (data.words) {
          const result = await importWords(data.words)
          alert(`Imported ${result.added} words, ${result.skipped} already existed.`)
        }
      } catch {
        alert('Invalid backup file.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleResetProgress = async () => {
    const db = await initDB()
    console.log('[DB] initDB completed in Settings reset flow')
    const all = await db.getAll('srs_cards')
    for (const card of all) {
      await db.put('srs_cards', {
        ...card,
        easeFactor: 2.5,
        interval: 0,
        repetitions: 0,
        nextReview: Date.now(),
        lastReview: null,
        lapses: 0,
        state: 'new',
        totalReviews: 0,
        stability: 1,
        difficulty: 5,
      })
    }
    setResetConfirm(false)
    alert('SRS progress reset. Words kept.')
  }

  const handleClearEverything = () => {
    localStorage.clear()
    indexedDB.deleteDatabase('deutsche-reise-db')
    window.location.reload()
  }

  const handleRequestNotification = () => {
    if ('Notification' in window) {
      Notification.requestPermission().then(p => {
        alert(p === 'granted' ? 'Notifications enabled!' : 'Permission denied.')
      })
    }
  }

  const refreshWordCount = async () => {
    try {
      const c = await getWordCount()
      setWordsStored(c)
    } catch { /* ignore */ }
  }

  const openRegroupConfirm = async () => {
    setRegroupResult(null)
    await refreshWordCount()
    setRegroupConfirm(true)
  }

  const runRegroupWithAI = async () => {
    const apiKey = localStorage.getItem('dr_api_key')
    console.log(
      '[Settings] API key at click time:',
      apiKey ? String(apiKey).substring(0, 8) + '...' : 'MISSING'
    )
    if (!apiKey?.trim()) {
      alert(
        'No API key found. Please save your DeepSeek API key in the API Settings section above first.'
      )
      setRegroupConfirm(false)
      return
    }
    setRegroupConfirm(false)
    setRegroupBusy(true)
    setRegroupProgress('')
    setRegroupResult(null)
    try {
      const allWords = await getAllWords()
      const rawEntryTotal = allWords.length
      try {
        localStorage.setItem('dr_vocab_raw_entry_total', String(rawEntryTotal))
      } catch { /* ignore */ }

      const wordList = allWords.map((w) => ({
        german: w.german,
        translation: w.translation || '',
      }))

      const { groups: grouped, method: regroupMethod } = await groupWordFamiliesWithAI(wordList, apiKey.trim(), {
        onBatchProgress: (cur, tot) => {
          setRegroupProgress(`🤖 Analyzing batch ${cur} of ${tot}...`)
        },
      })

      setRegroupProgress('Merging duplicates in IndexedDB...')
      const mergeResult = await applyAIFamilyMerge(grouped)
      setRegroupResult({ ...mergeResult, method: regroupMethod })
      await refreshWordCount()
    } catch (e) {
      console.error(e)
      alert(e?.message || 'Re-grouping failed. Check your API key and try again.')
    }
    setRegroupBusy(false)
    setRegroupProgress('')
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="mb-2">
        <h2 className="text-xl font-bold text-white">Settings</h2>
        <p className="text-sm text-slate-400">Configure Deutsche Reise</p>
      </div>

      {/* API Key */}
      <Section title="DeepSeek API Key" icon={Key}>
        <div>
          <div className="flex gap-2 mb-2">
            <div className="relative flex-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
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
            <Button onClick={handleSaveKey} variant="secondary">Save</Button>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Get your key at{' '}
            <a href="https://platform.deepseek.com" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">
              platform.deepseek.com
            </a>
            {' '}→ API Keys → Create Key
          </p>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleTestConnection}
              loading={testing}
              variant="secondary"
              size="sm"
            >
              Test Connection
            </Button>
            {testResult === 'success' && (
              <div className="flex items-center gap-1.5 text-green-400 text-sm">
                <CheckCircle2 size={14} />
                Connected!
              </div>
            )}
            {testResult === 'fail' && (
              <div className="flex items-center gap-1.5 text-red-400 text-sm">
                <AlertTriangle size={14} />
                Connection failed
              </div>
            )}
            {apiKey ? (
              <span className="flex items-center gap-1 text-xs text-green-400">
                <CheckCircle2 size={12} />
                Key saved
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-red-400">
                <AlertTriangle size={12} />
                No key
              </span>
            )}
          </div>
        </div>
      </Section>

      {/* Voice Settings */}
      <Section title="Voice Settings" icon={Volume2}>
        <div>
          <label className="text-sm text-slate-400 block mb-1.5">German Voice</label>
          {voices.length > 0 ? (
            <select
              value={selectedVoiceURI || ''}
              onChange={e => changeVoice(e.target.value)}
              className="input-field mb-3"
            >
              {voices.map(v => (
                <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
              ))}
            </select>
          ) : (
            <p className="text-slate-500 text-sm mb-3">
              No German voices found. Make sure your OS has German TTS voices installed.
            </p>
          )}

          <Button
            onClick={handleVoiceTest}
            variant="secondary"
            size="sm"
            icon={<Volume2 size={14} />}
            className="mb-4"
          >
            Test Voice
          </Button>

          <div>
            <div className="flex justify-between mb-1.5">
              <label className="text-sm text-slate-400">Speed</label>
              <span className="text-sm text-white font-medium">{rate}×</span>
            </div>
            <input
              type="range"
              min={0.6}
              max={1.2}
              step={0.05}
              value={rate}
              onChange={e => {
                changeRate(parseFloat(e.target.value))
                germanVoice.speakWord('Beispiel')
              }}
              className="w-full h-2 bg-surface-700 rounded-full appearance-none cursor-pointer accent-brand-500"
            />
            <div className="flex justify-between text-xs text-slate-600 mt-1">
              <span>0.6×</span>
              <span>1.2×</span>
            </div>
          </div>
        </div>
      </Section>

      {/* Study Settings */}
      <Section title="Study Settings" icon={Sliders}>
        <div>
          <label className="text-sm text-slate-400 block mb-1.5">New cards per day</label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={5}
              max={30}
              value={newCardsPerDay}
              onChange={e => setNewCardsPerDay(Math.min(30, Math.max(5, parseInt(e.target.value) || 15)))}
              className="input-field w-24 text-center"
            />
            <span className="text-sm text-slate-400">cards (5–30)</span>
          </div>
        </div>

        <div>
          <label className="text-sm text-slate-400 block mb-1.5">Daily XP goal</label>
          <div className="flex gap-2">
            {[100, 200, 300, 500].map(g => (
              <button
                key={g}
                onClick={() => setDailyXPGoal(g)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                  dailyXPGoal === g ? 'bg-brand-500 text-white' : 'bg-surface-800 text-slate-400 hover:text-white'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm text-slate-400 block mb-1.5">Dark mode</label>
          <div className="flex gap-2">
            {[true, false].map(val => (
              <button
                key={String(val)}
                onClick={() => setDarkMode(val)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                  darkMode === val ? 'bg-brand-500 text-white' : 'bg-surface-800 text-slate-400 hover:text-white'
                }`}
              >
                {val ? '🌙 Dark' : '☀️ Light'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Button
            onClick={handleRequestNotification}
            variant="secondary"
            size="sm"
            icon={<Bell size={14} />}
          >
            Enable Reminders
          </Button>
          <p className="text-xs text-slate-500 mt-1">Get a daily reminder to study</p>
        </div>
      </Section>

      {/* Progress Settings */}
      <Section title="B2 Journey" icon={Calendar}>
        <div>
          <label className="text-sm text-slate-400 block mb-1.5">Start date</label>
          <input
            type="date"
            value={startDate}
            onChange={e => {
              setStartDate(e.target.value)
              localStorage.setItem('dr_start_date', e.target.value)
            }}
            className="input-field w-48"
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">B2 target date</span>
            <span className="text-sm text-white font-medium">
              {new Date(targetDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{daysRemaining} days remaining</p>
        </div>
      </Section>

      {/* Vocabulary maintenance */}
      <Section title="Vocabulary Maintenance" icon={BookMarked}>
        <p className="text-sm text-slate-400">
          Use DeepSeek to merge conjugations and gendered pairs into single cards. Your SRS progress on the kept card is preserved.
        </p>
        <Button
          onClick={openRegroupConfirm}
          variant="secondary"
          size="sm"
          disabled={!apiKey?.trim() || wordsStored === 0 || regroupBusy}
          loading={regroupBusy}
          icon={<RefreshCw size={14} />}
        >
          Re-group Existing Words with AI
        </Button>
        {!apiKey?.trim() && (
          <p className="text-xs text-slate-500">Save an API key in the section above to enable AI re-grouping.</p>
        )}
        {regroupProgress && (
          <p className="text-sm text-slate-300 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin shrink-0" />
            {regroupProgress}
          </p>
        )}
        {regroupResult && (
          <div className="rounded-xl border border-green-500/25 bg-green-500/10 p-4 text-sm text-green-300 space-y-1">
            <p className="font-semibold text-green-400">✅ Re-grouping complete!</p>
            <p>Before: {regroupResult.beforeCount.toLocaleString()} entries</p>
            <p>After: {regroupResult.afterCount.toLocaleString()} unique word families</p>
            <p>Removed: {regroupResult.removedDuplicates.toLocaleString()} duplicate forms</p>
            {regroupResult.method === 'rules' ? (
              <p className="text-yellow-400 font-medium pt-1">Method used: 📐 Rule-based fallback</p>
            ) : (
              <p className="text-green-400 font-medium pt-1">Method used: ✨ DeepSeek AI</p>
            )}
          </div>
        )}
      </Section>

      {/* Data Management */}
      <Section title="Data Management" icon={Download}>
        <div className="rounded-xl border border-surface-700 bg-surface-900/70 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">IndexedDB status:</span>
            <span className={dbStatus === 'Connected' ? 'text-green-400 font-medium' : dbStatus === 'Error' ? 'text-red-400 font-medium' : 'text-slate-300'}>
              {dbStatus}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-slate-400">Words stored:</span>
            <span className="text-white font-medium">{wordsStored.toLocaleString()}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={handleExportData}
            variant="secondary"
            size="sm"
            icon={<Download size={14} />}
          >
            Export All Data
          </Button>

          <label className="cursor-pointer">
            <input type="file" accept=".json" onChange={handleImportData} className="hidden" />
            <div className="flex items-center gap-2 px-3 py-2 bg-surface-800 hover:bg-surface-700 text-slate-300 hover:text-white text-sm font-semibold rounded-xl border border-surface-700 hover:border-surface-600 transition-all cursor-pointer">
              <Upload size={14} />
              Import Backup
            </div>
          </label>

          <Button
            onClick={() => setResetConfirm(true)}
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} />}
          >
            Reset Progress
          </Button>

          <Button
            onClick={() => setClearConfirm(true)}
            variant="danger"
            size="sm"
            icon={<Trash2 size={14} />}
          >
            Clear Everything
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          Export saves all your words and SRS data as JSON for backup.
        </p>
      </Section>

      {/* Reset confirm */}
      <Modal isOpen={resetConfirm} onClose={() => setResetConfirm(false)} title="Reset SRS Progress" size="sm">
        <p className="text-slate-300 mb-4">
          This will reset all flashcard progress back to "new" status.
          Your words will be kept, but all SRS intervals reset.
        </p>
        <div className="flex gap-2">
          <Button variant="danger" onClick={handleResetProgress}>Reset Progress</Button>
          <Button variant="secondary" onClick={() => setResetConfirm(false)}>Cancel</Button>
        </div>
      </Modal>

      {/* AI re-group confirm */}
      <Modal isOpen={regroupConfirm} onClose={() => !regroupBusy && setRegroupConfirm(false)} title="Re-group with AI?" size="sm">
        <p className="text-slate-300 mb-4">
          AI will analyze your {wordsStored.toLocaleString()} existing words and merge duplicate conjugations and gendered pairs into single cards.
          This uses your DeepSeek API key and may take about {Math.max(1, Math.ceil(wordsStored / 80) * 10)} seconds.
          Your review history on the kept card is preserved. Continue?
        </p>
        <div className="flex gap-2">
          <Button onClick={runRegroupWithAI}>Continue</Button>
          <Button variant="secondary" onClick={() => setRegroupConfirm(false)}>Cancel</Button>
        </div>
      </Modal>

      {/* Clear everything confirm */}
      <Modal isOpen={clearConfirm} onClose={() => setClearConfirm(false)} title="Clear Everything" size="sm">
        <div className="flex items-start gap-3 mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
          <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">
            This will permanently delete ALL your words, stories, and progress.
            This cannot be undone.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="danger" onClick={handleClearEverything}>Delete Everything</Button>
          <Button variant="secondary" onClick={() => setClearConfirm(false)}>Cancel</Button>
        </div>
      </Modal>
    </div>
  )
}
