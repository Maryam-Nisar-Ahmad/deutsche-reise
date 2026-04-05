import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Upload, Plus, Volume2, Trash2, Download, Copy,
  Filter, BookMarked, AlertCircle, Loader2, Sparkles, ChevronRight, Package,
} from 'lucide-react'
import {
  getAllWords, getWordCount, importWords, addWord, deleteWord, getCardForWord,
  fixSwappedGermanEnglishInDB, getMasteredWordCount,
} from '../lib/db'
import { auditVocabularyFrequency, generateExampleSentenceForWord } from '../lib/deepseek'
import { getLevel } from '../lib/levelCalc'
import { showAppToast } from '../components/shared/XPToast'
import { parseDuolingoFormat, parseManualEntry, prepareGroupedImportRules } from '../lib/wordParser'
import { prepareGroupedImport } from '../lib/wordGrouper'
import { germanVoice } from '../lib/voice'
import Button from '../components/shared/Button'
import Modal from '../components/shared/Modal'
import SessionTimer from '../components/shared/SessionTimer'

const FILTERS = ['All', 'New', 'Learning', 'Mastered', 'Due Today']

function getCoverageInfo(knownWordCount) {
  if (knownWordCount < 1000) return { coverage: '< 78%', cefr: 'A1', nextMilestone: 1000, label: '1,000 words = 78% text coverage (A2)' }
  if (knownWordCount < 2000) return { coverage: '78–86%', cefr: 'A2', nextMilestone: 2000, label: '2,000 words = 86-90% coverage (B1)' }
  if (knownWordCount < 3000) return { coverage: '86–90%', cefr: 'B1', nextMilestone: 3000, label: '3,000 words = 93-95% coverage (B1-B2)' }
  if (knownWordCount < 5000) return { coverage: '93–95%', cefr: 'B1-B2', nextMilestone: 5000, label: '5,000 words = 95-96% coverage (B2)' }
  return { coverage: '95-96%', cefr: 'B2+', nextMilestone: null, label: 'B2 vocabulary achieved!' }
}

function SRSBar({ repetitions = 0 }) {
  const boxes = 5
  const filled = Math.min(boxes, repetitions)
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: boxes }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 w-3 rounded-full transition-colors ${
            i < filled ? 'bg-brand-400' : 'bg-surface-700'
          }`}
        />
      ))}
    </div>
  )
}

export default function VocabVault() {
  const [words, setWords] = useState([])
  const [cards, setCards] = useState({})
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('All')
  const [importText, setImportText] = useState('')
  const [importResult, setImportResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importStatus, setImportStatus] = useState('')
  const [manualGerman, setManualGerman] = useState('')
  const [manualTranslation, setManualTranslation] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [showImportArea, setShowImportArea] = useState(false)
  const [fixSwapBusy, setFixSwapBusy] = useState(false)
  const [auditBusy, setAuditBusy] = useState(false)
  const [auditOffset, setAuditOffset] = useState(0)
  const [auditResults, setAuditResults] = useState(null)
  const [practiceWord, setPracticeWord] = useState(null)
  const [practiceSentence, setPracticeSentence] = useState('')
  const [practiceBusy, setPracticeBusy] = useState(false)
  const fileRef = useRef(null)
  const [bundledBaseline, setBundledBaseline] = useState(null)

  useEffect(() => {
    fetch('/data/baseline-vocab.json')
      .then((r) => r.json())
      .then((d) =>
        setBundledBaseline({
          count: typeof d.count === 'number' ? d.count : (d.entries || []).length,
          note: d.note || '',
        })
      )
      .catch(() => setBundledBaseline({ count: 0, note: '' }))
  }, [])

  const loadWords = async () => {
    const [allWords] = await Promise.all([getAllWords()])
    setWords(allWords)

    // Load SRS card states
    const cardMap = {}
    for (const word of allWords) {
      const card = await getCardForWord(word.id)
      if (card) cardMap[word.id] = card
    }
    setCards(cardMap)
    setLoading(false)
  }

  useEffect(() => {
    loadWords()
  }, [])

  const filtered = useMemo(() => {
    let list = [...words].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(w =>
        w.german.toLowerCase().includes(q) ||
        w.translation.toLowerCase().includes(q)
      )
    }
    if (activeFilter !== 'All') {
      const now = Date.now()
      list = list.filter(w => {
        const card = cards[w.id]
        if (!card) return activeFilter === 'New'
        if (activeFilter === 'New') return card.state === 'new'
        if (activeFilter === 'Learning') return card.state === 'learning' || card.state === 'relearning'
        if (activeFilter === 'Mastered') return card.state === 'review'
        if (activeFilter === 'Due Today') return card.nextReview <= now && card.state !== 'new'
        return true
      })
    }
    return list
  }, [words, cards, search, activeFilter])

  const stats = useMemo(() => {
    const all = Object.values(cards)
    return {
      mastered: all.filter(c => c.state === 'review').length,
      learning: all.filter(c => c.state === 'learning' || c.state === 'relearning').length,
      newCards: all.filter(c => c.state === 'new').length,
    }
  }, [words, cards])

  const handleFixEnDeSwap = async () => {
    setFixSwapBusy(true)
    try {
      const { fixed } = await fixSwappedGermanEnglishInDB()
      await loadWords()
      showAppToast(
        fixed > 0
          ? `Fixed ${fixed} entries where English was stored as German. Re-open Flashcards.`
          : 'No obvious EN/DE swaps found (or already fixed).'
      )
    } catch (e) {
      showAppToast(e.message || 'Fix failed')
    }
    setFixSwapBusy(false)
  }

  const handleFrequencyAudit = async () => {
    const apiKey = localStorage.getItem('dr_api_key')
    if (!apiKey?.trim()) {
      showAppToast('Add DeepSeek API key in Settings to run frequency audit.')
      return
    }
    if (!words.length) return
    setAuditBusy(true)
    setAuditResults(null)
    try {
      const start = Math.min(auditOffset, Math.max(0, words.length - 1))
      const slice = words.slice(start, start + 40)
      const results = await auditVocabularyFrequency(slice)
      setAuditResults({ start, slice, results })
      setAuditOffset(start + 40 >= words.length ? 0 : start + 40)
    } catch (e) {
      showAppToast(e.message || 'Audit failed')
    }
    setAuditBusy(false)
  }

  const pickRandomPracticeWord = () => {
    if (!words.length) return
    const w = words[Math.floor(Math.random() * words.length)]
    setPracticeWord(w)
    setPracticeSentence('')
  }

  const loadPracticeSentence = async () => {
    if (!practiceWord) return
    const apiKey = localStorage.getItem('dr_api_key')
    if (!apiKey?.trim()) {
      showAppToast('Add API key in Settings for AI example sentences.')
      return
    }
    setPracticeBusy(true)
    try {
      const mastered = await getMasteredWordCount()
      const lv = getLevel(mastered).level
      const s = await generateExampleSentenceForWord(
        practiceWord.german,
        practiceWord.translation,
        lv
      )
      setPracticeSentence(s)
      germanVoice.speakWord(s)
    } catch (e) {
      showAppToast(e.message || 'Could not generate sentence')
    }
    setPracticeBusy(false)
  }

  const handleImport = async () => {
    if (!importText.trim()) return
    setImporting(true)
    setImportStatus('')
    try {
      const parsed = parseDuolingoFormat(importText)
      try {
        const prev = parseInt(localStorage.getItem('dr_vocab_raw_entry_total') || '0', 10)
        localStorage.setItem('dr_vocab_raw_entry_total', String(prev + parsed.length))
      } catch { /* storage blocked */ }
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
      setImportResult({
        added: result.added,
        skipped: result.skipped,
        groupingStats: result.groupingStats,
        rawParsed: parsed.length,
        familyCount: groupedWords.length,
        groupingMethod: groupingStats?.method,
      })
      setImportText('')
      await loadWords()
      setTimeout(() => setImportResult(null), 12000)
    } catch (e) {
      console.error(e)
    }
    setImporting(false)
    setImportStatus('')
  }

  /** Same pipeline as paste import, but from baked `public/data/baseline-vocab.json` (from words.txt at build). */
  const handleBundledBaselineImport = async () => {
    setImporting(true)
    setImportStatus('')
    try {
      const res = await fetch('/data/baseline-vocab.json')
      const data = await res.json()
      const parsed = Array.isArray(data.entries) ? data.entries : []
      if (!parsed.length) {
        showAppToast(
          data.note ||
            'No bundled baseline. Put words.txt in the project root and run npm run build:baseline (or npm run build).'
        )
        setImporting(false)
        return
      }
      try {
        const prev = parseInt(localStorage.getItem('dr_vocab_raw_entry_total') || '0', 10)
        localStorage.setItem('dr_vocab_raw_entry_total', String(prev + parsed.length))
      } catch { /* ignore */ }
      const apiKey = localStorage.getItem('dr_api_key')
      if (apiKey?.trim()) {
        setImportStatus('🤖 AI is grouping bundled baseline into families...')
      }
      const { words: groupedWords, stats: groupingStats } = await prepareGroupedImport(parsed, apiKey, {
        onBatchProgress: (cur, tot) => {
          setImportStatus(`🤖 AI grouping batch ${cur} of ${tot}...`)
        },
      })
      setImportStatus('')
      const result = await importWords(groupedWords, { groupingStats })
      localStorage.setItem('dr_new_cards_per_day', parsed.length > 500 ? '15' : '20')
      setImportResult({
        added: result.added,
        skipped: result.skipped,
        groupingStats: result.groupingStats,
        rawParsed: parsed.length,
        familyCount: groupedWords.length,
        groupingMethod: groupingStats?.method,
        source: 'bundled words.txt',
      })
      await loadWords()
      showAppToast(`Bundled baseline: +${result.added} new families (${result.skipped} already in vault).`)
      setTimeout(() => setImportResult(null), 14000)
    } catch (e) {
      console.error(e)
      showAppToast(e.message || 'Bundled import failed')
    }
    setImporting(false)
    setImportStatus('')
  }

  const handleFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setImportText(ev.target.result)
      setShowImportArea(true)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleAddManual = async () => {
    const entry = parseManualEntry(manualGerman, manualTranslation)
    if (!entry) return
    await addWord(entry.german, entry.translation)
    setManualGerman('')
    setManualTranslation('')
    await loadWords()
    showAppToast('Added — newest words appear at the top of this list.')
  }

  const handleDelete = async (id) => {
    await deleteWord(id)
    setDeleteConfirm(null)
    await loadWords()
  }

  const handleExport = (mode) => {
    let text = ''
    if (mode === 'german') text = words.map(w => w.german).join('\n')
    else if (mode === 'pairs') text = words.map(w => `${w.german}\t${w.translation}`).join('\n')
    else {
      // download
      const blob = new Blob([words.map(w => `${w.german}\n${w.translation}`).join('\n\n')], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'deutsch-vocabulary.txt'
      a.click()
      URL.revokeObjectURL(url)
      return
    }
    navigator.clipboard.writeText(text).catch(console.error)
  }

  const importPreview = useMemo(() => {
    if (!importText.trim()) return { raw: 0, grouped: 0 }
    const raw = parseDuolingoFormat(importText)
    return { raw: raw.length, grouped: prepareGroupedImportRules(raw).words.length }
  }, [importText])
  const coverage = getCoverageInfo(words.length)
  let rawEntryTotal = 0
  try {
    rawEntryTotal = parseInt(localStorage.getItem('dr_vocab_raw_entry_total') || '0', 10)
  } catch { /* ignore */ }
  const vocabTooltip =
    'Duolingo counts each verb form separately. Your true vocabulary size is measured by unique word families — the root word and all its forms.'

  return (
    <>
    <SessionTimer goalMinutes={10} label="Vocab Vault" pageKey="vocab" />
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Vocab Vault</h2>
          <p className="text-sm text-slate-400">Manage your German vocabulary</p>
          <p className="text-xs text-slate-500 mt-1" title={vocabTooltip}>
            <span className="cursor-help border-b border-dotted border-slate-600">
              Entries: {rawEntryTotal > 0 ? rawEntryTotal.toLocaleString() : '—'}
            </span>
            {' · '}
            <span className="cursor-help border-b border-dotted border-slate-600">
              Unique word families: ~{words.length.toLocaleString()}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowImportArea(v => !v)}
            icon={<Upload size={14} />}
          >
            Import
          </Button>
          <input ref={fileRef} type="file" accept=".txt" onChange={handleFileUpload} className="hidden" />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileRef.current?.click()}
            icon={<Upload size={14} />}
          >
            Upload .txt
          </Button>
        </div>
      </div>

      {/* Bundled baseline — same idea as Frequency list JSON */}
      <div className="card p-5 border-brand-500/15 bg-surface-900/40">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4 justify-between">
          <div className="flex gap-3">
            <div className="p-2 rounded-xl bg-brand-500/10 border border-brand-500/20 h-fit">
              <Package size={20} className="text-brand-400" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Bundled baseline (words.txt)</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-xl">
                One-click import from the built-in list. Moving PCs: Settings → full backup (see FIRST_WEEK_GUIDE.txt).
              </p>
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-2 shrink-0">
            <span className="text-xs text-slate-500 text-right sm:text-left">
              {bundledBaseline == null
                ? 'Checking bundle…'
                : bundledBaseline.count > 0
                  ? `${bundledBaseline.count.toLocaleString()} entries in bundle`
                  : 'Bundle empty (add words.txt & build)'}
            </span>
            <Button
              onClick={handleBundledBaselineImport}
              disabled={importing || !bundledBaseline || bundledBaseline.count === 0}
              icon={importing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            >
              Import bundled baseline
            </Button>
          </div>
        </div>
      </div>

      {/* Import area */}
      <AnimatePresence>
        {showImportArea && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="card p-5 overflow-hidden"
          >
            <h3 className="font-semibold text-white mb-2">Paste Duolingo Word List</h3>
            <p className="text-xs text-slate-500 mb-3">
              Format supported: one German word per line, German - English, German - English with em dash, tab-separated pairs, or two-line blocks.
            </p>
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder={"hilfreich\nhelpful\n\nSchatz\ntreasure\n\nordentlich\ntidy"}
              rows={8}
              className="input-field font-mono text-sm resize-y mb-3"
            />
            {importPreview.raw > 0 && (
              <p className="text-sm text-brand-400 mb-3 font-medium">
                ✓ {importPreview.raw.toLocaleString()} lines detected → ~{importPreview.grouped.toLocaleString()} word families (rule-based estimate; with a saved API key, import uses AI for smarter grouping)
              </p>
            )}
            {importStatus && (
              <p className="text-sm text-slate-300 mb-3 flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-brand-500 border-t-transparent animate-spin shrink-0" />
                {importStatus}
              </p>
            )}
            {importResult && (
              <div className="space-y-2 text-sm mb-3 p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400">
                <div className="flex items-start gap-2">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <div>
                    <p>
                      {importResult.rawParsed != null && importResult.familyCount != null && (
                        <span className="block mb-1">
                          Done! {importResult.rawParsed.toLocaleString()} Duolingo entries → {importResult.familyCount.toLocaleString()} unique word families
                          {importResult.groupingMethod === 'ai' ? ' (AI)' : importResult.groupingMethod === 'rules' ? ' (rules)' : ''}.
                        </span>
                      )}
                      Imported {importResult.added + importResult.skipped} families from {importResult.rawParsed?.toLocaleString() ?? '—'} entries.
                      {importResult.skipped > 0 && ` ${importResult.skipped} were already in your vault (skipped).`}
                      {importResult.added > 0 && ` ${importResult.added} new families added.`}
                    </p>
                    {importResult.groupingStats && (importResult.groupingStats.verbFamilies > 0 || importResult.groupingStats.nounPairFamilies > 0) && (
                      <p className="text-xs text-green-300/90 mt-2 leading-relaxed">
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
              <Button onClick={handleImport} loading={importing} disabled={!importText.trim()}>
                Import Words
              </Button>
              <Button variant="secondary" onClick={() => setShowImportArea(false)}>
                Cancel
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Manual add */}
      <div className="card p-4">
        <h3 className="font-semibold text-white text-sm mb-3">Add Word Manually</h3>
        <div className="flex gap-2">
          <input
            value={manualGerman}
            onChange={e => setManualGerman(e.target.value)}
            placeholder="German word"
            className="input-field"
            onKeyDown={e => e.key === 'Enter' && manualTranslation && handleAddManual()}
          />
          <input
            value={manualTranslation}
            onChange={e => setManualTranslation(e.target.value)}
            placeholder="English translation"
            className="input-field"
            onKeyDown={e => e.key === 'Enter' && manualGerman && handleAddManual()}
          />
          <Button
            onClick={handleAddManual}
            disabled={!manualGerman.trim() || !manualTranslation.trim()}
            icon={<Plus size={16} />}
          >
            Add
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white text-sm">Coverage Meter</h3>
          <span className="text-xs text-slate-400">{coverage.coverage} · {coverage.cefr}</span>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          You know ~{words.length.toLocaleString()} words → ~{coverage.coverage} of everyday German text (CEFR: {coverage.cefr})
        </p>
      </div>

      <div className="card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white">Vocab tools</h3>
        <p className="text-xs text-slate-500">
          Paste import: German line, then English, then blank line. Wrong columns? Use fix swap once.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={fixSwapBusy || words.length === 0}
            onClick={handleFixEnDeSwap}
            icon={fixSwapBusy ? <Loader2 size={14} className="animate-spin" /> : undefined}
          >
            {fixSwapBusy ? 'Fixing…' : 'Fix EN/DE swap in database'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={auditBusy || words.length === 0}
            onClick={handleFrequencyAudit}
            icon={auditBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          >
            {auditBusy ? 'Auditing…' : `AI frequency audit (next 40)`}
          </Button>
        </div>
        {auditResults?.results?.length > 0 && (
          <div className="rounded-xl border border-surface-700 bg-surface-900/50 p-3 max-h-48 overflow-y-auto text-xs">
            <p className="text-slate-500 mb-2">Batch starting at word #{auditResults.start + 1} — bands: core / useful / niche / noise</p>
            <ul className="space-y-1 text-slate-400">
              {auditResults.results.map((r) => {
                const w = auditResults.slice[r.index - 1]
                if (!w) return null
                return (
                  <li key={r.index}>
                    <span className="text-white">{w.german}</span>
                    {' '}
                    <span className="text-brand-400">({r.band})</span>
                    {' — '}
                    {r.note}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <div className="border-t border-surface-800 pt-4">
          <p className="text-xs text-slate-500 mb-2">Quick practice: random word + one AI example sentence</p>
          <div className="flex flex-wrap gap-2 mb-3">
            <Button type="button" size="sm" variant="secondary" onClick={pickRandomPracticeWord} disabled={!words.length}>
              Random word
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={loadPracticeSentence}
              disabled={!practiceWord || practiceBusy}
              icon={practiceBusy ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
            >
              {practiceBusy ? '…' : 'Make example sentence'}
            </Button>
          </div>
          {practiceWord && (
            <div className="rounded-xl bg-surface-800/60 border border-surface-700 p-3 text-sm">
              <p className="text-white font-medium">{practiceWord.german}</p>
              <p className="text-slate-500 text-xs">{practiceWord.translation}</p>
              {practiceSentence && (
                <p className="text-slate-300 mt-2 italic">{practiceSentence}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total', value: words.length, color: 'text-white' },
          { label: 'Mastered', value: stats.mastered, color: 'text-green-400' },
          { label: 'Learning', value: stats.learning, color: 'text-yellow-400' },
          { label: 'New', value: stats.newCards, color: 'text-blue-400' },
        ].map(s => (
          <div key={s.label} className="card p-3 text-center">
            <div className={`text-xl font-bold ${s.color}`}>{s.value.toLocaleString()}</div>
            <div className="text-xs text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search German or English..."
            className="input-field pl-9"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeFilter === f
                  ? 'bg-brand-500 text-white'
                  : 'bg-surface-800 text-slate-400 hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Word count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          {filtered.length.toLocaleString()} {filtered.length === 1 ? 'word' : 'words'}
          {search || activeFilter !== 'All' ? ` (filtered from ${words.length.toLocaleString()})` : ''}
          {!search && activeFilter === 'All' && words.length > 0 && (
            <span className="text-slate-600"> · newest at top</span>
          )}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport('german')}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <Copy size={12} />
            Copy German
          </button>
          <button
            onClick={() => handleExport('pairs')}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <Copy size={12} />
            Copy Pairs
          </button>
          <button
            onClick={() => handleExport('download')}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <Download size={12} />
            Download
          </button>
        </div>
      </div>

      {/* Word list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 rounded-full border-3 border-surface-700 border-t-brand-500 animate-spin" style={{borderWidth:3}} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <BookMarked size={40} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">
            {words.length === 0
              ? 'No words yet. Import your vocabulary above!'
              : 'No words match your search.'}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="divide-y divide-surface-800">
            {filtered.map((word, i) => {
              const card = cards[word.id]
              return (
                <motion.div
                  key={word.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.02, 0.3) }}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-800/50 transition-colors group"
                >
                  {/* Avatar */}
                  <div className="w-8 h-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400 text-sm font-bold flex-shrink-0">
                    {word.german[0]?.toUpperCase()}
                  </div>

                  {/* German */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white text-sm truncate">
                      {word.german}
                      {word.gender && (
                        <span className="ml-1.5 text-xs text-slate-500">{word.gender}</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {word.translation}
                      {Array.isArray(word.variants) && word.variants.length > 0 && (
                        <span className="text-slate-600"> · +{word.variants.length} forms</span>
                      )}
                    </div>
                  </div>

                  {/* Encounters & cloze (research: multiple exposures) */}
                  <div className="hidden sm:flex flex-col items-end text-[10px] text-slate-500 shrink-0 w-14">
                    <span title="Times seen in story chapters">{word.encounterCount || 0}×</span>
                    {(word.storyClozes?.length || 0) > 0 && (
                      <span className="text-brand-400/90" title="Cloze cards from stories">
                        {word.storyClozes.length} cloze
                      </span>
                    )}
                  </div>

                  {/* SRS bar */}
                  <div className="hidden sm:flex items-center gap-2">
                    <SRSBar repetitions={card?.repetitions || 0} />
                    <span className={`text-xs px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      card?.state === 'new' ? 'bg-blue-500/20 text-blue-400' :
                      card?.state === 'learning' ? 'bg-yellow-500/20 text-yellow-400' :
                      card?.state === 'review' ? 'bg-green-500/20 text-green-400' :
                      'bg-surface-700 text-slate-500'
                    }`}>
                      {card?.state || 'new'}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => germanVoice.speakWord(word.german)}
                      className="p-1.5 text-slate-400 hover:text-white hover:bg-surface-700 rounded-lg transition-all"
                    >
                      <Volume2 size={14} />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(word)}
                      className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Word"
        size="sm"
      >
        {deleteConfirm && (
          <div>
            <p className="text-slate-300 mb-4">
              Delete <strong className="text-white">{deleteConfirm.german}</strong>?
              This will also remove its SRS progress.
            </p>
            <div className="flex gap-2">
              <Button variant="danger" onClick={() => handleDelete(deleteConfirm.id)}>
                Delete
              </Button>
              <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
    </>
  )
}
