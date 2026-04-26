import { useState, useEffect, useMemo } from 'react'
import { Volume2, Clock, ChevronDown, ChevronUp, Bookmark } from 'lucide-react'
import { germanVoice } from '../../lib/voice'
import clsx from 'clsx'
import { updateWord } from '../../lib/db'
import { resolveEnglishCueSentence, splitSentenceAtGloss } from '../../lib/flashcardCue'

const CARD_SCENE_HEIGHT = 460

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Highlights lemma / saved variants in German story context (red, bold, underline). */
function StoryContextWithLemmaHighlight({ text, word }) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const surfaces = [
    String(word?.german || '').trim(),
    ...(Array.isArray(word?.variants) ? word.variants : []),
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
  if (!surfaces.length) {
    return <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{raw}</p>
  }
  const uniq = [...new Set(surfaces)].sort((a, b) => b.length - a.length)
  const pattern = uniq.map(escapeRegExp).join('|')
  let re
  try {
    re = new RegExp(`(${pattern})`, 'gi')
  } catch {
    return <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{raw}</p>
  }
  const parts = raw.split(re)
  return (
    <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
      {parts.map((part, i) => {
        const matched = uniq.some((s) => part.toLowerCase() === s.toLowerCase())
        if (matched) {
          return (
            <span
              key={i}
              className="font-bold text-red-400 underline decoration-red-400 decoration-2 underline-offset-2"
            >
              {part}
            </span>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </p>
  )
}

function EnglishSentenceEmphasis({ sentence, translation }) {
  const { before, emphasized, after } = useMemo(
    () => splitSentenceAtGloss(sentence, translation),
    [sentence, translation]
  )
  if (!String(sentence || '').trim()) return null
  if (!emphasized) {
    return (
      <p className="text-base text-slate-200 leading-relaxed px-1">{sentence}</p>
    )
  }
  return (
    <p className="text-base text-slate-200 leading-relaxed px-1">
      {before}
      <span className="font-bold underline decoration-2 decoration-brand-400/90 underline-offset-2 text-white">
        {emphasized}
      </span>
      {after}
    </p>
  )
}

export default function FlashCard({ card, mode = 'en_to_de', isFlipped, onFlip, onWordSaved }) {
  const { word } = card
  const flashExamples = Array.isArray(card.flashExamples)
    ? card.flashExamples.filter((ex) => ex && String(ex.de || '').trim())
    : []
  const hasFlashExamples = flashExamples.length > 0

  const cueSentence = resolveEnglishCueSentence(word, flashExamples)
  const useCaseParagraph =
    String(word.flashUseCaseNote || '').trim() ||
    String(card.flashUseCaseText || '').trim()
  const fullMeaningFromLesson = String(word.microLesson?.fullMeaning || '').trim()
  /** One meaning block: plain-English use case wins; lesson full meaning only if no use case (avoids duplicate blocks). */
  const backMeaningParagraph = useCaseParagraph || fullMeaningFromLesson

  const displayExamples = hasFlashExamples
    ? flashExamples
    : String(word.example || '').trim()
      ? [{ de: String(word.example).trim(), en: '' }]
      : []
  const hasDisplayExamples = displayExamples.length > 0

  const lastReviewedText = card.lastReview
    ? (() => {
        const days = Math.round((Date.now() - card.lastReview) / 86400000)
        if (days === 0) return 'Reviewed today'
        if (days === 1) return 'Reviewed yesterday'
        return `Reviewed ${days} days ago`
      })()
    : 'New card'

  const genderColor = {
    der: 'text-blue-400',
    die: 'text-pink-400',
    das: 'text-green-400',
  }

  const [editOpen, setEditOpen] = useState(false)
  const [cueDraft, setCueDraft] = useState('')
  const [frontNoteDraft, setFrontNoteDraft] = useState('')
  const [backNoteDraft, setBackNoteDraft] = useState('')
  const [useCaseDraft, setUseCaseDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEditOpen(false)
    setCueDraft(String(word.flashCueSentenceEn || ''))
    setFrontNoteDraft(String(word.flashFrontNote || ''))
    setBackNoteDraft(String(word.flashBackNote || ''))
    setUseCaseDraft(String(word.flashUseCaseNote || ''))
  }, [word.id])

  const persist = async (patch) => {
    if (!word?.id) return
    setSaving(true)
    try {
      await updateWord(word.id, patch)
      onWordSaved?.(word.id, patch)
    } finally {
      setSaving(false)
    }
  }

  const saveDrafts = async () => {
    await persist({
      flashCueSentenceEn: cueDraft.trim(),
      flashFrontNote: frontNoteDraft.trim(),
      flashBackNote: backNoteDraft.trim(),
      flashUseCaseNote: useCaseDraft.trim(),
    })
  }

  const handleBlurSave = () => {
    saveDrafts()
  }

  const toggleHardWord = async () => {
    const nextIsHard = !word?.isHard
    await persist({
      isHard: nextIsHard,
      hardMarkedAt: nextIsHard ? Date.now() : null,
    })
  }

  return (
    <div className="flashcard-scene w-full" style={{ height: CARD_SCENE_HEIGHT }}>
      <div className={`flashcard-inner ${isFlipped ? 'flipped' : ''}`}>
        {/* Front — English → guess German */}
        <div
          className="flashcard-face card flex flex-col items-stretch justify-between p-5 sm:p-6 text-center overflow-y-auto"
          style={{ minHeight: CARD_SCENE_HEIGHT }}
        >
          <div className="flex-1 flex flex-col items-center justify-center min-h-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-slate-500 uppercase tracking-wider">
                {mode === 'de_to_en' ? 'German' : 'English cue'}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleHardWord()
                }}
                className={clsx(
                  'p-1 rounded-md border transition-colors',
                  word?.isHard
                    ? 'text-amber-300 border-amber-400/40 bg-amber-500/10'
                    : 'text-slate-500 border-surface-700 hover:text-amber-300 hover:border-amber-400/30'
                )}
                aria-label={word?.isHard ? 'Unmark hard word' : 'Mark as hard word'}
                title={word?.isHard ? 'Saved to hard print deck' : 'Mark as hard for print deck'}
              >
                <Bookmark size={13} className={word?.isHard ? 'fill-current' : ''} />
              </button>
            </div>

            {mode === 'de_to_en' && (
              <>
                <div className="flex items-center gap-3 mb-3 flex-wrap justify-center">
                  {word.gender && (
                    <span
                      className={clsx(
                        'text-xl font-medium',
                        genderColor[word.gender] || 'text-slate-400'
                      )}
                    >
                      {word.gender}
                    </span>
                  )}
                  <h2 className="text-4xl font-bold text-white font-mono">{word.german}</h2>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      germanVoice.speakWord(word.german)
                    }}
                    className="text-slate-500 hover:text-brand-400 transition-colors"
                    type="button"
                    aria-label="Play German"
                  >
                    <Volume2 size={22} />
                  </button>
                </div>
              </>
            )}

            {mode === 'en_to_de' && (
              <div className="w-full max-w-md space-y-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Main gloss</p>
                <p className="text-xl sm:text-2xl font-semibold text-brand-200 leading-snug px-1">
                  {word.translation || '—'}
                </p>

                <div className="pt-2 border-t border-surface-700/80">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
                    English example (underline = what you&apos;re answering)
                  </p>
                  {cueSentence ? (
                    <EnglishSentenceEmphasis sentence={cueSentence} translation={word.translation} />
                  ) : (
                    <p className="text-sm text-amber-400/90 leading-snug">
                      No example sentence yet. Open &quot;Edit cue &amp; notes&quot; and paste an English
                      sentence that fits this gloss — use a phrase or situation so only one German answer
                      fits (e.g. not just &quot;but&quot; alone).
                    </p>
                  )}
                </div>

                {String(word.flashFrontNote || '').trim() ? (
                  <p className="text-sm text-slate-400 italic leading-snug border-t border-surface-700/60 pt-3">
                    {word.flashFrontNote}
                  </p>
                ) : null}

                <p className="text-slate-500 text-sm">Say the German — then flip.</p>
              </div>
            )}
          </div>

          <div className="shrink-0 space-y-2 mt-3">
            <button
              type="button"
              onClick={() => setEditOpen((o) => !o)}
              className="w-full flex items-center justify-center gap-2 py-2 text-xs text-slate-500 hover:text-brand-400 transition-colors"
            >
              {editOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              Edit cue &amp; notes
            </button>

            {editOpen && (
              <div
                className="text-left rounded-xl bg-surface-800/90 border border-surface-700 p-3 space-y-2 max-h-[280px] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                {String(word.storyEncounterContext || '').trim() ? (
                  <div className="rounded-lg bg-teal-950/35 border border-teal-800/35 px-2 py-2 mb-1">
                    <p className="text-[10px] uppercase text-teal-500/85 mb-1">Story moment (saved)</p>
                    <p className="text-[11px] text-slate-400 whitespace-pre-wrap leading-snug max-h-28 overflow-y-auto">
                      {word.storyEncounterContext}
                    </p>
                  </div>
                ) : null}
                <label className="block text-[10px] uppercase text-slate-500">English cue sentence</label>
                <textarea
                  value={cueDraft}
                  onChange={(e) => setCueDraft(e.target.value)}
                  onBlur={handleBlurSave}
                  rows={2}
                  className="w-full text-sm bg-surface-900 border border-surface-600 rounded-lg px-2 py-1.5 text-slate-200 placeholder:text-slate-600"
                  placeholder="Full English sentence containing your gloss…"
                />
                <label className="block text-[10px] uppercase text-slate-500">Note on front (optional)</label>
                <textarea
                  value={frontNoteDraft}
                  onChange={(e) => setFrontNoteDraft(e.target.value)}
                  onBlur={handleBlurSave}
                  rows={2}
                  className="w-full text-xs bg-surface-900 border border-surface-600 rounded-lg px-2 py-1.5 text-slate-300"
                  placeholder="Extra hint only you need…"
                />
                <label className="block text-[10px] uppercase text-slate-500">Note on back (optional)</label>
                <textarea
                  value={backNoteDraft}
                  onChange={(e) => setBackNoteDraft(e.target.value)}
                  onBlur={handleBlurSave}
                  rows={2}
                  className="w-full text-xs bg-surface-900 border border-surface-600 rounded-lg px-2 py-1.5 text-slate-300"
                  placeholder="After you flip — personal reminder…"
                />
                <label className="block text-[10px] uppercase text-slate-500">
                  When people use this (plain English, no grammar jargon)
                </label>
                <textarea
                  value={useCaseDraft}
                  onChange={(e) => setUseCaseDraft(e.target.value)}
                  onBlur={handleBlurSave}
                  rows={3}
                  className="w-full text-xs bg-surface-900 border border-surface-600 rounded-lg px-2 py-1.5 text-slate-300"
                  placeholder="Overrides AI meaning if set — explain situations, not cases/tenses."
                />
                <p className="text-[10px] text-slate-600">{saving ? 'Saving…' : 'Saved when you leave each field.'}</p>
                <button
                  type="button"
                  onClick={toggleHardWord}
                  className={clsx(
                    'w-full mt-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-xs transition-colors',
                    word?.isHard
                      ? 'text-amber-300 border-amber-400/40 bg-amber-500/10'
                      : 'text-slate-400 border-surface-700 hover:text-amber-300 hover:border-amber-400/30'
                  )}
                >
                  <Bookmark size={13} className={word?.isHard ? 'fill-current' : ''} />
                  {word?.isHard ? 'Saved to hard list' : 'Save to hard list'}
                </button>
              </div>
            )}

            <div className="flex items-center justify-center gap-1 text-xs text-slate-600">
              <Clock size={11} />
              <span>{lastReviewedText}</span>
            </div>

            <button
              onClick={onFlip}
              className="w-full mt-1 px-6 py-2.5 bg-surface-800 hover:bg-surface-700 text-slate-300 text-sm font-medium rounded-xl transition-all border border-surface-700 hover:border-surface-600"
            >
              Show Answer
            </button>
          </div>
        </div>

        {/* Back */}
        <div
          className="flashcard-face flashcard-back card flex flex-col items-center justify-start p-4 sm:p-5 text-center bg-surface-900 overflow-y-auto"
          style={{ minHeight: CARD_SCENE_HEIGHT }}
        >
          <div className="w-full max-w-lg shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">German</div>
            <div className="flex items-center justify-center gap-2 mb-2 flex-wrap">
              {word.gender && (
                <span
                  className={clsx('text-xl font-medium', genderColor[word.gender] || 'text-slate-400')}
                >
                  {word.gender}
                </span>
              )}
              <h2 className="text-2xl sm:text-3xl font-bold text-white font-mono">{word.german}</h2>
              <button
                type="button"
                onClick={toggleHardWord}
                className={clsx(
                  'p-1 rounded-md border transition-colors',
                  word?.isHard
                    ? 'text-amber-300 border-amber-400/40 bg-amber-500/10'
                    : 'text-slate-500 border-surface-700 hover:text-amber-300 hover:border-amber-400/30'
                )}
                aria-label={word?.isHard ? 'Unmark hard word' : 'Mark as hard word'}
                title={word?.isHard ? 'Saved to hard print deck' : 'Mark as hard for print deck'}
              >
                <Bookmark size={13} className={word?.isHard ? 'fill-current' : ''} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  germanVoice.speakWord(word.german)
                }}
                className="text-slate-500 hover:text-brand-400 transition-colors"
                aria-label="Play German"
              >
                <Volume2 size={20} />
              </button>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">English gloss</div>
            <div className="text-lg sm:text-xl text-brand-300 font-medium px-1">{word.translation}</div>

            {hasDisplayExamples && (
              <div className="mt-3 pt-3 border-t border-surface-700 w-full">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
                  {hasFlashExamples ? 'Examples (from your saved lesson)' : 'Example'}
                </div>
                <ul className="space-y-2 text-left">
                  {displayExamples.map((ex, i) => (
                    <li
                      key={i}
                      className="rounded-lg bg-surface-800/90 border border-surface-700 px-3 py-2"
                    >
                      <p className="text-sm text-slate-100 leading-snug">{ex.de}</p>
                      {String(ex.en || '').trim() ? (
                        <p className="text-xs text-slate-400 mt-1 leading-snug">{ex.en}</p>
                      ) : null}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          germanVoice.speakWord(ex.de)
                        }}
                        className="mt-1.5 text-[11px] text-brand-400 hover:underline"
                      >
                        Play German
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {backMeaningParagraph ? (
              <div className="mt-3 text-left rounded-xl bg-surface-800/80 border border-surface-700 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                  What it&apos;s for (plain English)
                </div>
                <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{backMeaningParagraph}</p>
              </div>
            ) : null}

            {String(word.storyEncounterContext || '').trim() ? (
              <div className="mt-3 text-left rounded-xl bg-teal-950/35 border border-teal-800/40 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider text-teal-500/90 mb-1">
                  Story moment (where you saved it)
                </div>
                <StoryContextWithLemmaHighlight text={word.storyEncounterContext} word={word} />
              </div>
            ) : null}

            {String(word.flashBackNote || '').trim() ? (
              <div className="mt-3 text-left rounded-xl bg-brand-900/20 border border-brand-700/30 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Your note</div>
                <p className="text-sm text-brand-100/95 leading-relaxed whitespace-pre-wrap">
                  {word.flashBackNote}
                </p>
              </div>
            ) : null}

            {Array.isArray(word.variants) && word.variants.length > 0 && (
              <div className="mt-3 text-left w-full rounded-xl bg-surface-800/80 border border-surface-700 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Forms</div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {[word.german, ...word.variants].filter(Boolean).join(', ')}
                </p>
              </div>
            )}
            {word.plural && (
              <div className="text-sm text-slate-500 mt-2">Plural: {word.plural}</div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
