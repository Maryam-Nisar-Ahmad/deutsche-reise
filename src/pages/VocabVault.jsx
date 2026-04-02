import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Upload, Plus, Volume2, Trash2, Download, Copy,
  Filter, BookMarked, AlertCircle
} from 'lucide-react'
import { getAllWords, getWordCount, importWords, addWord, deleteWord, getCardForWord } from '../lib/db'
import { parseDuolingoFormat, parseManualEntry } from '../lib/wordParser'
import { germanVoice } from '../lib/voice'
import Button from '../components/shared/Button'
import Modal from '../components/shared/Modal'
import SessionTimer from '../components/shared/SessionTimer'

const FILTERS = ['All', 'New', 'Learning', 'Mastered', 'Due Today']

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
  const [manualGerman, setManualGerman] = useState('')
  const [manualTranslation, setManualTranslation] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [showImportArea, setShowImportArea] = useState(false)
  const fileRef = useRef(null)

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
    let list = words
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
      total: words.length,
      mastered: all.filter(c => c.state === 'review').length,
      learning: all.filter(c => c.state === 'learning' || c.state === 'relearning').length,
      newCards: all.filter(c => c.state === 'new').length,
    }
  }, [words, cards])

  const handleImport = async () => {
    if (!importText.trim()) return
    setImporting(true)
    try {
      const parsed = parseDuolingoFormat(importText)
      const result = await importWords(parsed)
      setImportResult({ added: result.added, skipped: result.skipped, ignored: parsed.length - result.added - result.skipped })
      setImportText('')
      await loadWords()
      setTimeout(() => setImportResult(null), 5000)
    } catch (e) {
      console.error(e)
    }
    setImporting(false)
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

  const parsedCount = importText.trim() ? parseDuolingoFormat(importText).length : 0

  return (
    <>
    <SessionTimer goalMinutes={10} label="Vocab Vault" pageKey="vocab" />
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Vocab Vault</h2>
          <p className="text-sm text-slate-400">Manage your German vocabulary</p>
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
              Format: German word, then English translation, then blank line. Repeat.
            </p>
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder={"hilfreich\nhelpful\n\nSchatz\ntreasure\n\nordentlich\ntidy"}
              rows={8}
              className="input-field font-mono text-sm resize-y mb-3"
            />
            {parsedCount > 0 && (
              <p className="text-sm text-brand-400 mb-3 font-medium">
                ✓ {parsedCount.toLocaleString()} words detected
              </p>
            )}
            {importResult && (
              <div className="flex items-center gap-2 text-sm mb-3 p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400">
                <AlertCircle size={14} />
                Added {importResult.added} words · {importResult.skipped} already existed · {importResult.ignored} ignored
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
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total, color: 'text-white' },
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
                    <div className="text-xs text-slate-500 truncate">{word.translation}</div>
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
