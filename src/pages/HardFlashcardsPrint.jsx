import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { attachFlashExamplesToCards, getAllWords } from '../lib/db'
import Button from '../components/shared/Button'

export default function HardFlashcardsPrint() {
  const navigate = useNavigate()
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState('all')
  /** Default: row swap [1,2][3,4] -> [2,1][4,3] so each cut piece matches after typical duplex "flip on long edge". */
  const [backAlignMode, setBackAlignMode] = useState('flip_long_edge')

  useEffect(() => {
    const run = async () => {
      const all = await getAllWords()
      const hard = all
        .filter((w) => !!w.isHard)
        .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
      const enriched = await attachFlashExamplesToCards(
        hard.map((w) => ({
          wordId: w.id,
          word: w,
        }))
      )
      setCards(enriched)
      setLoading(false)
    }
    run()
  }, [])

  const scopedCards = useMemo(() => {
    if (scope === 'all') return cards
    const now = new Date()
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startYesterday = startToday - 24 * 60 * 60 * 1000
    return cards.filter((c) => {
      const w = c.word || {}
      const markedAt = Number(w?.hardMarkedAt || 0)
      if (!Number.isFinite(markedAt) || markedAt <= 0) return false
      if (scope === 'today') return markedAt >= startToday
      if (scope === 'yesterday') return markedAt >= startYesterday && markedAt < startToday
      return true
    })
  }, [scope, cards])

  const cardsPerPage = 10
  const CARD_HEIGHT_PX = 150

  const sheets = useMemo(() => {
    const out = []
    for (let i = 0; i < scopedCards.length; i += cardsPerPage) {
      const chunk = scopedCards.slice(i, i + cardsPerPage)
      while (chunk.length < cardsPerPage) chunk.push(null)
      out.push(chunk)
    }
    return out
  }, [scopedCards])

  const gridClass = 'grid-cols-2 grid-rows-5'

  const backOrder = (sheet) => {
    const withSlot = sheet.map((card, i) => ({ card, slot: i }))
    if (backAlignMode === 'flip_long_edge') {
      // Front [1,2][3,4]...[9,10] -> Back [2,1][4,3]...[10,9]
      const out = []
      for (let i = 0; i < withSlot.length; i += 2) {
        out.push(withSlot[i + 1], withSlot[i])
      }
      return out
    }
    if (backAlignMode === 'flip_short_edge') {
      // Front rows reversed, same left/right within each row
      const out = []
      for (let r = 4; r >= 0; r--) {
        out.push(withSlot[r * 2], withSlot[r * 2 + 1])
      }
      return out
    }
    // Exact slot match in preview
    return withSlot
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          header { display: none !important; }
          nav.bottom-nav { display: none !important; }
          .main-with-sidebar { padding-left: 0 !important; }
          main { padding: 0 !important; }
          .max-w-6xl { max-width: none !important; margin: 0 !important; }
          .print-page {
            page-break-after: always;
            break-after: page;
            margin: 0 !important;
            box-shadow: none !important;
          }
        }
      `}</style>

      <div className="no-print card p-4 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate('/vocab')}>
            <ArrowLeft size={14} />
            Back to Vocab Vault
          </Button>
          <span className="text-sm text-slate-400">
            Hard words: <span className="text-white font-semibold">{scopedCards.length}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500">Scope</label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="bg-surface-800 border border-surface-700 text-slate-200 rounded-lg px-2 py-1 text-sm"
          >
            <option value="today">Saved today</option>
            <option value="yesterday">Saved yesterday</option>
            <option value="all">All hard words</option>
          </select>
          <label className="text-xs text-slate-500">Back alignment</label>
          <select
            value={backAlignMode}
            onChange={(e) => setBackAlignMode(e.target.value)}
            className="bg-surface-800 border border-surface-700 text-slate-200 rounded-lg px-2 py-1 text-sm"
          >
            <option value="flip_long_edge">Duplex flip long edge (default)</option>
            <option value="flip_short_edge">Duplex flip short edge</option>
            <option value="same_slot">Same order on screen only (usually wrong for duplex)</option>
          </select>
          <span className="text-xs text-slate-500">Cards per sheet: 10</span>
          <Button onClick={() => window.print()}>
            <Printer size={14} />
            Print / Save PDF
          </Button>
        </div>
      </div>
      <div className="no-print text-xs text-slate-500 px-1">
        For double-sided print: use <span className="text-slate-300">Flip on long edge</span> with the default back alignment.
        If fronts and backs still swap left-right, try <span className="text-slate-300">Flip on short edge</span> and pick{' '}
        <span className="text-slate-300">Duplex flip short edge</span> here instead.
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 rounded-full border-3 border-surface-700 border-t-brand-500 animate-spin" style={{ borderWidth: 3 }} />
        </div>
      ) : scopedCards.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          No hard words in this scope yet.
        </div>
      ) : (
        <div className="space-y-6">
          {sheets.map((sheet, sheetIndex) => (
            <Fragment key={`sheet-pair-${sheetIndex}`}>
              <div className="print-page card p-4">
                <h3 className="text-sm text-slate-400 mb-3">Front - English (Sheet {sheetIndex + 1})</h3>
                <div className={`grid ${gridClass} gap-3`}>
                  {sheet.map((card, cardIndex) => {
                    if (!card) {
                      return (
                        <div
                          key={`f-empty-${sheetIndex}-${cardIndex}`}
                          className="border border-dashed border-surface-700 rounded-xl p-3 bg-surface-900/25"
                          style={{ height: CARD_HEIGHT_PX }}
                        />
                      )
                    }
                    const w = card.word
                    return (
                    <div
                      key={`f-${w.id}`}
                      className="border border-surface-700 rounded-xl p-3 bg-surface-900/40 overflow-hidden"
                      style={{ height: CARD_HEIGHT_PX }}
                    >
                      <div className="text-lg font-semibold text-black leading-snug">{w.translation || '—'}</div>
                      {String(w.flashFrontNote || '').trim() ? (
                        <p className="mt-3 text-xs text-slate-400 italic">{w.flashFrontNote}</p>
                      ) : null}
                    </div>
                  )})}
                </div>
              </div>

              <div className="print-page card p-4">
                <h3 className="text-sm text-slate-400 mb-3">Back - German + meaning + example (Sheet {sheetIndex + 1})</h3>
                <div className={`grid ${gridClass} gap-3`}>
                  {backOrder(sheet).map((entry, cardIndex) => {
                    const card = entry?.card || null
                    const sourceSlot = Number.isFinite(entry?.slot) ? entry.slot + 1 : null
                    if (!card) {
                      return (
                        <div
                          key={`b-empty-${sheetIndex}-${cardIndex}`}
                          className="border border-dashed border-surface-700 rounded-xl p-3 bg-surface-900/25"
                          style={{ height: CARD_HEIGHT_PX }}
                        />
                      )
                    }
                    const w = card.word
                  const flashExamples = Array.isArray(card.flashExamples)
                    ? card.flashExamples.filter((ex) => ex && String(ex.de || '').trim())
                    : []
                    const displayExamples = flashExamples.length
                    ? flashExamples
                    : String(w.example || '').trim()
                      ? [{ de: String(w.example).trim(), en: '' }]
                      : []
                    const firstExample = displayExamples[0] || null
                  return (
                    <div
                      key={`b-${w.id}`}
                      className="border border-surface-700 rounded-xl p-3 bg-surface-900/40 overflow-hidden"
                      style={{ height: CARD_HEIGHT_PX }}
                    >
                      <div className="text-[10px] text-slate-500 mb-1">Slot {sourceSlot}</div>
                      <div className="text-base font-bold text-black leading-snug">
                        {w.gender ? `${w.gender} ` : ''}
                        {w.german || '—'}
                      </div>
                      <div className="mt-1 text-sm text-black font-medium">{w.translation || '—'}</div>
                        <div className="mt-2 text-[11px] leading-snug">
                        <p className="text-black">• {firstExample?.de || '—'}</p>
                        <p className="text-black">{firstExample?.en || '—'}</p>
                        </div>
                    </div>
                  )
                })}
                </div>
              </div>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}