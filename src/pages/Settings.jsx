import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  Key, Eye, EyeOff, Volume2, Sliders, Calendar,
  Download, Upload, Trash2, AlertTriangle, CheckCircle2,
  RefreshCw, Loader2, Bell, BookMarked, Cloud, Smartphone, Mail, LogOut,
} from 'lucide-react'
import { useSettings } from '../hooks/useSettings'
import { useVoice } from '../hooks/useVoice'
import { testConnection } from '../lib/deepseek'
import { germanVoice } from '../lib/voice'
import {
  getAllWords, getWordCount, initDB, importWords, applyAIFamilyMerge,
  exportFullBackup, importFullBackup,
} from '../lib/db.js'
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient.js'
import {
  getSupabaseBackupUiState,
  syncSupabaseBackupNow,
  listBackupSnapshots,
  fetchSnapshotPayloadById,
  MAX_SNAPSHOTS_PER_USER,
} from '../lib/supabaseBackup.js'
import { signOutCloud } from '../lib/supabaseAuth.js'
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
  const {
    apiKey, setApiKey, newCardsPerDay, setNewCardsPerDay, darkMode, setDarkMode,
    dailyXPGoal, setDailyXPGoal, targetRetention, setTargetRetention,
    frequencyWordsPerDay, setFrequencyWordsPerDay,
  } = useSettings()
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
  const [fullRestoreConfirm, setFullRestoreConfirm] = useState(false)
  const [pendingFullBackupFile, setPendingFullBackupFile] = useState(null)
  /** 'device' | 'cloud' — full restore confirm copy */
  const [pendingRestoreSource, setPendingRestoreSource] = useState(null)
  const [pendingCloudRestoreUpdatedAt, setPendingCloudRestoreUpdatedAt] = useState(null)
  const [importBackupChoiceOpen, setImportBackupChoiceOpen] = useState(false)
  const [cloudImportBusy, setCloudImportBusy] = useState(false)
  const [snapshotPickerOpen, setSnapshotPickerOpen] = useState(false)
  const [cloudSnapshots, setCloudSnapshots] = useState([])
  const [restoringSnapshotId, setRestoringSnapshotId] = useState(null)
  const importFileInputRef = useRef(null)
  const supabaseCloudEnabled = isSupabaseConfigured()
  const [cloudBackupUi, setCloudBackupUi] = useState(() => getSupabaseBackupUiState())
  const [cloudSyncBusy, setCloudSyncBusy] = useState(false)
  const [cloudSession, setCloudSession] = useState(null)
  const [cloudEmail, setCloudEmail] = useState('')
  const [cloudPassword, setCloudPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [magicLinkSent, setMagicLinkSent] = useState(false)

  const refreshCloudBackupUi = () => setCloudBackupUi(getSupabaseBackupUiState())

  useEffect(() => {
    if (!supabaseCloudEnabled) return
    const supabase = getSupabaseClient()
    if (!supabase) return
    supabase.auth.getSession().then(({ data: { session } }) => setCloudSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setCloudSession(session)
    })
    return () => subscription.unsubscribe()
  }, [supabaseCloudEnabled])

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

  const handleExportWordsOnly = async () => {
    const words = await getAllWords()
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      words,
      settings: {
        newCardsPerDay,
        frequencyWordsPerDay,
        dailyXPGoal,
        startDate,
        targetRetention,
      }
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `deutsche-reise-words-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportFullBackup = async () => {
    await initDB()
    const data = await exportFullBackup()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `deutsche-reise-FULL-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleSupabaseSyncNow = async () => {
    setCloudSyncBusy(true)
    try {
      const r = await syncSupabaseBackupNow()
      refreshCloudBackupUi()
      if (r?.skipped) {
        if (r.reason === 'not_signed_in') {
          alert('Sign in to your cloud account above first.')
        } else         if (r.reason === 'empty_wipe_guard') {
          alert('Backup skipped: local data looks empty, but your cloud already has snapshots — we did not upload, so your history stays safe.')
        } else if (r.reason === 'empty_nothing_to_save') {
          alert('Nothing to upload yet (empty library). Add some progress first.')
        }
      }
    } catch (err) {
      refreshCloudBackupUi()
      alert(err?.message || 'Cloud backup failed. Check the browser console and Supabase settings.')
    }
    setCloudSyncBusy(false)
  }

  const handleCloudSignUp = async () => {
    const supabase = getSupabaseClient()
    if (!supabase) return
    const email = cloudEmail.trim()
    if (!email || cloudPassword.length < 6) {
      alert('Enter email and password (at least 6 characters).')
      return
    }
    setAuthBusy(true)
    const { error } = await supabase.auth.signUp({ email, password: cloudPassword })
    setAuthBusy(false)
    if (error) alert(error.message)
    else alert('Account created. Confirm your email if your project requires it, then sign in.')
  }

  const handleCloudSignIn = async () => {
    const supabase = getSupabaseClient()
    if (!supabase) return
    const email = cloudEmail.trim()
    if (!email || !cloudPassword) {
      alert('Enter email and password.')
      return
    }
    setAuthBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: cloudPassword })
    setAuthBusy(false)
    if (error) alert(error.message)
  }

  const handleCloudMagicLink = async () => {
    const supabase = getSupabaseClient()
    if (!supabase) return
    const email = cloudEmail.trim()
    if (!email) {
      alert('Enter your email.')
      return
    }
    setAuthBusy(true)
    setMagicLinkSent(false)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/settings` },
    })
    setAuthBusy(false)
    if (error) alert(error.message)
    else setMagicLinkSent(true)
  }

  const handleCloudSignOut = async () => {
    setAuthBusy(true)
    try {
      await signOutCloud()
      setMagicLinkSent(false)
    } catch (e) {
      alert(e?.message || 'Sign out failed.')
    }
    setAuthBusy(false)
  }

  function formatSnapshotRow(iso) {
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return String(iso)
    const diff = Date.now() - d.getTime()
    const days = Math.floor(diff / 86400000)
    if (days <= 0) {
      return `Today · ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
    }
    if (days === 1) return `Yesterday · ${d.toLocaleString()}`
    return `${days} days ago · ${d.toLocaleString()}`
  }

  const handleOpenCloudSnapshotPicker = async () => {
    const supabase = getSupabaseClient()
    if (!supabase) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      alert('Sign in with the same cloud email you use on other devices, then try again.')
      return
    }
    setCloudImportBusy(true)
    try {
      const rows = await listBackupSnapshots()
      setCloudSnapshots(rows)
      setImportBackupChoiceOpen(false)
      setSnapshotPickerOpen(true)
    } catch (err) {
      alert(err?.message || 'Could not list cloud backups.')
    }
    setCloudImportBusy(false)
  }

  const handleRestoreCloudSnapshot = async (snapshotId) => {
    setRestoringSnapshotId(snapshotId)
    try {
      const { payload, createdAt } = await fetchSnapshotPayloadById(snapshotId)
      if (payload.format !== 'deutsche-reise-full-backup') {
        alert('Invalid snapshot format.')
        return
      }
      setSnapshotPickerOpen(false)
      setPendingFullBackupFile(JSON.stringify(payload))
      setPendingRestoreSource('cloud')
      setPendingCloudRestoreUpdatedAt(createdAt)
      setFullRestoreConfirm(true)
    } catch (err) {
      alert(err?.message || 'Could not load snapshot.')
    }
    setRestoringSnapshotId(null)
  }

  const handleImportFilePick = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        if (data.format === 'deutsche-reise-full-backup') {
          setPendingFullBackupFile(ev.target.result)
          setPendingRestoreSource('device')
          setPendingCloudRestoreUpdatedAt(null)
          setFullRestoreConfirm(true)
          e.target.value = ''
          return
        }
        if (data.words) {
          const result = await importWords(data.words)
          const t = data.settings?.targetRetention
          if (t != null) {
            const v = parseFloat(t)
            if (Number.isFinite(v) && v >= 0.8 && v <= 0.97) setTargetRetention(v)
          }
          alert(`Imported ${result.added} words, ${result.skipped} already existed.`)
        } else {
          alert('Unrecognized backup format.')
        }
      } catch {
        alert('Invalid backup file.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const runFullRestore = async () => {
    if (!pendingFullBackupFile) return
    try {
      await initDB()
      await importFullBackup(pendingFullBackupFile)
      setFullRestoreConfirm(false)
      setPendingFullBackupFile(null)
      setPendingRestoreSource(null)
      setPendingCloudRestoreUpdatedAt(null)
      alert('Full restore complete. The app will reload.')
      window.location.reload()
    } catch (err) {
      alert(err?.message || 'Full restore failed.')
    }
  }

  const openImportFromDevice = () => {
    setImportBackupChoiceOpen(false)
    requestAnimationFrame(() => importFileInputRef.current?.click())
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
        <p className="text-sm text-slate-400">
          First-week help: <code className="text-slate-500">public/FIRST_WEEK_GUIDE.txt</code>
        </p>
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
              value={newCardsPerDay}
              onChange={e => setNewCardsPerDay(parseInt(e.target.value, 10) || 15)}
              className="input-field w-24 text-center"
            />
            <span className="text-sm text-slate-400">(any number)</span>
          </div>
        </div>

        <div>
          <label className="text-sm text-slate-400 block mb-1.5">Frequency Lab — words per day (goal)</label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={5}
              max={50}
              value={frequencyWordsPerDay}
              onChange={e => setFrequencyWordsPerDay(parseInt(e.target.value, 10) || 25)}
              className="input-field w-24 text-center"
            />
            <span className="text-sm text-slate-400">words (5–50)</span>
          </div>
        </div>

        <div>
          <label className="text-sm text-slate-400 block mb-1.5">SRS retention target (%)</label>
          <p className="text-xs text-slate-500 mb-2">Explained in FIRST_WEEK_GUIDE.txt — higher = more reviews.</p>
          <div className="flex flex-wrap gap-2">
            {[0.85, 0.88, 0.9, 0.93].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTargetRetention(t)}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                  Math.abs(targetRetention - t) < 0.01
                    ? 'bg-brand-500 text-white'
                    : 'bg-surface-800 text-slate-400 hover:text-white'
                }`}
              >
                {Math.round(t * 100)}%
              </button>
            ))}
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
        <p className="text-sm text-slate-400">Merge duplicate forms into one card (AI). Keeps review history on the kept card.</p>
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
        {supabaseCloudEnabled && (
          <>
            <div className="rounded-xl border border-surface-700 bg-surface-900/70 p-3 text-sm space-y-3">
              <div className="flex items-center gap-2 text-slate-300 font-medium">
                <Mail size={16} className="text-brand-400 shrink-0" />
                Cloud account
              </div>
              <p className="text-slate-500 text-xs">
                Use the <strong className="text-slate-400">same email</strong> on every device (only env vars differ). Backups are stored under your account, not an anonymous browser session.
              </p>
              {cloudSession?.user?.email ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-300">
                    Signed in as <span className="text-white font-medium">{cloudSession.user.email}</span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={authBusy}
                    icon={<LogOut size={14} />}
                    onClick={handleCloudSignOut}
                  >
                    Sign out
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="Email"
                    value={cloudEmail}
                    onChange={(e) => setCloudEmail(e.target.value)}
                    className="w-full rounded-xl border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
                  />
                  <input
                    type="password"
                    autoComplete="current-password"
                    placeholder="Password (min 6)"
                    value={cloudPassword}
                    onChange={(e) => setCloudPassword(e.target.value)}
                    className="w-full rounded-xl border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" loading={authBusy} onClick={handleCloudSignUp}>
                      Create account
                    </Button>
                    <Button variant="secondary" size="sm" loading={authBusy} onClick={handleCloudSignIn}>
                      Sign in
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-slate-400"
                    loading={authBusy}
                    onClick={handleCloudMagicLink}
                  >
                    Email me a magic link
                  </Button>
                  {magicLinkSent && (
                    <p className="text-xs text-green-400">Check your inbox for the link (same tab will open Settings when done).</p>
                  )}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-surface-700 bg-surface-900/70 p-3 text-sm space-y-2">
              <div className="flex items-center gap-2 text-slate-300 font-medium">
                <Cloud size={16} className="text-brand-400 shrink-0" />
                Cloud backup (Supabase)
              </div>
              <p className="text-slate-500 text-xs">
                Adds a <strong className="text-slate-400">new snapshot</strong> each time (keeps history; older snapshots are removed only after {MAX_SNAPSHOTS_PER_USER} are stored). Auto-upload when signed in and it has been 24h since the last successful sync — never replaces older snapshots with empty data after data loss.
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-slate-400">
                  Last cloud sync:{' '}
                  <span className="text-slate-200">
                    {cloudBackupUi.lastExportAt
                      ? new Date(cloudBackupUi.lastExportAt).toLocaleString()
                      : '—'}
                  </span>
                </div>
                <Button
                  onClick={handleSupabaseSyncNow}
                  variant="secondary"
                  size="sm"
                  loading={cloudSyncBusy}
                  disabled={!cloudSession}
                  icon={<Cloud size={14} />}
                >
                  {cloudSyncBusy ? 'Syncing…' : 'Sync to cloud now'}
                </Button>
              </div>
              {!cloudSession && (
                <p className="text-xs text-amber-400/90">Sign in above to enable sync and snapshot history.</p>
              )}
              {cloudBackupUi.lastError && (
                <p className="text-xs text-red-400/90">
                  Last error: {cloudBackupUi.lastError}
                </p>
              )}
            </div>
          </>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={handleExportFullBackup}
            variant="secondary"
            size="sm"
            icon={<Download size={14} />}
          >
            Export full backup
          </Button>
          <Button
            onClick={handleExportWordsOnly}
            variant="secondary"
            size="sm"
            icon={<Download size={14} />}
          >
            Export words only
          </Button>

          <input
            ref={importFileInputRef}
            type="file"
            accept=".json"
            onChange={handleImportFilePick}
            className="hidden"
          />
          <Button
            onClick={() => setImportBackupChoiceOpen(true)}
            variant="secondary"
            size="sm"
            icon={<Upload size={14} />}
          >
            Import backup
          </Button>

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
          Full backup (file or cloud) = all IndexedDB data plus streak/settings keys in localStorage — not your API key.
          Words only = vocabulary merge. See FIRST_WEEK_GUIDE.txt.
        </p>
      </Section>

      <Modal
        isOpen={importBackupChoiceOpen}
        onClose={() => !cloudImportBusy && setImportBackupChoiceOpen(false)}
        title="Import backup"
        size="sm"
      >
        <p className="text-slate-400 text-sm mb-4">
          Choose where to load a <strong className="text-slate-200">full backup</strong> from (same content as Export full backup).
          Cloud: sign in with your backup email, then pick a dated snapshot (restore does not delete other snapshots).
        </p>
        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            className="justify-start"
            icon={<Smartphone size={14} />}
            onClick={openImportFromDevice}
            disabled={cloudImportBusy}
          >
            From device — JSON file
          </Button>
          {supabaseCloudEnabled ? (
            <Button
              variant="secondary"
              className="justify-start"
              icon={<Cloud size={14} />}
              loading={cloudImportBusy}
              onClick={handleOpenCloudSnapshotPicker}
            >
              From cloud — choose snapshot
            </Button>
          ) : (
            <p className="text-xs text-slate-500 px-1">
              Cloud import appears when <code className="text-slate-400">VITE_SUPABASE_*</code> env vars are set.
            </p>
          )}
          <Button variant="ghost" onClick={() => setImportBackupChoiceOpen(false)} disabled={cloudImportBusy}>
            Cancel
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={snapshotPickerOpen}
        onClose={() => !restoringSnapshotId && setSnapshotPickerOpen(false)}
        title="Restore from cloud"
        size="md"
      >
        <p className="text-slate-400 text-sm mb-3">
          Pick a snapshot to restore. Older backups stay in the cloud unless you exceed the retention limit.
        </p>
        <div className="max-h-[min(360px,50vh)] overflow-y-auto space-y-2 pr-1">
          {cloudSnapshots.length === 0 ? (
            <p className="text-sm text-slate-500">No snapshots yet. Sign in and use &quot;Sync to cloud now&quot; first.</p>
          ) : (
            cloudSnapshots.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-surface-700 bg-surface-950/80 px-3 py-2 text-sm"
              >
                <div>
                  <div className="text-slate-200">{formatSnapshotRow(row.created_at)}</div>
                  <div className="text-xs text-slate-500">
                    Words {row.word_count?.toLocaleString?.() ?? row.word_count} · SRS {row.srs_count?.toLocaleString?.() ?? row.srs_count} · Stories {row.story_count?.toLocaleString?.() ?? row.story_count}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={restoringSnapshotId === row.id}
                  disabled={!!restoringSnapshotId && restoringSnapshotId !== row.id}
                  onClick={() => handleRestoreCloudSnapshot(row.id)}
                >
                  Restore
                </Button>
              </div>
            ))
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={() => setSnapshotPickerOpen(false)} disabled={!!restoringSnapshotId}>
            Cancel
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={fullRestoreConfirm}
        onClose={() => {
          setFullRestoreConfirm(false)
          setPendingFullBackupFile(null)
          setPendingRestoreSource(null)
          setPendingCloudRestoreUpdatedAt(null)
        }}
        title="Replace everything?"
        size="sm"
      >
        <p className="text-slate-300 text-sm mb-4">
          This will <strong className="text-red-300">delete all local progress</strong> and replace it with the backup
          (words, flashcard intervals, stories, frequency data, sessions). Your API key in Settings is not changed.
        </p>
        {pendingRestoreSource === 'cloud' && pendingCloudRestoreUpdatedAt && (
          <p className="text-slate-400 text-xs mb-4">
            Cloud backup time: {new Date(pendingCloudRestoreUpdatedAt).toLocaleString()}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="danger" onClick={runFullRestore}>Restore and reload</Button>
          <Button
            variant="secondary"
            onClick={() => {
              setFullRestoreConfirm(false)
              setPendingFullBackupFile(null)
              setPendingRestoreSource(null)
              setPendingCloudRestoreUpdatedAt(null)
            }}
          >
            Cancel
          </Button>
        </div>
      </Modal>

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
