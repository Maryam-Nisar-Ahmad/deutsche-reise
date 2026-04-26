import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, RefreshCw, AlertCircle, BookOpenCheck } from 'lucide-react'
import {
  buildDailyCoachSnapshot,
  buildDataCoverageCatalog,
  generateDailyCoachMarkdown,
  getLocalYesterdayYmd,
  readCoachCache,
  writeCoachCache,
} from '../../lib/dailyCoach'
import { cleanMarkdown } from '../../lib/deepseek'

function renderCoachMarkdown(md) {
  const lines = String(md || '').split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const h3 = line.match(/^###\s+(.*)$/)
    if (h3) {
      out.push(
        <h4 key={`h-${i}`} className="text-xs font-semibold text-brand-300 uppercase tracking-wide mt-3 mb-1.5 first:mt-0">
          {h3[1].trim()}
        </h4>
      )
      i += 1
      continue
    }
    if (line.trim() === '') {
      out.push(<div key={`b-${i}`} className="h-1.5" />)
      i += 1
      continue
    }
    if (/^[-*]\s+/.test(line.trim())) {
      const items = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].replace(/^[-*]\s+/, '').trim())
        i += 1
      }
      out.push(
        <ul key={`ul-${i}`} className="list-disc pl-4 space-y-0.5 text-slate-300 text-[12px] leading-snug">
          {items.map((t, j) => (
            <li key={j}>{cleanMarkdown(t)}</li>
          ))}
        </ul>
      )
      continue
    }
    out.push(
      <p key={`p-${i}`} className="text-[12px] text-slate-300 leading-snug">
        {cleanMarkdown(line)}
      </p>
    )
    i += 1
  }
  return out
}

export default function DailyCoachCard({
  phaseInfo,
  wordCount,
  firmMastered,
  weekGrammarSessions,
  dailyXPGoal,
  newCardsPerDay,
  frequencyWordsPerDay,
}) {
  const yesterdayYmd = useMemo(() => getLocalYesterdayYmd(), [])
  const dataCoverage = useMemo(() => buildDataCoverageCatalog(), [])

  const [markdown, setMarkdown] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastHash, setLastHash] = useState('')
  const [fromCache, setFromCache] = useState(false)

  useEffect(() => {
    const c = readCoachCache()
    if (!c || c.yesterdayYmd !== yesterdayYmd || !c.markdown) return
    setMarkdown(c.markdown)
    setLastHash(c.snapshotHash || '')
    setFromCache(true)
  }, [yesterdayYmd])

  const snapshotContext = useMemo(
    () => ({
      yesterdayYmd,
      phase: phaseInfo?.phase ?? null,
      phaseName: phaseInfo?.name ?? null,
      wordCount,
      firmMastered,
      weekGrammarSessions,
      dailyXPGoal,
      newCardsPerDay,
      frequencyWordsPerDay,
    }),
    [
      yesterdayYmd,
      phaseInfo?.phase,
      phaseInfo?.name,
      wordCount,
      firmMastered,
      weekGrammarSessions,
      dailyXPGoal,
      newCardsPerDay,
      frequencyWordsPerDay,
    ]
  )

  const runGenerate = useCallback(
    async (forceRefresh) => {
      setError('')
      setLoading(true)
      setFromCache(false)
      try {
        const snap = await buildDailyCoachSnapshot(snapshotContext)
        if (!forceRefresh) {
          const c = readCoachCache()
          if (c?.yesterdayYmd === yesterdayYmd && c?.snapshotHash === snap.snapshotHash && c?.markdown) {
            setMarkdown(c.markdown)
            setLastHash(snap.snapshotHash)
            setFromCache(true)
            setLoading(false)
            return
          }
        }
        const md = await generateDailyCoachMarkdown(snap)
        setMarkdown(md)
        setLastHash(snap.snapshotHash)
        writeCoachCache({
          yesterdayYmd,
          snapshotHash: snap.snapshotHash,
          markdown: md,
          updatedAt: Date.now(),
        })
        setFromCache(false)
      } catch (e) {
        const msg = e?.message || String(e)
        if (msg.includes('NO_API_KEY')) {
          setError('Add your DeepSeek API key in Settings to generate the coach report.')
        } else {
          setError(msg.length > 220 ? `${msg.slice(0, 220)}…` : msg)
        }
        setMarkdown('')
      } finally {
        setLoading(false)
      }
    },
    [snapshotContext, yesterdayYmd]
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 }}
      className="card p-4 sm:p-5 border border-surface-700/80"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="text-amber-400 shrink-0" size={20} />
          <div className="min-w-0">
            <h3 className="font-semibold text-white text-sm">Evidence-based coach</h3>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
              Review is anchored on <span className="text-slate-400">{yesterdayYmd}</span> (yesterday). Week/month blocks are
              previews only. Read-only — nothing here changes your data.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            disabled={loading}
            onClick={() => runGenerate(false)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-medium"
          >
            <BookOpenCheck size={14} />
            {markdown ? 'Refresh' : 'Generate'}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => runGenerate(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-800 border border-surface-600 hover:border-surface-500 disabled:opacity-50 text-slate-200 text-xs"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Regenerate
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-950/40 border border-red-900/50 px-3 py-2 text-[12px] text-red-200 mb-3">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {fromCache && markdown && !loading && (
        <p className="text-[10px] text-slate-600 mb-2">Showing saved report for yesterday (data unchanged).</p>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-6">
          <div className="h-5 w-5 rounded-full border-2 border-surface-600 border-t-brand-400 animate-spin" />
          Analyzing your study trail and research excerpts…
        </div>
      )}

      {!loading && markdown && <div className="space-y-1 border-t border-surface-800 pt-3">{renderCoachMarkdown(markdown)}</div>}

      {!loading && !markdown && !error && (
        <p className="text-xs text-slate-500 py-2">
          Generate a personalized summary: how yesterday looked vs your goals, what is working, what to adjust next — grounded
          in your bundled research document (via retrieved excerpts), not generic advice.
        </p>
      )}

      <details className="group mt-3 rounded-xl border border-surface-800 bg-surface-900/50 px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-medium text-slate-400 hover:text-slate-300 select-none list-none flex items-center gap-2 [&::-webkit-details-marker]:hidden">
          <span className="text-slate-600 group-open:rotate-90 transition-transform inline-block">▸</span>
          What the coach can and cannot see
        </summary>
        <div className="mt-3 pt-3 border-t border-surface-800 space-y-3 text-[10px] text-slate-500 leading-relaxed">
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Sent to the coach (summary)</p>
            <ul className="list-disc pl-4 space-y-1">
              {dataCoverage.reflectedInSnapshot.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Blind spots (honesty)
            </p>
            <ul className="list-disc pl-4 space-y-1">
              {dataCoverage.weaklyTrackedOrMissing.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
          <p className="text-slate-600">
            The report is built from yesterday’s snapshot JSON + research excerpts + your trajectory fields. Click{' '}
            <strong className="text-slate-500">Regenerate</strong> after a long study day if the cached text feels stale.
          </p>
        </div>
      </details>

      <p className="text-[10px] text-slate-600 mt-3 leading-snug">
        AI can be wrong. Use this as reflection, not a prescription. Your FSRS data and timers stay exactly as they are.
      </p>
    </motion.div>
  )
}
